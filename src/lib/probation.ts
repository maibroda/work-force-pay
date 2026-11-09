/**
 * Pure rules for the probation review decision: when a decision goes against the appraisal's recommendation, how much reason that needs, who may decide, when an
 * undecided probation is escalated, and the line the employee sees. No database and no clock here (dates are plain "YYYY-MM-DD" days).
 *
 * The decision itself (confirm, extend, fail) is made by HR in `decideProbation` (src/server/services/contracts.ts). Nothing here decides anything: a recommendation
 * never makes a decision for anyone, and a decision against one is allowed, with a fuller reason, and marked.
 */
import { d, fmtDate } from "@/lib/dates";

export type ProbationDecisionKind = "CONFIRMED" | "EXTENDED" | "FAILED";

/** How many characters the reason needs when a decision goes against the appraisal's recommendation. */
export const AGAINST_REASON_MIN = 20;

// What each recommendation means for a probation (an assumption for the founder to confirm: docs/plans/probation-review-plan.md, question 2).
const POSITIVE = ["CONFIRM_EMPLOYMENT", "INCREMENT", "PROMOTION"];
const NEEDS_WORK = ["PERFORMANCE_PLAN", "TRAINING"];

/** Whether a decision goes against what the probation appraisal recommended. No recommendation (or none on file) never does. */
export function departsFromRecommendation(decision: ProbationDecisionKind, recommendation: string | null | undefined): boolean {
  if (!recommendation) return false;
  if (decision === "CONFIRMED") return NEEDS_WORK.includes(recommendation);
  if (decision === "FAILED") return POSITIVE.includes(recommendation);
  return recommendation === "CONFIRM_EMPLOYMENT"; // extending when confirmation was recommended
}

export function checkAgainstReason(note: string | null | undefined): string | null {
  return (note ?? "").trim().length >= AGAINST_REASON_MIN ? null : `This decision goes against the probation appraisal's recommendation: give a fuller reason (at least ${AGAINST_REASON_MIN} characters).`;
}

/** The person who rated or signed off the probation appraisal does not also decide on it. Returns why not, or null. */
export function decisionConflict(userId: string, appraisal: { reviewerUserId: string | null; approvedByUserId: string | null } | null): string | null {
  if (!appraisal) return null;
  if (appraisal.reviewerUserId === userId) return "You reviewed this probation appraisal: someone else has to make the decision.";
  if (appraisal.approvedByUserId === userId) return "You signed off this probation appraisal: someone else has to make the decision.";
  return null;
}

/** Whole days past the probation's end date (0 on or before it). */
export function daysOverdue(end: string, today: string): number {
  const n = Math.round((d(today).getTime() - d(end).getTime()) / 86_400_000);
  return n > 0 ? n : 0;
}

/** Escalated once overdue for the company's number of days; zero switches escalation off. */
export const escalated = (overdueDays: number, escalationDays: number) => escalationDays > 0 && overdueDays >= escalationDays;

/** The one line an employee sees about their probation decision, and only once HR has told them. Never the reasons. */
export function employeeLine(x: { decision: ProbationDecisionKind; informed: boolean; date: string | null }): string | null {
  if (!x.informed) return null;
  if (x.decision === "CONFIRMED") return `Probation confirmed${x.date ? `: permanent from ${fmtDate(d(x.date))}` : ""}.`;
  if (x.decision === "EXTENDED") return `Probation extended${x.date ? ` to ${fmtDate(d(x.date))}` : ""}.`;
  return "Probation not confirmed.";
}
