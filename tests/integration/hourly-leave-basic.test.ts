import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { payslipModel } from "@/lib/payslip-pdf";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, createSupplementaryRun, getPayslip, runPayroll } from "@/server/services/payroll";
import { copyStatutoryRules, createPayrollRule, payrollRuleFor } from "@/server/services/statutory";
import { createStructure } from "@/server/services/structures";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, H14, the leave pay basis (the founder's decision of 2026-11-21): the leave percentage is taken of the BASIC part of the pay, as the site's salary structure splits it. It is a RULE SETTING (BASIC for a new version;
 * a version made before the decision keeps ALL_PAY, so no past or open payroll changes). The stored line keeps the base, the percentage, the amount and the basis. A structure with no Basic component pays no leave pay on those
 * hours and raises a blocking finding. Real payrolls in the demo company for February and March 2056 (BASIC, 10%) and March 2057 (ALL_PAY, 10%); no other test uses them. The percentages are test figures, not recommendations.
 * Calendar: 2056-02-07, 2056-03-06, 2056-03-13 and 2057-03-05 are Mondays. Rates are INVENTED: role weekday 1,000 an hour; the test structure gives Basic 10% of the gross.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.06);

async function world(opts: { leavePct?: string | null; tag?: string; noBasic?: boolean } = {}) {
  const tag = opts.tag ?? uid();
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `CP-${tag}`, name: `Contract pct ${tag}`, effectiveFrom: "2040-01-01", activate: true,
    components: opts.noBasic ? [{ code: "HOUSING", name: "Housing", calcType: "PERCENTAGE" as const, percentage: 100, taxable: true, pensionable: true }] : DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `CQ${tag}`, name: `Contract pct Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `CQK${tag}`, name: `Contract pct guarding ${tag}`, startDate: day("2040-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `CQB${tag}`, name: `Contract pct site ${tag}`, state: "Lagos" } });
  const rate = await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2040-01-01"), ...(opts.leavePct === undefined ? {} : { hourlyLeavePct: opts.leavePct }) } });
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2030-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2", decidedAt: new Date() } });
  let n = 0;
  const person = async (label: string, employmentDate = "2040-01-01") => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Cp", lastName: `${label}${tag}`, employmentDate, categoryId: cat.id, bankName: "GTBank", accountNumber: `74${String(Date.now()).slice(-7)}${n}`, accountName: `CP ${label}` } as never);
    await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day(employmentDate), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2", decidedAt: new Date() } });
    return e;
  };
  /** An approved shift at this world's site, or at another world's site (`at`). */
  const shift = async (employeeId: string, from: string, to: string, at: { clientId: string; contractId: string; beatId: string } = { clientId: client.id, contractId: contract.id, beatId: beat.id }) => {
    const cin = wat(from);
    const cout = wat(to);
    const en = await db.timeEntry.create({ data: { organizationId: org, employeeId, ...at, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: (cout.getTime() - cin.getTime()) / 60000 } });
    await db.timeEntrySegment.createMany({ data: payableSegments(cin, cout, [], new Set()).map((s) => ({ organizationId: org, entryId: en.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
  };
  const site = { clientId: client.id, contractId: contract.id, beatId: beat.id };
  /** A rule version for ONE year only, CLOSED, made directly: the demo company keeps exactly one open-ended rule. */
  const ruleFor = async (year: number, hourlyLeavePct: string, hourlyLeaveBasis: "BASIC" | "ALL_PAY") => {
    const current = await db.payrollRule.findFirstOrThrow({ where: { organizationId: org, effectiveTo: null } });
    const { id: _id, createdAt: _created, ...fields } = current;
    void _id;
    void _created;
    await db.payrollRule.create({ data: { ...fields, version: `lb-${year}-${tag}`, effectiveFrom: day(`${year}-01-01`), effectiveTo: day(`${year}-12-31`), hourlyLeavePct, hourlyLeaveBasis } });
  };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  const allowances = (recordId: string) => db.hourlyAllowanceLine.findMany({ where: { recordId } });
  return { payroll, org, cat, contract, rate, person, shift, site, ruleFor, record, allowances, beat, tag };
}


// the rule versions are made once for the whole file: 2056 on the BASIC basis (10%), 2057 on the ALL_PAY basis (10%); both closed, one year each
beforeAll(async () => {
  const w = await world();
  await w.ruleFor(2056, "10", "BASIC");
  await w.ruleFor(2057, "10", "ALL_PAY");
}, 120_000);

const periodOf = async (orgId: string, ctx: Awaited<ReturnType<typeof ctxFor>>, year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: orgId, year, month } })) ?? createPeriod(ctx, year, month);

describe("the leave percentage is taken of the Basic part of the pay (the founder's decision)", () => {
  it("10% of the Basic part: 10 hours at 1,000 are 10,000 of pay, Basic is 10% of that (1,000), so the leave pay is 100; the line stores the Basic base, the percentage, the amount and the basis, and the payslip says 'of Basic'", async () => {
    const w = await world();
    const e = await w.person("Basic");
    await w.shift(e.id, "2056-03-06T08:00", "2056-03-06T18:00"); // Monday 10 h = 10,000
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2056, 3)).id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 10_100);
    const lines = await w.allowances(rec.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "LEAVE_PERCENT", leaveBasis: "BASIC" });
    expect([num(lines[0].baseAmount), num(lines[0].pct), num(lines[0].amount)]).toEqual([1_000, 10, 100]);
    const slip = (await getPayslip(w.payroll, rec.id))!;
    expect(slip.hourlyAllowances[0].basis).toBe("BASIC");
    const m = payslipModel({
      orgName: "Demo", employeeNumber: slip.employeeNumber, employeeName: slip.employeeName, departmentName: null, categoryName: slip.categoryName, bankName: null, accountNumber: null, pensionPin: null, pfa: null, taxId: null,
      daysWorked: num(slip.daysWorked), basisDays: slip.basisDays, daysAbsent: slip.daysAbsent, overtimeHours: 0, monthlyGross: num(slip.monthlyGross), totalEarnings: num(slip.totalEarnings), totalDeductions: num(slip.totalDeductions), netPay: num(slip.netPay),
      taxRuleVersion: slip.taxRuleVersion, hasOverride: false, lines: slip.lines as never, locations: [], hourly: slip.hourly, allowances: slip.hourlyAllowances, periodName: "March 2056", periodStart: "2056-03-01", periodEnd: "2056-03-31", runType: "REGULAR", runNumber: 1, generatedOn: "2056-03-31",
    });
    expect(m.hourly?.rows.some((r) => r[1] === "Leave pay (10% of Basic 1,000.00)" && r[4] === "100.00")).toBe(true);
  });

  it("a rule version on ALL_PAY (made before the decision) still takes the percentage of all the pay: 1,000, and the line has no basis", async () => {
    const w = await world();
    const e = await w.person("AllPay");
    await w.shift(e.id, "2057-03-05T08:00", "2057-03-05T18:00"); // Monday 10 h = 10,000
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2057, 3)).id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 11_000);
    const lines = await w.allowances(rec.id);
    expect([num(lines[0].baseAmount), num(lines[0].amount), lines[0].leaveBasis]).toEqual([10_000, 1_000, null]);
  });

  it("a structure with no Basic component pays no leave pay on those hours, pays the hours, and raises a blocking finding that names the structure", async () => {
    const w = await world({ noBasic: true });
    const e = await w.person("NoBasic");
    await w.shift(e.id, "2056-02-07T08:00", "2056-02-07T18:00");
    const run = await runPayroll(w.payroll, (await periodOf(w.org, w.payroll, 2056, 2)).id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 10_000); // the hours only
    expect(await w.allowances(rec.id)).toHaveLength(0);
    const found = await db.payrollValidationIssue.findMany({ where: { runId: run.id, employeeId: e.id, code: "HOURLY_LEAVE_NO_BASIC" } });
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect(found[0].message).toContain("no Basic component");
  });

  it("late hours paid by a supplementary payroll take the Basic part too: 5 hours = 5,000, Basic 500, 10% = 50", async () => {
    const w = await world();
    const e = await w.person("Late");
    await w.shift(e.id, "2056-03-06T08:00", "2056-03-06T16:00");
    const period = await periodOf(w.org, w.payroll, 2056, 3);
    await runPayroll(w.payroll, period.id);
    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
    await w.shift(e.id, "2056-03-13T08:00", "2056-03-13T13:00"); // approved after the lock: 5,000
    const supp = await createSupplementaryRun(w.payroll, period.id, "Late hours");
    const rec = await w.record(supp.id, e.id);
    near(num(rec.earnedGross), 5_050);
    expect((await w.allowances(rec.id)).map((l) => [num(l.baseAmount), num(l.pct), num(l.amount), l.leaveBasis])).toEqual([[500, 10, 50, "BASIC"]]);
  });
});

describe("the basis is a rule setting: effective-dated, versioned, defaulted for new versions only, audited and copied", () => {
  it("a new version starts on BASIC, ALL_PAY can be chosen, anything else is refused, the lookup returns it, and a new company copies it", async () => {
    const t = await isolatedOrg();
    const u = await db.user.create({ data: { organizationId: t.org.id, email: `lb.${uid()}@lb.test`.toLowerCase(), name: "Admin", role: "COMPANY_ADMIN", passwordHash: "x" } });
    const admin = { userId: u.id, orgId: t.org.id, role: "COMPANY_ADMIN" as const, name: u.name, email: u.email, employeeId: null };
    const base = { prorationBasis: "CALENDAR_DAYS", defaultOperativeSharePct: 70, standardHoursPerDay: 12, overtimeMultiplier: 1.5, maxOvertimeHoursPerMonth: 60, maxDeductionPctOfGross: 33.33, backOfficeChargePct: 15 };
    const first = await createPayrollRule(admin, { ...base, version: "a", effectiveFrom: "2027-01-01" } as never);
    expect(first.hourlyLeaveBasis).toBe("BASIC");
    const second = await createPayrollRule(admin, { ...base, version: "b", effectiveFrom: "2028-01-01", hourlyLeaveBasis: "ALL_PAY" } as never);
    expect(second.hourlyLeaveBasis).toBe("ALL_PAY");
    await expect(createPayrollRule(admin, { ...base, version: "c", effectiveFrom: "2029-01-01", hourlyLeaveBasis: "GROSS" } as never)).rejects.toThrow();
    expect((await payrollRuleFor(db, t.org.id, new Date("2027-06-01T00:00:00Z"))).hourlyLeaveBasis).toBe("BASIC");
    expect((await payrollRuleFor(db, t.org.id, new Date("2028-06-01T00:00:00Z"))).hourlyLeaveBasis).toBe("ALL_PAY");
    // every change is audited with who and when, old and new value
    const audit = await db.auditLog.findMany({ where: { organizationId: t.org.id, action: "PAYROLL_RULE_CHANGE" } });
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit.map((a) => a.newValue))).toContain("hourlyLeaveBasis");
    const other = await isolatedOrg();
    await db.$transaction((tx) => copyStatutoryRules(tx, t.org.id, other.org.id));
    expect((await db.payrollRule.findMany({ where: { organizationId: other.org.id }, orderBy: { effectiveFrom: "asc" } })).map((r) => r.hourlyLeaveBasis)).toEqual(["BASIC", "ALL_PAY"]);
  });

  it("the demonstration company's own rule is ALL_PAY (so its figures and older tests do not change), and a bare rule row made without a basis starts on BASIC", async () => {
    const demo = await ctxFor("PAYROLL_ADMIN");
    expect((await payrollRuleFor(db, demo.orgId, new Date("2026-06-01T00:00:00Z"))).hourlyLeaveBasis).toBe("ALL_PAY");
    const t = await isolatedOrg();
    const bare = await db.payrollRule.create({ data: { organizationId: t.org.id, version: "bare", effectiveFrom: new Date("2027-01-01T00:00:00Z") } });
    expect(bare.hourlyLeaveBasis).toBe("BASIC");
  });
});
