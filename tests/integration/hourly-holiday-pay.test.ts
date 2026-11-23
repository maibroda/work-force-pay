import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { payslipModel } from "@/lib/payslip-pdf";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, createSupplementaryRun, getPayslip, runPayroll } from "@/server/services/payroll";
import { createStructure } from "@/server/services/structures";
import { ctxFor, uid } from "../helpers";

/**
 * Hourly pay, H14 piece 3 (docs/plans/hourly-payroll-h14-build-plan.md): a PAID PUBLIC HOLIDAY NOT WORKED for a person paid by the hour. The founder's answers of 2026-11-20 and 2026-11-21 (my recommendations, which he
 * accepted): paid at the person's AVERAGE DAILY HOURS times their WEEKDAY RATE (the average of the approved hours of the 3 months before the holiday, divided by the days worked); only for a holiday that applies to the
 * state of the place they work (H11), on a USUAL day (a day of the week they worked in that period), when they were employed, paid by the hour and past the service period (12 months, as for monthly staff), and did NOT
 * work (a worked holiday is already paid at the holiday rate); a day of approved sickness is paid as sickness, never twice. Real payrolls in the demo company for March 2046 (no other test uses it); the hours, the holidays
 * and the spell are put in directly. Rates are INVENTED: role weekday 1,000, weekend 1,500, holiday 2,000 an hour.
 * Holidays made for these tests (2046): Wednesday 7 March, national; Friday 9 March, national; Monday 12 March, Lagos only; Tuesday 13 March, FCT only. Calendar: 2046-01-01 is a Monday.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.06);

async function world(tag = uid()) {
  const hr = await ctxFor("HR_ADMIN");
  const payroll = await ctxFor("PAYROLL_ADMIN");
  const org = payroll.orgId;
  await db.leavePolicy.upsert({ where: { organizationId: org }, create: { organizationId: org, sickDaysPerYear: 5 }, update: { sickDaysPerYear: 5 } });
  const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: org, code: "GUARD" } });
  const structure = await createStructure(payroll, {
    code: `HP-${tag}`, name: `Holiday pay ${tag}`, effectiveFrom: "2040-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `HQ${tag}`, name: `Holiday Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `HQK${tag}`, name: `Holiday guarding ${tag}`, startDate: day("2040-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `HQB${tag}`, name: `Holiday site ${tag}`, state: "Lagos" } });
  await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2040-01-01") } });
  // the demo company's role rate is shared by every hourly test file, and this file runs first: it starts in 2030, before any other file's periods, so the files after it still find a rate in force
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2030-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
  let n = 0;
  const person = async (label: string, employmentDate = "2040-01-01") => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Hd", lastName: `${label}${tag}`, employmentDate, categoryId: cat.id, bankName: "GTBank", accountNumber: `71${String(Date.now()).slice(-7)}${n}`, accountName: `HD ${label}` } as never);
    await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day(employmentDate), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  const shift = async (employeeId: string, from: string, to: string) => {
    const cin = wat(from);
    const cout = wat(to);
    const en = await db.timeEntry.create({ data: { organizationId: org, employeeId, clientId: client.id, contractId: contract.id, beatId: beat.id, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: (cout.getTime() - cin.getTime()) / 60000 } });
    await db.timeEntrySegment.createMany({ data: payableSegments(cin, cout, [], new Set()).map((s) => ({ organizationId: org, entryId: en.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
  };
  /** Eight-hour shifts Monday to Thursday of the week of 1 January 2046: 4 days worked, 32 h: an average of 8 h a day, usual days Monday to Thursday. */
  const usualWeek = async (employeeId: string) => {
    for (const date of ["2046-01-01", "2046-01-02", "2046-01-03", "2046-01-04"]) await shift(employeeId, `${date}T08:00`, `${date}T16:00`);
  };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  const holidayLines = (recordId: string) => db.hourlyAllowanceLine.findMany({ where: { recordId, kind: "HOLIDAY_NOT_WORKED" }, orderBy: { amount: "asc" } });
  return { payroll, org, person, shift, usualWeek, record, holidayLines, beat };
}

let payrollCtx: Awaited<ReturnType<typeof ctxFor>>;
const periodOf = async (year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: payrollCtx.orgId, year, month } })) ?? createPeriod(payrollCtx, year, month);

