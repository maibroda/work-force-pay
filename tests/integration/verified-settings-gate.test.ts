/**
 * Rule 3: payroll for a production client is stopped while a required statutory rule is unverified.
 * A "production client" is a client of a bureau whose engagement is ACTIVE. A rule is verified when its content is what HR and Finance signed in the
 * bureau's Statutory Rule Library. The check is made when a payroll is calculated, when a supplementary payroll is created, and when a payroll is
 * submitted, approved and locked. Every block is written to the audit log. There is no override.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { enableBureau, onboardClient } from "@/server/services/bureau";
import { approveRun, createPeriod, createSupplementaryRun, lockRun, runPayroll, submitForApproval } from "@/server/services/payroll";
import { explainIssue, signOffReconciliation } from "@/server/services/payroll-controls";
import { copyStatutoryRules } from "@/server/services/statutory";
import { enforceVerifiedRules, statutoryStatus, statutoryVerification } from "@/server/services/statutory-verification";
import { buildDemoClient, DEMO_MONTH, finishDemoMonth, verifyBureauRules } from "../../prisma/demo-client";
import { isolatedOrg, uid } from "../helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@gate.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}
type Staff = { founder: Ctx; officer: Ctx; reviewer: Ctx; hr: Ctx };

/** A bureau whose own statutory tables are the demo company's, and whose rules have NOT been put through the library. */
async function newBureau(): Promise<{ bureauId: string; staff: Staff }> {
  const t = await isolatedOrg();
  const staff: Staff = {
    founder: await person(t.org.id, "COMPANY_ADMIN", "founder"),
    officer: await person(t.org.id, "PAYROLL_ADMIN", "officer"),
    reviewer: await person(t.org.id, "FINANCE", "reviewer"),
    hr: await person(t.org.id, "HR_ADMIN", "hr"),
  };
  await enableBureau(staff.founder);
  const dss = await db.organization.findUniqueOrThrow({ where: { code: "DSS" } });
  await db.$transaction((tx) => copyStatutoryRules(tx, dss.id, t.org.id));
  return { bureauId: t.org.id, staff };
}

async function onboard(staff: Staff, name: string) {
  const { client } = await onboardClient(staff.founder, {
    name: `${name} ${uid()}`, code: `GT${uid()}${uid()}`, package: "PAYROLL_COMPLIANCE", startDate: "2026-10-01", termMonths: 12, perEmployeeRate: 2500, monthlyMinimum: 50000, onboardingFee: 0,
  } as never);
  return client;
}
const asClient = (c: Ctx, clientId: string, bureauId: string): Ctx => ({ ...c, orgId: clientId, homeOrgId: bureauId });
const setEngagement = (clientId: string, status: "ONBOARDING" | "ACTIVE") => db.clientEngagement.update({ where: { clientOrganizationId: clientId }, data: { status } });

/** Changes the client's pension rate directly in the database, as a person with database access could. Returns the function that puts it back. */
async function tamper(clientId: string) {
  const r = await db.pensionRule.findFirstOrThrow({ where: { organizationId: clientId }, orderBy: { effectiveFrom: "desc" } });
  await db.pensionRule.update({ where: { id: r.id }, data: { employerRate: Number(r.employerRate) + 1 } });
  return () => db.pensionRule.update({ where: { id: r.id }, data: { employerRate: r.employerRate } });
}

const blockedLog = (clientId: string) => db.auditLog.findMany({ where: { organizationId: clientId, action: "PAYROLL_BLOCKED_UNVERIFIED_RULES" }, orderBy: { createdAt: "asc" } });

// ───────────────────────────── A production client whose rules are verified ─────────────────────────────

let bureauId: string;
let staff: Staff;
let demo: Awaited<ReturnType<typeof buildDemoClient>>;
let nov: { id: string };
let novRun: { id: string };

beforeAll(async () => {
  ({ bureauId, staff } = await newBureau());
  demo = await buildDemoClient(staff, { name: `Gate Facilities ${uid()}`, code: `GF${uid()}${uid()}` });
  await finishDemoMonth(demo);
  // November is calculated and reconciled, ready to be submitted
  nov = await createPeriod(demo.founder, DEMO_MONTH.year, 11);
  novRun = await runPayroll(demo.founder, nov.id);
  const findings = await db.payrollValidationIssue.findMany({ where: { runId: novRun.id, requiresExplanation: true } });
  for (const f of findings) await explainIssue(demo.founder, f.id, "The October joiners now work a whole month");
  await signOffReconciliation(demo.founder, novRun.id, "Same staff as October; two joiners now full-month");
}, 300_000);

