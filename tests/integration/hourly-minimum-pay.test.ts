import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import { copyStatutoryRules, createPayrollRule, payrollRuleFor } from "@/server/services/statutory";
import { createStructure } from "@/server/services/structures";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, phase 4c (the founder's H13): a minimum-pay WARNING, set in the payroll rules (effective-dated, 0 = no check, no figure built in). It warns when a person paid only by the hour earned less from
 * hours in the month than the figure, and nothing else: pay is not blocked and not changed. Real payrolls in the demo company for December 2039 and March 2040 (no other test uses them); the rule version with the figure is CLOSED and covers 2040 only, so it cannot touch any other test's dates or the demo company's open rule. Rates are INVENTED: role weekday 1,000 an hour. Calendar: 2039-12-05 and 2040-03-05 are Mondays.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);

async function world(tag = uid()) {
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `HM-${tag}`, name: `Hourly min ${tag}`, effectiveFrom: "2037-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `MC${tag}`, name: `Min Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `MK${tag}`, name: `Min guarding ${tag}`, startDate: day("2037-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `MB${tag}`, name: `Min site ${tag}`, state: "Lagos" } });
  await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2037-01-01") } });
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2037-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
  let n = 0;
  const person = async (label: string) => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Hm", lastName: `${label}${tag}`, employmentDate: "2037-01-01", categoryId: cat.id, bankName: "GTBank", accountNumber: `76${String(Date.now()).slice(-7)}${n}`, accountName: `HM ${label}` } as never);
    await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day("2037-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  const shift = async (employeeId: string, from: string, to: string) => {
    const cin = wat(from);
    const cout = wat(to);
    const en = await db.timeEntry.create({ data: { organizationId: org, employeeId, clientId: client.id, contractId: contract.id, beatId: beat.id, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: (cout.getTime() - cin.getTime()) / 60000 } });
    await db.timeEntrySegment.createMany({ data: payableSegments(cin, cout, [], new Set()).map((s) => ({ organizationId: org, entryId: en.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
  };
  const warnings = (runId: string, employeeId: string) => db.payrollValidationIssue.findMany({ where: { runId, employeeId, code: "HOURLY_BELOW_MINIMUM_PAY" } });
  return { payroll, org, person, shift, warnings };
}

describe("the minimum monthly pay for staff paid by the hour, on the payroll rule", () => {
  it("is 0 (no check) unless set, validated to naira and kobo, stored with the version, effective-dated, and copied to a new organization", async () => {
    const t = await isolatedOrg();
    const u = await db.user.create({ data: { organizationId: t.org.id, email: `min.${uid()}@min.test`.toLowerCase(), name: "Admin", role: "COMPANY_ADMIN", passwordHash: "x" } });
    const admin = { userId: u.id, orgId: t.org.id, role: "COMPANY_ADMIN" as const, name: u.name, email: u.email, employeeId: null };
    const base = { prorationBasis: "CALENDAR_DAYS", defaultOperativeSharePct: 70, standardHoursPerDay: 12, overtimeMultiplier: 1.5, maxOvertimeHoursPerMonth: 60, maxDeductionPctOfGross: 33.33, backOfficeChargePct: 15 };
    const none = await createPayrollRule(admin, { ...base, version: "a", effectiveFrom: "2027-01-01" } as never);
    expect(num(none.hourlyMinMonthlyPay)).toBe(0);
    const on = await createPayrollRule(admin, { ...base, version: "b", effectiveFrom: "2028-01-01", hourlyMinMonthlyPay: 70000.5 } as never);
    expect(num(on.hourlyMinMonthlyPay)).toBe(70000.5);
    await expect(createPayrollRule(admin, { ...base, version: "c", effectiveFrom: "2029-01-01", hourlyMinMonthlyPay: -1 } as never)).rejects.toThrow();
    await expect(createPayrollRule(admin, { ...base, version: "d", effectiveFrom: "2029-01-01", hourlyMinMonthlyPay: 100.005 } as never)).rejects.toThrow(/two decimal places/i);
    // effective-dated: each date reads the version in force on it
    expect((await payrollRuleFor(db, t.org.id, day("2027-06-01"))).hourlyMinMonthlyPayKobo).toBe(0);
    expect((await payrollRuleFor(db, t.org.id, day("2028-06-01"))).hourlyMinMonthlyPayKobo).toBe(7_000_050);
    const other = await isolatedOrg();
    await db.$transaction((tx) => copyStatutoryRules(tx, t.org.id, other.org.id));
    expect((await db.payrollRule.findMany({ where: { organizationId: other.org.id }, orderBy: { effectiveFrom: "asc" } })).map((r) => num(r.hourlyMinMonthlyPay))).toEqual([0, 70000.5]);
  });
});

describe("the pay run warns about hourly pay below the minimum", () => {
  it("warns, with both figures and the shortfall, for a person paid only by the hour who earned less than the figure, and changes nothing about their pay", async () => {
    // a version for 2040 only, CLOSED (it has an end date), made directly: the demo company keeps exactly one open-ended rule, which other tests look up and edit, and the creation of a version through the service is proved in the isolated-company test above
    const current = await db.payrollRule.findFirstOrThrow({ where: { organizationId: (await ctxFor("PAYROLL_ADMIN")).orgId, effectiveTo: null } });
    const { id: _id, createdAt: _created, ...fields } = current;
    void _id;
    void _created;
    await db.payrollRule.create({ data: { ...fields, version: "min-2040", effectiveFrom: day("2040-01-01"), effectiveTo: day("2040-12-31"), hourlyMinMonthlyPay: "50000" } });
    const w = await world();
    const low = await w.person("Low");
    const exact = await w.person("Exact");
    const high = await w.person("High");
    await w.shift(low.id, "2040-03-05T08:00", "2040-03-05T12:00"); // 4 h = 4,000: below 50,000
    for (const d of ["05", "06", "07", "08", "09"]) await w.shift(exact.id, `2040-03-${d}T08:00`, `2040-03-${d}T18:00`); // 50 h = 50,000: exactly the figure
    for (const d of ["12", "13", "14", "15", "16"]) await w.shift(high.id, `2040-03-${d}T08:00`, `2040-03-${d}T20:00`); // 60 h = 60,000: above
    const period = await createPeriod(w.payroll, 2040, 3);
    const run = await runPayroll(w.payroll, period.id);
    const found = await w.warnings(run.id, low.id);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("WARNING");
    expect(found[0].requiresExplanation).toBe(false);
    for (const shown of ["4,000.00", "50,000.00", "46,000.00"]) expect(found[0].message, shown).toContain(shown);
    // a warning only: the pay is exactly what the hours earned, and nothing blocks the payroll
    const rec = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: low.id } });
    expect(Math.abs(num(rec.earnedGross) - 4_000)).toBeLessThan(0.06);
    expect(await db.payrollValidationIssue.count({ where: { runId: run.id, employeeId: low.id, severity: "CRITICAL" } })).toBe(0);
    // at the figure, and above it: no warning
    expect(await w.warnings(run.id, exact.id)).toHaveLength(0);
    expect(await w.warnings(run.id, high.id)).toHaveLength(0);
  });

  it("does not warn for a month before the rule version with the figure takes effect (the version in force then has no check)", async () => {
    const w = await world();
    const e = await w.person("Before");
    await w.shift(e.id, "2039-12-05T08:00", "2039-12-05T12:00"); // 4 h = 4,000, in a month the figure does not cover
    const period = await createPeriod(w.payroll, 2039, 12);
    const run = await runPayroll(w.payroll, period.id);
    expect(await w.warnings(run.id, e.id)).toHaveLength(0);
  });

  it("does not warn a person paid monthly, however low", async () => {
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const period = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: payroll.orgId, year: 2040, month: 3 } });
    const run = await db.payrollRun.findFirstOrThrow({ where: { periodId: period.id, type: "REGULAR" } });
    const monthly = await db.payrollRecord.findMany({ where: { runId: run.id, hourlyLines: { none: {} } }, select: { employeeId: true } });
    expect(monthly.length).toBeGreaterThan(0);
    const ids = monthly.map((m) => m.employeeId);
    expect(await db.payrollValidationIssue.count({ where: { runId: run.id, code: "HOURLY_BELOW_MINIMUM_PAY", employeeId: { in: ids } } })).toBe(0);
  });
});
