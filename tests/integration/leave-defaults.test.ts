import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { getLeavePolicy } from "@/server/services/leave";
import { createPayrollRule, payrollRuleFor } from "@/server/services/statutory";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, H14 (the founder's figures of 2026-11-21): the leave pay for staff paid by the hour is 2.5% of the hours worked by default (a contract may set its own), 5 paid sick days a year, 3 months of hours averaged.
 * These are the DEFAULTS FOR NEW settings only: a new company's leave policy, and a payroll rule version created without a figure. Every EXISTING setting keeps the value it has (so no past or open payroll changes);
 * a company turns leave pay on from a date it chooses by creating a new payroll rule version. The demonstration company's own rule keeps leave pay off so its figures are unchanged.
 */
const base = { prorationBasis: "CALENDAR_DAYS", defaultOperativeSharePct: 70, standardHoursPerDay: 12, overtimeMultiplier: 1.5, maxOvertimeHoursPerMonth: 60, maxDeductionPctOfGross: 33.33, backOfficeChargePct: 15 };
const adminOf = async (orgId: string) => {
  const u = await db.user.create({ data: { organizationId: orgId, email: `def.${uid()}@def.test`.toLowerCase(), name: "Admin", role: "COMPANY_ADMIN", passwordHash: "x" } });
  return { userId: u.id, orgId, role: "COMPANY_ADMIN" as const, name: u.name, email: u.email, employeeId: null };
};

describe("the paid sick days a year", () => {
  it("start at 5 for a company that has no leave policy yet, and an existing policy keeps the value it has", async () => {
    const fresh = await isolatedOrg();
    expect((await getLeavePolicy(fresh.org.id)).sickDaysPerYear).toBe(5);
    const existing = await isolatedOrg();
    await db.leavePolicy.create({ data: { organizationId: existing.org.id, sickDaysPerYear: 0 } });
    expect((await getLeavePolicy(existing.org.id)).sickDaysPerYear).toBe(0);
  });
});

describe("the leave pay for staff paid by the hour", () => {
  it("starts at 2.5% for a payroll rule version created without a figure, and 0 means none when it is set", async () => {
    const t = await isolatedOrg();
    const admin = await adminOf(t.org.id);
    const first = await createPayrollRule(admin, { ...base, version: "a", effectiveFrom: "2027-01-01" } as never);
    expect(num(first.hourlyLeavePct)).toBe(2.5);
    const off = await createPayrollRule(admin, { ...base, version: "b", effectiveFrom: "2028-01-01", hourlyLeavePct: 0 } as never);
    expect(num(off.hourlyLeavePct)).toBe(0);
    expect((await payrollRuleFor(db, t.org.id, new Date("2027-06-01T00:00:00Z"))).hourlyLeavePct).toBe(2.5);
    expect((await payrollRuleFor(db, t.org.id, new Date("2028-06-01T00:00:00Z"))).hourlyLeavePct).toBe(0);
  });

  it("a rule row made without a figure gets 2.5, a row with a figure keeps it", async () => {
    const t = await isolatedOrg();
    const plain = await db.payrollRule.create({ data: { organizationId: t.org.id, version: "plain", effectiveFrom: new Date("2027-01-01T00:00:00Z"), effectiveTo: new Date("2027-12-31T00:00:00Z") } });
    const zero = await db.payrollRule.create({ data: { organizationId: t.org.id, version: "zero", effectiveFrom: new Date("2028-01-01T00:00:00Z"), hourlyLeavePct: "0" } });
    expect([num(plain.hourlyLeavePct), num(zero.hourlyLeavePct)]).toEqual([2.5, 0]);
  });

  it("the demonstration company's rule keeps leave pay off, so its payroll figures are unchanged", async () => {
    const demo = await ctxFor("PAYROLL_ADMIN");
    expect((await payrollRuleFor(db, demo.orgId, new Date("2026-06-01T00:00:00Z"))).hourlyLeavePct).toBe(0);
  });
});
