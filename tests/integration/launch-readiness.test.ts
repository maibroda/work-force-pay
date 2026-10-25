import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { sendEmail } from "@/lib/email";
import { enableBureau, onboardClient } from "@/server/services/bureau";
import { confirmLaunchCheck, launchChecklist, launchProgress, sendTestEmail, withdrawLaunchCheck } from "@/server/services/launch-readiness";
import { recordJob } from "@/server/services/job-runs";
import { proposeRelease, publishRelease, verifyRelease } from "@/server/services/rule-library";
import { isolatedOrg, uid } from "../helpers";

const mail = vi.mocked(sendEmail);
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const GOOD_ENV = { RESEND_API_KEY: "re_x", EMAIL_FROM: "ThreeRoots <payroll@threeroots.ng>", APP_URL: "https://app.threeroots.ng", AUTH_SECRET: "k3Jd9sLq2PzX7vBn4RtYw8UeA1oCmF6h", CRON_SECRET: "k3Jd9sLq2PzX7vBn4RtYw8UeA1oCmF6h" };

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@ready.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

/** A bureau with master PAYE, pension and employer-contribution tables in force, and the people who propose and verify. */
async function world(opts: { tables?: boolean } = {}) {
  const t = await isolatedOrg();
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
  const hr = await person(t.org.id, "HR_ADMIN", "hr");
  const finance = await person(t.org.id, "FINANCE", "finance");
  await enableBureau(founder);
  let tax = null as { id: string } | null;
  let pension = null as { id: string } | null;
  let employer = null as { id: string } | null;
  if (opts.tables !== false) {
    tax = await db.taxRule.create({
      data: {
        organizationId: t.org.id, code: "NG-PAYE", name: "PAYE", version: "2026.1", effectiveFrom: d("2026-01-01"),
        bands: { create: [{ sortOrder: 1, lowerBound: 0, upperBound: 800000, rate: 0 }, { sortOrder: 2, lowerBound: 800000, upperBound: null, rate: 15 }] },
        reliefs: { create: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION" }] },
      },
    });
    pension = await db.pensionRule.create({ data: { organizationId: t.org.id, version: "v1", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC"], effectiveFrom: d("2020-01-01") } });
    employer = await db.employerCostRule.create({ data: { organizationId: t.org.id, version: "v1", effectiveFrom: d("2020-01-01") } });
  }
  await db.payrollRule.create({ data: { organizationId: t.org.id, version: "v1", effectiveFrom: d("2020-01-01") } });
  const client = (await onboardClient(founder, { name: `Client ${uid()}`, code: `R${uid()}${uid()}`, package: "PAYROLL_COMPLIANCE", startDate: "2026-11-01", termMonths: 12 } as never)).client;
  return { t, founder, officer, hr, finance, tax, pension, employer, client };
}
type W = Awaited<ReturnType<typeof world>>;
const item = async (w: W, key: string, env: Record<string, string | undefined> = GOOD_ENV, now = new Date("2026-10-26T09:00:00Z")) => (await launchChecklist(w.founder, now, env)).items.find((i) => i.key === key)!;

beforeEach(() => mail.mockClear());

describe("the rate tables item", () => {
  it("follows the baseline through proposing, both signatures and publishing", async () => {
    const w = await world();
    const now = new Date("2026-10-26T09:00:00Z");
    expect((await item(w, "RULES")).status).toBe("TODO");
    expect((await item(w, "RULES")).evidence).toContain("PAYE NG-PAYE v2026.1 was never put through verification.");

    const src = "Nigeria Tax Act 2025, schedule effective 1 January 2026";
    const rels = [];
    for (const [kind, id] of [["TAX", w.tax!.id], ["PENSION", w.pension!.id], ["EMPLOYER_COST", w.employer!.id]] as const)
      rels.push(await proposeRelease(w.founder, { kind, ruleId: id, summary: "Baseline tables in use at launch", source: src }));
    expect((await item(w, "RULES")).status).toBe("ATTENTION");
    expect((await item(w, "RULES")).evidence[0]).toMatch(/waiting for HR and Finance \(0 of 2 signed\)/);

    for (const r of rels) {
      await verifyRelease(w.hr, r.id, "Checked against the Act and the tax authority's guidance");
      await verifyRelease(w.finance, r.id, "Checked against the Act and our payroll advisers' note");
    }
    expect((await item(w, "RULES")).evidence.join(" ")).toMatch(/verified by both but not yet published/);

    for (const r of rels) await publishRelease(w.founder, r.id);
    const done = await item(w, "RULES");
    expect(done.status).toBe("DONE");
    expect(done.evidence).toHaveLength(3);
    expect(done.points?.length).toBeGreaterThan(4);
    expect(now).toBeTruthy();
  });

  it("is to do when a whole kind of table is missing", async () => {
    const w = await world({ tables: false });
    const r = await item(w, "RULES");
    expect(r.status).toBe("TODO");
    expect(r.evidence.join(" ")).toMatch(/no PAYE rule in force/);
  });

  it("ignores a table that isn't in force yet", async () => {
    const w = await world();
    await db.taxRule.create({ data: { organizationId: w.t.org.id, code: "NG-PAYE", name: "PAYE", version: "2027.1", effectiveFrom: d("2027-01-01"), bands: { create: [{ sortOrder: 1, lowerBound: 0, upperBound: null, rate: 10 }] } } });
    expect((await item(w, "RULES")).evidence.join(" ")).not.toMatch(/2027\.1/);
  });
});

describe("what the app can see for itself", () => {
  it("judges email, address and secrets from the environment", async () => {
    const w = await world();
    expect((await item(w, "EMAIL", {})).status).toBe("TODO");
    expect((await item(w, "EMAIL")).status).toBe("DONE");
    expect((await item(w, "APP_URL", { ...GOOD_ENV, APP_URL: "http://localhost:3000" })).status).toBe("TODO");
    expect((await item(w, "SECRETS", { ...GOOD_ENV, CRON_SECRET: undefined })).status).toBe("TODO");
    expect((await item(w, "SECRETS")).status).toBe("DONE");
  });

  it("sees the scheduler once a job has been called, and a failing one", async () => {
    const w = await world();
    const now = new Date();
    expect((await item(w, "SCHEDULER", GOOD_ENV, now)).status).toBe("TODO");
    await recordJob("payroll-reminders", async () => ({ ok: true }));
    expect((await item(w, "SCHEDULER", GOOD_ENV, now)).status).toBe("DONE");
    await expect(recordJob("payroll-reminders", async () => { throw new Error("mail provider down"); })).rejects.toThrow(/mail provider down/);
    const s = await item(w, "SCHEDULER", GOOD_ENV, now);
    expect(s.status).toBe("ATTENTION");
    expect(s.evidence.join(" ")).toContain("mail provider down");
    const rows = await db.jobRun.findMany({ where: { name: "payroll-reminders" }, orderBy: { startedAt: "asc" } });
    expect(rows.map((r) => r.ok)).toEqual([true, false]);
    expect(rows.every((r) => r.finishedAt)).toBe(true);
  });

  it("returns the job's own result unchanged, and clears old runs", async () => {
    await db.jobRun.create({ data: { name: "hr-digest", startedAt: new Date(Date.now() - 100 * 86_400_000), ok: true } });
    expect(await recordJob("hr-digest", async () => 42)).toBe(42);
    const rows = await db.jobRun.findMany({ where: { name: "hr-digest", startedAt: { lt: new Date(Date.now() - 95 * 86_400_000) } } });
    expect(rows).toHaveLength(0);
  });

  it("counts staff without two-factor, and clients without signed terms", async () => {
    const w = await world();
    const staff = await item(w, "STAFF_MFA");
    expect(staff.status).toBe("ATTENTION");
    expect(staff.evidence[0]).toMatch(/haven't set up two-factor; it becomes compulsory on/);
    const terms = await item(w, "CLIENT_TERMS");
    expect(terms.status).toBe("TODO");
    expect(terms.evidence[0]).toContain(w.client.name);
    await db.clientEngagement.update({ where: { clientOrganizationId: w.client.id }, data: { dpaReference: "DPA-2026-001", dpaSignedAt: d("2026-10-01") } });
    expect((await item(w, "CLIENT_TERMS")).status).toBe("DONE");
  });

  it("is ready only when everything is, and reports progress", async () => {
    const w = await world();
    const p = await launchProgress(w.founder);
    expect(p.ready).toBe(false);
    expect(p.total).toBe(10);
  });
});

describe("what a person confirms", () => {
  it("records who, when and what they did, and can be taken back with a reason", async () => {
    const w = await world();
    expect((await item(w, "BANK_CODES")).status).toBe("TODO");
    await confirmLaunchCheck(w.founder, "BANK_CODES", "Compared GTBank and Access upload guides with the bank code list; all matched");
    const done = await item(w, "BANK_CODES");
    expect(done.status).toBe("DONE");
    expect(done.confirmed).toMatchObject({ by: w.founder.name, note: "Compared GTBank and Access upload guides with the bank code list; all matched" });
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "LAUNCH_CHECK_CONFIRM", entityId: "BANK_CODES" } })).toBe(1);
    await expect(withdrawLaunchCheck(w.founder, "BANK_CODES", "no")).rejects.toThrow(/at least 10/);
    await withdrawLaunchCheck(w.founder, "BANK_CODES", "Access changed its file layout in November");
    expect((await item(w, "BANK_CODES")).status).toBe("TODO");
    await expect(withdrawLaunchCheck(w.founder, "BANK_CODES", "Nothing to withdraw here at all")).rejects.toThrow(/not confirmed/);
  });

  it("needs a real note, a known item, and a bureau manager", async () => {
    const w = await world();
    await expect(confirmLaunchCheck(w.founder, "BANK_CODES", "done")).rejects.toThrow(/at least 10/);
    await expect(confirmLaunchCheck(w.founder, "RULES", "Ticked it by hand, honest")).rejects.toThrow(/checked by the app/);
    await expect(confirmLaunchCheck(w.officer, "BANK_CODES", "Compared the guides and all matched")).rejects.toThrow(/permission/);
    await expect(db.launchCheck.create({ data: { bureauOrganizationId: w.t.org.id, key: "BACKUP_RESTORE", note: "short", confirmedBy: "x", confirmedByUserId: "x" } })).rejects.toThrow();
  });

  it("is re-confirmed rather than duplicated", async () => {
    const w = await world();
    await confirmLaunchCheck(w.founder, "BACKUP_RESTORE", "Restored the 20 Oct dump into a scratch database");
    await confirmLaunchCheck(w.founder, "BACKUP_RESTORE", "Restored the 26 Oct dump into a scratch database");
    expect(await db.launchCheck.count({ where: { bureauOrganizationId: w.t.org.id, key: "BACKUP_RESTORE" } })).toBe(1);
    expect((await item(w, "BACKUP_RESTORE")).confirmed?.note).toContain("26 Oct");
  });

  it("belongs to the bureau, not to a client or an ordinary organization", async () => {
    const w = await world();
    const plain = await isolatedOrg();
    const admin = await person(plain.org.id, "COMPANY_ADMIN", "plain");
    await expect(launchChecklist(admin)).rejects.toThrow(/payroll bureau/);
    // a bureau member working inside a client still sees the bureau's list
    const inClient = { ...w.founder, orgId: w.client.id, homeOrgId: w.t.org.id };
    expect((await launchChecklist(inClient, new Date(), GOOD_ENV)).total).toBe(10);
  });
});

describe("the test email", () => {
  it("sends the manager a message with a small PDF attached, and says whether a provider is configured", async () => {
    const w = await world();
    const before = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_test";
    try {
      const r = await sendTestEmail(w.founder);
      expect(r).toEqual({ to: w.founder.email, live: true });
    } finally {
      if (before === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = before;
    }
    const sent = mail.mock.calls[0][0];
    expect(sent.to).toBe(w.founder.email);
    expect(sent.attachments?.[0].filename).toBe("test-attachment.pdf");
    expect(sent.attachments?.[0].content.subarray(0, 4).toString()).toBe("%PDF");
    expect((await sendTestEmail(w.founder)).live).toBe(false);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "LAUNCH_TEST_EMAIL" } })).toBe(2);
  });

  it("is for bureau managers only", async () => {
    const w = await world();
    await expect(sendTestEmail(w.officer)).rejects.toThrow(/permission/);
    expect(mail).not.toHaveBeenCalled();
  });
});