// the public holidays used by these tests are made once (the demo company's holiday list is shared)
beforeAll(async () => {
  payrollCtx = await ctxFor("PAYROLL_ADMIN");
  const org = payrollCtx.orgId;
  const make = async (date: string, name: string, states: string[] = []) => {
    const h = await db.publicHoliday.create({ data: { organizationId: org, date: day(date), name, createdBy: "test" } });
    for (const state of states) await db.publicHolidayState.create({ data: { organizationId: org, holidayId: h.id, state, createdBy: "test" } });
  };
  await make("2046-03-07", "Test national holiday (Wednesday)");
  await make("2046-03-09", "Test national holiday (Friday)");
  await make("2046-03-12", "Test Lagos holiday (Monday)", ["Lagos"]);
  await make("2046-03-13", "Test FCT holiday (Tuesday)", ["FCT"]);
}, 120_000);

describe("the pay run pays a public holiday not worked at the average daily hours and the weekday rate", () => {
  it("pays the holidays that apply to the person's state and fall on one of their usual days: the national Wednesday and the Lagos Monday, not the Friday they never work and not the FCT-only Tuesday", async () => {
    const w = await world();
    const e = await w.person("Base");
    await w.usualWeek(e.id);
    const period = await periodOf(2046, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 16_000); // two holidays x 8 h x 1,000
    const lines = await w.holidayLines(rec.id);
    expect(lines.map((l) => l.dates)).toEqual([["2046-03-07"], ["2046-03-12"]]);
    expect(lines.map((l) => [l.minutes, num(l.rate), num(l.amount)])).toEqual([[480, 1000, 8000], [480, 1000, 8000]]);
    expect(lines[0]).toMatchObject({ kind: "HOLIDAY_NOT_WORKED", employeeId: e.id, runId: run.id, organizationId: w.org, beatId: w.beat.id });
    const split = (rec.lines as Array<{ type: string; amount: number }>).filter((l) => l.type === "EARNING").reduce((a, l) => a + l.amount, 0);
    near(split, 16_000); // divided by the site's structure like the hours
    near(num(rec.netPay), num(rec.totalEarnings) - num(rec.totalDeductions));
  });

  it("does not pay a holiday the person worked (it is paid with the hours), and pays the others", async () => {
    const w = await world();
    const e = await w.person("Worked");
    await w.usualWeek(e.id);
    await w.shift(e.id, "2046-03-07T08:00", "2046-03-07T16:00"); // worked the national Wednesday
    const period = await periodOf(2046, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    expect((await w.holidayLines(rec.id)).map((l) => l.dates)).toEqual([["2046-03-12"]]); // only the Lagos Monday
    near(num(rec.earnedGross), 16_000); // 8,000 for the shift worked and 8,000 for the Monday
  });

  it("pays a day of approved sickness as sickness and not also as a holiday (a day is paid once)", async () => {
    const w = await world();
    const e = await w.person("SickDay");
    await w.usualWeek(e.id);
    const doc = await db.employeeDocument.create({ data: { organizationId: w.org, employeeId: e.id, documentType: "MEDICAL_CERTIFICATE", fileReference: `ref-${uid()}`, uploadedBy: "t" } });
    await db.sickSpell.create({ data: { organizationId: w.org, employeeId: e.id, cycleStart: day("2046-01-01"), cycleEnd: day("2046-12-31"), startDate: day("2046-03-07"), endDate: day("2046-03-07"), workingDays: 1, certificateDocumentId: doc.id, status: "APPROVED", recordedBy: "t", recordedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2", decidedAt: new Date() } });
    const period = await periodOf(2046, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    expect((await w.holidayLines(rec.id)).map((l) => l.dates)).toEqual([["2046-03-12"]]);
    expect((await db.hourlyAllowanceLine.findMany({ where: { recordId: rec.id, kind: "SICK_DAY" } })).map((l) => l.dates)).toEqual([["2046-03-07"]]);
    near(num(rec.earnedGross), 16_000); // 8,000 of sick pay and 8,000 of holiday pay: 2 days, each paid once
  });

  it("pays nothing before the service period is complete, and nothing (and no finding) for a person with no hours in the months before", async () => {
    const w = await world();
    const newcomer = await w.person("Newcomer", "2045-09-01"); // 12 months complete on 2046-09-01
    await w.usualWeek(newcomer.id);
    const noHistory = await w.person("NoHistory");
    const period = await periodOf(2046, 3);
    const run = await runPayroll(w.payroll, period.id);
    expect(await db.payrollRecord.count({ where: { runId: run.id, employeeId: newcomer.id, earnedGross: { gt: 0 } } })).toBe(0);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: run.id, employeeId: { in: [newcomer.id, noHistory.id] } } })).toBe(0);
    expect(await db.payrollValidationIssue.count({ where: { runId: run.id, employeeId: noHistory.id, code: { contains: "HOLIDAY" } } })).toBe(0); // no hours to average is not an error for a holiday: they are simply not owed it
  });

  it("calculating again replaces the lines instead of doubling them", async () => {
    const w = await world();
    const e = await w.person("Again");
    await w.usualWeek(e.id);
    const period = await periodOf(2046, 3);
    const run = await runPayroll(w.payroll, period.id);
    const again = await runPayroll(w.payroll, period.id);
    expect(again.id).toBe(run.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: run.id, employeeId: e.id, kind: "HOLIDAY_NOT_WORKED" } })).toBe(2);
    near(num((await w.record(run.id, e.id)).earnedGross), 16_000);
  });
});

