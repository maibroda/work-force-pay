import { describe, expect, it } from "vitest";
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
 * Hourly pay, H14 piece 2, step 2b (docs/plans/hourly-payroll-h14-build-plan.md): the PAY for approved sick days of a person paid by the hour. The founder's answers of 2026-11-20 and 2026-11-21: paid at the person's
 * AVERAGE DAILY HOURS times their WEEKDAY RATE; the average is the approved hours of the 3 months before the spell divided by the days worked; only a USUAL day (a day of the week they worked in that period) is paid; only
 * the first 5 days of the leave year, in date order; no hours to average means nothing is paid and a finding says so; hours waiting for approval are the same: a spell waiting for approval is not paid and says so.
 * Real payrolls in the demo company for March and April 2045 (no other test uses them); the hours and the approved spells are put in directly. Rates are INVENTED: role weekday 1,000, weekend 1,500 an hour.
 * Calendar: 2045-01-02, 2045-03-06 and 2045-04-03 are Mondays.
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
    code: `SP-${tag}`, name: `Sick pay ${tag}`, effectiveFrom: "2040-01-01", activate: true,
    components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
  });
  const client = await db.client.create({ data: { organizationId: org, code: `SQ${tag}`, name: `Sick Client ${tag}` } });
  const contract = await db.contract.create({ data: { organizationId: org, clientId: client.id, contractNumber: `SQK${tag}`, name: `Sick guarding ${tag}`, startDate: day("2040-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: org, clientId: client.id, contractId: contract.id, code: `SQB${tag}`, name: `Sick site ${tag}`, state: "Lagos" } });
  await db.contractRate.create({ data: { organizationId: org, contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: "200000", effectiveFrom: day("2040-01-01") } });
  if (!(await db.hourlyRate.findFirst({ where: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, status: "APPROVED", effectiveTo: null } })))
    await db.hourlyRate.create({ data: { organizationId: org, scope: "CATEGORY", categoryId: cat.id, weekdayRate: "1000", weekendRate: "1500", holidayRate: "2000", effectiveFrom: day("2030-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t2", decidedByUserId: "t2" } });
  let n = 0;
  const person = async (label: string, employmentDate = "2040-01-01") => {
    n += 1;
    const e = await createEmployee(hr, { firstName: "Sp", lastName: `${label}${tag}`, employmentDate, categoryId: cat.id, bankName: "GTBank", accountNumber: `72${String(Date.now()).slice(-7)}${n}`, accountName: `SP ${label}` } as never);
    await db.employeeCompensationType.create({ data: { organizationId: org, employeeId: e.id, type: "HOURLY", effectiveFrom: day(employmentDate), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  const shift = async (employeeId: string, from: string, to: string) => {
    const cin = wat(from);
    const cout = wat(to);
    const en = await db.timeEntry.create({ data: { organizationId: org, employeeId, clientId: client.id, contractId: contract.id, beatId: beat.id, clockIn: cin, clockOut: cout, status: "APPROVED", capturedBy: "cap", capturedByUserId: "cap-user", decidedBy: "dec", decidedByUserId: "dec-user", decidedAt: new Date(), placeState: "Lagos", calendarConfirmed: true, payableMinutes: (cout.getTime() - cin.getTime()) / 60000 } });
    await db.timeEntrySegment.createMany({ data: payableSegments(cin, cout, [], new Set()).map((s) => ({ organizationId: org, entryId: en.id, date: day(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
  };
  /** Eight-hour shifts, Monday to Thursday of the week of the given Monday: the person's usual days, 32 h over 4 days worked. */
  const usualWeek = async (employeeId: string, monday: string) => {
    for (let i = 0; i < 4; i++) {
      const date = new Date(day(monday).getTime() + i * 86_400_000).toISOString().slice(0, 10);
      await shift(employeeId, `${date}T08:00`, `${date}T16:00`);
    }
  };
  /** An approved (or other) spell of sickness put in directly, with a certificate document, charged to the leave year that holds its first day (every test person has been in service since 2040). */
  const spell = async (employeeId: string, from: string, to: string, workingDays: number, status: "APPROVED" | "PENDING" = "APPROVED") => {
    const doc = await db.employeeDocument.create({ data: { organizationId: org, employeeId, documentType: "MEDICAL_CERTIFICATE", fileReference: `ref-${uid()}`, uploadedBy: "t" } });
    const year = Number(from.slice(0, 4));
    return db.sickSpell.create({ data: { organizationId: org, employeeId, cycleStart: day(`${year}-01-01`), cycleEnd: day(`${year}-12-31`), startDate: day(from), endDate: day(to), workingDays, certificateDocumentId: doc.id, status, recordedBy: "t", recordedByUserId: "t", ...(status === "APPROVED" ? { decidedBy: "t2", decidedByUserId: "t2", decidedAt: new Date() } : {}) } });
  };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  const sick = (recordId: string) => db.hourlyAllowanceLine.findMany({ where: { recordId, kind: "SICK_DAY" } });
  const finding = (runId: string, employeeId: string, code: string) => db.payrollValidationIssue.findMany({ where: { runId, employeeId, code } });
  return { payroll, org, person, shift, usualWeek, spell, record, sick, finding, beat };
}

const periodOf = async (orgId: string, ctx: Awaited<ReturnType<typeof ctxFor>>, year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: orgId, year, month } })) ?? createPeriod(ctx, year, month);

describe("the pay run pays approved sick days at the average daily hours times the weekday rate", () => {
  it("pays a person with no hours in the month: 2 sick days at their average 8 hours and the weekday rate of 1,000, stored with the days, split by the site's structure like hourly pay", async () => {
    const w = await world();
    const e = await w.person("Sick");
    await w.usualWeek(e.id, "2045-01-02"); // 4 days worked, 32 h: an average of 8 h a day, usual days Monday to Thursday
    await w.spell(e.id, "2045-03-06", "2045-03-07", 2); // Monday and Tuesday
    const period = await periodOf(w.org, w.payroll, 2045, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 16_000); // 2 days x 8 h x 1,000
    const lines = await w.sick(rec.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "SICK_DAY", employeeId: e.id, runId: run.id, organizationId: w.org, beatId: w.beat.id, minutes: 960, dates: ["2045-03-06", "2045-03-07"] });
    expect([num(lines[0].rate), num(lines[0].amount)]).toEqual([1000, 16_000]);
    const split = (rec.lines as Array<{ type: string; amount: number }>).filter((l) => l.type === "EARNING").reduce((a, l) => a + l.amount, 0);
    near(split, 16_000); // divided by the site's structure, like the hours
    near(num(rec.netPay), num(rec.totalEarnings) - num(rec.totalDeductions));
  });

  it("is added to the hours of a person who also worked in the month, and a recalculation replaces it instead of doubling it", async () => {
    const w = await world();
    const e = await w.person("Both");
    await w.usualWeek(e.id, "2045-01-02");
    await w.shift(e.id, "2045-03-08T08:00", "2045-03-08T16:00"); // a Wednesday worked: 8,000
    await w.spell(e.id, "2045-03-06", "2045-03-07", 2);
    const period = await periodOf(w.org, w.payroll, 2045, 3);
    const run = await runPayroll(w.payroll, period.id);
    near(num((await w.record(run.id, e.id)).earnedGross), 24_000); // 8,000 of hours and 16,000 of sick pay
    const again = await runPayroll(w.payroll, period.id);
    expect(again.id).toBe(run.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: run.id, employeeId: e.id, kind: "SICK_DAY" } })).toBe(1);
    near(num((await w.record(run.id, e.id)).earnedGross), 24_000);
  });

  it("pays only the days that are one of the person's usual days: a Friday they never work in the period is not paid", async () => {
    const w = await world();
    const e = await w.person("Usual");
    await w.usualWeek(e.id, "2045-01-02"); // Monday to Thursday only
    await w.spell(e.id, "2045-03-13", "2045-03-17", 5); // Monday to Friday
    const period = await periodOf(w.org, w.payroll, 2045, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 32_000); // Monday to Thursday: 4 days
    expect((await w.sick(rec.id))[0].dates).toEqual(["2045-03-13", "2045-03-14", "2045-03-15", "2045-03-16"]);
  });

  it("pays only the first 5 days of the leave year, in date order, and a warning names the days beyond", async () => {
    const w = await world();
    const e = await w.person("Beyond");
    await w.usualWeek(e.id, "2045-01-02");
    await w.spell(e.id, "2045-02-06", "2045-02-08", 3); // 3 days earlier in the leave year (paid by the February payroll)
    await w.spell(e.id, "2045-03-06", "2045-03-08", 3); // 3 more: only 2 are within the 5
    const period = await periodOf(w.org, w.payroll, 2045, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 16_000); // Monday 6 and Tuesday 7 March; Wednesday 8 March is beyond the entitlement
    expect((await w.sick(rec.id))[0].dates).toEqual(["2045-03-06", "2045-03-07"]);
    const warn = await w.finding(run.id, e.id, "SICK_BEYOND_ENTITLEMENT");
    expect(warn).toHaveLength(1);
    expect(warn[0].severity).toBe("WARNING");
    expect(warn[0].message).toContain("2045-03-08");
  });
});

describe("what cannot be paid is not paid, and a finding says why", () => {
  it("no approved hours in the months before the spell: nothing to average, nothing is paid, and a blocking finding says so", async () => {
    const w = await world();
    const e = await w.person("NoHistory");
    await w.spell(e.id, "2045-03-06", "2045-03-07", 2);
    const period = await periodOf(w.org, w.payroll, 2045, 3);
    const run = await runPayroll(w.payroll, period.id);
    const found = await w.finding(run.id, e.id, "SICK_NO_AVERAGE");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect(await db.hourlyAllowanceLine.count({ where: { runId: run.id, employeeId: e.id } })).toBe(0);
    expect(await db.payrollRecord.count({ where: { runId: run.id, employeeId: e.id } })).toBe(0);
  });

  it("a spell still waiting for approval is not paid, and a blocking finding says so", async () => {
    const w = await world();
    const e = await w.person("Waiting");
    await w.usualWeek(e.id, "2045-01-02");
    await w.spell(e.id, "2045-03-13", "2045-03-14", 2, "PENDING");
    const period = await periodOf(w.org, w.payroll, 2045, 3);
    const run = await runPayroll(w.payroll, period.id);
    const found = await w.finding(run.id, e.id, "SICK_NOT_APPROVED");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect(await db.hourlyAllowanceLine.count({ where: { runId: run.id, employeeId: e.id } })).toBe(0);
  });
});

describe("late sick days (a supplementary payroll) and the payslip", () => {
  it("a spell approved after the payroll was locked is paid by a supplementary payroll, once, and the days the regular payroll paid are not paid again", async () => {
    const w = await world();
    const e = await w.person("Late");
    await w.usualWeek(e.id, "2045-03-06"); // the history for April: Monday to Thursday in March
    await w.spell(e.id, "2045-04-03", "2045-04-04", 2); // approved before the regular payroll: paid by it
    const period = await periodOf(w.org, w.payroll, 2045, 4);
    const run = await runPayroll(w.payroll, period.id);
    near(num((await w.record(run.id, e.id)).earnedGross), 16_000);
    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
    await w.spell(e.id, "2045-04-10", "2045-04-11", 2); // approved after the lock
    const supp = await createSupplementaryRun(w.payroll, period.id, "Late sick pay");
    const rec = await w.record(supp.id, e.id);
    near(num(rec.earnedGross), 16_000); // the two late days only
    expect((await w.sick(rec.id))[0].dates).toEqual(["2045-04-10", "2045-04-11"]);
    await expect(createSupplementaryRun(w.payroll, period.id, "Again")).rejects.toThrow(/no approved, unprocessed/i);
  });

  it("the payslip shows the sick pay with the days, the hours and the rate, and counts it in the total", async () => {
    const w = await world();
    const e = await w.person("Slip");
    await w.usualWeek(e.id, "2045-01-02");
    await w.spell(e.id, "2045-03-06", "2045-03-07", 2);
    const period = await periodOf(w.org, w.payroll, 2045, 3);
    const run = await runPayroll(w.payroll, period.id);
    const rec = await w.record(run.id, e.id);
    const slip = (await getPayslip(w.payroll, rec.id))!;
    expect(slip.hourlyAllowances).toHaveLength(1);
    const m = payslipModel({
      orgName: "Demo", employeeNumber: slip.employeeNumber, employeeName: slip.employeeName, departmentName: null, categoryName: slip.categoryName, bankName: null, accountNumber: null, pensionPin: null, pfa: null, taxId: null,
      daysWorked: num(slip.daysWorked), basisDays: slip.basisDays, daysAbsent: slip.daysAbsent, overtimeHours: 0, monthlyGross: num(slip.monthlyGross), totalEarnings: num(slip.totalEarnings), totalDeductions: num(slip.totalDeductions), netPay: num(slip.netPay),
      taxRuleVersion: slip.taxRuleVersion, hasOverride: false, lines: slip.lines as never, locations: [], hourly: slip.hourly, allowances: slip.hourlyAllowances, periodName: "March 2045", periodStart: "2045-03-01", periodEnd: "2045-03-31", runType: "REGULAR", runNumber: 1, generatedOn: "2045-03-31",
    });
    expect(m.hourly?.rows).toEqual([[w.beat.name, "Sick pay (2 days)", "16 h", "1,000.00", "16,000.00"]]);
    expect(m.hourly?.total).toEqual(["Total", "", "16 h", "", "16,000.00"]);
  });
});
