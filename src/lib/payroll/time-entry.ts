/**
 * Hourly pay, phase 3 (docs/plans/hourly-payroll-assessment.md): the pure rules under a time entry, a clock-in and a clock-out. No database, no framework. Nothing in the pay run reads this yet (phase 4).
 *
 * The founder's answers of 2026-11-19: H5 approved unpaid breaks are deducted from the payable hours; H10 a missing clock-out is not payable (an entry with no clock-out is OPEN here and is never priced);
 * H2 each hour falls on the day it was worked (hourly.ts cuts at midnight).
 *
 * BREAKS ARE RECORDED AS THE TIMES THEY WERE TAKEN, not as a number of minutes. The founder's answer says the supervisor records the break minutes; but on a shift over midnight a number of minutes does not say
 * WHICH DAY (and so which class: weekday, weekend or holiday) the break comes off, and no rule for that was decided. Recording the times makes the deduction exact and needs no invented rule. This is my reading,
 * flagged to the founder as H18; the minutes are still shown (the sum of the breaks).
 *
 * All times are whole minutes in West Africa Time (UTC+1, no daylight saving), as in hourly.ts: a time with seconds is refused, never rounded.
 */
import { MoneyError } from "../money-exact";
import { splitShift, watDate, type ShiftSegment } from "./hourly";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WAT_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export interface Break {
  start: Date;
  end: Date;
}

/** A clock time typed as Nigerian wall-clock time, "YYYY-MM-DDTHH:mm", as the instant it is. Anything else (seconds, a time zone, a space, hour 24, an impossible date) is refused. */
export function parseWatLocal(text: string): Date {
  const m = WAT_LOCAL.exec((text ?? "").trim());
  if (!m) throw new MoneyError(`"${text}" is not a date and time (YYYY-MM-DDTHH:mm, Nigerian time).`);
  const [year, month, day, hour, minute] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) throw new MoneyError(`"${text}" is not a real calendar date.`);
  if (hour > 23 || minute > 59) throw new MoneyError(`"${text}" is not a real time of day.`);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 3_600_000);
}

function wholeMinute(value: Date, what: string): number {
  const ms = value instanceof Date ? value.getTime() : Number.NaN;
  if (!Number.isFinite(ms)) throw new MoneyError(`${what} is not a valid date and time.`);
  if (ms % MINUTE_MS !== 0) throw new MoneyError(`${what} must be on a whole minute.`);
  return ms;
}

/** The shift without its breaks: the intervals that are paid. Breaks must lie inside the shift, not overlap, and leave something to pay. */
export function workingIntervals(clockIn: Date, clockOut: Date, breaks: readonly Break[]): Array<{ from: Date; to: Date }> {
  const start = wholeMinute(clockIn, "The clock-in time");
  const end = wholeMinute(clockOut, "The clock-out time");
  if (end <= start) throw new MoneyError("A shift must end after it starts.");
  const sorted = [...breaks].map((b) => ({ s: wholeMinute(b.start, "A break start"), e: wholeMinute(b.end, "A break end") })).sort((a, b) => a.s - b.s);
  let cursor = start;
  const out: Array<{ from: Date; to: Date }> = [];
  for (const b of sorted) {
    if (b.e <= b.s) throw new MoneyError("A break must end after it starts.");
    if (b.s < start || b.e > end) throw new MoneyError("A break must lie inside the shift.");
    if (b.s < cursor) throw new MoneyError("Two breaks overlap.");
    if (b.s > cursor) out.push({ from: new Date(cursor), to: new Date(b.s) });
    cursor = b.e;
  }
  if (cursor < end) out.push({ from: new Date(cursor), to: new Date(end) });
  if (out.length === 0) throw new MoneyError("The breaks leave no time to pay.");
  return out;
}

/** The paid pieces of a shift, by day and class: each working interval cut at Nigerian midnight (hourly.ts). A piece of one day may appear twice when a break splits it; pricing adds them up by class. */
export function payableSegments(clockIn: Date, clockOut: Date, breaks: readonly Break[], holidays: ReadonlySet<string>): ShiftSegment[] {
  return workingIntervals(clockIn, clockOut, breaks).flatMap((i) => splitShift(i.from, i.to, holidays));
}

export interface Span {
  clockIn: Date;
  /** null: an entry with no clock-out yet (open). It is never paid, and only its clock-in is known. */
  clockOut: Date | null;
}

/**
 * Whether two entries for the same person share any time. Shifts that touch end to end do not overlap. An open entry (no clock-out) occupies only its clock-in moment: it conflicts when that moment is
 * inside another shift, and two open entries conflict when they start at the same moment.
 */
export function entriesOverlap(a: Span, b: Span): boolean {
  if (a.clockOut && b.clockOut) return a.clockIn.getTime() < b.clockOut.getTime() && b.clockIn.getTime() < a.clockOut.getTime();
  if (!a.clockOut && !b.clockOut) return a.clockIn.getTime() === b.clockIn.getTime();
  const [open, closed] = a.clockOut ? [b, a] : [a, b];
  return open.clockIn.getTime() >= closed.clockIn.getTime() && open.clockIn.getTime() < closed.clockOut!.getTime();
}

const BREAK = /^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/;

/**
 * Breaks typed as clock times ("13:00-13:30", several separated by commas, semicolons or new lines) placed inside the shift: the break starts the FIRST time the clock reads the start time during the shift,
 * and ends the first time the clock reads the end time after that. So on a Friday 19:00 to Saturday 07:00 shift, "23:45-00:15" is Friday 23:45 to Saturday 00:15 and "02:00-02:30" is Saturday.
 */
export function parseBreakTimes(text: string, clockIn: Date, clockOut: Date): Break[] {
  const start = wholeMinute(clockIn, "The clock-in time");
  const end = wholeMinute(clockOut, "The clock-out time");
  const parts = (text ?? "").split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  const wall = (day: string, h: number, m: number) => parseWatLocal(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  const firstAtOrAfter = (from: number, h: number, m: number, strictlyAfter: boolean): number => {
    let day = watDate(new Date(from));
    for (let i = 0; i < 4; i++) {
      const at = wall(day, h, m).getTime();
      if (strictlyAfter ? at > from : at >= from) return at;
      day = watDate(new Date(wall(day, 0, 0).getTime() + DAY_MS + 3_600_000));
    }
    throw new MoneyError("A break time could not be placed.");
  };
  return parts.map((p) => {
    const m = BREAK.exec(p);
    if (!m) throw new MoneyError(`"${p}" is not a break (write it as HH:MM-HH:MM, for example 13:00-13:30).`);
    const [sh, sm, eh, em] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (sh > 23 || sm > 59 || eh > 23 || em > 59) throw new MoneyError(`"${p}" is not a real time of day.`);
    if (sh === eh && sm === em) throw new MoneyError(`The break "${p}" starts and ends at the same time.`);
    const s = firstAtOrAfter(start, sh, sm, false);
    if (s >= end) throw new MoneyError(`The clock never reads ${m[1]}:${m[2]} during the shift, so the break "${p}" does not fall inside it.`);
    const e = firstAtOrAfter(s, eh, em, true);
    if (e > end) throw new MoneyError(`The break "${p}" runs past the end of the shift.`);
    return { start: new Date(s), end: new Date(e) };
  });
}
