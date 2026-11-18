/**
 * Failed-probation reconsideration (the founder's approval of 2026-11-17, F1 to F4 as recommended; docs/plans/failed-probation-renewal-proposal.md). A probation that failed stays RECORDED as
 * failed (the history is never edited); a separately approved reconsideration may extend it with conditions, never automatically. Pure rules: no database and no clock. Dates are plain
 * "YYYY-MM-DD" days.
 *
 * Nothing here touches pay. Nothing here decides anything: it says who may take each step, how much has to be written, and when.
 */
import { daysBetween } from "./career";
import { addMonths } from "./leave";

export const RECONSIDERATION_STATUSES = ["REQUESTED", "RETURNED", "FORWARDED", "APPROVED", "DECLINED", "EFFECTIVE", "WITHDRAWN"] as const;
export type ReconsiderationStatus = (typeof RECONSIDERATION_STATUSES)[number];
export const RECONSIDERATION_STATUS_LABELS: Record<ReconsiderationStatus, string> = {
  REQUESTED: "Waiting for HR's review",
  RETURNED: "Returned to the supervisor",
  FORWARDED: "Waiting for the decision",
  APPROVED: "Approved: the employee must be told",
  DECLINED: "Declined",
  EFFECTIVE: "In effect",
  WITHDRAWN: "Withdrawn",
};

/** The wording of the employee's statement has NOT yet been reviewed by a lawyer (F5 of the proposal). The screens say so while this is false. */
export const STATEMENT_WORDING_REVIEWED = false;

/** Still in progress: asked, forwarded or approved but not yet told to the employee. */
export const isOpenStatus = (s: ReconsiderationStatus) => s === "REQUESTED" || s === "FORWARDED" || s === "APPROVED";

/** What counts against the limit per contract: everything except one sent back for more work or one withdrawn. A second failure after a reconsideration is final. */
export const countsTowardLimit = (s: ReconsiderationStatus) => s !== "RETURNED" && s !== "WITHDRAWN";

/** A reconsideration can be asked for on the day of the failed decision and for the company's number of days after it, never later. */
export function windowOpen(failedDay: string, today: string, windowDays: number): boolean {
  return daysBetween(failedDay, today) <= Math.max(0, windowDays);
}

/** The total probation (what it already is plus the extension) may not exceed the company's ceiling, and an extension is a whole number of months, at least one. */
export function ceilingProblem(currentMonths: number, addMonthsBy: number, ceiling: number): string | null {
  if (!Number.isInteger(addMonthsBy)) return "The extension must be a whole number of months.";
  if (addMonthsBy < 1) return "The extension must be at least one month.";
  const total = currentMonths + addMonthsBy;
  return total > ceiling ? `Probation would reach ${total} month(s); the company's ceiling for a reconsidered probation is ${ceiling}.` : null;
}

const parse = (day: string) => new Date(`${day}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** The revised probation end date: the extension counted from the day it takes effect, ending the day before the same date `months` later (as an extension already is). */
export function extensionEnd(effectiveDay: string, months: number): string {
  return fmt(new Date(addMonths(parse(effectiveDay), months).getTime() - 86_400_000));
}

/** The supervisor's justification: at least the company's number of characters once spaces at either end are ignored. */
export function checkJustification(text: string | null | undefined, min: number): string | null {
  return (text ?? "").trim().length >= min ? null : `Give the justification in your own words (at least ${min} characters).`;
}

export interface ExpectationInput {
  measure: string;
  target: string;
  reviewOn: string;
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** At least the company's number of measurable expectations; each has what is measured, the target and a review date that is a real day and not in the past. */
export function checkExpectations(list: readonly ExpectationInput[], min: number, today: string): string | null {
  if (list.length < Math.max(1, min)) return `Give at least ${Math.max(1, min)} measurable expectation(s), each with what is measured, the target and the date it is reviewed.`;
  for (const e of list) {
    if ((e.measure ?? "").trim().length < 3) return "Say what is measured for each expectation.";
    if ((e.target ?? "").trim().length < 3) return "Give a target for each expectation.";
    if (!DAY.test(e.reviewOn ?? "") || Number.isNaN(parse(e.reviewOn).getTime())) return "Give a review date for each expectation (year-month-day).";
    if (e.reviewOn < today) return "An expectation's review date can't be in the past.";
  }
  return null;
}

const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const long = (day: string) => LONG.format(parse(day));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The written statement the employee is given (step 5). FACTS ONLY: the earlier decision, the extension and the revised review date, the conditions with their review dates, and the right to
 * respond once. It says nothing about pay. The wording has not been reviewed by a lawyer (STATEMENT_WORDING_REVIEWED).
 */
export function statementFor(p: { failedOn: string; months: number; newEnd: string; expectations: readonly ExpectationInput[] }): string {
  const lines = [
    `Your probation was recorded as not confirmed on ${long(p.failedOn)}.`,
    `After that decision was reconsidered, your probation has been extended by ${plural(p.months, "month", "months")}. The new date on which it will be reviewed is ${long(p.newEnd)}.`,
    "During the extension you are expected to meet the following:",
    ...p.expectations.map((e, i) => `${i + 1}. ${e.measure.trim()}: ${e.target.trim()} (reviewed on ${long(e.reviewOn)}).`),
    "You may respond once in writing, saying whether you agree and, if you wish, why.",
  ];
  return lines.join("\n");
}
