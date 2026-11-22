import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee } from "@/server/services/employees";
import { createPeriod, createSupplementaryRun, runPayroll } from "@/server/services/payroll";
import { createStructure } from "@/server/services/structures";
import { ctxFor, uid } from "../helpers";

/**
 * Hourly pay, H14: a shift on a public holiday that is APPROVED AFTER the month was locked, when the holiday was already paid as NOT worked (the person had no shift that day when the payroll was calculated). The late shift is
 * paid by a supplementary payroll at the rates of the day (a worked holiday), so the person would be paid twice for the day. NO NEGATIVE PAY is ever made (the rule the hourly pay already follows for corrections after payment): the
 * supplementary payroll raises ONE critical finding naming the person, the holiday and the amount paid as not worked, for Payroll to enter a deduction if it is to be recovered. A late shift on any other day raises nothing. Real
 * payrolls in the demo company for March 2054 (no other test uses 2054); the Lagos holiday Monday 2 March 2054 is made for this file. Rates are INVENTED: role weekday 1,000 an hour. Calendar: 2054-01-05 and 2054-03-02 are Mondays.
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
    for (const date of ["2054-01-05", "2054-01-06", "2054-01-07", "2054-01-08"]) await shift(employeeId, `${date}T08:00`, `${date}T16:00`);
  };
  const record = (runId: string, employeeId: string) => db.payrollRecord.findFirstOrThrow({ where: { runId, employeeId } });
  const holidayLines = (recordId: string) => db.hourlyAllowanceLine.findMany({ where: { recordId, kind: "HOLIDAY_NOT_WORKED" }, orderBy: { amount: "asc" } });
  return { payroll, org, person, shift, usualWeek, record, holidayLines, beat };
}


let payrollCtx: Awaited<ReturnType<typeof ctxFor>>;
const periodOf = async (year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: payrollCtx.orgId, year, month } })) ?? createPeriod(payrollCtx, year, month);

// the Lagos holidays used by these tests are made once (the demo company's holiday list is shared): Monday 2 March 2054 and Monday 1 March 2055
beforeAll(async () => {
  payrollCtx = await ctxFor("PAYROLL_ADMIN");
  for (const date of ["2054-03-02", "2055-03-01"]) {
    const h = await db.publicHoliday.create({ data: { organizationId: payrollCtx.orgId, date: day(date), name: `Test Lagos holiday ${date}`, createdBy: "test" } });
    await db.publicHolidayState.create({ data: { organizationId: payrollCtx.orgId, holidayId: h.id, state: "Lagos", createdBy: "test" } });
  }
}, 120_000);

const finding = (runId: string, employeeId: string, code: string) => db.payrollValidationIssue.findMany({ where: { runId, employeeId, code } });
/** Monday to Thursday of the week of the given Monday, 8 hours a day: the person's usual days, an average of 8 hours. */
const week = async (w: Awaited<ReturnType<typeof world>>, employeeId: string, monday: string) => {
  for (let i = 0; i < 4; i++) {
    const date = new Date(day(monday).getTime() + i * 86_400_000).toISOString().slice(0, 10);
    await w.shift(employeeId, `${date}T08:00`, `${date}T16:00`);
  }
};

describe("a shift approved after the lock on a holiday that was paid as not worked", () => {
  it("is paid by the supplementary payroll, with ONE critical finding that names the holiday and the amount paid as not worked, and no negative pay", async () => {
    const w = await world();
    const e = await w.person("Late");
    await week(w, e.id, "2054-01-05");
    const march = await periodOf(2054, 3);
    const run = await runPayroll(w.payroll, march.id);
    const rec = await w.record(run.id, e.id);
    near(num(rec.earnedGross), 8_000); // the holiday on Monday 2 March, not worked: 8 h x 1,000
    expect(await w.holidayLines(rec.id)).toHaveLength(1);
    await db.payrollPeriod.update({ where: { id: march.id }, data: { status: "LOCKED" } });
    await w.shift(e.id, "2054-03-02T08:00", "2054-03-02T16:00"); // approved after the lock: they did work the holiday
    const supp = await createSupplementaryRun(w.payroll, march.id, "Late shift");
    const srec = await w.record(supp.id, e.id);
    expect(num(srec.earnedGross)).toBeGreaterThan(0); // the worked shift is paid; nothing is taken back
    const found = await finding(supp.id, e.id, "HOLIDAY_PAID_AND_WORKED");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect(found[0].message).toContain("2054-03-02");
    expect(found[0].message).toContain("8,000.00");
    expect(found[0].message).toMatch(/deduction/i);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: supp.id, employeeId: e.id, kind: "HOLIDAY_NOT_WORKED" } })).toBe(0); // not paid a second time as not worked
  });

  it("a late shift on another day raises nothing about the holiday", async () => {
    const w = await world();
    const e = await w.person("Other");
    await week(w, e.id, "2055-01-04");
    const march = await periodOf(2055, 3);
    const run = await runPayroll(w.payroll, march.id);
    expect(await w.holidayLines((await w.record(run.id, e.id)).id)).toHaveLength(1); // the holiday on Monday 1 March was paid as not worked
    await db.payrollPeriod.update({ where: { id: march.id }, data: { status: "LOCKED" } });
    await w.shift(e.id, "2055-03-02T08:00", "2055-03-02T16:00"); // a Tuesday, not the holiday
    const supp = await createSupplementaryRun(w.payroll, march.id, "Late shift");
    expect(await finding(supp.id, e.id, "HOLIDAY_PAID_AND_WORKED")).toHaveLength(0);
  });
});
