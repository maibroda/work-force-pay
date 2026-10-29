import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import * as emailLib from "@/lib/email";
import { redactionProof } from "@/lib/audit-seal";
import { logAudit } from "@/server/services/audit";
import {
  auditIntegrityOverview,
  redactAuditRows,
  reportIntegrityFailure,
  sealAllOrganizations,
  sealOrganization,
  sendChainHeads,
  verifyAllOrganizations,
  verifyAuditNow,
  verifyOrganization,
} from "@/server/services/audit-seal";
import { isolatedOrg, uid } from "../helpers";

/**
 * Rule 5: the audit log is tamper-evident. Every row gets a seal; changing, removing, forging or back-dating a row, or a seal, is found by the check.
 * The "attacker" below has full database rights (can switch off triggers); what they lack is the sealing key. Everything is invented.
 */
const KEY = "integration-test-sealing-key-of-32-plus-characters";
const minutes = (n: number) => new Date(Date.now() + n * 60_000);
const LATER = () => minutes(5); // "now", far enough on that rows written a moment ago are old enough to seal

beforeAll(() => vi.stubEnv("AUDIT_SEAL_KEY", KEY));
afterAll(() => vi.unstubAllEnvs());
afterEach(() => vi.restoreAllMocks());

async function newOrg() {
  const t = await isolatedOrg();
  return { t, org: t.org.id, admin: t.ctx("COMPANY_ADMIN") as Ctx };
}
async function write(ctx: Ctx, n: number, tag = "ENTRY") {
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    await logAudit(ctx, { action: `TEST_${tag}`, entity: "Test", entityId: `e${i}`, newValue: { n: i, note: `row ${i}` }, reason: `reason ${i}` });
  }
  const rows = await db.auditLog.findMany({ where: { organizationId: ctx.orgId, action: `TEST_${tag}` }, orderBy: { createdAt: "asc" } });
  rows.forEach((r) => ids.push(r.id));
  return ids;
}
/** Someone with the database login and the right to switch triggers off (superuser), but not the sealing key. */
async function attack(fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<unknown>) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await fn(tx);
  });
}
const kinds = async (org: string) => (await verifyOrganization(org, { now: LATER() })).findings.map((f) => f.kind).sort();

