import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { enableBureau, onboardClient } from "@/server/services/bureau";
import { fingerprintOf, proposeRelease, publishRelease, verifyRelease } from "@/server/services/rule-library";
import { copyStatutoryRules, createTaxRuleVersion } from "@/server/services/statutory";
import { remittanceTiming } from "@/server/services/payments";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * PAYE filing dates and the late penalty are RULE DATA: they live on the tax rule, travel with it to clients, are part of what HR and Finance sign,
 * and drive the due date shown on each PAYE remittance. Values here are invented to prove the mechanism; none is a statement of the law.
 */
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const bands = [{ lowerBound: 0, upperBound: 800000, rate: 0 }, { lowerBound: 800000, upperBound: null, rate: 15 }];
const rule = (over: Record<string, unknown> = {}) => ({
  code: "NG-PAYE", name: "PAYE", version: "2027.1", effectiveFrom: "2027-01-01", bands,
  reliefs: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION" }],
  exemptions: [{ code: "MIN", description: "Minimum wage", annualGrossCeiling: 840000 }],
  ...over,
});

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@timing.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

describe("filing dates on a tax rule", () => {
  it("are stored with the rule, blank means not set, and the audit entry is written", async () => {
    const t = await isolatedOrg();
    const admin = await person(t.org.id, "COMPANY_ADMIN", "admin");
    const set = await createTaxRuleVersion(admin, rule({ payeDueDay: "10", annualReturnMonth: 1, annualReturnDay: 31, latePenaltyPct: "10" }) as never);
    expect(set).toMatchObject({ payeDueDay: 10, annualReturnMonth: 1, annualReturnDay: 31 });
    expect(Number(set.latePenaltyPct)).toBe(10);
    const blank = await createTaxRuleVersion(admin, rule({ version: "2028.1", effectiveFrom: "2028-01-01", payeDueDay: "", annualReturnMonth: "", annualReturnDay: "", latePenaltyPct: "" }) as never);
    expect(blank).toMatchObject({ payeDueDay: null, annualReturnMonth: null, annualReturnDay: null, latePenaltyPct: null });
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "TAX_CONFIGURATION_CHANGE", entityId: set.id } })).toBe(1);
  });

  it("are refused when they are not real: a due day outside 1 to 28, half an annual return date, a penalty above 100", async () => {
    const t = await isolatedOrg();
    const admin = await person(t.org.id, "COMPANY_ADMIN", "admin");
    await expect(createTaxRuleVersion(admin, rule({ payeDueDay: 31 }) as never)).rejects.toThrow(/due day/i);
    await expect(createTaxRuleVersion(admin, rule({ annualReturnMonth: 4, annualReturnDay: 31 }) as never)).rejects.toThrow(/annual return/i);
    await expect(createTaxRuleVersion(admin, rule({ annualReturnMonth: 1 }) as never)).rejects.toThrow(/annual return/i);
    await expect(createTaxRuleVersion(admin, rule({ latePenaltyPct: 150 }) as never)).rejects.toThrow(/penalty/i);
    expect(await db.taxRule.count({ where: { organizationId: t.org.id } })).toBe(0);
  });

  it("are copied with the rule when a new organization takes over the bureau's tables", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const admin = await person(a.org.id, "COMPANY_ADMIN", "admin");
    await createTaxRuleVersion(admin, rule({ payeDueDay: 15, annualReturnMonth: 3, annualReturnDay: 31, latePenaltyPct: 5 }) as never);
    await db.$transaction((tx) => copyStatutoryRules(tx, a.org.id, b.org.id));
    const copy = await db.taxRule.findFirstOrThrow({ where: { organizationId: b.org.id } });
    expect(copy).toMatchObject({ payeDueDay: 15, annualReturnMonth: 3, annualReturnDay: 31 });
    expect(Number(copy.latePenaltyPct)).toBe(5);
  });
});

