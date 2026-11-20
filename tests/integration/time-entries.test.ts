import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { confirmHolidayYear } from "@/server/services/holidays";
import {
  approveTimeEntry,
  captureTimeEntry,
  completeClockOut,
  correctTimeEntry,
  listTimeEntries,
  loadApprovedSegments,
  rejectTimeEntry,
  submitTimeEntry,
  withdrawTimeEntry,
} from "@/server/services/time-entries";
import { isolatedOrg, uid } from "../helpers";

/**
 * Hourly pay, phase 3 (docs/plans/hourly-payroll-assessment.md; the founder's answers of 2026-11-19): a time entry is a clock-in and a clock-out in Nigerian time. H9 the supervisor approves, never the person who
 * captured it; H10 a missing clock-out is not payable until completed; H5 approved breaks are deducted; H16 an approved entry is never edited, a correction replaces it; H11 the state of the work location decides
 * the holiday. Nothing here reads the pay run yet. Calendar: 2026-11-20 is a Friday, 21 a Saturday, 22 a Sunday.
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function world() {
  const t = await isolatedOrg();
  await db.hourlyPaySetting.create({ data: { organizationId: t.org.id, enabled: true, changedBy: "test", changedByUserId: "test" } });
  const sup = t.ctx("SUPERVISOR", null, 1);
  const otherSup = t.ctx("SUPERVISOR", null, 2);
  for (const s of [sup, otherSup]) await db.user.create({ data: { id: s.userId, organizationId: t.org.id, email: s.email, name: s.name, passwordHash: "x", role: "SUPERVISOR" } });
  const ops = t.ctx("OPERATIONS", null, 1);
  const payroll = t.ctx("PAYROLL_ADMIN", null, 1);
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const hr = t.ctx("HR_ADMIN");
  const client = await db.client.create({ data: { organizationId: t.org.id, code: `C${uid()}`, name: "Alpha Bank" } });
  const contract = await db.contract.create({ data: { organizationId: t.org.id, clientId: client.id, contractNumber: `K${uid()}`, name: "Alpha guarding", startDate: day("2026-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: t.org.id, clientId: client.id, contractId: contract.id, code: `B${uid()}`, name: "Lagos HQ", state: "Lagos", supervisorId: sup.userId } });
  const kano = await db.beat.create({ data: { organizationId: t.org.id, clientId: client.id, contractId: contract.id, code: `B${uid()}`, name: "Kano depot", state: "Kano", supervisorId: sup.userId } });
  const elsewhere = await db.beat.create({ data: { organizationId: t.org.id, clientId: client.id, contractId: contract.id, code: `B${uid()}`, name: "Other site", state: "Lagos", supervisorId: otherSup.userId } });
  const hourly = async (n: string) => {
    const e = await createEmployee(hr, { firstName: "Hourly", lastName: n, employmentDate: "2026-01-01", categoryId: t.guardId } as never);
    await db.employeeCompensationType.create({ data: { organizationId: t.org.id, employeeId: e.id, type: "HOURLY", effectiveFrom: day("2026-01-01"), reason: "test", status: "APPROVED", proposedBy: "t", proposedByUserId: "t", decidedBy: "t", decidedByUserId: "t2" } });
    return e;
  };
  const emp = await hourly("One");
  const audit = (action: string) => db.auditLog.findMany({ where: { organizationId: t.org.id, action } });
  /** captured by the operations officer, ready for a supervisor to approve */
  const submitted = async (employeeId: string, from: string, to: string, beatId = beat.id) => {
    const e = await captureTimeEntry(ops, { employeeId, beatId, clockIn: from, clockOut: to });
    return submitTimeEntry(ops, e.id);
  };
  return { t, sup, otherSup, ops, payroll, admin, hr, client, contract, beat, kano, elsewhere, emp, hourly, audit, submitted };
}