describe("sealing", () => {
  it("seals rows once they are a minute old, in order, 1 to n, and a second run seals nothing", async () => {
    const { org, admin } = await newOrg();
    const ids = await write(admin, 5);
    expect((await sealOrganization(org, { now: new Date() })).sealed).toBe(0); // too fresh: transactions in flight may not have committed
    expect((await sealOrganization(org, { now: LATER() })).sealed).toBe(5);
    const seals = await db.auditSeal.findMany({ where: { organizationId: org }, orderBy: { seq: "asc" } });
    expect(seals.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(seals.map((s) => s.auditLogId)).toEqual(ids);
    expect(seals.every((s) => !s.sealedLate)).toBe(true);
    expect((await sealOrganization(org, { now: LATER() })).sealed).toBe(0);
    const report = await verifyOrganization(org, { now: LATER() });
    expect(report).toMatchObject({ ok: true, checked: 5, findingCount: 0, stalledRows: 0 });
    expect(report.head).toEqual({ seq: 5, chainHash: seals[4].chainHash });
  });

  it("two sealers at the same moment leave one clean chain: no duplicate and no gap", async () => {
    const { org, admin } = await newOrg();
    await write(admin, 30);
    await Promise.all([sealOrganization(org, { now: LATER() }), sealOrganization(org, { now: LATER() })]);
    const seals = await db.auditSeal.findMany({ where: { organizationId: org }, orderBy: { seq: "asc" } });
    expect(seals.map((s) => s.seq)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect((await verifyOrganization(org, { now: LATER() })).ok).toBe(true);
  });

  it("marks rows sealed long after they were written (history from before sealing began) as 'sealed late'", async () => {
    const { org, admin } = await newOrg();
    await db.auditLog.create({ data: { organizationId: org, userName: "Old", action: "OLD", entity: "Test", createdAt: new Date(Date.now() - 3 * 3_600_000) } });
    await write(admin, 1);
    await sealOrganization(org, { now: LATER() });
    const seals = await db.auditSeal.findMany({ where: { organizationId: org }, orderBy: { seq: "asc" } });
    expect(seals.map((s) => s.sealedLate)).toEqual([true, false]);
    expect((await verifyOrganization(org, { now: LATER() })).sealedLate).toBe(1);
  });

  it("is done for every organization with rows waiting by the scheduled job's function", async () => {
    const a = await newOrg();
    const b = await newOrg();
    await write(a.admin, 2);
    await write(b.admin, 3);
    const results = await sealAllOrganizations({ now: LATER() });
    expect(results.find((r) => r.organizationId === a.org)?.sealed).toBe(2);
    expect(results.find((r) => r.organizationId === b.org)?.sealed).toBe(3);
  });

  it("seals and checks 10,000 entries in a measured, reasonable time", async () => {
    const { org } = await newOrg();
    await db.auditLog.createMany({ data: Array.from({ length: 10_000 }, (_, i) => ({ organizationId: org, userName: "Bulk", action: "BULK", entity: "Test", entityId: String(i), newValue: { i }, createdAt: new Date(Date.now() - 600_000 + i) })) });
    const t0 = Date.now();
    expect((await sealOrganization(org, { now: LATER() })).sealed).toBe(10_000);
    const t1 = Date.now();
    const report = await verifyOrganization(org, { now: LATER() });
    const t2 = Date.now();
    expect(report).toMatchObject({ ok: true, checked: 10_000 });
    console.info(`audit seal timing: sealed 10,000 in ${t1 - t0} ms, checked 10,000 in ${t2 - t1} ms`);
    expect(t1 - t0).toBeLessThan(60_000);
    expect(t2 - t1).toBeLessThan(30_000);
  });
});

describe("the seals are append-only, and so is the audit log", () => {
  it("refuses to change or delete a seal, or an audit row, with the ordinary protection in place", async () => {
    const { org, admin } = await newOrg();
    const [id] = await write(admin, 1);
    await sealOrganization(org, { now: LATER() });
    const seal = await db.auditSeal.findFirstOrThrow({ where: { organizationId: org } });
    await expect(db.auditSeal.update({ where: { id: seal.id }, data: { chainHash: "x" } })).rejects.toThrow(/append-only/);
    await expect(db.auditSeal.delete({ where: { id: seal.id } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.update({ where: { id }, data: { reason: "changed" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id } })).rejects.toThrow();
  });
});

describe("tampering by someone who has the database but not the key is found", () => {
  it("MODIFIED: an audit entry edited after it was sealed names that entry", async () => {
    const { org, admin } = await newOrg();
    const ids = await write(admin, 5);
    await sealOrganization(org, { now: LATER() });
    await attack((tx) => tx.$executeRaw`UPDATE "AuditLog" SET "newValue" = '{"n": 999999}'::jsonb WHERE id = ${ids[2]}`);
    const r = await verifyOrganization(org, { now: LATER() });
    expect(r.ok).toBe(false);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ kind: "MODIFIED", seq: 3, auditLogId: ids[2] });
  });

  it("MISSING_ROW: an audit entry removed after it was sealed names that entry", async () => {
    const { org, admin } = await newOrg();
    const ids = await write(admin, 5);
    await sealOrganization(org, { now: LATER() });
    await attack((tx) => tx.$executeRaw`DELETE FROM "AuditLog" WHERE id = ${ids[1]}`);
    const r = await verifyOrganization(org, { now: LATER() });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ kind: "MISSING_ROW", seq: 2, auditLogId: ids[1] });
  });

  it("BAD_SEAL: a seal rewritten (even with its content hash fixed to match an edited row) fails, because the keyed hash cannot be recomputed", async () => {
    const { org, admin } = await newOrg();
    const ids = await write(admin, 4);
    await sealOrganization(org, { now: LATER() });
    await attack(async (tx) => {
      await tx.$executeRaw`UPDATE "AuditLog" SET "reason" = 'rewritten' WHERE id = ${ids[1]}`;
      await tx.$executeRaw`UPDATE "AuditSeal" SET "contentHash" = ${"a".repeat(64)} WHERE "auditLogId" = ${ids[1]}`;
    });
    expect(await kinds(org)).toContain("BAD_SEAL");
  });

  it("SEQ_GAP and BROKEN_LINK: a seal taken out of the middle", async () => {
    const { org, admin } = await newOrg();
    await write(admin, 5);
    await sealOrganization(org, { now: LATER() });
    await attack((tx) => tx.$executeRaw`DELETE FROM "AuditSeal" WHERE "organizationId" = ${org} AND "seq" = 3`);
    const k = await kinds(org);
    expect(k).toContain("SEQ_GAP");
    expect(k).toContain("BROKEN_LINK");
  });

  it("an entry slipped in dated long before the ones already sealed is not sealed quietly: it shows as stalled, and as BACKDATED if someone seals everything", async () => {
    const { org, admin } = await newOrg();
    await write(admin, 3);
    await sealOrganization(org, { now: LATER() });
    const forged = await db.auditLog.create({ data: { organizationId: org, userName: "Nobody", action: "FORGED", entity: "Test", createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    expect((await sealOrganization(org, { now: LATER() })).sealed).toBe(0); // outside the recent window: left alone
    const stalled = await verifyOrganization(org, { now: LATER() });
    expect(stalled.ok).toBe(false);
    expect(stalled.stalledRows).toBe(1);
    expect((await sealOrganization(org, { now: LATER(), sweep: true })).sealed).toBe(1);
    const r = await verifyOrganization(org, { now: LATER() });
    expect(r.findings.map((f) => [f.kind, f.auditLogId])).toEqual([["BACKDATED", forged.id]]);
  });

  it("cannot be hidden by a fake 'AUDIT_REDACTION' entry: an edit is excused only by a declaration with a proof from the sealing key", async () => {
    const { org, admin } = await newOrg();
    const ids = await write(admin, 3);
    await sealOrganization(org, { now: LATER() });
    await attack((tx) => tx.$executeRaw`UPDATE "AuditLog" SET "newValue" = '{"n": 7}'::jsonb WHERE id = ${ids[0]}`);
    const edited = await db.auditLog.findUniqueOrThrow({ where: { id: ids[0] } });
    // the attacker inserts a declaration for the new content, but cannot make the proof
    const { auditContentHash } = await import("@/lib/audit-seal");
    const hash = auditContentHash(edited);
    await db.auditLog.create({ data: { organizationId: org, userName: "Nobody", action: "AUDIT_REDACTION", entity: "AuditLog", newValue: { redacted: [{ id: ids[0], contentHash: hash, proof: "f".repeat(64) }] } } });
    await sealOrganization(org, { now: LATER() });
    const r = await verifyOrganization(org, { now: LATER() });
    expect(r.findings.map((f) => f.kind)).toContain("MODIFIED");
    // with a proof made by someone who has the key it WOULD be accepted: the stated limit of this design
    await db.auditLog.create({ data: { organizationId: org, userName: "Insider", action: "AUDIT_REDACTION", entity: "AuditLog", newValue: { redacted: [{ id: ids[0], contentHash: hash, proof: redactionProof(KEY, org, ids[0], hash) }] } } });
    await sealOrganization(org, { now: LATER() });
    expect((await verifyOrganization(org, { now: LATER() })).findings.map((f) => f.kind)).not.toContain("MODIFIED");
  });

  it("is not found when the sealing key is wrong, which is why every check uses the real one: with another key every seal fails", async () => {
    const { org, admin } = await newOrg();
    await write(admin, 3);
    await sealOrganization(org, { now: LATER() });
    const r = await verifyOrganization(org, { now: LATER(), key: "some-other-key-that-is-long-enough-for-the-check-x" });
    expect(r.findings.filter((f) => f.kind === "BAD_SEAL")).toHaveLength(3);
  });

  it("STALLED: entries still unsealed after ten minutes mean the sealing job has stopped", async () => {
    const { org, admin } = await newOrg();
    await write(admin, 2);
    const r = await verifyOrganization(org, { now: minutes(20) });
    expect(r.ok).toBe(false);
    expect(r.stalledRows).toBe(2);
    expect(r.findingCount).toBe(0);
  });
});

describe("a deliberate redaction", () => {
  it("is accepted when made through the sanctioned procedure, which writes its own sealed AUDIT_REDACTION entry with proofs", async () => {
    const { org, admin } = await newOrg();
    const ids = await write(admin, 4);
    await sealOrganization(org, { now: LATER() });
    const out = await redactAuditRows(admin, [{ id: ids[1], newValue: { n: 2, account: "••••6789" } }, { id: ids[2], newValue: { n: 3, account: "••••1111" } }], "Masking account numbers for the encryption rollout");
    expect(out.redacted).toBe(2);
    const row = await db.auditLog.findUniqueOrThrow({ where: { id: ids[1] } });
    expect(JSON.stringify(row.newValue)).toContain("6789");
    const declaration = await db.auditLog.findFirstOrThrow({ where: { organizationId: org, action: "AUDIT_REDACTION" } });
    expect(JSON.stringify(declaration.newValue)).toContain("proof");
    expect(declaration.reason).toMatch(/encryption rollout/);
    await sealOrganization(org, { now: LATER() }); // the declaration is itself sealed
    const r = await verifyOrganization(org, { now: LATER() });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(5);
  });

  it("still flags a different edit of the same row, afterwards", async () => {
    const { org, admin } = await newOrg();
    const ids = await write(admin, 3);
    await sealOrganization(org, { now: LATER() });
    await redactAuditRows(admin, [{ id: ids[1], newValue: { n: 2, account: "••••6789" } }], "Masking account numbers for the encryption rollout");
    await sealOrganization(org, { now: LATER() });
    await attack((tx) => tx.$executeRaw`UPDATE "AuditLog" SET "newValue" = '{"n": 2000}'::jsonb WHERE id = ${ids[1]}`);
    expect((await verifyOrganization(org, { now: LATER() })).findings.map((f) => f.kind)).toEqual(["MODIFIED"]);
  });

  it("needs the right permission, a real reason, a row of this organization, and the protection is back on afterwards", async () => {
    const { org, admin, t } = await newOrg();
    const other = await newOrg();
    const ids = await write(admin, 2);
    const [foreign] = await write(other.admin, 1);
    await expect(redactAuditRows(t.ctx("EMPLOYEE"), [{ id: ids[0], newValue: { n: 1 } }], "A reason that is long enough")).rejects.toThrow(/permission/i);
    await expect(redactAuditRows(admin, [{ id: ids[0], newValue: { n: 1 } }], "short")).rejects.toThrow(/reason/i);
    await expect(redactAuditRows(admin, [{ id: foreign, newValue: { n: 1 } }], "A reason that is long enough")).rejects.toThrow(/not found in this organization/);
    await expect(db.auditLog.update({ where: { id: ids[0] }, data: { reason: "after" } })).rejects.toThrow(/append-only/); // the switch lasted only for the redaction's transaction
    expect(org).toBeTruthy();
  });
});

describe("organizations are separate", () => {
  it("one organization's tampering does not fail another's check, and each screen shows only its own chain", async () => {
    const a = await newOrg();
    const b = await newOrg();
    const aIds = await write(a.admin, 3);
    await write(b.admin, 2);
    await sealAllOrganizations({ now: LATER() });
    await attack((tx) => tx.$executeRaw`UPDATE "AuditLog" SET "reason" = 'x' WHERE id = ${aIds[0]}`);
    expect((await verifyOrganization(a.org, { now: LATER() })).ok).toBe(false);
    expect((await verifyOrganization(b.org, { now: LATER() })).ok).toBe(true);
    const viewB = await auditIntegrityOverview(b.admin);
    expect(viewB.sealed).toBe(2);
    expect(viewB.head?.seq).toBe(2);
    const checked = await verifyAuditNow(b.admin);
    expect(checked.ok).toBe(true);
    expect(checked.checked).toBeGreaterThanOrEqual(2);
    expect(await db.auditLog.count({ where: { organizationId: a.org, action: "AUDIT_INTEGRITY_CHECK" } })).toBe(0); // b's check wrote to b's log only
    expect(await db.auditLog.count({ where: { organizationId: b.org, action: "AUDIT_INTEGRITY_CHECK" } })).toBe(1);
  });

  it("the screen and the check need the audit permission", async () => {
    const { t } = await newOrg();
    await expect(auditIntegrityOverview(t.ctx("EMPLOYEE"))).rejects.toThrow(/permission/i);
    await expect(verifyAuditNow(t.ctx("EMPLOYEE"))).rejects.toThrow(/permission/i);
  });
});

describe("the key", () => {
  it("is required, and the error says so without containing any key", async () => {
    const { org, admin } = await newOrg();
    await write(admin, 1);
    vi.stubEnv("AUDIT_SEAL_KEY", "");
    await expect(sealOrganization(org, { now: LATER() })).rejects.toThrow(/AUDIT_SEAL_KEY/);
    vi.stubEnv("AUDIT_SEAL_KEY", "too-short-key");
    const e = await sealOrganization(org, { now: LATER() }).catch((x) => x as Error);
    expect(String((e as Error).message)).toMatch(/32/);
    expect(String((e as Error).message)).not.toContain("too-short-key");
    vi.stubEnv("AUDIT_SEAL_KEY", KEY);
  });

  it("never appears in an audit row, an email or a log line, however a seal, a check, a failure report or a chain head goes", async () => {
    const lines: string[] = [];
    for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((l: unknown) => void lines.push(String(l)));
    const emails: string[] = [];
    vi.spyOn(emailLib, "sendEmail").mockImplementation(async (m) => void emails.push(JSON.stringify(m)));
    const { org, admin } = await newOrg();
    const ids = await write(admin, 3);
    await sealOrganization(org, { now: LATER() });
    await attack((tx) => tx.$executeRaw`UPDATE "AuditLog" SET "reason" = 'x' WHERE id = ${ids[0]}`);
    await reportIntegrityFailure(org, await verifyOrganization(org, { now: LATER() }));
    await sendChainHeads();
    const rows = JSON.stringify(await db.auditLog.findMany({ where: { organizationId: org } }));
    const seals = JSON.stringify(await db.auditSeal.findMany({ where: { organizationId: org } }));
    for (const text of [rows, seals, emails.join("\n"), lines.join("\n")]) expect(text).not.toContain(KEY);
  });
});

describe("telling people", () => {
  it("a failed check is written to the audit log and emailed to those who can view it, with kinds and numbers but no audit content", async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    vi.spyOn(emailLib, "sendEmail").mockImplementation(async (m) => void sent.push({ to: m.to as string, subject: m.subject, text: m.text as string }));
    const { org, admin } = await newOrg();
    await db.user.create({ data: { organizationId: org, email: `founder.${uid()}@seal.test`, name: "Founder", role: "COMPANY_ADMIN", passwordHash: "x" } });
    await db.user.create({ data: { organizationId: org, email: `staff.${uid()}@seal.test`, name: "Staff", role: "EMPLOYEE", passwordHash: "x" } });
    const ids = await write(admin, 3);
    await sealOrganization(org, { now: LATER() });
    await attack((tx) => tx.$executeRaw`UPDATE "AuditLog" SET "reason" = 'SECRET-CONTENT-123' WHERE id = ${ids[0]}`);
    const outcome = (await verifyAllOrganizations({ now: LATER() })).find((o) => o.organizationId === org);
    expect(outcome).toMatchObject({ ok: false, findingCount: 1 });
    const entry = await db.auditLog.findFirstOrThrow({ where: { organizationId: org, action: "AUDIT_INTEGRITY_FAILED" } });
    expect(entry.newValue).toMatchObject({ findingCount: 1, kinds: ["MODIFIED"] });
    expect(sent.length).toBe(1);
    expect(sent[0].to).toMatch(/^founder\./);
    expect(sent[0].subject).toMatch(/FAILED/);
    expect(sent.map((s) => s.text).join()).not.toContain("SECRET-CONTENT-123");
  });

  it("the weekly chain head goes to those who can view the audit log, is recorded in the log, and matches the screen", async () => {
    const sent: Array<{ to: string; text: string }> = [];
    vi.spyOn(emailLib, "sendEmail").mockImplementation(async (m) => void sent.push({ to: m.to as string, text: m.text as string }));
    const { org, admin } = await newOrg();
    const founder = await db.user.create({ data: { organizationId: org, email: `founder.${uid()}@seal.test`, name: "Founder", role: "COMPANY_ADMIN", passwordHash: "x" } });
    await write(admin, 3);
    await sealOrganization(org, { now: LATER() });
    const head = (await auditIntegrityOverview(admin)).head!;
    await sendChainHeads();
    const mine = sent.filter((s) => s.to === founder.email);
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain(head.chainHash);
    expect(mine[0].text).toContain(`Entries sealed: ${head.seq}`);
    const anchor = await db.auditLog.findFirstOrThrow({ where: { organizationId: org, action: "AUDIT_ANCHOR_SENT" } });
    expect(anchor.newValue).toMatchObject({ seq: head.seq, chainHash: head.chainHash });
  });
});
