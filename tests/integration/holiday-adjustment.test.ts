import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { payableSegments } from "@/lib/payroll/time-entry";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee } from "@/server/services/employees";
import { listHolidayAdjustments, reviewHolidayAdjustment } from "@/server/services/holiday-adjustments";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import { createStructure } from "@/server/services/structures";
import { approveTimeEntry, captureTimeEntry, submitTimeEntry } from "@/server/services/time-entries";
import { ctxFor, isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, the late-approved public-holiday adjustment, PIECE A (docs/plans/hourly-holiday-adjustment-plan.md; the founder's confirmed decision of 2026-11-21): when a shift is approved on a public holiday that a payroll already paid as NOT
 * WORKED, a holiday adjustment is proposed automatically (one per person and holiday, never twice): linked to the shift, who approved it and when, the original payroll run and stored line, with what was paid, the corrected entitlement
 * (the hours worked that day at the holiday rate) and the net difference. A payroll reviewer who did not approve the shift, and is not the person, approves or rejects it. Piece A changes NO pay: the closed payroll and its lines are
 * untouched. Real payrolls in the demo company for March 2062 to 2067 (no other test uses these years), one year for each test because a locked month stays locked; the Lagos holiday is the second Monday of March of each year.
 * Rates are INVENTED: role weekday 1,000, holiday 2,000 an hour. The person works Monday to Thursday, 8 hours, in the first week of January.
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

const YEARS = [2062, 2063, 2064, 2065, 2066, 2067]; // one year for each test, because a locked payroll month stays locked
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

describe("a shift approved late on a holiday already paid as not worked becomes a holiday adjustment (piece A: the record and its review; no pay yet)", () => {
  it("is proposed automatically, linked to the shift, its approval and the original payroll line, with the corrected entitlement (the hours worked at the holiday rate) and the net difference, and the closed payroll is untouched", async () => {
    const { w, e, run, rec, line, sup, holiday } = await paidAsNotWorked("Late", YEARS[0]);
    const entry = await lateShift(w, e.id, `${holiday}T08:00`, `${holiday}T16:00`, sup); // worked the holiday: 8 h at the holiday rate of 2,000
    const adj = await db.holidayAdjustment.findMany({ where: { organizationId: w.org, employeeId: e.id } });
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ status: "PROPOSED", timeEntryId: entry.id, shiftApprovedByUserId: sup.userId, originalRunId: run.id, originalLineId: line.id, originalClassification: "HOLIDAY_NOT_WORKED", workedMinutes: 480 });
    expect(adj[0].holidayDate.toISOString().slice(0, 10)).toBe(holiday);
    expect([num(adj[0].originalPaid), num(adj[0].correctedEntitlement), num(adj[0].netDifference)]).toEqual([8_000, 16_000, 8_000]);
    // the original payroll and its stored lines are exactly as they were
    expect(num((await w.record(run.id, e.id)).earnedGross)).toBe(num(rec.earnedGross));
    expect(await w.holidayLines(rec.id)).toHaveLength(1);
    expect(num((await w.holidayLines(rec.id))[0].amount)).toBe(8_000);
    // audited with ids and numbers only
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.org, action: "HOLIDAY_ADJUSTMENT_PROPOSED", entityId: adj[0].id } });
    expect(JSON.stringify(audit.newValue)).toContain("netDifference");
    expect(JSON.stringify(audit)).not.toContain(e.lastName);
  });

  it("is not made for a shift on another day, nor for a holiday that was not paid as not worked", async () => {
    const { w, e, sup, holiday } = await paidAsNotWorked("Other", YEARS[1]);
    await lateShift(w, e.id, `${plus(holiday, 1)}T08:00`, `${plus(holiday, 1)}T16:00`, sup); // the Tuesday: not the holiday
    expect(await db.holidayAdjustment.count({ where: { organizationId: w.org, employeeId: e.id } })).toBe(0);
    const w2 = await world();
    const stranger = await w2.person("NoHistory"); // no hours before, so the holiday was never paid to them as not worked
    const sup2 = await ctxFor("SUPERVISOR");
    await db.beat.update({ where: { id: w2.beat.id }, data: { supervisorId: sup2.userId } });
    await lateShift(w2, stranger.id, `${holiday}T08:00`, `${holiday}T16:00`, sup2);
    expect(await db.holidayAdjustment.count({ where: { organizationId: w2.org, employeeId: stranger.id } })).toBe(0);
  });

  it("can never be made twice for the same person and holiday: a second shift that day is added to the one waiting, and the key is unique", async () => {
    const { w, e, sup, holiday } = await paidAsNotWorked("Twice", YEARS[2]);
    await lateShift(w, e.id, `${holiday}T08:00`, `${holiday}T12:00`, sup); // 4 h
    await lateShift(w, e.id, `${holiday}T13:00`, `${holiday}T17:00`, sup); // another 4 h the same day
    const adj = await db.holidayAdjustment.findMany({ where: { organizationId: w.org, employeeId: e.id } });
    expect(adj).toHaveLength(1);
    expect([adj[0].workedMinutes, num(adj[0].correctedEntitlement), num(adj[0].netDifference)]).toEqual([480, 16_000, 8_000]); // both shifts, 8 h at 2,000
    await expect(db.holidayAdjustment.create({ data: { organizationId: w.org, employeeId: e.id, holidayDate: day(holiday), timeEntryId: "x", shiftApprovedBy: "x", shiftApprovedByUserId: "x", shiftApprovedAt: new Date(), originalRunId: "x", originalLineId: "x", originalClassification: "HOLIDAY_NOT_WORKED", originalPaid: "1", workedMinutes: 1 } })).rejects.toThrow();
  });
});

