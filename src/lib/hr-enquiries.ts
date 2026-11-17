/**
 * HR enquiries (slice 5A, approved by the founder on 2026-11-17: docs/plans/hr-phases-4-5-plan.md, section 6, rules E1 to E6 as recommended). An employee asks HR a question, HR replies in a
 * thread, and it is answered and closed. These are the pure rules: the categories (E1), what counts as a working day and the first-response target in working days (E4), and when an enquiry
 * is overdue. Dates are plain "YYYY-MM-DD" days; no clock and no database here. Nothing in here touches pay: a pay question is a question, never a change.
 */

/** E1: the kinds of question. */
export const ENQUIRY_CATEGORIES = ["PAY", "LEAVE", "LETTER", "POLICY", "BENEFITS", "OTHER"] as const;
export type EnquiryCategory = (typeof ENQUIRY_CATEGORIES)[number];
export const ENQUIRY_CATEGORY_LABELS: Record<EnquiryCategory, string> = {
  PAY: "A payslip or pay question",
  LEAVE: "Leave",
  LETTER: "A letter request",
  POLICY: "A policy question",
  BENEFITS: "Benefits",
  OTHER: "Something else",
};

export const ENQUIRY_STATUSES = ["OPEN", "ANSWERED", "CLOSED"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = { OPEN: "Waiting for HR", ANSWERED: "Answered", CLOSED: "Closed" };

/** E2: a question that is really one of these goes through the existing Employee relations process. HR can move an enquiry into a case of one of these kinds (never a disciplinary one). */
export const MOVABLE_CASE_TYPES = ["GRIEVANCE", "HARASSMENT", "WHISTLEBLOWING", "WELFARE"] as const;
export type MovableCaseType = (typeof MOVABLE_CASE_TYPES)[number];

/** E4: the founder's default first-response target, in working days. A company setting (HR policy), so this is only the starting value. */
export const DEFAULT_RESPONSE_DAYS = 3;

const MS = 86_400_000;
const parse = (day: string) => new Date(`${day}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const next = (day: string) => fmt(new Date(parse(day).getTime() + MS));

/** The calendar day in West Africa Time (a fixed UTC+1, no daylight saving) of a moment: the company's clock for "the day it was raised". */
export const watDay = (at: Date) => fmt(new Date(at.getTime() + 3_600_000));

/** Monday to Friday, and not a public holiday the company has entered. */
export function isEnquiryWorkingDay(day: string, holidays: ReadonlySet<string>): boolean {
  const dow = parse(day).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(day);
}

/** The day by which HR should have replied: `targetDays` working days AFTER the day it was raised (a Saturday or Sunday raising counts from the next working day). */
export function responseDueDay(raisedDay: string, targetDays: number, holidays: ReadonlySet<string>): string {
  let day = raisedDay;
  let left = Math.max(0, Math.trunc(targetDays));
  while (left > 0) {
    day = next(day);
    if (isEnquiryWorkingDay(day, holidays)) left--;
  }
  return day;
}

/** Overdue only once the due day has passed (the due day itself is still on time), and only while nobody from HR has replied and it is not closed. */
export function isFirstResponseOverdue(i: { status: EnquiryStatus; firstResponseAt: Date | null; raisedDay: string; today: string; targetDays: number; holidays: ReadonlySet<string> }): boolean {
  if (i.status === "CLOSED" || i.firstResponseAt) return false;
  return i.today > responseDueDay(i.raisedDay, i.targetDays, i.holidays);
}

/** Working days from the day after it was raised up to and including `today` (0 on the day itself, and for a day before it was raised). */
export function workingDaysWaiting(raisedDay: string, today: string, holidays: ReadonlySet<string>): number {
  let n = 0;
  for (let day = next(raisedDay); day <= today; day = next(day)) if (isEnquiryWorkingDay(day, holidays)) n++;
  return n;
}
