/**
 * Pure rules for career and succession: the life of a promotion proposal, the warnings shown on one, whole months in a role, and the succession readiness levels.
 * No database and no clock here (dates are plain "YYYY-MM-DD" days), so every rule is tested exactly.
 *
 * A promotion proposal is a record of a decision, never a change: approving it alters no category, pay or payroll figure. The warnings are guidance (they ask the
 * decider for a reason); none of them blocks a proposal.
 */

export const PROMOTION_STATUSES = ["PROPOSED", "APPROVED", "DECLINED", "WITHDRAWN", "APPLIED"] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];
export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  PROPOSED: "Proposed",
  APPROVED: "Approved, not yet applied",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  APPLIED: "Applied",
};

export type PromotionAction = "APPROVE" | "DECLINE" | "WITHDRAW" | "APPLY";

/** The status after an action, or null when the action is not allowed from that status. Declined, withdrawn and applied are final. */
export function promotionStatusAfter(from: PromotionStatus, action: PromotionAction): PromotionStatus | null {
  if (from === "PROPOSED") return action === "APPROVE" ? "APPROVED" : action === "DECLINE" ? "DECLINED" : action === "WITHDRAW" ? "WITHDRAWN" : null;
  if (from === "APPROVED") return action === "APPLY" ? "APPLIED" : action === "WITHDRAW" ? "WITHDRAWN" : null;
  return null;
}

/** The person who proposed a promotion never decides it. */
export function proposerConflict(userId: string, proposerUserId: string): string | null {
  return userId === proposerUserId ? "You proposed this, so someone else decides." : null;
}

const parts = (day: string) => {
  const [y, m, dd] = day.split("-").map(Number);
  return { y, m, dd };
};

/** Completed calendar months from one day to another (never negative). */
export function monthsBetween(fromDay: string, toDay: string): number {
  const a = parts(fromDay);
  const b = parts(toDay);
  let n = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.dd < a.dd) {
    // a start on the 31st completes its month on the last day of a shorter month
    const lastOfMonth = new Date(Date.UTC(b.y, b.m, 0)).getUTCDate();
    if (!(b.dd === lastOfMonth && a.dd > lastOfMonth)) n -= 1;
  }
  return Math.max(0, n);
}

const DAY = 86_400_000;
export const daysBetween = (fromDay: string, toDay: string) => Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY);

/** Approved but not yet applied for at least the company's number of days (0 = never flagged). */
export function applyOverdue(approvedDay: string, today: string, days: number): boolean {
  return days > 0 && daysBetween(approvedDay, today) >= days;
}

export type PromotionWarning = "NO_PATH" | "BELOW_MIN_SERVICE" | "COURSE_NOT_VALID" | "OPEN_PLAN" | "OPEN_DISCIPLINE";
export const PROMOTION_WARNING_LABELS: Record<PromotionWarning, string> = {
  NO_PATH: "The company has set no career path for this move",
  BELOW_MIN_SERVICE: "Less time in the current role than the career path asks for",
  COURSE_NOT_VALID: "A course the career path asks for is missing or expired",
  OPEN_PLAN: "An improvement plan is open",
  OPEN_DISCIPLINE: "A disciplinary case is open",
};

export interface WarningInput {
  pathExists: boolean;
  minMonths: number | null;
  monthsInRole: number;
  courseRequired: string | null;
  /** Whether the employee holds a valid certificate for the required course (null when no course is required). */
  courseValid: boolean | null;
  openPlan: boolean;
  openDiscipline: boolean;
}

/** Guidance for the decider, in a fixed order. Never a block: with any warning the decider simply must give a reason to approve. */
export function proposalWarnings(i: WarningInput): PromotionWarning[] {
  const w: PromotionWarning[] = [];
  if (!i.pathExists) w.push("NO_PATH");
  if (i.pathExists && i.minMonths !== null && i.monthsInRole < i.minMonths) w.push("BELOW_MIN_SERVICE");
  if (i.pathExists && i.courseRequired && i.courseValid === false) w.push("COURSE_NOT_VALID");
  if (i.openPlan) w.push("OPEN_PLAN");
  if (i.openDiscipline) w.push("OPEN_DISCIPLINE");
  return w;
}

export const MAX_SUCCESSORS = 5;
export const READINESS_LEVELS = ["READY_NOW", "READY_1_2_YEARS", "READY_3_PLUS"] as const;
export type Readiness = (typeof READINESS_LEVELS)[number];
export const READINESS_LABELS: Record<Readiness, string> = { READY_NOW: "Ready now", READY_1_2_YEARS: "Ready in 1 to 2 years", READY_3_PLUS: "Ready in 3 or more years" };

/** A critical role has cover only when at least one successor is ready now. */
export const readyNow = (candidates: Array<{ readiness: string }>) => candidates.some((c) => c.readiness === "READY_NOW");