describe("a production client whose rules are verified", () => {
  it("is gated, all three rules are verified, and who signed and when is shown", async () => {
    const s = await statutoryStatus(demo.founder, nov.id);
    expect(s.gated).toBe(true);
    expect(s.verdicts.map((v) => [v.kind, v.verified])).toEqual([["TAX", true], ["PENSION", true], ["EMPLOYER_COST", true]]);
    expect(s.unverified).toEqual([]);
    const tax = s.verdicts[0];
    expect(tax.signedBy.map((x) => x.slot).sort()).toEqual(["FINANCE", "HR"]);
    expect(tax.signedBy.every((x) => x.name.length > 0 && x.at instanceof Date)).toBe(true);
  });
  it("had its October payroll calculated, approved and locked on those rules (the demo month ran through the gate)", async () => {
    const run = await db.payrollRun.findFirstOrThrow({ where: { id: demo.run.id } });
    expect(run.status).toBe("LOCKED");
  });
});

// ───────────────────────────── A rule changed after sign-off stops every step ─────────────────────────────

describe("a rule changed after HR and Finance signed it stops the payroll", () => {
  it("shows what changed in plain words, and says the client is blocked", async () => {
    const restore = await tamper(demo.client.id);
    try {
      const s = await statutoryStatus(demo.founder, nov.id);
      expect(s.gated).toBe(true);
      expect(s.unverified.map((v) => v.kind)).toEqual(["PENSION"]);
      expect(s.unverified[0].reason).toMatch(/changed since it was verified/i);
    } finally {
      await restore();
    }
  });

  it("stops submitting for approval, and allows it again once the rule is back as signed", async () => {
    const restore = await tamper(demo.client.id);
    await expect(submitForApproval(demo.founder, novRun.id)).rejects.toThrow(/can't be submitted for approval.*Pension.*changed since it was verified/is);
    await restore();
    await submitForApproval(demo.founder, novRun.id);
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: novRun.id } })).status).toBe("PENDING_APPROVAL");
  });

  it("stops approval, and allows it again once the rule is back as signed", async () => {
    const restore = await tamper(demo.client.id);
    await expect(approveRun(demo.reviewer, novRun.id)).rejects.toThrow(/can't be approved.*Pension/is);
    await restore();
    await approveRun(demo.reviewer, novRun.id);
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: novRun.id } })).status).toBe("APPROVED");
  });

  it("stops locking", async () => {
    const restore = await tamper(demo.client.id);
    try {
      await expect(lockRun(demo.reviewer, novRun.id)).rejects.toThrow(/can't be locked.*Pension/is);
      expect((await db.payrollRun.findUniqueOrThrow({ where: { id: novRun.id } })).status).toBe("APPROVED");
    } finally {
      await restore();
    }
  });

  it("stops a supplementary payroll for a locked month", async () => {
    const restore = await tamper(demo.client.id);
    try {
      await expect(createSupplementaryRun(demo.founder, demo.period.id, "Back pay for one employee")).rejects.toThrow(/supplementary.*Pension/is);
    } finally {
      await restore();
    }
  });

  it("stops calculating a new month, and no run is created", async () => {
    const dec = await createPeriod(demo.founder, DEMO_MONTH.year, 12);
    const restore = await tamper(demo.client.id);
    try {
      await expect(runPayroll(demo.founder, dec.id)).rejects.toThrow(/can't be calculated.*Pension/is);
      expect(await db.payrollRun.count({ where: { periodId: dec.id } })).toBe(0);
    } finally {
      await restore();
    }
  });

  it("writes every block to the audit log: who tried, which step, which rule, and why", async () => {
    const log = await blockedLog(demo.client.id);
    expect(log.length).toBeGreaterThanOrEqual(5);
    const steps = log.map((l) => (l.newValue as { step: string }).step);
    expect(steps).toEqual(expect.arrayContaining(["submit", "approve", "lock", "supplementary", "calculate"]));
    const first = log[0].newValue as { rules: Array<{ label: string; reason: string }> };
    expect(first.rules[0].reason).toMatch(/changed since it was verified/i);
    expect(log.every((l) => l.userId)).toBe(true);
  });

  it("is not stopped by anything once the rule is back as signed: a new month calculates", async () => {
    const dec = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: demo.client.id, year: DEMO_MONTH.year, month: 12 } });
    const run = await runPayroll(demo.founder, dec.id);
    expect(run.id).toBeTruthy();
  });
});

// ───────────────────────────── Who is and is not gated ─────────────────────────────

