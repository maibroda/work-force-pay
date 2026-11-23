import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payslipModel } from "@/lib/payslip-pdf";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee } from "@/server/services/employees";
import { listHolidayAdjustments, reviewHolidayAdjustment } from "@/server/services/holiday-adjustments";
import { createPeriod, createSupplementaryRun, getPayslip, runPayroll } from "@/server/services/payroll";
import { createStructure } from "@/server/services/structures";
import { approveTimeEntry, captureTimeEntry, submitTimeEntry } from "@/server/services/time-entries";
import { ctxFor, uid } from "../helpers";

/**
 * Hourly pay, the late-approved holiday adjustment, PIECES B AND D (docs/plans/hourly-holiday-adjustment-plan.md): D a supplementary payroll HOLDS BACK a late shift on a holiday already paid as not worked while an adjustment settles it
 * (waiting for review, approved or applied), and pays it as before once the adjustment is rejected; B an approved adjustment's net difference is paid ONCE by the earliest open period after the original, as an extra pay line at the shift's site.
 * An overpayment is not recovered (a finding only), and an approved adjustment with no open period is escalated.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const wat = (s: string) => new Date(`${s}:00+01:00`);

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

const YEARS = [2068, 2069, 2070, 2071, 2072, 2073, 2074]; // one year for each test, because a locked payroll month stays locked
/** The first Monday of a month, and a day some days later (as ISO dates). */
const firstMonday = (year: number, month: number) => {
  const first = new Date(Date.UTC(year, month - 1, 1));
  first.setUTCDate(1 + ((8 - first.getUTCDay()) % 7));
  return first.toISOString().slice(0, 10);
};
const plus = (isoDate: string, n: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The Lagos holiday of a test year: the second Monday of March. */
const holidayOf = (year: number) => plus(firstMonday(year, 3), 7);

let payrollCtx: Awaited<ReturnType<typeof ctxFor>>;
let hourlyBefore: { enabled: boolean } | null = null;

// the demo company has hourly pay switched off (time entries need it on): switched on for this file, put back after; and the Lagos holidays used here are made once
beforeAll(async () => {
  payrollCtx = await ctxFor("PAYROLL_ADMIN");
  const org = payrollCtx.orgId;
  hourlyBefore = await db.hourlyPaySetting.findUnique({ where: { organizationId: org }, select: { enabled: true } });
  await db.hourlyPaySetting.upsert({ where: { organizationId: org }, update: { enabled: true }, create: { organizationId: org, enabled: true, changedBy: "test", changedByUserId: "test" } });
  for (const year of YEARS) {
    const h = await db.publicHoliday.create({ data: { organizationId: org, date: day(holidayOf(year)), name: `Test Lagos holiday ${year}`, createdBy: "test" } });
    await db.publicHolidayState.create({ data: { organizationId: org, holidayId: h.id, state: "Lagos", createdBy: "test" } });
  }
}, 120_000);
afterAll(async () => {
  const org = (await ctxFor("PAYROLL_ADMIN")).orgId;
  if (hourlyBefore) await db.hourlyPaySetting.update({ where: { organizationId: org }, data: { enabled: hourlyBefore.enabled } });
  else await db.hourlyPaySetting.deleteMany({ where: { organizationId: org } });
});

const periodOf = async (year: number, month: number) => (await db.payrollPeriod.findFirst({ where: { organizationId: payrollCtx.orgId, year, month } })) ?? createPeriod(payrollCtx, year, month);
/** A person whose usual days are Monday to Thursday (8 h), with the Monday holiday of the year paid as not worked by a March payroll that is then locked: 8,000 paid. */
async function paidAsNotWorked(label: string, year: number) {
  const w = await world();
  const e = await w.person(label);
  for (let i = 0; i < 4; i++) {
    const date = plus(firstMonday(year, 1), i);
    await w.shift(e.id, `${date}T08:00`, `${date}T16:00`);
  }
  const sup = await ctxFor("SUPERVISOR");
  await db.beat.update({ where: { id: w.beat.id }, data: { supervisorId: sup.userId } });
  const march = await periodOf(year, 3);
  const run = await runPayroll(w.payroll, march.id);
  const rec = await w.record(run.id, e.id);
  const line = (await w.holidayLines(rec.id))[0];
  expect(num(line.amount)).toBe(8_000);
  await db.payrollPeriod.update({ where: { id: march.id }, data: { status: "LOCKED" } });
  return { w, e, run, rec, line, sup, holiday: holidayOf(year) };
}
/** A shift captured by operations, submitted and approved by `approver` (never the person who captured it). */
async function lateShift(w: Awaited<ReturnType<typeof world>>, employeeId: string, from: string, to: string, approver: Awaited<ReturnType<typeof ctxFor>>) {
  const ops = await ctxFor("OPERATIONS");
  const entry = await captureTimeEntry(ops, { employeeId, beatId: w.beat.id, clockIn: from, clockOut: to });
  await submitTimeEntry(ops, entry.id);
  return approveTimeEntry(approver, entry.id, { breaks: "" });
}

const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

const periodIn = async (year: number, month: number) => periodOf(year, month);
const audit = (orgId: string, action: string, entityId: string) => db.auditLog.count({ where: { organizationId: orgId, action, entityId } });
/** A late shift on the holiday, approved by the supervisor; the adjustment is proposed. */
async function adjusted(label: string, year: number, to = "16:00") {
  const base = await paidAsNotWorked(label, year);
  await lateShift(base.w, base.e.id, `${base.holiday}T08:00`, `${base.holiday}T${to}`, base.sup);
  const adj = await db.holidayAdjustment.findFirstOrThrow({ where: { organizationId: base.w.org, employeeId: base.e.id } });
  return { ...base, adj };
}
const approve = (id: string) => reviewHolidayAdjustment(payrollCtx, id, "APPROVED");
/** Another guard whose late shift is on the Tuesday after the holiday: it makes the supplementary payroll of the month worth running. */
async function tuesdayShift(w: Awaited<ReturnType<typeof world>>, holiday: string, sup: Awaited<ReturnType<typeof ctxFor>>) {
  const other = await w.person("Tuesday");
  await lateShift(w, other.id, `${plus(holiday, 1)}T08:00`, `${plus(holiday, 1)}T16:00`, sup);
  return other;
}
const finding = (runId: string, employeeId: string, code: string) => db.payrollValidationIssue.findMany({ where: { runId, employeeId, code } });

describe("piece D: the supplementary payroll holds back a late shift whose holiday adjustment is waiting, and pays it as before once the adjustment is rejected", () => {
  it("while the adjustment waits for review the shift is NOT paid by the supplementary payroll, a warning says it is held, and another guard's late shift is paid as before", async () => {
    const { w, e, sup, holiday } = await adjusted("Held", YEARS[0]);
    const other = await tuesdayShift(w, holiday, sup);
    const march = await periodIn(YEARS[0], 3);
    const supp = await createSupplementaryRun(w.payroll, march.id, "Late shifts");
    expect(await db.payrollRecord.count({ where: { runId: supp.id, employeeId: e.id } })).toBe(0);
    expect(await db.hourlyPayLine.count({ where: { runId: supp.id, employeeId: e.id } })).toBe(0);
    const held = await finding(supp.id, e.id, "HOLIDAY_ADJUSTMENT_HELD");
    expect(held).toHaveLength(1);
    expect(held[0].severity).toBe("WARNING");
    expect(held[0].message).toContain(holiday);
    expect(num((await w.record(supp.id, other.id)).earnedGross)).toBeGreaterThan(0); // the other late shift is paid as before
  });

  it("once the adjustment is REJECTED the shift is paid by the next supplementary payroll in full, at the holiday rate, and the earlier alert (paid twice) is raised", async () => {
    const { w, e, adj, sup, holiday } = await adjusted("Rejected", YEARS[1]);
    await reviewHolidayAdjustment(payrollCtx, adj.id, "REJECTED", "The adjustment is not wanted: pay the shift as it is");
    await tuesdayShift(w, holiday, sup);
    const supp = await createSupplementaryRun(w.payroll, (await periodIn(YEARS[1], 3)).id, "Late shifts");
    near(num((await w.record(supp.id, e.id)).earnedGross), 16_000); // 8 h at the holiday rate of 2,000
    expect(await finding(supp.id, e.id, "HOLIDAY_PAID_AND_WORKED")).toHaveLength(1);
    expect(await finding(supp.id, e.id, "HOLIDAY_ADJUSTMENT_HELD")).toHaveLength(0);
  });
});

describe("piece B: an approved adjustment is paid as its net difference in the next open payroll, once", () => {
  it("is applied by the regular payroll of the next open period: an earning line of 8,000.00 (16,000.00 owed less 8,000.00 paid) at the shift's site, the adjustment becomes APPLIED and linked to that run, audited; calculating again changes nothing; the closed March payroll is untouched; the shift is never also paid by a supplementary payroll", async () => {
    const { w, e, run, rec, adj, sup, holiday } = await adjusted("Apply", YEARS[2]);
    await approve(adj.id);
    const apr = await periodIn(YEARS[2], 4);
    const aprRun = await runPayroll(w.payroll, apr.id);
    const aprRec = await w.record(aprRun.id, e.id);
    near(num(aprRec.earnedGross), 8_000);
    const lines = await db.hourlyAllowanceLine.findMany({ where: { recordId: aprRec.id, kind: "HOLIDAY_ADJUSTMENT" } });
    expect(lines).toHaveLength(1);
    expect([num(lines[0].amount), lines[0].minutes, lines[0].dates, lines[0].beatId]).toEqual([8_000, 480, [holiday], w.beat.id]);
    const done = await db.holidayAdjustment.findUniqueOrThrow({ where: { id: adj.id } });
    expect([done.status, done.appliedRunId]).toEqual(["APPLIED", aprRun.id]);
    expect(await audit(w.org, "HOLIDAY_ADJUSTMENT_APPLIED", adj.id)).toBe(1);
    // calculated again: the same single line, applied once
    const again = await runPayroll(w.payroll, apr.id);
    expect(again.id).toBe(aprRun.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: aprRun.id, employeeId: e.id, kind: "HOLIDAY_ADJUSTMENT" } })).toBe(1);
    near(num((await w.record(aprRun.id, e.id)).earnedGross), 8_000);
    expect(await audit(w.org, "HOLIDAY_ADJUSTMENT_APPLIED", adj.id)).toBe(1);
    // the closed payroll is exactly as it was, and no supplementary payroll pays the shift again
    expect(num((await w.record(run.id, e.id)).earnedGross)).toBe(num(rec.earnedGross));
    await tuesdayShift(w, holiday, sup);
    const supp = await createSupplementaryRun(w.payroll, (await periodIn(YEARS[2], 3)).id, "Late shifts");
    expect(await db.payrollRecord.count({ where: { runId: supp.id, employeeId: e.id } })).toBe(0);
    // the payslip names it
    const slip = (await getPayslip(w.payroll, (await w.record(aprRun.id, e.id)).id))!; // the recalculation made new records: read the current one
    expect(slip.hourlyAllowances.map((a) => a.kind)).toContain("HOLIDAY_ADJUSTMENT");
    const m = payslipModel({
      orgName: "Demo", employeeNumber: slip.employeeNumber, employeeName: slip.employeeName, departmentName: null, categoryName: slip.categoryName, bankName: null, accountNumber: null, pensionPin: null, pfa: null, taxId: null,
      daysWorked: num(slip.daysWorked), basisDays: slip.basisDays, daysAbsent: slip.daysAbsent, overtimeHours: 0, monthlyGross: num(slip.monthlyGross), totalEarnings: num(slip.totalEarnings), totalDeductions: num(slip.totalDeductions), netPay: num(slip.netPay),
      taxRuleVersion: slip.taxRuleVersion, hasOverride: false, lines: slip.lines as never, locations: [], hourly: slip.hourly, allowances: slip.hourlyAllowances, periodName: "April", periodStart: "2070-04-01", periodEnd: "2070-04-30", runType: "REGULAR", runNumber: 1, generatedOn: "2070-04-30",
    });
    expect(m.hourly?.rows.some((r) => r[1] === `Holiday adjustment (${holiday})` && r[4] === "8,000.00")).toBe(true);
  });

  it("only the EARLIEST open period applies it: with April and May both open, May's payroll leaves it alone and April's applies it", async () => {
    const { w, e, adj } = await adjusted("Timing", YEARS[3]);
    await approve(adj.id);
    const apr = await periodIn(YEARS[3], 4);
    const may = await periodIn(YEARS[3], 5);
    const mayRun = await runPayroll(w.payroll, may.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: mayRun.id, employeeId: e.id, kind: "HOLIDAY_ADJUSTMENT" } })).toBe(0);
    expect((await db.holidayAdjustment.findUniqueOrThrow({ where: { id: adj.id } })).status).toBe("APPROVED");
    const aprRun = await runPayroll(w.payroll, apr.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: aprRun.id, employeeId: e.id, kind: "HOLIDAY_ADJUSTMENT" } })).toBe(1);
    const mayAgain = await runPayroll(w.payroll, may.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: mayAgain.id, employeeId: e.id, kind: "HOLIDAY_ADJUSTMENT" } })).toBe(0); // never twice
  });

  it("an adjustment still waiting for review is not applied, and the list says which payroll would take it", async () => {
    const { w, e, adj } = await adjusted("Unreviewed", YEARS[4]);
    const apr = await periodIn(YEARS[4], 4);
    const aprRun = await runPayroll(w.payroll, apr.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: aprRun.id, employeeId: e.id, kind: "HOLIDAY_ADJUSTMENT" } })).toBe(0);
    expect((await db.holidayAdjustment.findUniqueOrThrow({ where: { id: adj.id } })).status).toBe("PROPOSED");
    await approve(adj.id);
    const listed = (await listHolidayAdjustments(payrollCtx, { status: "APPROVED" })).find((a) => a.id === adj.id);
    expect(listed?.nextOpenPeriod?.name).toMatch(/April/);
  });

  it("an overpayment (the shift is worth LESS than was paid) is not recovered by this piece: it stays approved, nothing is applied or taken, and a critical finding says recovery is not available yet", async () => {
    const { w, e, adj } = await adjusted("Short", YEARS[5], "10:00"); // 2 h at 2,000 = 4,000 owed, 8,000 paid: net -4,000
    const approved = await approve(adj.id);
    expect(num(approved.netDifference)).toBe(-4_000);
    const apr = await periodIn(YEARS[5], 4);
    const aprRun = await runPayroll(w.payroll, apr.id);
    expect(await db.hourlyAllowanceLine.count({ where: { runId: aprRun.id, employeeId: e.id, kind: "HOLIDAY_ADJUSTMENT" } })).toBe(0);
    expect((await db.holidayAdjustment.findUniqueOrThrow({ where: { id: adj.id } })).status).toBe("APPROVED");
    const found = await finding(aprRun.id, e.id, "HOLIDAY_ADJUSTMENT_RECOVERY_PENDING");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
  });

  it("with NO open payroll after the original period it is escalated: the list shows no next payroll, a supplementary payroll raises a critical finding, and nothing in the closed payroll changes", async () => {
    const { w, e, adj, sup, holiday } = await adjusted("Escalate", YEARS[6]);
    await approve(adj.id);
    const listed = (await listHolidayAdjustments(payrollCtx, { status: "APPROVED" })).find((a) => a.id === adj.id);
    expect(listed?.nextOpenPeriod).toBeNull();
    await tuesdayShift(w, holiday, sup);
    const supp = await createSupplementaryRun(w.payroll, (await periodIn(YEARS[6], 3)).id, "Late shifts");
    const found = await finding(supp.id, e.id, "HOLIDAY_ADJUSTMENT_ESCALATED");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("CRITICAL");
    expect((await db.holidayAdjustment.findUniqueOrThrow({ where: { id: adj.id } })).status).toBe("APPROVED");
  });
});
