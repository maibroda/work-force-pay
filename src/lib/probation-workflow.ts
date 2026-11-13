/**
 * Pure rules for the probation workflow (docs/plans/probation-workflow-plan.md): the reporting manager recommends, HR reviews against the policy, an independent
 * designated decider decides, the employee receives documented feedback and may respond once. No database and no clock: dates are plain "YYYY-MM-DD" days.
 *
 * Nothing here decides anything. The contract still changes only through `decideProbation`'s logic (src/server/services/contracts.ts); these rules say who may take each
 * step, how much has to be written, and when.
 */
import { daysBetween } from "@/lib/career";
import type { ProbationDecisionKind } from "@/lib/probation";

export const RECOMMENDATIONS = ["CONFIRM", "EXTEND", "NOT_CONFIRM"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const RECOMMENDATION_LABELS: Record<Recommendation, string> = { CONFIRM: "Confirm", EXTEND: "Extend", NOT_CONFIRM: "Do not confirm" };

/** What each recommendation would become if the decider agrees: the decision that already exists. */
export const toDecision = (r: Recommendation): ProbationDecisionKind => (r === "CONFIRM" ? "CONFIRMED" : r === "EXTEND" ? "EXTENDED" : "FAILED");

export const NOTE_MIN = 20;
export const FEEDBACK_MIN = 10;
export const FEEDBACK_MAX = 1000;
export const RESPONSE_MAX = 1000;
export const DISAGREE_MIN = 5;

/** The manager's reason: at least 20 characters once spaces at either end are ignored. */
export function checkRecommendationNote(note: string | null | undefined): string | null {
  return (note ?? "").trim().length >= NOTE_MIN ? null : `Give your reasons for this recommendation (at least ${NOTE_MIN} characters).`;
}

/** A manager may recommend from `alertDays` before the probation ends, and at any time after it ends until it is decided. */
export function recommendationWindowOpen(end: string, today: string, alertDays: number): boolean {
  return daysBetween(today, end) <= Math.max(0, alertDays);
}

/** The HR reviewer is not the person who recorded the recommendation. */
export function reviewerConflict(userId: string, recommenderUserId: string): string | null {
  return userId === recommenderUserId ? "You recorded this recommendation, so a different HR person reviews it." : null;
}

export interface DecisionParties {
  recommenderUserId: string;
  reviewerUserId: string | null;
  /** The employee the probation is about. */
  employeeId: string;
  /** The employee record linked to the would-be decider's login, if any. */
  deciderEmployeeId: string | null;
  /** The probation appraisal's reviewer and signer, when there is one. */
  appraisal: { reviewerUserId: string | null; approvedByUserId: string | null } | null;
}

/**
 * The final decider is independent: never the person who recommended, the HR reviewer, the reviewer or signer of the probation appraisal, or the employee themselves.
 * Returns why not, or null.
 */
export function deciderConflict(userId: string, p: DecisionParties): string | null {
  if (userId === p.recommenderUserId) return "You made the recommendation, so someone else decides.";
  if (p.reviewerUserId && userId === p.reviewerUserId) return "You reviewed this recommendation for HR, so someone else decides.";
  if (p.appraisal?.reviewerUserId === userId) return "You reviewed this probation appraisal: someone else has to make the decision.";
  if (p.appraisal?.approvedByUserId === userId) return "You signed off this probation appraisal: someone else has to make the decision.";
  if (p.deciderEmployeeId && p.deciderEmployeeId === p.employeeId) return "You cannot decide your own probation.";
  return null;
}

/** A decision departs from the review when it is not the one the manager recommended. */
export function departsFromReview(decision: ProbationDecisionKind, recommendation: Recommendation): boolean {
  return toDecision(recommendation) !== decision;
}

/** The statement the employee receives: required (at least 10 characters) when probation is extended or not confirmed, optional when it is confirmed; at most 1,000. */
export function checkFeedback(decision: ProbationDecisionKind, text: string | null | undefined): string | null {
  const n = (text ?? "").trim().length;
  if (n > FEEDBACK_MAX) return `Keep the feedback to at most ${FEEDBACK_MAX} characters.`;
  if (decision !== "CONFIRMED" && n < FEEDBACK_MIN) return `Write the feedback the employee will receive (at least ${FEEDBACK_MIN} characters).`;
  return null;
}

/** The employee's one response: agree or disagree; disagreeing needs a sentence; at most 1,000 characters. */
export function checkResponse(agree: boolean, comment: string | null | undefined): string | null {
  const n = (comment ?? "").trim().length;
  if (n > RESPONSE_MAX) return `Keep your response to at most ${RESPONSE_MAX} characters.`;
  if (!agree && n < DISAGREE_MIN) return "If you disagree, say why (at least a sentence).";
  return null;
}

/** The employee may respond for `days` days after HR told them (that day counts); 0 means no time limit. */
export function responseOpen(informedDay: string, today: string, days: number): boolean {
  return days === 0 || daysBetween(informedDay, today) <= days;
}
