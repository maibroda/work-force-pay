/**
 * Hourly pay, phase 1 (docs/plans/hourly-payroll-assessment.md): the arithmetic for paying a person by the hour. Pure: no database, no framework, and nothing here is wired into the pay run yet.
 *
 * Three steps, each a function:
 *   1. `splitShift`  cuts a shift (a clock-in and a clock-out) at every midnight, West Africa Time, into pieces that each lie inside ONE calendar day, and gives each piece the day's class.
 *      A Friday 19:00 to Saturday 07:00 shift is 5 hours of Friday and 7 hours of Saturday, never 12 hours of either (the founder's rule H2, 2026-11-19).
 *   2. `classifyDay` says whether a day is a weekday (Monday to Friday), a weekend day (Saturday or Sunday) or a public holiday. A public holiday wins over a weekend (the founder's rule H3).
 *   3. `priceHours`  multiplies the minutes of each class by that class's hourly rate, in whole kobo: the minutes of a class are added up FIRST and the amount is rounded half up to the kobo ONCE,
 *      on that class line (the shared rule of money-exact.ts), so a class never gains or loses a kobo to the number of pieces it was cut into.
 *
 * What is NOT here, on purpose (decisions the founder has not made, docs/plans/hourly-payroll-assessment.md section 7): overtime, night differential, minimum hours, breaks, which rate applies to
 * whom (the rates are passed in), which holidays apply to a place (the caller passes the dates that apply: the holiday set is already filtered by the work location), and any limit on how long a shift can be.
 *
 * Time zone: Nigeria is on West Africa Time, UTC+1 all year, with no daylight saving, so a fixed one-hour offset is exact. Hours are counted in WHOLE MINUTES: a time with seconds is refused, never rounded.
 */
import { MoneyError, koboFromNaira, koboToNumber, mulDiv, sumKobo, type Kobo } from "../money-exact";

export type DayClass = "WEEKDAY" | "WEEKEND" | "HOLIDAY";

/** One piece of a shift: inside a single West Africa Time calendar day. */
export interface ShiftSegment {
  /** The West Africa Time calendar day (YYYY-MM-DD) the piece lies in. */
  date: string;
  dayClass: DayClass;
  /** Whole minutes, at least 1 and at most 1,440. */
  minutes: number;
  from: Date;
  to: Date;
}

/** The hourly rates, in naira, for the three classes of day. Each may have at most two decimal places (whole kobo). */
export interface HourlyRates {
  weekday: number;
  weekend: number;
  holiday: number;
}

export interface PricedLine {
  dayClass: DayClass;
  minutes: number;
  /** The hourly rate used, in naira. Stored with the line so a later rate change can never alter it. */
  rate: number;
  /** The pay for the class's minutes, in naira, rounded half up to the kobo once. */
  amount: number;
}

