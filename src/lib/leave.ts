/**
 * Annual-leave rules (pure, framework-free, unit-testable).
 *
 *  • An employee earns `annualDays` working days of leave for each leave year.
 *  • The first entitlement falls due once `eligibilityMonths` of service are complete; every
 *    12 months after that a fresh entitlement falls due (the leave year runs anniversary to
 *    anniversary). Leave must start within the leave year it is charged to.
 *  • "Working days" follow the organization's work week: 5 = Mon–Fri, 6 = Mon–Sat, 7 = all days.
 */
import { addDays, eachDay } from "./dates";

/** Adds whole months in UTC, clamping to the last day of the target month (31 Jan + 1m = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay)));
}

export interface LeaveCycle {
  /** 1 = first entitlement. */
  number: number;
  /** Date this entitlement fell due — the first day leave can be applied for. */
  start: Date;
  /** Last day of the leave year (day before the next entitlement falls due). */
  end: Date;
}

export interface LeaveEligibility {
  /** The entitlement in force today, or null when none is due yet. */
  cycle: LeaveCycle | null;
  /** When the next entitlement falls due (the first one, when nothing is due yet). */
  nextDueDate: Date;
}

/** The leave year in force on `today`, plus when the next entitlement falls due. */
export function leaveEligibility(
  employmentDate: Date,
  today: Date,
  eligibilityMonths: number,
): LeaveEligibility {
  const firstDue = addMonths(employmentDate, eligibilityMonths);
  if (today < firstDue) return { cycle: null, nextDueDate: firstDue };
  let n = 1;
  let start = firstDue;
  for (;;) {
    const next = addMonths(firstDue, 12 * n);
    if (today < next) return { cycle: { number: n, start, end: addDays(next, -1) }, nextDueDate: next };
    n++;
    start = next;
  }
}

const isWorkingDay = (date: Date, workingDaysPerWeek: number) => {
  const dow = date.getUTCDay(); // 0 = Sunday … 6 = Saturday
  if (workingDaysPerWeek >= 7) return true;
  if (workingDaysPerWeek === 6) return dow !== 0;
  return dow !== 0 && dow !== 6;
};

/** Working days between two dates, inclusive. */
export function workingDatesBetween(from: Date, to: Date, workingDaysPerWeek: number): Date[] {
  if (to < from) return [];
  return eachDay(from, to).filter((x) => isWorkingDay(x, workingDaysPerWeek));
}

export const countWorkingDays = (from: Date, to: Date, workingDaysPerWeek: number) =>
  workingDatesBetween(from, to, workingDaysPerWeek).length;