describe("filing dates through the bureau's rule library", () => {
  async function bureau() {
    const t = await isolatedOrg();
    const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
    const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
    const hr = await person(t.org.id, "HR_ADMIN", "hr");
    const finance = await person(t.org.id, "FINANCE", "finance");
    await enableBureau(founder);
    await db.taxRule.create({ data: { organizationId: t.org.id, code: "NG-PAYE", name: "PAYE", version: "2026.1", effectiveFrom: d("2026-01-01"), bands: { create: [{ sortOrder: 1, lowerBound: 0, upperBound: 800000, rate: 0 }, { sortOrder: 2, lowerBound: 800000, upperBound: null, rate: 15 }] }, reliefs: { create: [{ code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION" }] }, exemptions: { create: [{ code: "MIN", description: "Minimum wage", annualGrossCeiling: 840000 }] } } });
    await db.pensionRule.create({ data: { organizationId: t.org.id, version: "v1", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC"], effectiveFrom: d("2020-01-01") } });
    await db.payrollRule.create({ data: { organizationId: t.org.id, version: "v1", effectiveFrom: d("2020-01-01") } });
    await db.employerCostRule.create({ data: { organizationId: t.org.id, version: "v1", effectiveFrom: d("2020-01-01") } });
    const client = (await onboardClient(founder, { name: "Timing Client", code: `T${uid()}${uid()}`, package: "ENTERPRISE", startDate: "2026-11-01", termMonths: 12 } as never)).client;
    return { t, founder, officer, hr, finance, client };
  }

  it("a published version reaches the client with its filing dates, and the client's copy has exactly the fingerprint that was signed", async () => {
    const w = await bureau();
    const master = await createTaxRuleVersion(w.founder, rule({ payeDueDay: 10, annualReturnMonth: 1, annualReturnDay: 31, latePenaltyPct: 10 }) as never);
    const rel = await proposeRelease(w.officer, { kind: "TAX", ruleId: master.id, summary: "Filing dates added from the adviser's note", source: "Adviser note (invented for the test)" } as never);
    await verifyRelease(w.hr, rel.id, "Checked every figure against the adviser's note");
    await verifyRelease(w.finance, rel.id, "Agrees with the adviser's note");
    await publishRelease(w.officer, rel.id);

    const held = await db.taxRule.findFirstOrThrow({ where: { organizationId: w.client.id, version: "2027.1" }, include: { bands: true, reliefs: true, exemptions: true } });
    expect(held).toMatchObject({ payeDueDay: 10, annualReturnMonth: 1, annualReturnDay: 31 });
    expect(Number(held.latePenaltyPct)).toBe(10);
    const checksum = (await db.ruleRelease.findUniqueOrThrow({ where: { id: rel.id } })).checksum;
    expect(fingerprintOf({ kind: "TAX", row: held })).toBe(checksum); // the client's copy is exactly what was signed, so payroll is not blocked
  });

  it("a back-dated version that would be in force on the same days as an ended one is refused, and so is one a client already covers (pension and employer rules too)", async () => {
    // PAYE in the bureau's own tables: an ended version covers 2027-2028 and no version is open
    const t = await isolatedOrg();
    const admin = await person(t.org.id, "COMPANY_ADMIN", "admin");
    await db.taxRule.create({ data: { organizationId: t.org.id, code: "NG-PAYE", name: "PAYE", version: "old", effectiveFrom: d("2027-01-01"), effectiveTo: d("2028-12-31"), bands: { create: [{ sortOrder: 1, lowerBound: 0, upperBound: null, rate: 10 }] } } });
    await expect(createTaxRuleVersion(admin, rule({ version: "clash", effectiveFrom: "2028-06-01" }) as never)).rejects.toThrow(/same days as version old \(2027-01-01 to 2028-12-31\)/);
    const next = await createTaxRuleVersion(admin, rule({ version: "next", effectiveFrom: "2029-01-01" }) as never); // the day after it ends is fine
    expect(next.version).toBe("next");

    // a client that already holds an ended pension version covering the new one's start
    const w = await bureau();
    const pension2 = await db.pensionRule.create({ data: { organizationId: w.t.org.id, version: "v2", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC"], effectiveFrom: d("2027-01-01") } });
    await db.pensionRule.updateMany({ where: { organizationId: w.client.id }, data: { effectiveTo: d("2027-06-30") } });
    const rel = await proposeRelease(w.officer, { kind: "PENSION", ruleId: pension2.id, summary: "Pension rate unchanged, new version", source: "PRA (invented for the test)" } as never);
    await verifyRelease(w.hr, rel.id, "Checked the rates against the source");
    await verifyRelease(w.finance, rel.id, "Agrees with the source");
    const result = await publishRelease(w.officer, rel.id);
    const outcome = result.find((o) => o.clientId === w.client.id);
    expect(outcome?.outcome).toBe("FAILED");
    expect(outcome?.message).toMatch(/same days/);
  });
});

describe("due dates on PAYE remittance lines", () => {
  it("come from the tax rule the payroll was calculated under: 'not set' until the rule has them, then the date, lateness and penalty", async () => {
    const ctx = await ctxFor("FINANCE");
    const taxRule = await db.taxRule.findFirstOrThrow({ where: { organizationId: ctx.orgId, active: true }, orderBy: { effectiveFrom: "desc" } });
    const version = `${taxRule.code}@${taxRule.version}`;
    const line = (type: string, status: string) => ({ id: `${type}-${status}`, type, status, totalAmount: 250000, run: { taxRuleVersion: version, period: { year: 2026, month: 3 } } });
    const rows = [line("PAYE", "PENDING"), line("PAYE", "PAID"), line("PENSION", "PENDING")];
    const saved = { payeDueDay: taxRule.payeDueDay, annualReturnMonth: taxRule.annualReturnMonth, annualReturnDay: taxRule.annualReturnDay, latePenaltyPct: taxRule.latePenaltyPct };
    await db.taxRule.update({ where: { id: taxRule.id }, data: { payeDueDay: null, annualReturnMonth: null, annualReturnDay: null, latePenaltyPct: null } }); // start from a rule with no dates, whatever the seed holds
    try {
      const before = await remittanceTiming(ctx, rows, "2026-04-11");
      expect(before.get("PAYE-PENDING")).toEqual({ dueDate: null, overdue: false, daysLate: 0, penalty: null }); // nothing set: no date, never overdue
      expect(before.has("PENSION-PENDING")).toBe(false);

      await db.taxRule.update({ where: { id: taxRule.id }, data: { payeDueDay: 10, latePenaltyPct: 10 } });
      const after = await remittanceTiming(ctx, rows, "2026-04-11");
      expect(after.get("PAYE-PENDING")).toEqual({ dueDate: "2026-04-10", overdue: true, daysLate: 1, penalty: 25000 });
      expect(after.get("PAYE-PAID")).toEqual({ dueDate: "2026-04-10", overdue: false, daysLate: 0, penalty: 0 });
      expect((await remittanceTiming(ctx, rows, "2026-04-10")).get("PAYE-PENDING")?.overdue).toBe(false);

      // another organization has no such rule: it learns nothing
      const other = await isolatedOrg();
      expect((await remittanceTiming(other.ctx("FINANCE"), rows, "2026-04-11")).get("PAYE-PENDING")?.dueDate).toBeNull();
    } finally {
      await db.taxRule.update({ where: { id: taxRule.id }, data: saved });
    }
  });
});