export interface PricedHours {
  /** In the order weekday, weekend, holiday; a class with no minutes has no line. */
  lines: PricedLine[];
  totalMinutes: number;
  /** Exactly the sum of the lines. */
  totalAmount: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** West Africa Time is one hour ahead of UTC, all year. */
const WAT_OFFSET_MS = 3_600_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ORDER: readonly DayClass[] = ["WEEKDAY", "WEEKEND", "HOLIDAY"];

function validInstant(value: Date, what: string): number {
  const ms = value instanceof Date ? value.getTime() : Number.NaN;
  if (!Number.isFinite(ms)) throw new MoneyError(`${what} is not a valid date and time.`);
  return ms;
}

/** The West Africa Time calendar day (YYYY-MM-DD) of an instant. 23:00 UTC is already the next day in Nigeria. */
export function watDate(instant: Date): string {
  const ms = validInstant(instant, "The time");
  return new Date(ms + WAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The weekday number (0 Sunday to 6 Saturday) of a calendar day, refusing a text that is not a real date. */
function dayOfWeek(isoDay: string): number {
  const m = ISO_DAY.exec(isoDay);
  if (!m) throw new MoneyError(`"${isoDay}" is not a date (YYYY-MM-DD).`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) throw new MoneyError(`"${isoDay}" is not a real calendar date.`);
  return at.getUTCDay();
}

/** A calendar day's class. A public holiday is a holiday even on a Saturday or a Sunday (the holiday rate wins over the weekend rate). */
export function classifyDay(isoDay: string, holidays: ReadonlySet<string>): DayClass {
  const weekday = dayOfWeek(isoDay);
  if (holidays.has(isoDay)) return "HOLIDAY";
  return weekday === 0 || weekday === 6 ? "WEEKEND" : "WEEKDAY";
}

/**
 * Cuts a shift at every West Africa Time midnight. The pieces join end to end, each lies in one day, and their minutes add up to the whole shift.
 * `holidays` are the ISO dates of the public holidays that apply at the place of work (the caller decides which; this function does not know about states).
 */
export function splitShift(clockIn: Date, clockOut: Date, holidays: ReadonlySet<string>): ShiftSegment[] {
  const start = validInstant(clockIn, "The clock-in time");
  const end = validInstant(clockOut, "The clock-out time");
  if (start % MINUTE_MS !== 0 || end % MINUTE_MS !== 0) throw new MoneyError("A clock-in and a clock-out time must be on a whole minute.");
  if (end <= start) throw new MoneyError("A shift must end after it starts.");
  const segments: ShiftSegment[] = [];
  let cursor = start;
  while (cursor < end) {
    // the next midnight in Nigeria after the cursor, as an instant
    const nextMidnight = (Math.floor((cursor + WAT_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - WAT_OFFSET_MS;
    const stop = Math.min(nextMidnight, end);
    const date = watDate(new Date(cursor));
    segments.push({ date, dayClass: classifyDay(date, holidays), minutes: (stop - cursor) / MINUTE_MS, from: new Date(cursor), to: new Date(stop) });
    cursor = stop;
  }
  return segments;
}

/** The pieces whose day lies in a pay period, both ends included. A shift over a month end belongs half to each month. */
export function segmentsInPeriod(segments: readonly ShiftSegment[], fromDay: string, toDay: string): ShiftSegment[] {
  dayOfWeek(fromDay);
  dayOfWeek(toDay);
  return segments.filter((s) => s.date >= fromDay && s.date <= toDay);
}

function rateInKobo(rate: number, what: string): Kobo {
  const kobo = koboFromNaira(rate, `The ${what} hourly rate`);
  if (kobo < 0) throw new MoneyError(`The ${what} hourly rate cannot be negative.`);
  return kobo;
}

/**
 * The pay for a person's pieces of shifts: per class, the minutes added up, times the rate, divided by 60, rounded half up to the kobo once. All three rates are always checked, so a bad
 * rate is refused here and not discovered later. A rate that is MISSING (not entered) must be refused by whoever finds the rate: zero here means a class that is deliberately unpaid.
 */
export function priceHours(segments: readonly ShiftSegment[], rates: HourlyRates): PricedHours {
  const rateKobo: Record<DayClass, Kobo> = {
    WEEKDAY: rateInKobo(rates.weekday, "weekday"),
    WEEKEND: rateInKobo(rates.weekend, "weekend"),
    HOLIDAY: rateInKobo(rates.holiday, "public holiday"),
  };
  const minutes: Record<DayClass, number> = { WEEKDAY: 0, WEEKEND: 0, HOLIDAY: 0 };
  for (const s of segments) {
    if (!Number.isInteger(s.minutes) || s.minutes < 1) throw new MoneyError("A piece of a shift must be a whole number of minutes, at least one.");
    minutes[s.dayClass] += s.minutes;
  }
  const lines: PricedLine[] = [];
  const amounts: Kobo[] = [];
  for (const dayClass of ORDER) {
    if (minutes[dayClass] === 0) continue;
    const amount = mulDiv(rateKobo[dayClass], minutes[dayClass], 60);
    amounts.push(amount);
    lines.push({ dayClass, minutes: minutes[dayClass], rate: koboToNumber(rateKobo[dayClass]), amount: koboToNumber(amount) });
  }
  return { lines, totalMinutes: lines.reduce((a, l) => a + l.minutes, 0), totalAmount: koboToNumber(sumKobo(amounts)) };
}