describe("who is gated", () => {
  it("a client still being onboarded is NOT stopped, but is told plainly", async () => {
    await setEngagement(demo.client.id, "ONBOARDING");
    const restore = await tamper(demo.client.id);
    try {
      const s = await statutoryStatus(demo.founder, nov.id);
      expect(s.gated).toBe(false);
      expect(s.unverified).toHaveLength(1);
      await expect(enforceVerifiedRules(demo.founder, d("2026-11-30"), "calculate")).resolves.toBeUndefined();
    } finally {
      await restore();
      await setEngagement(demo.client.id, "ACTIVE");
    }
  });

  it("an organization that is not a bureau client has nothing to check and is not gated", async () => {
    const dss = await db.organization.findUniqueOrThrow({ where: { code: "DSS" } });
    const v = await statutoryVerification(db, dss.id, d("2026-09-30"));
    expect(v).toMatchObject({ gated: false, verdicts: [] });
  });

  it("the bureau's own organization is not gated", async () => {
    const v = await statutoryVerification(db, bureauId, d("2026-10-31"));
    expect(v.gated).toBe(false);
  });
});

// ───────────────────────────── Baseline rules, and clients onboarded after publication ─────────────────────────────

describe("baseline rules and later clients", () => {
  it("a client on rules that were never put through the library is stopped, and told so", async () => {
    const b = await newBureau();
    const client = await onboard(b.staff, "Baseline Ltd");
    await setEngagement(client.id, "ACTIVE");
    const ctx = asClient(b.staff.founder, client.id, b.bureauId);
    const s = await statutoryStatus(ctx, (await createPeriod(ctx, 2026, 11)).id);
    expect(s.gated).toBe(true);
    expect(s.unverified.map((v) => v.kind)).toEqual(["TAX", "PENSION", "EMPLOYER_COST"]);
    expect(s.unverified.every((v) => /never put through verification/i.test(v.reason))).toBe(true);
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: client.id, year: 2026, month: 11 } });
    await expect(runPayroll(ctx, period.id)).rejects.toThrow(/can't be calculated.*PAYE.*never put through verification/is);
    expect((await blockedLog(client.id)).length).toBe(1);
  });

  it("one bureau's sign-off never verifies another bureau's client, even when the content is identical", async () => {
    const a = await newBureau();
    const b = await newBureau();
    const clientOfA = await onboard(a.staff, "Verified Ltd");
    const clientOfB = await onboard(b.staff, "Unverified Ltd");
    await verifyBureauRules(a.staff, a.bureauId);
    await setEngagement(clientOfA.id, "ACTIVE");
    await setEngagement(clientOfB.id, "ACTIVE");
    const va = await statutoryVerification(db, clientOfA.id, d("2026-10-31"));
    const vb = await statutoryVerification(db, clientOfB.id, d("2026-10-31"));
    expect(va.unverified).toEqual([]);
    expect(vb.unverified).toHaveLength(3);
  });

  it("a client onboarded AFTER the rules were published is verified without any publication record", async () => {
    const b = await newBureau();
    await onboard(b.staff, "Early Ltd"); // the rules are published to the clients that exist
    await verifyBureauRules(b.staff, b.bureauId);
    const late = await onboard(b.staff, "Late Ltd");
    await setEngagement(late.id, "ACTIVE");
    expect(await db.rulePublication.count({ where: { clientOrganizationId: late.id } })).toBe(0);
    const v = await statutoryVerification(db, late.id, d("2026-10-31"));
    expect(v.gated).toBe(true);
    expect(v.unverified).toEqual([]);
    // and its payroll is not stopped by the gate
    const ctx = asClient(b.staff.founder, late.id, b.bureauId);
    await expect(enforceVerifiedRules(ctx, d("2026-10-31"), "calculate")).resolves.toBeUndefined();
  });

  it("a rule dated later than the period is not what the period is checked against", async () => {
    const b = await newBureau();
    const c = await onboard(b.staff, "Dated Ltd");
    await verifyBureauRules(b.staff, b.bureauId);
    await setEngagement(c.id, "ACTIVE");
    // a future rule version the bureau has not verified: it must not make October unverified
    const tax = await db.taxRule.findFirstOrThrow({ where: { organizationId: c.id }, include: { bands: true, reliefs: true, exemptions: true } });
    const future = await db.taxRule.create({ data: { organizationId: c.id, code: tax.code, name: tax.name, version: "2099.1", effectiveFrom: d("2099-01-01"), bands: { create: tax.bands.map((x) => ({ sortOrder: x.sortOrder, lowerBound: x.lowerBound, upperBound: x.upperBound, rate: x.rate })) } } });
    expect(future.id).toBeTruthy();
    expect((await statutoryVerification(db, c.id, d("2026-10-31"))).unverified).toEqual([]);
    expect((await statutoryVerification(db, c.id, d("2099-06-30"))).unverified.map((v) => v.kind)).toEqual(["TAX"]);
  });
});
