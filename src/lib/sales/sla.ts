/**
 * Service-level clocks, with no database: adding business minutes in Lagos time (West Africa Time, UTC+1, no daylight saving) around working days, opening hours and
 * holidays; the due and 75% warning times of a window; and where a clock stands. The service (src/server/services/sales/cases.ts) uses these and nothing else.
 */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WAT = HOUR;

export interface Calendar {
  /** Minutes after midnight, Lagos time: 480 is 08:00. */
  openMinute: number;
  closeMinute: number;
  /** ISO weekdays: 1 is Monday, 7 is Sunday. */
  workDays: number[];
  /** Lagos dates (YYYY-MM-DD) that are not working days. */
  holidays: string[];
}

/** Monday to Friday, 08:00 to 17:00, until an organization says otherwise. */
export const DEFAULT_CALENDAR: Calendar = { openMinute: 480, closeMinute: 1020, workDays: [1, 2, 3, 4, 5], holidays: [] };

const isWorkDay = (dayStartWat: number, cal: Calendar) => {
  const d = new Date(dayStartWat); // its UTC fields are the Lagos fields
  const iso = d.toISOString().slice(0, 10);
  const weekday = ((d.getUTCDay() + 6) % 7) + 1;
  return cal.workDays.includes(weekday) && !cal.holidays.includes(iso);
};

/** The moment `minutes` working minutes after `start`: the clock runs only between opening and closing on working days. A start outside those hours begins when business next opens. */
export function addBusinessMinutes(start: Date, minutes: number, cal: Calendar): Date {
  if (!cal.workDays.length) throw new Error("The calendar has no working day.");
  if (cal.closeMinute <= cal.openMinute) throw new Error("The closing time must be after the opening time.");
  let t = start.getTime() + WAT; // Lagos wall-clock time, as if it were UTC
  let remaining = minutes * MIN;
  for (let guard = 0; guard < 4000; guard++) {
    const dayStart = Math.floor(t / DAY) * DAY;
    if (isWorkDay(dayStart, cal)) {
      const open = dayStart + cal.openMinute * MIN;
      const close = dayStart + cal.closeMinute * MIN;
      const from = Math.max(t, open);
      if (from < close) {
        const available = close - from;
        if (remaining <= available) return new Date(from + remaining - WAT);
        remaining -= available;
      }
    }
    t = dayStart + DAY;
  }
  throw new Error("The window is too long to place on the calendar.");
}

/** When a window of `minutes` ends: around the clock, or in business hours. */
export function dueAt(start: Date, minutes: number, businessHoursOnly: boolean, cal: Calendar): Date {
  return businessHoursOnly ? addBusinessMinutes(start, minutes, cal) : new Date(start.getTime() + minutes * MIN);
}

/** When 75% of the window has gone, counted the same way as the window itself. */
export function warnAt(start: Date, minutes: number, businessHoursOnly: boolean, cal: Calendar): Date {
  return dueAt(start, Math.round(minutes * 0.75), businessHoursOnly, cal);
}

export type ClockState = "NONE" | "OK" | "WARNING" | "BREACHED" | "MET" | "LATE";

/** Where a clock stands: not running (no deadline), fine, 75% gone, passed, met in time, or met late. The deadline itself is not yet late. */
export function clockState(c: { dueAt: Date | null; warnAt: Date | null; doneAt: Date | null }, now: Date): ClockState {
  if (!c.dueAt) return "NONE";
  if (c.doneAt) return c.doneAt.getTime() <= c.dueAt.getTime() ? "MET" : "LATE";
  if (now.getTime() > c.dueAt.getTime()) return "BREACHED";
  if (c.warnAt && now.getTime() >= c.warnAt.getTime()) return "WARNING";
  return "OK";
}