describe("what else counts it", () => {
  it("a supplementary payroll never pays a holiday the period's regular payroll already paid", async () => {
    const w = await world();
    const e = await w.person("Supp");
    await w.usualWeek(e.id);
    const period = await periodOf(2046, 3);
    const run = await runPayroll(w.payroll, period.id);
    near(num((await w.record(run.id, e.id)).earnedGross), 16_000);
    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
    await w.shift(e.id, "2046-03-14T08:00", "2046-03-14T12:00"); // 4 h approved after the lock: 4,000
    const supp = await createSupplementaryRun(w.payroll, period.id, "Late hours");
    const rec = await w.record(supp.id, e.id);
    near(num(rec.earnedGross), 4_000); // the late hours only: the holidays are not paid again
    expect(await db.hourlyAllowanceLine.count({ where: { recordId: rec.id, kind: "HOLIDAY_NOT_WORKED" } })).toBe(0);
    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "OPEN" } });
  });

  it("the payslip names the holiday, with the hours and the rate, and counts it in the total", async () => {
    const w = await world();
    const e = await w.person("Slip");
    await w.usualWeek(e.id);
    const period = await periodOf(2046, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    const slip = (await getPayslip(w.payroll, rec.id))!;
    const m = payslipModel({
      orgName: "Demo", employeeNumber: slip.employeeNumber, employeeName: slip.employeeName, departmentName: null, categoryName: slip.categoryName, bankName: null, accountNumber: null, pensionPin: null, pfa: null, taxId: null,
      daysWorked: num(slip.daysWorked), basisDays: slip.basisDays, daysAbsent: slip.daysAbsent, overtimeHours: 0, monthlyGross: num(slip.monthlyGross), totalEarnings: num(slip.totalEarnings), totalDeductions: num(slip.totalDeductions), netPay: num(slip.netPay),
      taxRuleVersion: slip.taxRuleVersion, hasOverride: false, lines: slip.lines as never, locations: [], hourly: slip.hourly, allowances: slip.hourlyAllowances, periodName: "March 2046", periodStart: "2046-03-01", periodEnd: "2046-03-31", runType: "REGULAR", runNumber: 1, generatedOn: "2046-03-31",
    });
    const place = `${(await db.client.findUniqueOrThrow({ where: { id: w.beat.clientId } })).name} - ${w.beat.name}`; // the Site column names the client (the founder's decision)
    expect(m.hourly?.rows).toEqual([
      [place, "Holiday pay (2046-03-07)", "8 h", "1,000.00", "8,000.00"],
      [place, "Holiday pay (2046-03-12)", "8 h", "1,000.00", "8,000.00"],
    ]);
    expect(m.hourly?.total).toEqual(["Total", "", "16 h", "", "16,000.00"]);
  });

  it("warns, once for the payroll, when the year's public holidays have not been confirmed (so holiday pay may be missing), and not once they are", async () => {
    const w = await world();
    const e = await w.person("Confirm");
    await w.usualWeek(e.id);
    const period = await periodOf(2046, 3);
    await db.holidayCalendarYear.deleteMany({ where: { organizationId: w.org, year: 2046 } });
    const run = await runPayroll(w.payroll, period.id);
    expect(await db.payrollValidationIssue.count({ where: { runId: run.id, code: "HOURLY_HOLIDAY_PAY_UNCONFIRMED", severity: "WARNING" } })).toBe(1);
    await db.holidayCalendarYear.create({ data: { organizationId: w.org, year: 2046, confirmedBy: "t", confirmedByUserId: "t" } });
    const run2 = await runPayroll(w.payroll, period.id);
    expect(await db.payrollValidationIssue.count({ where: { runId: run2.id, code: "HOURLY_HOLIDAY_PAY_UNCONFIRMED" } })).toBe(0);
  });
});
