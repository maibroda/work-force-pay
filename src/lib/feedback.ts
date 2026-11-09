/**
 * Pure rules for continuous feedback: the two kinds, who may give feedback about whom, the length of the text, and which entries fall inside an appraisal period.
 * No database and no clock here (dates are plain "YYYY-MM-DD" days), so every rule is tested exactly.
 *
 * Feedback is a short, dated note about an employee. The employee always sees it (there are no private notes about a person's performance), it is never edited
 * (a mistake is voided with a reason), and it never changes pay, status, discipline or an appraisal score: it is only evidence a reviewer can read.
 */

export const FEEDBACK_KINDS = ["RECOGNITION", "COACHING"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = { RECOGNITION: "Recognition", COACHING: "Coaching" };

export const FEEDBACK_LIMITS = { minChars: 5, maxChars: 1000 } as const;

export function checkBody(text: string): string | null {
  const n = text.trim().length;
  if (n < FEEDBACK_LIMITS.minChars) return `Write at least ${FEEDBACK_LIMITS.minChars} characters.`;
  if (n > FEEDBACK_LIMITS.maxChars) return `Keep it to at most ${FEEDBACK_LIMITS.maxChars} characters.`;
  return null;
}

/** The date a piece of feedback relates to: today or earlier. */
export function checkRelatesOn(relatesOn: string, today: string): string | null {
  return relatesOn > today ? "Feedback can't be dated in the future." : null;
}

/** Both the first and the last day of a period count. */
export const inPeriod = (day: string, period: { from: string; to: string }) => day >= period.from && day <= period.to;

/**
 * Who may give feedback about an employee. Nobody about themselves. HR about anyone. Anyone else only about their own direct report (the person who names them
 * as their reporting manager); for everyone else the answer is only "not found", so a manager cannot find out who else works here.
 */
export function mayGiveFeedback(giver: { giverEmployeeId: string | null; isHr: boolean }, target: { employeeId: string; reportingManagerId: string | null }): null | "SELF" | "NOT_FOUND" {
  if (giver.giverEmployeeId && giver.giverEmployeeId === target.employeeId) return "SELF";
  if (giver.isHr) return null;
  return giver.giverEmployeeId && target.reportingManagerId === giver.giverEmployeeId ? null : "NOT_FOUND";
}