describe("who may capture a time entry, and for whom", () => {
  it("is refused while hourly pay is switched off, and for a person who is paid monthly", async () => {
    const w = await world();
    await db.hourlyPaySetting.update({ where: { organizationId: w.t.org.id }, data: { enabled: false } });
    await expect(captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-20T08:00", clockOut: "2026-11-20T16:00" })).rejects.toThrow(/not switched on/i);
    await db.hourlyPaySetting.update({ where: { organizationId: w.t.org.id }, data: { enabled: true } });
    const monthly = await createEmployee(w.hr, { firstName: "Monthly", lastName: "Person", employmentDate: "2026-01-01", categoryId: w.t.guardId } as never);
    await expect(captureTimeEntry(w.ops, { employeeId: monthly.id, beatId: w.beat.id, clockIn: "2026-11-20T08:00", clockOut: "2026-11-20T16:00" })).rejects.toThrow(/paid monthly/i);
    // hourly only from the date of the record: before it, the person is monthly
    const later = await w.hourly("Later");
    await expect(captureTimeEntry(w.ops, { employeeId: later.id, beatId: w.beat.id, clockIn: "2025-12-31T08:00", clockOut: "2025-12-31T16:00" })).rejects.toThrow(/paid monthly/i);
  });

  it("operations and the beat's own supervisor may capture; another site's supervisor, HR, the auditor and an employee may not; nobody captures their own hours", async () => {
    const w = await world();
    const ask = (over = {}) => ({ employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-20T08:00", clockOut: "2026-11-20T16:00", ...over });
    await expect(captureTimeEntry(w.sup, ask())).resolves.toMatchObject({ status: "DRAFT", capturedByUserId: w.sup.userId });
    await expect(captureTimeEntry(w.ops, ask({ clockIn: "2026-11-21T08:00", clockOut: "2026-11-21T16:00" }))).resolves.toMatchObject({ status: "DRAFT" });
    await expect(captureTimeEntry(w.otherSup, ask({ clockIn: "2026-11-22T08:00", clockOut: "2026-11-22T16:00" }))).rejects.toThrow(/not the supervisor/i);
    for (const r of ["HR_ADMIN", "AUDITOR", "EMPLOYEE"] as const) await expect(captureTimeEntry(w.t.ctx(r), ask({ clockIn: "2026-11-23T08:00", clockOut: "2026-11-23T16:00" })), r).rejects.toThrow(/permission/);
    await expect(captureTimeEntry(w.t.ctx("OPERATIONS", w.emp.id, 9), ask({ clockIn: "2026-11-24T08:00", clockOut: "2026-11-24T16:00" }))).rejects.toThrow(/your own/i);
  });

  it("reads the times as Nigerian time and refuses bad times, another company's person and site, and a site that does not exist", async () => {
    const w = await world();
    const e = await captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-20T19:00", clockOut: "2026-11-21T07:00" });
    expect(e.clockIn.toISOString()).toBe("2026-11-20T18:00:00.000Z");
    expect(e.clockOut?.toISOString()).toBe("2026-11-21T06:00:00.000Z");
    expect(e).toMatchObject({ clientId: w.client.id, contractId: w.contract.id, beatId: w.beat.id });
    const ask = (over = {}) => ({ employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-25T08:00", clockOut: "2026-11-25T16:00", ...over });
    await expect(captureTimeEntry(w.ops, ask({ clockIn: "2026-11-25T08:00:30" }))).rejects.toThrow(/date and time/i);
    await expect(captureTimeEntry(w.ops, ask({ clockOut: "2026-11-25T07:00" }))).rejects.toThrow(/end after/i);
    const b = await world();
    await expect(captureTimeEntry(w.ops, ask({ employeeId: b.emp.id }))).rejects.toThrow(/not found/i);
    await expect(captureTimeEntry(w.ops, ask({ beatId: b.beat.id }))).rejects.toThrow(/not found/i);
    await expect(captureTimeEntry(w.ops, ask({ beatId: "nope" }))).rejects.toThrow(/not found/i);
  });

  it("refuses a shift inside a CLOSED payroll period (an approved, locked or paid one is allowed: see below), and records the capture in the audit log by ids and times only", async () => {
    const w = await world();
    await db.payrollPeriod.create({ data: { organizationId: w.t.org.id, name: "October 2026", year: 2026, month: 10, startDate: day("2026-10-01"), endDate: day("2026-10-31"), status: "CLOSED" } });
    await expect(captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-10-15T08:00", clockOut: "2026-10-15T16:00" })).rejects.toThrow(/Payroll for October 2026/);
    // a shift that starts in an open month and ends in a closed one is refused too
    await db.payrollPeriod.create({ data: { organizationId: w.t.org.id, name: "December 2026", year: 2026, month: 12, startDate: day("2026-12-01"), endDate: day("2026-12-31"), status: "OPEN" } });
    await db.payrollPeriod.update({ where: { organizationId_year_month: { organizationId: w.t.org.id, year: 2026, month: 10 } }, data: { status: "OPEN" } });
    await db.payrollPeriod.create({ data: { organizationId: w.t.org.id, name: "November 2026", year: 2026, month: 11, startDate: day("2026-11-01"), endDate: day("2026-11-30"), status: "CLOSED" } });
    await expect(captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-10-31T19:00", clockOut: "2026-11-01T07:00" })).rejects.toThrow(/Payroll for November 2026/);
    const ok = await captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-12-05T08:00", clockOut: "2026-12-05T16:00", });
    const rows = await w.audit("TIME_ENTRY_CAPTURED");
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-12-05T07:00:00.000Z", clockOut: "2026-12-05T15:00:00.000Z" });
    expect(rows[0].entityId).toBe(ok.id);
  });
});

describe("a shift in a month whose payroll is already approved, locked or paid (the founder's H22, 2026-11-20)", () => {
  it("can still be captured, submitted and approved: it is paid by a supplementary payroll, and the locked payroll is never changed", async () => {
    const w = await world();
    for (const [month, status] of [[8, "APPROVED"], [9, "LOCKED"], [10, "PAID"]] as const)
      await db.payrollPeriod.create({ data: { organizationId: w.t.org.id, name: `Month ${month} 2026`, year: 2026, month, startDate: day(`2026-${String(month).padStart(2, "0")}-01`), endDate: day(`2026-${String(month).padStart(2, "0")}-28`), status } });
    for (const date of ["2026-08-10", "2026-09-10", "2026-10-10"]) {
      const e = await captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: `${date}T08:00`, clockOut: `${date}T16:00` });
      await submitTimeEntry(w.ops, e.id);
      await expect(approveTimeEntry(w.sup, e.id, {}), date).resolves.toMatchObject({ status: "APPROVED", payableMinutes: 480 });
    }
  });

  it("a correction to an approved shift in a locked month can be made and approved (it pays only what is still owed)", async () => {
    const w = await world();
    await db.payrollPeriod.create({ data: { organizationId: w.t.org.id, name: "November 2026", year: 2026, month: 11, startDate: day("2026-11-01"), endDate: day("2026-11-30"), status: "LOCKED" } });
    const e = await w.submitted(w.emp.id, "2026-11-20T08:00", "2026-11-20T16:00");
    const orig = await approveTimeEntry(w.sup, e.id, {});
    const fix = await correctTimeEntry(w.ops, orig.id, { clockIn: "2026-11-20T08:00", clockOut: "2026-11-20T17:00", reason: "Stayed an hour longer" });
    await submitTimeEntry(w.ops, fix.id);
    await expect(approveTimeEntry(w.sup, fix.id, {})).resolves.toMatchObject({ status: "APPROVED", payableMinutes: 540 });
  });
});

describe("a missing clock-out is not payable until a supervisor completes it (H10)", () => {
  it("an entry with no clock-out is a draft that cannot be submitted or approved; completing it, then submitting, then approving by someone else makes it payable", async () => {
    const w = await world();
    const open = await captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-20T19:00", clockOut: null });
    expect(open).toMatchObject({ status: "DRAFT", clockOut: null });
    await expect(submitTimeEntry(w.ops, open.id)).rejects.toThrow(/clock-out/i);
    await expect(approveTimeEntry(w.sup, open.id, {})).rejects.toThrow(/submitted/i);
    await expect(completeClockOut(w.sup, open.id, "2026-11-20T18:00")).rejects.toThrow(/end after/i);
    const done = await completeClockOut(w.sup, open.id, "2026-11-21T07:00");
    expect(done).toMatchObject({ clockOut: new Date("2026-11-21T06:00:00.000Z"), completedByUserId: w.sup.userId });
    await submitTimeEntry(w.ops, open.id);
    await expect(approveTimeEntry(w.sup, open.id, {})).rejects.toThrow(/entered its clock-out|someone else/i); // the one who completed the times is a maker too
    await expect(approveTimeEntry(w.payroll, open.id, {})).resolves.toMatchObject({ status: "APPROVED", payableMinutes: 720 });
    await expect(completeClockOut(w.sup, open.id, "2026-11-21T08:00")).rejects.toThrow(/draft/i); // only a draft can be completed
  });

  it("never pays an entry that has no clock-out: it is not in what the pay run will read", async () => {
    const w = await world();
    await captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-20T19:00", clockOut: null });
    expect(await db.$transaction((tx) => loadApprovedSegments(tx, w.t.org.id, day("2026-11-01"), day("2026-11-30")))).toHaveLength(0);
  });
});

describe("one person cannot be at work twice at the same time", () => {
  it("refuses the same shift twice and any overlap, allows end-to-end shifts, and ignores rejected and withdrawn entries", async () => {
    const w = await world();
    const first = await captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-20T08:00", clockOut: "2026-11-20T16:00" });
    const ask = (from: string, to: string | null) => captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: from, clockOut: to });
    await expect(ask("2026-11-20T08:00", "2026-11-20T16:00")).rejects.toThrow(/already has/i);
    await expect(ask("2026-11-20T15:00", "2026-11-20T20:00")).rejects.toThrow(/already has/i);
    await expect(ask("2026-11-20T06:00", "2026-11-20T09:00")).rejects.toThrow(/already has/i);
    await expect(ask("2026-11-20T10:00", null)).rejects.toThrow(/already has/i); // an open entry that starts inside a shift
    await expect(ask("2026-11-20T16:00", "2026-11-20T20:00")).resolves.toMatchObject({ status: "DRAFT" }); // touching is fine
    await withdrawTimeEntry(w.ops, first.id);
    await expect(ask("2026-11-20T08:00", "2026-11-20T16:00")).resolves.toMatchObject({ status: "DRAFT" }); // a withdrawn entry blocks nothing
  });

  it("two people can work the same hours, and two captures at the same instant cannot both succeed", async () => {
    const w = await world();
    const other = await w.hourly("Two");
    const mk = (employeeId: string) => captureTimeEntry(w.ops, { employeeId, beatId: w.beat.id, clockIn: "2026-11-22T08:00", clockOut: "2026-11-22T16:00" });
    await expect(Promise.all([mk(w.emp.id), mk(other.id)])).resolves.toHaveLength(2);
    const results = await Promise.allSettled([mk(w.emp.id), mk(w.emp.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(0); // the shift already exists from the first call: both refused
    const racing = await w.hourly("Three");
    const race = await Promise.allSettled([mk(racing.id), mk(racing.id), mk(racing.id)]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.timeEntry.count({ where: { employeeId: racing.id } })).toBe(1);
  });
});

describe("approval: the supervisor, never the capturer (H9)", () => {
  it("only a submitted entry can be approved; a draft cannot", async () => {
    const w = await world();
    const draft = await captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-20T08:00", clockOut: "2026-11-20T16:00" });
    await expect(approveTimeEntry(w.sup, draft.id, {})).rejects.toThrow(/submitted/i);
    await submitTimeEntry(w.ops, draft.id);
    await expect(approveTimeEntry(w.sup, draft.id, {})).resolves.toMatchObject({ status: "APPROVED", decidedByUserId: w.sup.userId });
    await expect(approveTimeEntry(w.sup, draft.id, {})).rejects.toThrow(/already approved/i);
  });

  it("the beat's supervisor and the payroll approvers may approve; another site's supervisor, operations, HR and the auditor may not", async () => {
    const w = await world();
    const e = await w.submitted(w.emp.id, "2026-11-20T08:00", "2026-11-20T16:00");
    await expect(approveTimeEntry(w.otherSup, e.id, {})).rejects.toThrow(/not the supervisor/i);
    for (const r of ["OPERATIONS", "HR_ADMIN", "AUDITOR", "EMPLOYEE"] as const) await expect(approveTimeEntry(w.t.ctx(r, null, 5), e.id, {}), r).rejects.toThrow(/permission/);
    await expect(approveTimeEntry(w.payroll, e.id, {})).resolves.toMatchObject({ status: "APPROVED" });
    const e2 = await w.submitted(w.emp.id, "2026-11-21T08:00", "2026-11-21T16:00");
    await expect(approveTimeEntry(w.sup, e2.id, {})).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("the person who captured an entry can never approve it, even with the approval right; nor a person their own hours", async () => {
    const w = await world();
    const e = await captureTimeEntry(w.admin, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-20T08:00", clockOut: "2026-11-20T16:00" }); // a company administrator holds both rights
    await submitTimeEntry(w.admin, e.id);
    await expect(approveTimeEntry(w.admin, e.id, {})).rejects.toThrow(/someone else/i);
    await expect(approveTimeEntry(w.t.ctx("COMPANY_ADMIN", w.emp.id, 7), e.id, {})).rejects.toThrow(/your own/i);
    await expect(approveTimeEntry(w.payroll, e.id, {})).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("stores the paid pieces by day and class, the work location's state deciding the holiday (H11): a Lagos holiday on the Saturday is a holiday in Lagos and an ordinary Saturday in Kano", async () => {
    const w = await world();
    const hol = await db.publicHoliday.create({ data: { organizationId: w.t.org.id, date: day("2026-11-21"), name: "A Lagos holiday", createdBy: "t" } });
    await db.publicHolidayState.create({ data: { organizationId: w.t.org.id, holidayId: hol.id, state: "Lagos", createdBy: "t" } });
    const other = await w.hourly("Kano");
    const lagos = await w.submitted(w.emp.id, "2026-11-20T19:00", "2026-11-21T07:00", w.beat.id);
    const kano = await w.submitted(other.id, "2026-11-20T19:00", "2026-11-21T07:00", w.kano.id);
    await approveTimeEntry(w.sup, lagos.id, { breaks: "02:00-02:30" });
    await approveTimeEntry(w.sup, kano.id, {});
    const segs = async (id: string) => (await db.timeEntrySegment.findMany({ where: { entryId: id }, orderBy: [{ date: "asc" }, { minutes: "asc" }] })).map((s) => [s.date.toISOString().slice(0, 10), s.dayClass, s.minutes]);
    expect(await segs(lagos.id)).toEqual([["2026-11-20", "WEEKDAY", 300], ["2026-11-21", "HOLIDAY", 120], ["2026-11-21", "HOLIDAY", 270]]);
    expect(await segs(kano.id)).toEqual([["2026-11-20", "WEEKDAY", 300], ["2026-11-21", "WEEKEND", 420]]);
    const a = await db.timeEntry.findUniqueOrThrow({ where: { id: lagos.id }, include: { breaks: true } });
    expect(a).toMatchObject({ payableMinutes: 690, placeState: "Lagos", calendarConfirmed: false });
    expect(a.breaks).toHaveLength(1);
    expect(a.breaks[0].startsAt.toISOString()).toBe("2026-11-21T01:00:00.000Z"); // 02:00 Nigerian time
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: kano.id } })).placeState).toBe("Kano");
  });

  it("records whether the holiday list of the year was confirmed when the shift was approved, and a site with no recognised state gets only national holidays", async () => {
    const w = await world();
    await confirmHolidayYear(w.payroll, 2026);
    const nostate = await db.beat.create({ data: { organizationId: w.t.org.id, clientId: w.client.id, contractId: w.contract.id, code: `B${uid()}`, name: "No state", supervisorId: w.sup.userId } });
    const e = await w.submitted(w.emp.id, "2026-11-20T08:00", "2026-11-20T16:00", nostate.id);
    await approveTimeEntry(w.sup, e.id, {});
    expect(await db.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ placeState: null, calendarConfirmed: true });
  });

  it("refuses bad breaks and stores nothing: outside the shift, overlapping, or leaving nothing to pay", async () => {
    const w = await world();
    const e = await w.submitted(w.emp.id, "2026-11-20T08:00", "2026-11-20T16:00");
    for (const bad of ["07:00-07:30", "12:00-12:30, 12:15-12:45", "08:00-16:00", "13:00", "25:00-26:00"]) await expect(approveTimeEntry(w.sup, e.id, { breaks: bad }), bad).rejects.toThrow();
    expect(await db.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ status: "SUBMITTED", payableMinutes: null });
    expect(await db.timeEntryBreak.count({ where: { entryId: e.id } })).toBe(0);
    expect(await db.timeEntrySegment.count({ where: { entryId: e.id } })).toBe(0);
  });

  it("only approved entries are what the pay run will read; an unapproved entry never is", async () => {
    const w = await world();
    const a = await w.submitted(w.emp.id, "2026-11-20T08:00", "2026-11-20T16:00");
    await captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-21T08:00", clockOut: "2026-11-21T16:00" }); // a draft
    await w.submitted(w.emp.id, "2026-11-22T08:00", "2026-11-22T16:00"); // submitted, not approved
    expect(await db.$transaction((tx) => loadApprovedSegments(tx, w.t.org.id, day("2026-11-01"), day("2026-11-30")))).toHaveLength(0);
    await approveTimeEntry(w.sup, a.id, { breaks: "12:00-12:30" });
    const rows = await db.$transaction((tx) => loadApprovedSegments(tx, w.t.org.id, day("2026-11-01"), day("2026-11-30")));
    expect(rows.map((r) => [r.date, r.dayClass, r.minutes, r.employeeId, r.entryId])).toEqual([
      ["2026-11-20", "WEEKDAY", 240, w.emp.id, a.id],
      ["2026-11-20", "WEEKDAY", 210, w.emp.id, a.id],
    ]);
  });
});

describe("reject and withdraw", () => {
  it("rejecting needs a reason and a submitted entry, and a rejected entry pays nothing; the capturer may withdraw a draft or submitted entry, nobody else", async () => {
    const w = await world();
    const e = await w.submitted(w.emp.id, "2026-11-20T08:00", "2026-11-20T16:00");
    await expect(rejectTimeEntry(w.sup, e.id, "")).rejects.toThrow(/reason/i);
    await expect(rejectTimeEntry(w.otherSup, e.id, "Not my site at all")).rejects.toThrow(/not the supervisor/i);
    await expect(rejectTimeEntry(w.sup, e.id, "Wrong site, please recapture")).resolves.toMatchObject({ status: "REJECTED", decisionNote: "Wrong site, please recapture" });
    await expect(approveTimeEntry(w.sup, e.id, {})).rejects.toThrow(/submitted/i);
    const d = await captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-21T08:00", clockOut: "2026-11-21T16:00" });
    await expect(withdrawTimeEntry(w.sup, d.id)).rejects.toThrow(/only your own/i);
    await expect(withdrawTimeEntry(w.ops, d.id)).resolves.toMatchObject({ status: "WITHDRAWN" });
    await expect(withdrawTimeEntry(w.ops, d.id)).rejects.toThrow(/withdrawn/i);
  });

  it("an approved entry cannot be withdrawn: only corrected", async () => {
    const w = await world();
    const e = await w.submitted(w.emp.id, "2026-11-20T08:00", "2026-11-20T16:00");
    await approveTimeEntry(w.sup, e.id, {});
    await expect(withdrawTimeEntry(w.ops, e.id)).rejects.toThrow(/approved/i);
  });
});

describe("corrections: an approved entry is never edited, a new entry replaces it (H16)", () => {
  async function approved(w: Awaited<ReturnType<typeof world>>) {
    const e = await w.submitted(w.emp.id, "2026-11-20T08:00", "2026-11-20T16:00");
    return approveTimeEntry(w.sup, e.id, {});
  }

  it("the original stays payable until the correction is approved; then it is superseded and kept, and only the correction is read", async () => {
    const w = await world();
    const orig = await approved(w);
    const fix = await correctTimeEntry(w.ops, orig.id, { clockIn: "2026-11-20T09:00", clockOut: "2026-11-20T17:00", reason: "The guard clocked in an hour late" });
    expect(fix).toMatchObject({ status: "DRAFT", correctsId: orig.id });
    const read = () => db.$transaction((tx) => loadApprovedSegments(tx, w.t.org.id, day("2026-11-01"), day("2026-11-30")));
    expect((await read()).map((r) => r.entryId)).toEqual([orig.id]);
    await submitTimeEntry(w.ops, fix.id);
    expect((await read()).map((r) => r.entryId)).toEqual([orig.id]); // still the original: a submitted correction pays nothing yet
    await approveTimeEntry(w.sup, fix.id, {});
    expect((await read()).map((r) => [r.entryId, r.minutes])).toEqual([[fix.id, 480]]);
    expect(await db.timeEntry.findUniqueOrThrow({ where: { id: orig.id } })).toMatchObject({ status: "SUPERSEDED" });
    expect(await db.timeEntrySegment.count({ where: { entryId: orig.id } })).toBe(1); // the original's pieces are kept
  });

  it("needs a reason, only an approved entry can be corrected, only one correction at a time, and the correction may overlap the entry it replaces but not any other", async () => {
    const w = await world();
    const orig = await approved(w);
    await expect(correctTimeEntry(w.ops, orig.id, { clockIn: "2026-11-20T09:00", clockOut: "2026-11-20T17:00", reason: "x" })).rejects.toThrow(/reason/i);
    const draft = await captureTimeEntry(w.ops, { employeeId: w.emp.id, beatId: w.beat.id, clockIn: "2026-11-21T08:00", clockOut: "2026-11-21T16:00" });
    await expect(correctTimeEntry(w.ops, draft.id, { clockIn: "2026-11-21T09:00", clockOut: "2026-11-21T17:00", reason: "Not approved yet" })).rejects.toThrow(/approved/i);
    await w.submitted(w.emp.id, "2026-11-20T18:00", "2026-11-20T23:00"); // another shift, later the same day
    await expect(correctTimeEntry(w.ops, orig.id, { clockIn: "2026-11-20T09:00", clockOut: "2026-11-20T19:00", reason: "Runs into the next shift" })).rejects.toThrow(/already has/i);
    await correctTimeEntry(w.ops, orig.id, { clockIn: "2026-11-20T07:00", clockOut: "2026-11-20T17:00", reason: "A longer shift in fact" });
    await expect(correctTimeEntry(w.ops, orig.id, { clockIn: "2026-11-20T06:00", clockOut: "2026-11-20T17:00", reason: "A second correction" })).rejects.toThrow(/already a correction/i);
  });

  it("the person who captured the correction cannot approve it; a different person does", async () => {
    const w = await world();
    const orig = await approved(w);
    const fix = await correctTimeEntry(w.admin, orig.id, { clockIn: "2026-11-20T09:00", clockOut: "2026-11-20T17:00", reason: "The guard clocked in an hour late" });
    await submitTimeEntry(w.admin, fix.id);
    await expect(approveTimeEntry(w.admin, fix.id, {})).rejects.toThrow(/someone else/i);
    await expect(approveTimeEntry(w.sup, fix.id, {})).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("is refused inside a CLOSED payroll period (a locked one is allowed, and is paid by a supplementary payroll)", async () => {
    const w = await world();
    const orig = await approved(w);
    await db.payrollPeriod.create({ data: { organizationId: w.t.org.id, name: "November 2026", year: 2026, month: 11, startDate: day("2026-11-01"), endDate: day("2026-11-30"), status: "CLOSED" } });
    await expect(correctTimeEntry(w.ops, orig.id, { clockIn: "2026-11-20T09:00", clockOut: "2026-11-20T17:00", reason: "The guard clocked in an hour late" })).rejects.toThrow(/is closed/i);
  });
});

describe("the database keeps time entries as a record", () => {
  it("refuses delete, edits to an approved or submitted entry, a change to the breaks or pieces, and an approval by the capturer", async () => {
    const w = await world();
    const e = await w.submitted(w.emp.id, "2026-11-20T08:00", "2026-11-20T16:00");
    await expect(db.timeEntry.update({ where: { id: e.id }, data: { clockIn: new Date("2026-11-20T06:00:00Z") } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.timeEntry.update({ where: { id: e.id }, data: { status: "APPROVED", decidedByUserId: w.ops.userId, decidedBy: "x", payableMinutes: 480 } })).rejects.toThrow(); // approved by its own capturer
    await approveTimeEntry(w.sup, e.id, { breaks: "12:00-12:30" });
    await expect(db.timeEntry.delete({ where: { id: e.id } })).rejects.toThrow(/cannot be deleted/i);
    await expect(db.timeEntry.update({ where: { id: e.id }, data: { payableMinutes: 999 } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.timeEntry.update({ where: { id: e.id }, data: { status: "DRAFT" } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.timeEntrySegment.deleteMany({ where: { entryId: e.id } })).rejects.toThrow(/cannot be changed or deleted/i);
    await expect(db.timeEntrySegment.updateMany({ where: { entryId: e.id }, data: { minutes: 1 } })).rejects.toThrow(/cannot be changed or deleted/i);
    await expect(db.timeEntryBreak.deleteMany({ where: { entryId: e.id } })).rejects.toThrow(/cannot be changed or deleted/i);
  });

  it("refuses a shift that ends before it starts, a time with seconds, and a submitted entry with no clock-out", async () => {
    const w = await world();
    const base = { organizationId: w.t.org.id, employeeId: w.emp.id, clientId: w.client.id, contractId: w.contract.id, beatId: w.beat.id, capturedBy: "x", capturedByUserId: "x" };
    await expect(db.timeEntry.create({ data: { ...base, clockIn: new Date("2026-11-20T10:00:00Z"), clockOut: new Date("2026-11-20T09:00:00Z") } })).rejects.toThrow();
    await expect(db.timeEntry.create({ data: { ...base, clockIn: new Date("2026-11-20T10:00:30Z") } })).rejects.toThrow();
    await expect(db.timeEntry.create({ data: { ...base, clockIn: new Date("2026-11-20T10:00:00Z"), status: "SUBMITTED" } })).rejects.toThrow();
  });
});

describe("company walls, visibility and the audit log", () => {
  it("another company's entries are 'not found' and not listed; a supervisor sees only the entries of the sites they supervise", async () => {
    const a = await world();
    const b = await world();
    const e = await a.submitted(a.emp.id, "2026-11-20T08:00", "2026-11-20T16:00");
    await expect(approveTimeEntry(b.payroll, e.id, {})).rejects.toThrow(/not found/i);
    await expect(rejectTimeEntry(b.payroll, e.id, "A reason here")).rejects.toThrow(/not found/i);
    await expect(withdrawTimeEntry(b.ops, e.id)).rejects.toThrow(/not found/i);
    await expect(correctTimeEntry(b.ops, e.id, { clockIn: "2026-11-20T09:00", clockOut: "2026-11-20T17:00", reason: "Not theirs" })).rejects.toThrow(/not found/i);
    expect((await listTimeEntries(b.admin, {})).entries).toHaveLength(0);
    expect((await listTimeEntries(a.admin, {})).entries).toHaveLength(1);
    const other = await a.hourly("Elsewhere");
    await a.submitted(other.id, "2026-11-20T08:00", "2026-11-20T16:00", a.elsewhere.id);
    expect((await listTimeEntries(a.sup, {})).entries.map((x) => x.beatId)).toEqual([a.beat.id]); // not the other supervisor's site
    expect((await listTimeEntries(a.otherSup, {})).entries.map((x) => x.beatId)).toEqual([a.elsewhere.id]);
    expect((await listTimeEntries(a.admin, {})).entries).toHaveLength(2);
  });

  it("the audit log carries ids, times and numbers only, never a rejection reason or a correction reason", async () => {
    const w = await world();
    const e = await w.submitted(w.emp.id, "2026-11-20T08:00", "2026-11-20T16:00");
    await approveTimeEntry(w.sup, e.id, { breaks: "12:00-12:30" });
    const fix = await correctTimeEntry(w.ops, e.id, { clockIn: "2026-11-20T09:00", clockOut: "2026-11-20T17:00", reason: "SECRET-CORRECTION-REASON the guard was late" });
    await submitTimeEntry(w.ops, fix.id);
    await rejectTimeEntry(w.sup, fix.id, "SECRET-REJECT-REASON wrong again");
    const all = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "TIME_ENTRY_" } } });
    const actions = all.map((r) => r.action);
    for (const a of ["TIME_ENTRY_CAPTURED", "TIME_ENTRY_SUBMITTED", "TIME_ENTRY_APPROVED", "TIME_ENTRY_CORRECTION_STARTED", "TIME_ENTRY_REJECTED"]) expect(actions, a).toContain(a);
    const approved = all.find((r) => r.action === "TIME_ENTRY_APPROVED")!;
    expect(approved.newValue).toMatchObject({ payableMinutes: 450, breakMinutes: 30 });
    expect(JSON.stringify(all)).not.toContain("SECRET-CORRECTION-REASON");
    expect(JSON.stringify(all)).not.toContain("SECRET-REJECT-REASON");
  });
});
