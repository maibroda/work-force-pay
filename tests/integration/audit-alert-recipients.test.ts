import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import * as emailLib from "@/lib/email";
import { logAudit } from "@/server/services/audit";
import { auditAlertSettings, reportIntegrityFailure, sealOrganization, sendChainHeads, setAuditAlertRecipients, verifyOrganization } from "@/server/services/audit-seal";
import { isolatedOrg, uid } from "../helpers";

/**
 * Who is told when the audit log fails its check, and who gets the weekly chain head, is a SETTING with a default: everyone who can view the audit
 * log. It can be widened with extra addresses (for example an outside auditor), or narrowed to named addresses only. It can never be empty.
 */
const KEY = "alert-recipients-test-sealing-key-of-32-plus-chars";
beforeAll(() => vi.stubEnv("AUDIT_SEAL_KEY", KEY));
afterAll(() => vi.unstubAllEnvs());
const made: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  // leave every organization this file made fully sealed, so a later test that checks ALL organizations does not find rows still waiting
  for (const org of made.splice(0)) await sealOrganization(org, { now: new Date(Date.now() + 300_000) });
});

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@alerts.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}
async function world() {
  const t = await isolatedOrg();
  made.push(t.org.id);
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  const auditor = await person(t.org.id, "AUDITOR", "auditor");
  await person(t.org.id, "EMPLOYEE", "staff"); // cannot view the audit log
  await logAudit(founder, { action: "TEST_ROW", entity: "Test", entityId: "1" });
  await sealOrganization(t.org.id, { now: new Date(Date.now() + 300_000) });
  return { t, org: t.org.id, founder, auditor };
}
const capture = () => {
  const sent: string[] = [];
  vi.spyOn(emailLib, "sendEmail").mockImplementation(async (m) => void sent.push(m.to as string));
  return sent;
};
const failure = async (org: string) => {
  const pass = await verifyOrganization(org, { now: new Date(Date.now() + 40 * 60_000) });
  await reportIntegrityFailure(org, { ...pass, ok: false, findingCount: 1, findings: [{ kind: "MODIFIED", seq: 1, auditLogId: "x", detail: "d" }] });
};

describe("who is told about the audit log", () => {
  it("is, by default, everyone in the organization who can view the audit log, and nobody else", async () => {
    const w = await world();
    const sent = capture();
    expect(await auditAlertSettings(w.founder)).toEqual({ extraEmails: [], includeEveryone: true });
    await failure(w.org);
    expect(sent.sort()).toEqual([w.auditor.email, w.founder.email].sort());
    sent.length = 0;
    await sendChainHeads();
    expect(sent.filter((e) => [w.auditor.email, w.founder.email].includes(e)).sort()).toEqual([w.auditor.email, w.founder.email].sort());
  });

  it("can be widened with extra addresses (stored lower-case, once each)", async () => {
    const w = await world();
    await setAuditAlertRecipients(w.founder, { extraEmails: ["Outside.Auditor@Firm.test", "outside.auditor@firm.test", " second@firm.test "], includeEveryone: true });
    expect(await auditAlertSettings(w.founder)).toEqual({ extraEmails: ["outside.auditor@firm.test", "second@firm.test"], includeEveryone: true });
    const sent = capture();
    await failure(w.org);
    expect(sent.sort()).toEqual([w.auditor.email, w.founder.email, "outside.auditor@firm.test", "second@firm.test"].sort());
  });

  it("can be narrowed to the named addresses only", async () => {
    const w = await world();
    await setAuditAlertRecipients(w.founder, { extraEmails: ["only.me@firm.test"], includeEveryone: false });
    const sent = capture();
    await failure(w.org);
    expect(sent).toEqual(["only.me@firm.test"]);
  });

  it("is never nobody: narrowing to an empty list falls back to everyone who can view the audit log", async () => {
    const w = await world();
    await setAuditAlertRecipients(w.founder, { extraEmails: [], includeEveryone: false });
    const sent = capture();
    await failure(w.org);
    expect(sent.sort()).toEqual([w.auditor.email, w.founder.email].sort());
  });

  it("is changed only by someone who can manage settings, with a real address, and every change is written to the audit log", async () => {
    const w = await world();
    await expect(setAuditAlertRecipients(w.auditor, { extraEmails: ["a@firm.test"], includeEveryone: true })).rejects.toThrow(/permission/i);
    await expect(setAuditAlertRecipients(w.founder, { extraEmails: ["not-an-email"], includeEveryone: true })).rejects.toThrow(/not an email address/i);
    expect(await db.auditLog.count({ where: { organizationId: w.org, action: "AUDIT_ALERT_RECIPIENTS_CHANGE" } })).toBe(0);
    await setAuditAlertRecipients(w.founder, { extraEmails: ["a@firm.test"], includeEveryone: false });
    const entry = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.org, action: "AUDIT_ALERT_RECIPIENTS_CHANGE" } });
    expect(entry.newValue).toMatchObject({ extraEmails: ["a@firm.test"], includeEveryone: false });
    expect(entry.oldValue).toMatchObject({ extraEmails: [], includeEveryone: true });
  });

  it("is each organization's own: one organization's list is never used for, or shown to, another", async () => {
    const a = await world();
    const b = await world();
    await setAuditAlertRecipients(a.founder, { extraEmails: ["only.a@firm.test"], includeEveryone: false });
    expect(await auditAlertSettings(b.founder)).toEqual({ extraEmails: [], includeEveryone: true });
    const sent = capture();
    await failure(b.org);
    expect(sent).not.toContain("only.a@firm.test");
    expect(sent.sort()).toEqual([b.auditor.email, b.founder.email].sort());
  });
});
