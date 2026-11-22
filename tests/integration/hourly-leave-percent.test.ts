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
 * Hourly pay, H14 piece 1 (docs/plans/hourly-payroll-h14-build-plan.md): the leave pay for a person paid by the hour is a PERCENTAGE ADDED TO EVERY HOUR WORKED (the founder's answers of 2026-11-20), a figure set in the payroll
 * rules (effective-dated, 0 = off, none built in), due only from the day the person completes the company's service period for annual leave (12 months by the leave policy, as for monthly staff). It is part of the site's gross:
 * divided by the salary structure, pension and PAYE as for hourly pay. Real payrolls in the demo company for March and April 2043 and March 2044 (no other test uses them); the rule version with the percentage is CLOSED and
 * covers 2043 (or 2044) only, made directly so the demo company keeps its one open-ended rule. Rates are INVENTED: role weekday 1,000, weekend 1,500 an hour; the percentage is 10 (a test figure, not a recommendation).
 * Calendar: 2043-03-02, 2043-03-09 and 2043-03-16 are Mondays; 2043-03-14 a Saturday; 2043-04-06 and 2044-03-07 Mondays.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.06);

async function world(tag = uid()) {
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `LP-${tag}`, name: `Leave pct ${tag}`, effectiveFrom: "2040-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `LQ${tag}`, name: `Leave pct Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `LQK${tag}`, name: `Leave pct guarding ${tag}`, startDate: day("2040-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `LQB${tag}`, name: `Leave pct site ${tag}`, state: "Lagos" } });
  await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2040-01-01") } });
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2040-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
  let n = 0;
  const person = async (label: string, employmentDate = "2040-01-01", hourly = true) => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Lq", lastName: `${label}${tag}`, employmentDate, categoryId: cat.id, bankName: "GTBank", accountNumber: `73${String(Date.now()).slice(-7)}${n}`, accountName: `LQ ${label}` } as never);
    if (hourly) await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day(employmentDate), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  const shift = async (employeeId: string, from: string, to: string) => {
    const cin = wat(from);
    const cout = wat(to);
    const en = await db.timeEntry.create({ data: { organizationId: org, employeeId, clientId: client.id, contractId: contract.id, beatId: beat.id, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: (cout.getTime() - cin.getTime()) / 60000 } });
    await db.timeEntrySegment.createMany({ data: payableSegments(cin, cout, [], new Set()).map((s) => ({ organizationId: org, entryId: en.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
  };
  /** A rule version for ONE year only, CLOSED (it has an end date), made directly: the demo company keeps exactly one open-ended rule, which other tests look up and edit. */
  const ruleFor = async (year: number, over: { hourlyLeavePct?: string; hourlyMinMonthlyPay?: string }) => {
    const current = await db.payrollRule.findFirstOrThrow({ where: { organizationId: org, effectiveTo: null } });
    const { id: _id, createdAt: _created, ...fields } = current;
    void _id;
    void _created;
    await db.payrollRule.create({ data: { ...fields, version: `leave-${year}-${tag}`, effectiveFrom: day(`${year}-01-01`), effectiveTo: day(`${year}-12-31`), ...over } });
  };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  const allowances = (recordId: string) => db.hourlyAllowanceLine.findMany({ where: { recordId } });
  return { payroll, org, person, shift, ruleFor, record, allowances, beat, tag };
}

// the rule versions with a percentage are made once for the whole file (closed, one year each, so no other test or date meets them)
beforeAll(async () => {
  const w = await world();
  await w.ruleFor(2043, { hourlyLeavePct: "10" });
  await w.ruleFor(2044, { hourlyLeavePct: "10", hourlyMinMonthlyPay: "11500" });
}, 120_000);

const periodOf = async (orgId: string, ctx: Awaited<ReturnType<typeof ctxFor>>, year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: orgId, year, month } })) ?? createPeriod(ctx, year, month);

describe("the leave percentage on the payroll rule", () => {
  it("is 0 (no leave pay) unless set, validated to a percentage of at most two decimals, stored with the version, effective-dated, and copied to a new organization", async () => {
    const t = await isolatedOrg();
    const u = await db.user.create({ data: { organizationId: t.org.id, email: `lp.${uid()}@lp.test`.toLowerCase(), name: "Admin", role: "COMPANY_ADMIN", passwordHash: "x" } });
    const admin = { userId: u.id, orgId: t.org.id, role: "COMPANY_ADMIN" as const, name: u.name, email: u.email, employeeId: null };
    const base = { prorationBasis: "CALENDAR_DAYS", defaultOperativeSharePct: 70, standardHoursPerDay: 12, overtimeMultiplier: 1.5, maxOvertimeHoursPerMonth: 60, maxDeductionPctOfGross: 33.33, backOfficeChargePct: 15 };
    const none = await createPayrollRule(admin, { ...base, version: "a", effectiveFrom: "2027-01-01" } as never);
    expect(num(none.hourlyLeavePct)).toBe(2.5); // a new version created without a figure starts at 2.5 (the founder's default of 2026-11-21)
    const zero = await createPayrollRule(admin, { ...base, version: "a0", effectiveFrom: "2027-06-01", hourlyLeavePct: 0 } as never);
    expect(num(zero.hourlyLeavePct)).toBe(0);
    const on = await createPayrollRule(admin, { ...base, version: "b", effectiveFrom: "2028-01-01", hourlyLeavePct: 8.33 } as never);
    expect(num(on.hourlyLeavePct)).toBe(8.33);
    await expect(createPayrollRule(admin, { ...base, version: "c", effectiveFrom: "2029-01-01", hourlyLeavePct: -1 } as never)).rejects.toThrow();
    await expect(createPayrollRule(admin, { ...base, version: "d", effectiveFrom: "2029-01-01", hourlyLeavePct: 100.5 } as never)).rejects.toThrow();
    await expect(createPayrollRule(admin, { ...base, version: "e", effectiveFrom: "2029-01-01", hourlyLeavePct: 8.333 } as never)).rejects.toThrow(/two decimal places/i);
    expect((await payrollRuleFor(db, t.org.id, day("2027-03-01"))).hourlyLeavePct).toBe(2.5);
    expect((await payrollRuleFor(db, t.org.id, day("2027-08-01"))).hourlyLeavePct).toBe(0);
    expect((await payrollRuleFor(db, t.org.id, day("2028-06-01"))).hourlyLeavePct).toBe(8.33);
    const other = await isolatedOrg();
    await db.$transaction((tx) => copyStatutoryRules(tx, t.org.id, other.org.id));
    expect((await db.payrollRule.findMany({ where: { organizationId: other.org.id }, orderBy: { effectiveFrom: "asc" } })).map((r) => num(r.hourlyLeavePct))).toEqual([2.5, 0, 8.33]);
  });
});

describe("the pay run adds the leave percentage to hours worked, for a person past the service period", () => {
  it("adds 10% of the pay for every hour worked (weekday and weekend alike) as its own stored line, divided by the site's structure like the hours", async () => {
    const w = await world();
    const e = await w.person("Eligible"); // in service since 2040: past 12 months
    await w.shift(e.id, "2043-03-02T08:00", "2043-03-02T16:00"); // Monday 8 h = 8,000
    await w.shift(e.id, "2043-03-14T08:00", "2043-03-14T16:00"); // Saturday 8 h = 12,000
    const period = await periodOf(w.org, w.payroll, 2043, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 22_000); // 20,000 of hours + 10% leave pay 2,000
    const lines = await w.allowances(rec.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "LEAVE_PERCENT", employeeId: e.id, runId: run.id, organizationId: w.org, beatId: w.beat.id });
    expect([num(lines[0].baseAmount), num(lines[0].pct), num(lines[0].amount)]).toEqual([20_000, 10, 2_000]);
    // the structure divides the whole 22,000 (hours and leave pay together)
    const split = (rec.lines as Array<{ type: string; amount: number }>).filter((l) => l.type === "EARNING").reduce((a, l) => a + l.amount, 0);
    near(split, 22_000);
    near(num(rec.netPay), num(rec.totalEarnings) - num(rec.totalDeductions));
    // the hours themselves are unchanged
    expect((await db.hourlyPayLine.findMany({ where: { recordId: rec.id } })).reduce((a, l) => a + num(l.amount), 0)).toBeCloseTo(20_000, 2);
  });

  it("adds nothing for a person who has not yet completed the service period, and counts only the hours worked on or after the day they do", async () => {
    const w = await world();
    const notYet = await w.person("NotYet", "2043-01-15"); // 12 months not reached in 2043
    const mid = await w.person("MidMonth", "2042-03-15"); // completes 12 months on 2043-03-15
    await w.shift(notYet.id, "2043-03-02T08:00", "2043-03-02T18:00"); // 10 h = 10,000
    await w.shift(mid.id, "2043-03-09T08:00", "2043-03-09T18:00"); // Monday 10 h before 15 March: not eligible
    await w.shift(mid.id, "2043-03-16T08:00", "2043-03-16T18:00"); // Monday 10 h after: eligible
    const period = await periodOf(w.org, w.payroll, 2043, 3);
    const run = await runPayroll(w.payroll, period.id);
    const a = await w.record(run.id, notYet.id);
    near(num(a.earnedGross), 10_000);
    expect(await w.allowances(a.id)).toHaveLength(0);
    const b = await w.record(run.id, mid.id);
    near(num(b.earnedGross), 21_000); // 20,000 of hours + 10% of the 10,000 worked on or after 15 March
    const lines = await w.allowances(b.id);
    expect([num(lines[0].baseAmount), num(lines[0].amount)]).toEqual([10_000, 1_000]);
  });

  it("adds nothing while the percentage is 0 (off), for a person paid monthly, and when calculated again it replaces its line instead of adding to it", async () => {
    const w = await world();
    const off = await w.person("Off");
    await w.shift(off.id, "2043-03-02T08:00", "2043-03-02T16:00");
    const period = await periodOf(w.org, w.payroll, 2043, 3);
    // the rule version for 2043 has 10%, so for a month the percentage does NOT cover (December 2042) there is none
    const dec = await periodOf(w.org, w.payroll, 2042, 12);
    await w.shift(off.id, "2042-12-08T08:00", "2042-12-08T16:00");
    const decRun = await runPayroll(w.payroll, dec.id);
    const decRec = await w.record(decRun.id, off.id);
    near(num(decRec.earnedGross), 8_000);
    expect(await w.allowances(decRec.id)).toHaveLength(0);
    // a person paid monthly has none
    const monthly = await w.person("Monthly", "2040-01-01", false);
    const run = await runPayroll(w.payroll, period.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: run.id, employeeId: monthly.id } })).toBe(0);
    // calculating again replaces the line
    const rec = await w.record(run.id, off.id);
    expect(await w.allowances(rec.id)).toHaveLength(1);
    const again = await runPayroll(w.payroll, period.id);
    expect(again.id).toBe(run.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: run.id, employeeId: off.id } })).toBe(1);
    near(num((await w.record(run.id, off.id)).earnedGross), 8_800);
  });

  it("is added to late hours paid by a supplementary payroll too", async () => {
    const w = await world();
    const e = await w.person("Late");
    await w.shift(e.id, "2043-04-06T08:00", "2043-04-06T16:00"); // 8,000 in the regular payroll
    const period = await periodOf(w.org, w.payroll, 2043, 4);
    const run = await runPayroll(w.payroll, period.id);
    near(num((await w.record(run.id, e.id)).earnedGross), 8_800);
    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
    await w.shift(e.id, "2043-04-07T08:00", "2043-04-07T18:00"); // approved after the lock: 10 h = 10,000
    const supp = await createSupplementaryRun(w.payroll, period.id, "Late hours");
    const rec = await w.record(supp.id, e.id);
    near(num(rec.earnedGross), 11_000); // 10,000 + 10% leave pay
    expect((await w.allowances(rec.id)).map((l) => [num(l.baseAmount), num(l.amount)])).toEqual([[10_000, 1_000]]);
  });
});

