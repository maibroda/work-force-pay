import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { normaliseState } from "@/lib/nigeria-states";
import { watDate } from "@/lib/payroll/hourly";
import { compensationTypeOn, holidaysApplying } from "@/lib/payroll/hourly-rates";
import { entriesOverlap, parseBreakTimes, parseWatLocal, payableSegments } from "@/lib/payroll/time-entry";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { assertHourlyPayOn } from "./hourly-pay";

/**
 * Hourly pay, phase 3 (docs/plans/hourly-payroll-assessment.md; the founder's answers of 2026-11-19): time entries, a clock-in and a clock-out in Nigerian time for a person who is paid by the hour.
 *   H9  the supervisor approves, never the person who captured the entry (and never the person who entered a missing clock-out, nor the employee for their own hours); unapproved hours never reach a pay run.
 *   H10 an entry with no clock-out stays a DRAFT and is never payable; a supervisor completes it.
 *   H5  approved unpaid breaks are deducted: the approver records the TIMES of the breaks (see src/lib/payroll/time-entry.ts for why times and not minutes).
 *   H16 an approved entry is never edited: a CORRECTION entry replaces it; approving the correction makes the original SUPERSEDED (kept). A correction goes through a supplementary payroll once its period is locked.
 *   H11 the state of the work location (the site's state) decides which public holidays apply to the hours.
 * Approval stores the paid pieces by day and class (what a later phase's pay run will read). NOTHING in the pay run reads any of this yet. Who may do what: capturing, completing, submitting, withdrawing and correcting need
 * `attendance.record` (a supervisor only for their own sites); approving or rejecting is for the site's supervisor or someone with `payroll.inputs.approve`. Everything is for the caller's company only (another company's
 * entry, person or site is "not found"). Audit entries carry ids, times and numbers only, never the reasons typed.
 */
/** Only a CLOSED pay period refuses time entries: while it is approved, locked or paid, a shift can still be captured, approved or corrected, and is paid by a supplementary payroll (the founder's H22, 2026-11-20). */
const CLOSED_PERIOD = ["CLOSED"] as const;
const LIVE = ["DRAFT", "SUBMITTED", "APPROVED"] as const;

export interface CaptureInput {
  employeeId: string;
  beatId: string;
  /** Nigerian wall-clock time, "YYYY-MM-DDTHH:mm". */
  clockIn: string;
  /** The same form; empty or null when the clock-out is missing (the entry then stays a draft and is never paid). */
  clockOut?: string | null;
}

type Beat = { id: string; name: string; supervisorId: string | null; state: string | null; clientId: string; contractId: string };

function assertMayCapture(ctx: Ctx, beat: Beat) {
  assertCan(ctx, "attendance.record");
  if (ctx.role === "SUPERVISOR" && beat.supervisorId !== ctx.userId) throw new BusinessError(`You are not the supervisor for ${beat.name}.`);
}

/** The site's supervisor, or someone with the payroll approval right. */
function assertMayDecide(ctx: Ctx, beat: Beat) {
  if (ctx.role === "SUPERVISOR") {
    assertCan(ctx, "attendance.record");
    if (beat.supervisorId !== ctx.userId) throw new BusinessError(`You are not the supervisor for ${beat.name}.`);
  } else assertCan(ctx, "payroll.inputs.approve");
}

async function loadBeat(ctx: Ctx, tx: Tx, id: string): Promise<Beat> {
  const beat = await tx.beat.findFirst({ where: { id: id || "-", organizationId: ctx.orgId }, select: { id: true, name: true, supervisorId: true, state: true, clientId: true, contractId: true } });
  if (!beat) throw new BusinessError("Site not found.");
  return beat;
}

async function loadEntry(ctx: Ctx, tx: Tx, id: string) {
  const e = await tx.timeEntry.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!e) throw new BusinessError("Time entry not found.");
  return e;
}

/**
 * A closed pay period may not have time entries added, changed or approved in it. An approved, locked or paid one may (the founder's H22, 2026-11-20, which replaced the earlier rule that refused them): hours the locked
 * payroll did not pay are paid by a supplementary payroll, and a correction pays only what is still owed (src/lib/payroll/hourly-late.ts). The locked payroll itself is never changed.
 */