describe("the review: a payroll reviewer who did not approve the shift approves or rejects it", () => {
  it("is approved by a reviewer with the payroll approval right, who is not the shift's approver and not the person; the decision is stored, audited and final; it changes no pay", async () => {
    const { w, e, run, rec, holiday } = await paidAsNotWorked("Review", YEARS[3]);
    const finance = await ctxFor("FINANCE");
    await lateShift(w, e.id, `${holiday}T08:00`, `${holiday}T16:00`, finance); // the shift is approved by finance...
    const adj = await db.holidayAdjustment.findFirstOrThrow({ where: { organizationId: w.org, employeeId: e.id } });
    await expect(reviewHolidayAdjustment(finance, adj.id, "APPROVED")).rejects.toThrow(/approved the shift/i); // ...so finance cannot review it
    const self = { ...(await ctxFor("PAYROLL_ADMIN")), employeeId: e.id };
    await expect(reviewHolidayAdjustment(self, adj.id, "APPROVED")).rejects.toThrow(/your own/i);
    await expect(reviewHolidayAdjustment(await ctxFor("OPERATIONS"), adj.id, "APPROVED")).rejects.toThrow(); // no payroll approval right
    const reviewer = await ctxFor("PAYROLL_ADMIN");
    const done = await reviewHolidayAdjustment(reviewer, adj.id, "APPROVED");
    expect(done).toMatchObject({ status: "APPROVED", reviewedByUserId: reviewer.userId });
    expect(done.reviewedAt).toBeInstanceOf(Date);
    await expect(reviewHolidayAdjustment(reviewer, adj.id, "REJECTED", "changed my mind")).rejects.toThrow(/already/i); // final
    expect(await db.auditLog.count({ where: { organizationId: w.org, action: "HOLIDAY_ADJUSTMENT_APPROVED", entityId: adj.id } })).toBe(1);
    expect(num((await w.record(run.id, e.id)).earnedGross)).toBe(num(rec.earnedGross)); // no pay is changed by piece A
  });

  it("a rejection needs a reason, kept on the record and not in the audit log", async () => {
    const { w, e, holiday } = await paidAsNotWorked("Reject", YEARS[4]);
    await lateShift(w, e.id, `${holiday}T08:00`, `${holiday}T16:00`, await ctxFor("FINANCE"));
    const adj = await db.holidayAdjustment.findFirstOrThrow({ where: { organizationId: w.org, employeeId: e.id } });
    const reviewer = await ctxFor("PAYROLL_ADMIN");
    await expect(reviewHolidayAdjustment(reviewer, adj.id, "REJECTED")).rejects.toThrow(/reason/i);
    const done = await reviewHolidayAdjustment(reviewer, adj.id, "REJECTED", "The supervisor confirms the shift was a mistake");
    expect(done).toMatchObject({ status: "REJECTED", reviewNote: "The supervisor confirms the shift was a mistake" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.org, action: "HOLIDAY_ADJUSTMENT_REJECTED", entityId: adj.id } });
    expect(JSON.stringify(audit)).not.toContain("mistake");
  });

  it("another company cannot list, see or review it; the list shows the adjustments to a reader of payroll", async () => {
    const { w, e, holiday } = await paidAsNotWorked("Isolated", YEARS[5]);
    await lateShift(w, e.id, `${holiday}T08:00`, `${holiday}T16:00`, await ctxFor("FINANCE"));
    const adj = await db.holidayAdjustment.findFirstOrThrow({ where: { organizationId: w.org, employeeId: e.id } });
    const listed = await listHolidayAdjustments(await ctxFor("PAYROLL_ADMIN"), { status: "PROPOSED" });
    expect(listed.some((a) => a.id === adj.id)).toBe(true);
    const other = await isolatedOrg();
    const stranger = other.ctx("PAYROLL_ADMIN");
    expect(await listHolidayAdjustments(stranger, {})).toHaveLength(0);
    await expect(reviewHolidayAdjustment(stranger, adj.id, "APPROVED")).rejects.toThrow(/not found/i);
  });
});