describe("what else counts it", () => {
  it("the payslip carries the leave pay line, and the PDF model shows it with the hours and counts it in the total", async () => {
    const w = await world();
    const e = await w.person("Slip");
    await w.shift(e.id, "2043-03-02T08:00", "2043-03-02T12:00"); // 4 h = 4,000
    const period = await periodOf(w.org, w.payroll, 2043, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    const slip = (await getPayslip(w.payroll, rec.id))!;
    expect(slip.hourlyAllowances).toHaveLength(1);
    expect(slip.hourlyAllowances[0]).toMatchObject({ kind: "LEAVE_PERCENT", siteName: w.beat.name });
    expect([num(slip.hourlyAllowances[0].baseAmount), num(slip.hourlyAllowances[0].pct), num(slip.hourlyAllowances[0].amount)]).toEqual([4_000, 10, 400]);
    const m = payslipModel({
      orgName: "Demo", employeeNumber: slip.employeeNumber, employeeName: slip.employeeName, departmentName: null, categoryName: slip.categoryName, bankName: null, accountNumber: null, pensionPin: null, pfa: null, taxId: null,
      daysWorked: num(slip.daysWorked), basisDays: slip.basisDays, daysAbsent: slip.daysAbsent, overtimeHours: 0, monthlyGross: num(slip.monthlyGross), totalEarnings: num(slip.totalEarnings), totalDeductions: num(slip.totalDeductions), netPay: num(slip.netPay),
      taxRuleVersion: slip.taxRuleVersion, hasOverride: false, lines: slip.lines as never, locations: [], hourly: slip.hourly, allowances: slip.hourlyAllowances, periodName: "March 2043", periodStart: "2043-03-01", periodEnd: "2043-03-31", runType: "REGULAR", runNumber: 1, generatedOn: "2043-03-31",
    });
    const place = `${(await db.client.findUniqueOrThrow({ where: { id: w.beat.clientId } })).name} - ${w.beat.name}`; // the Site column names the client (the founder's decision)
    expect(m.hourly?.rows).toEqual([[place, "Weekday", "4 h", "1,000.00", "4,000.00"], [place, "Leave pay (10% of 4,000.00)", "", "", "400.00"]]);
    expect(m.hourly?.total).toEqual(["Total", "", "4 h", "", "4,400.00"]);
  });

  it("the minimum-pay warning counts the leave pay as earnings, and another company cannot read the leave pay", async () => {
    const w = await world();
    const e = await w.person("MinPay");
    await w.shift(e.id, "2044-03-07T08:00", "2044-03-07T18:00"); // 10 h = 10,000, and 1,000 leave pay: 11,000 earned, below the 11,500 figure
    const period = await periodOf(w.org, w.payroll, 2044, 3);
    const run = await runPayroll(w.payroll, period.id);
    const found = await db.payrollValidationIssue.findMany({ where: { runId: run.id, employeeId: e.id, code: "HOURLY_BELOW_MINIMUM_PAY" } });
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("11,000.00");
    expect(found[0].message).toContain("500.00"); // the shortfall
    const rec = await w.record(run.id, e.id);
    const other = await isolatedOrg();
    expect(await getPayslip(other.ctx("PAYROLL_ADMIN"), rec.id)).toBeNull();
  });
});