async function assertDatesEditable(ctx: Ctx, tx: Tx, from: Date, to: Date | null) {
  const first = d(watDate(from));
  const last = d(watDate(new Date((to ?? from).getTime() - (to ? 60_000 : 0))));
  const p = await tx.payrollPeriod.findFirst({ where: { organizationId: ctx.orgId, status: { in: [...CLOSED_PERIOD] }, startDate: { lte: last }, endDate: { gte: first } } });
  if (p) throw new BusinessError(`Payroll for ${p.name} is closed: time entries for those dates cannot be changed.`);
}

/** Only a person who is paid by the hour on the day has time entries (a person on a monthly salary is never paid from hours, so nothing can be double counted). */
async function assertHourlyOn(ctx: Ctx, tx: Tx, employeeId: string, clockIn: Date) {
  const rows = await tx.employeeCompensationType.findMany({ where: { organizationId: ctx.orgId, employeeId, status: "APPROVED" }, select: { type: true, effectiveFrom: true, status: true } });
  if (compensationTypeOn(rows, d(watDate(clockIn))) !== "HOURLY") throw new BusinessError("This person is paid monthly on that date, so hours are not entered for them. Record that they are paid by the hour first.");
}

/** One person at work twice at the same time is refused. A lock on the person makes two entries made at the same moment queue instead of both passing the check. */
async function assertNoOverlap(tx: Tx, orgId: string, employeeId: string, clockIn: Date, clockOut: Date | null, except: string[]) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"time-entry:" + employeeId}))`;
  const candidates = await tx.timeEntry.findMany({
    where: {
      organizationId: orgId,
      employeeId,
      status: { in: [...LIVE] },
      id: { notIn: except },
      clockIn: { lt: clockOut ?? new Date(clockIn.getTime() + 60_000) },
      OR: [{ clockOut: null }, { clockOut: { gt: clockIn } }],
    },
    select: { clockIn: true, clockOut: true },
  });
  if (candidates.some((c) => entriesOverlap({ clockIn, clockOut }, c))) throw new BusinessError("This person already has a time entry that overlaps these times.");
}

function times(clockIn: string, clockOut: string | null | undefined) {
  const cin = parseWatLocal(clockIn);
  const cout = clockOut && clockOut.trim() ? parseWatLocal(clockOut) : null;
  if (cout && cout.getTime() <= cin.getTime()) throw new BusinessError("A shift must end after it starts.");
  return { cin, cout };
}

const stamp = (v: Date | null) => (v ? v.toISOString() : null);

async function createEntry(ctx: Ctx, tx: Tx, v: { employeeId: string; beat: Beat; cin: Date; cout: Date | null; correctsId?: string; reason?: string; except: string[] }) {
  const emp = await tx.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId }, select: { id: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (ctx.employeeId && ctx.employeeId === emp.id) throw new BusinessError("This is your own pay: someone else has to enter your hours.");
  await assertHourlyOn(ctx, tx, emp.id, v.cin);
  await assertDatesEditable(ctx, tx, v.cin, v.cout);
  await assertNoOverlap(tx, ctx.orgId, emp.id, v.cin, v.cout, v.except);
  const row = await tx.timeEntry.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: emp.id,
      clientId: v.beat.clientId,
      contractId: v.beat.contractId,
      beatId: v.beat.id,
      clockIn: v.cin,
      clockOut: v.cout,
      correctsId: v.correctsId ?? null,
      reason: v.reason ?? null,
      capturedBy: ctx.name,
      capturedByUserId: ctx.userId,
    },
  });
  return row;
}

/** Captures a shift as a DRAFT. With no clock-out it stays a draft and is never paid until a supervisor completes it. */
export async function captureTimeEntry(ctx: Ctx, raw: CaptureInput) {
  const { cin, cout } = times(raw.clockIn, raw.clockOut);
  return db.$transaction(async (tx) => {
    await assertHourlyPayOn(ctx, tx);
    const beat = await loadBeat(ctx, tx, raw.beatId);
    assertMayCapture(ctx, beat);
    const row = await createEntry(ctx, tx, { employeeId: raw.employeeId, beat, cin, cout, except: [] });
    await logAudit(ctx, { action: "TIME_ENTRY_CAPTURED", entity: "TimeEntry", entityId: row.id, newValue: { employeeId: row.employeeId, beatId: beat.id, clockIn: stamp(cin), clockOut: stamp(cout) } }, tx);
    return row;
  });
}

/** A supervisor enters the real clock-out of a draft that had none. Whoever does it is a maker of the entry too, so they cannot approve it. */
export async function completeClockOut(ctx: Ctx, id: string, clockOut: string) {
  return db.$transaction(async (tx) => {
    await assertHourlyPayOn(ctx, tx);
    const e = await loadEntry(ctx, tx, id);
    if (e.status !== "DRAFT") throw new BusinessError(`Only a draft can be completed (this entry is ${e.status.toLowerCase()}).`);
    if (e.clockOut) throw new BusinessError("This draft already has its clock-out.");
    const beat = await loadBeat(ctx, tx, e.beatId);
    assertMayCapture(ctx, beat);
    if (ctx.employeeId && ctx.employeeId === e.employeeId) throw new BusinessError("This is your own pay: someone else has to enter your hours.");
    const out = parseWatLocal(clockOut);
    if (out.getTime() <= e.clockIn.getTime()) throw new BusinessError("A shift must end after it starts.");
    await assertDatesEditable(ctx, tx, e.clockIn, out);
    await assertNoOverlap(tx, ctx.orgId, e.employeeId, e.clockIn, out, [e.id]);
    const row = await tx.timeEntry.update({ where: { id }, data: { clockOut: out, completedBy: ctx.name, completedByUserId: ctx.userId } });
    await logAudit(ctx, { action: "TIME_ENTRY_CLOCKOUT_COMPLETED", entity: "TimeEntry", entityId: id, newValue: { employeeId: e.employeeId, beatId: e.beatId, clockOut: stamp(out) } }, tx);
    return row;
  });
}

/** Sends a draft for approval. It needs its clock-out: an entry with none is never paid. */
export async function submitTimeEntry(ctx: Ctx, id: string) {
  return db.$transaction(async (tx) => {
    await assertHourlyPayOn(ctx, tx);
    const e = await loadEntry(ctx, tx, id);
    if (e.status !== "DRAFT") throw new BusinessError(`Only a draft can be submitted (this entry is ${e.status.toLowerCase()}).`);
    if (!e.clockOut) throw new BusinessError("Enter the clock-out before submitting: an entry with no clock-out is never paid.");
    const beat = await loadBeat(ctx, tx, e.beatId);
    assertMayCapture(ctx, beat);
    const row = await tx.timeEntry.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    await logAudit(ctx, { action: "TIME_ENTRY_SUBMITTED", entity: "TimeEntry", entityId: id, newValue: { employeeId: e.employeeId, beatId: e.beatId } }, tx);
    return row;
  });
}

function assertDecidable(status: string, verb: "approved" | "rejected") {
  if (status === "SUBMITTED") return;
  if (status === verb.toUpperCase()) throw new BusinessError(`This time entry is already ${verb}.`);
  throw new BusinessError(`Only a submitted time entry can be ${verb} (this one is ${status.toLowerCase()}).`);
}

/** The years a shift touches, for the holiday list: from the year of the clock-in to the year of the last minute. */
function yearsOf(clockIn: Date, clockOut: Date): number[] {
  const a = Number(watDate(clockIn).slice(0, 4));
  const b = Number(watDate(new Date(clockOut.getTime() - 60_000)).slice(0, 4));
  const out: number[] = [];
  for (let y = a; y <= b; y++) out.push(y);
  return out;
}

/**
 * Approves a submitted entry. The approver gives the breaks that were taken (as clock times, "13:00-13:30"). The paid pieces are worked out and stored by day and class, with the state of the site and whether the
 * holiday list was confirmed, as they were now. If the entry is a correction, the entry it corrects becomes SUPERSEDED in the same step.
 */
export async function approveTimeEntry(ctx: Ctx, id: string, input: { breaks?: string }) {
  return db.$transaction(async (tx) => {
    await assertHourlyPayOn(ctx, tx);
    const e = await loadEntry(ctx, tx, id);
    assertDecidable(e.status, "approved");
    const beat = await loadBeat(ctx, tx, e.beatId);
    assertMayDecide(ctx, beat);
    if (e.capturedByUserId === ctx.userId) throw new BusinessError("You captured this entry: someone else has to approve it.");
    if (e.completedByUserId === ctx.userId) throw new BusinessError("You entered its clock-out: someone else has to approve it.");
    if (ctx.employeeId && ctx.employeeId === e.employeeId) throw new BusinessError("This is your own pay: someone else has to approve your hours.");
    if (!e.clockOut) throw new BusinessError("Enter the clock-out before approving.");
    await assertDatesEditable(ctx, tx, e.clockIn, e.clockOut);
    let original = null;
    if (e.correctsId) {
      original = await tx.timeEntry.findFirst({ where: { id: e.correctsId, organizationId: ctx.orgId } });
      if (!original || original.status !== "APPROVED") throw new BusinessError("The entry this one corrects is no longer approved, so it cannot be replaced.");
    }
    const breaks = parseBreakTimes(input.breaks ?? "", e.clockIn, e.clockOut);
    const years = yearsOf(e.clockIn, e.clockOut);
    const [holidays, confirmed] = await Promise.all([
      tx.publicHoliday.findMany({ where: { organizationId: ctx.orgId, date: { gte: d(`${years[0]}-01-01`), lte: d(`${years[years.length - 1]}-12-31`) } }, include: { states: { select: { state: true } } } }),
      tx.holidayCalendarYear.findMany({ where: { organizationId: ctx.orgId, year: { in: years } }, select: { year: true } }),
    ]);
    const placeState = normaliseState(beat.state);
    const dates = holidaysApplying(holidays.map((h) => ({ date: iso(h.date), states: h.states.map((s) => s.state) })), placeState);
    const segments = payableSegments(e.clockIn, e.clockOut, breaks, dates);
    const payable = segments.reduce((a, s) => a + s.minutes, 0);
    const breakMinutes = (e.clockOut.getTime() - e.clockIn.getTime()) / 60_000 - payable;
    if (breaks.length) await tx.timeEntryBreak.createMany({ data: breaks.map((b) => ({ entryId: id, startsAt: b.start, endsAt: b.end })) });
    await tx.timeEntrySegment.createMany({ data: segments.map((s) => ({ organizationId: ctx.orgId, entryId: id, date: d(s.date), dayClass: s.dayClass, minutes: s.minutes })) });
    const row = await tx.timeEntry.update({
      where: { id },
      data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), placeState, calendarConfirmed: confirmed.length === years.length, payableMinutes: payable },
    });
    if (original) await tx.timeEntry.update({ where: { id: original.id }, data: { status: "SUPERSEDED" } });
    await logAudit(ctx, { action: "TIME_ENTRY_APPROVED", entity: "TimeEntry", entityId: id, newValue: { employeeId: e.employeeId, beatId: e.beatId, payableMinutes: payable, breakMinutes, supersedes: original?.id ?? null } }, tx);
    return row;
  });
}

export async function rejectTimeEntry(ctx: Ctx, id: string, note: string) {
  if ((note ?? "").trim().length < 3) throw new BusinessError("Give a reason for rejecting it.");
  return db.$transaction(async (tx) => {
    await assertHourlyPayOn(ctx, tx);
    const e = await loadEntry(ctx, tx, id);
    assertDecidable(e.status, "rejected");
    assertMayDecide(ctx, await loadBeat(ctx, tx, e.beatId));
    const row = await tx.timeEntry.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() } });
    await logAudit(ctx, { action: "TIME_ENTRY_REJECTED", entity: "TimeEntry", entityId: id, newValue: { employeeId: e.employeeId, beatId: e.beatId } }, tx);
    return row;
  });
}

/** The person who captured an entry may withdraw it while it is a draft or waiting for approval. An approved entry is corrected, never withdrawn. */
export async function withdrawTimeEntry(ctx: Ctx, id: string) {
  return db.$transaction(async (tx) => {
    await assertHourlyPayOn(ctx, tx);
    const e = await loadEntry(ctx, tx, id);
    assertMayCapture(ctx, await loadBeat(ctx, tx, e.beatId));
    if (e.capturedByUserId !== ctx.userId) throw new BusinessError("You can withdraw only your own entries.");
    if (e.status === "APPROVED") throw new BusinessError("An approved time entry cannot be withdrawn: correct it with a new entry.");
    if (e.status !== "DRAFT" && e.status !== "SUBMITTED") throw new BusinessError(`This time entry is already ${e.status.toLowerCase()}.`);
    const row = await tx.timeEntry.update({ where: { id }, data: { status: "WITHDRAWN", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date() } });
    await logAudit(ctx, { action: "TIME_ENTRY_WITHDRAWN", entity: "TimeEntry", entityId: id, newValue: { employeeId: e.employeeId, beatId: e.beatId } }, tx);
    return row;
  });
}

/**
 * Starts a correction of an APPROVED entry (the founder's H16): a new draft that replaces it once approved by someone other than whoever captured it. The original stays approved and payable until then. It is refused
 * inside an approved or locked pay period (a supplementary payroll handles that), and may overlap the entry it replaces but no other.
 */
export async function correctTimeEntry(ctx: Ctx, id: string, raw: { clockIn: string; clockOut: string; beatId?: string; reason: string }) {
  const reason = (raw.reason ?? "").trim();
  if (reason.length < 3) throw new BusinessError("Give the reason for the correction.");
  if (!raw.clockOut || !raw.clockOut.trim()) throw new BusinessError("A correction needs both the clock-in and the clock-out.");
  const { cin, cout } = times(raw.clockIn, raw.clockOut);
  return db.$transaction(async (tx) => {
    await assertHourlyPayOn(ctx, tx);
    const orig = await loadEntry(ctx, tx, id);
    if (orig.status !== "APPROVED") throw new BusinessError(`Only an approved time entry can be corrected (this one is ${orig.status.toLowerCase()}).`);
    if (await tx.timeEntry.findFirst({ where: { organizationId: ctx.orgId, correctsId: id, status: { in: ["DRAFT", "SUBMITTED"] } }, select: { id: true } })) throw new BusinessError("There is already a correction waiting for this entry.");
    const beat = await loadBeat(ctx, tx, raw.beatId || orig.beatId);
    assertMayCapture(ctx, beat);
    await assertDatesEditable(ctx, tx, orig.clockIn, orig.clockOut);
    const row = await createEntry(ctx, tx, { employeeId: orig.employeeId, beat, cin, cout, correctsId: id, reason, except: [id] });
    await logAudit(ctx, { action: "TIME_ENTRY_CORRECTION_STARTED", entity: "TimeEntry", entityId: row.id, newValue: { correctsId: id, employeeId: orig.employeeId, beatId: beat.id, clockIn: stamp(cin), clockOut: stamp(cout) } }, tx);
    return row;
  });
}

/** Entries for the list: the company's, newest first; a supervisor sees only the sites they supervise. */
export async function listTimeEntries(ctx: Ctx, f: { status?: string; employeeId?: string }) {
  assertCan(ctx, "operations.view");
  await assertHourlyPayOn(ctx);
  const entries = await db.timeEntry.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(ctx.role === "SUPERVISOR" ? { beat: { supervisorId: ctx.userId } } : {}),
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
    },
    include: { employee: { select: { employeeNumber: true, firstName: true, lastName: true } }, beat: { select: { name: true } }, segments: { select: { minutes: true } } },
    orderBy: [{ clockIn: "desc" }],
    take: 300,
  });
  return { entries };
}

/** What the pay run will need (phase 4): the paid pieces of APPROVED entries in a date range, never a draft, submitted, rejected or superseded entry. */
export async function loadApprovedSegments(tx: Tx, orgId: string, from: Date, to: Date) {
  const rows = await tx.timeEntrySegment.findMany({
    where: { organizationId: orgId, date: { gte: from, lte: to }, entry: { status: "APPROVED" } },
    include: { entry: { select: { employeeId: true, beatId: true, contractId: true, clientId: true } } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({ segmentId: r.id, entryId: r.entryId, employeeId: r.entry.employeeId, beatId: r.entry.beatId, contractId: r.entry.contractId, clientId: r.entry.clientId, date: iso(r.date), dayClass: r.dayClass, minutes: r.minutes }));
}
