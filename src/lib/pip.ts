/**
 * Pure rules for performance improvement plans (PIPs): the fixed steps a plan moves through, who may approve a step, the limits on length and
 * extensions, and when a review is due. No database and no clock here (dates are plain "YYYY-MM-DD" days), so every rule is tested exactly.
 *
 * A PIP is about capability and results, not conduct: it is not a sanction and nothing here changes pay, status or discipline.
 * The limits are company settings (HrPolicy), passed in; the defaults below are only the starting values.
 */
import { addDays, d, iso } from "@/lib/dates";

export const PIP_STATUSES = ["DRAFT", "AWAITING_APPROVAL", "ACTIVE", "OUTCOME_PROPOSED", "CLOSED", "WITHDRAWN"] as const;
export type PipStatus = (typeof PIP_STATUSES)[number];

export const PIP_STATUS_LABELS: Record<PipStatus, string> = {
  DRAFT: "Draft",
  AWAITING_APPROVAL: "Awaiting approval to start",
  ACTIVE: "Active",
  OUTCOME_PROPOSED: "Outcome awaiting approval",
  CLOSED: "Closed",
  WITHDRAWN: "Withdrawn",
};

export const PIP_OUTCOMES = ["SUCCESSFUL", "EXTENDED", "UNSUCCESSFUL"] as const;
export type PipOutcome = (typeof PIP_OUTCOMES)[number];
export const OUTCOME_LABELS: Record<PipOutcome, string> = { SUCCESSFUL: "Successful", EXTENDED: "Extended", UNSUCCESSFUL: "Unsuccessful" };

export const OBJECTIVE_RESULTS = ["OPEN", "MET", "PARTLY_MET", "NOT_MET"] as const;
export type ObjectiveResult = (typeof OBJECTIVE_RESULTS)[number];
export const OBJECTIVE_RESULT_LABELS: Record<ObjectiveResult, string> = { OPEN: "Not yet reviewed", MET: "Met", PARTLY_MET: "Partly met", NOT_MET: "Not met" };

/** A plan is open until it is Closed or Withdrawn; an employee has at most one open plan at a time. */
export const OPEN_STATUSES: readonly PipStatus[] = ["DRAFT", "AWAITING_APPROVAL", "ACTIVE", "OUTCOME_PROPOSED"];
export const isOpen = (s: PipStatus) => OPEN_STATUSES.includes(s);

export interface PipLimits {
  defaultDays: number;
  maxDays: number;
  maxExtensions: number;
  maxExtensionDays: number;
  reviewIntervalDays: number;
}
/** The starting values for a company (proposed, for the founder to confirm; a lawyer should review them). The company's own values live in HrPolicy. */
export const DEFAULT_PIP_LIMITS: PipLimits = { defaultDays: 60, maxDays: 90, maxExtensions: 1, maxExtensionDays: 30, reviewIntervalDays: 14 };

const daysBetween = (from: string, to: string) => Math.round((d(to).getTime() - d(from).getTime()) / 86_400_000);

/** The last day of a plan: the start date plus its length in days. */
export const planEnd = (start: string, days: number) => iso(addDays(d(start), days));

export function checkLength(days: number, limits: PipLimits): string | null {
  if (!Number.isInteger(days)) return "The length of a plan must be a whole number of days.";
  if (days < 1) return "A plan must run for at least 1 day.";
  if (days > limits.maxDays) return `A plan can run for at most ${limits.maxDays} days.`;
  return null;
}

export function checkExtension(x: { extensionsUsed: number; currentEnd: string; newEnd: string }, limits: PipLimits): string | null {
  if (limits.maxExtensions <= 0) return "Extensions are not allowed under this company's settings.";
  if (x.extensionsUsed >= limits.maxExtensions) return `This plan has already been extended ${x.extensionsUsed === 1 ? "once" : `${x.extensionsUsed} times`}; no further extension is allowed.`;
  const by = daysBetween(x.currentEnd, x.newEnd);
  if (by < 1) return "The new end date must be later than the current end date.";
  if (by > limits.maxExtensionDays) return `An extension can be at most ${limits.maxExtensionDays} days.`;
  return null;
}

export type PipAction = "SUBMIT" | "APPROVE_START" | "RETURN" | "PROPOSE_OUTCOME" | "APPROVE_OUTCOME" | "WITHDRAW";

/** The status a step leads to, or null if the step is not allowed from where the plan is. A step never skips another. */
export function nextStatus(from: PipStatus, action: PipAction, outcome?: PipOutcome): PipStatus | null {
  switch (action) {
    case "SUBMIT":
      return from === "DRAFT" ? "AWAITING_APPROVAL" : null;
    case "APPROVE_START":
      return from === "AWAITING_APPROVAL" ? "ACTIVE" : null;
    case "RETURN":
      return from === "AWAITING_APPROVAL" ? "DRAFT" : from === "OUTCOME_PROPOSED" ? "ACTIVE" : null;
    case "PROPOSE_OUTCOME":
      return from === "ACTIVE" ? "OUTCOME_PROPOSED" : null;
    case "APPROVE_OUTCOME":
      if (from !== "OUTCOME_PROPOSED" || !outcome) return null;
      return outcome === "EXTENDED" ? "ACTIVE" : "CLOSED";
    case "WITHDRAW":
      return isOpen(from) ? "WITHDRAWN" : null;
  }
}

/**
 * Maker and checker separation. Starting a plan (or returning it to draft) is not for the person who drafted it or who owns it;
 * approving (or returning) an outcome is not for the person who proposed it or who owns the plan. Returns why not, or null.
 */
export function approverConflict(
  step: "APPROVE_START" | "RETURN_START" | "APPROVE_OUTCOME" | "RETURN_OUTCOME",
  people: { drafterId: string; ownerId: string; proposerId?: string | null },
  userId: string,
): string | null {
  if (userId === people.ownerId) return "You are the owner of this plan: someone else has to decide this step.";
  if ((step === "APPROVE_START" || step === "RETURN_START") && userId === people.drafterId) return "You drafted this plan: someone else has to decide this step.";
  if ((step === "APPROVE_OUTCOME" || step === "RETURN_OUTCOME") && people.proposerId && userId === people.proposerId) return "You proposed this outcome: someone else has to decide it.";
  return null;
}

/** The next review is one interval after the last, and never later than the end of the plan. */
export function nextReviewDue(reviewedOn: string, endDate: string, limits: PipLimits): string {
  const next = planEnd(reviewedOn, limits.reviewIntervalDays);
  return next > endDate ? endDate : next;
}

export type ReviewState = "NONE" | "UPCOMING" | "DUE" | "OVERDUE";
/** Only an Active plan has reviews to do. */
export function reviewState(plan: { status: PipStatus; nextReviewDue: string | null }, today: string): ReviewState {
  if (plan.status !== "ACTIVE" || !plan.nextReviewDue) return "NONE";
  if (plan.nextReviewDue < today) return "OVERDUE";
  return plan.nextReviewDue === today ? "DUE" : "UPCOMING";
}

/** The employee sees a plan only once it has been started (and a plan withdrawn before that was never shown to them). */
export function employeeMaySee(status: PipStatus, activatedAt: Date | null): boolean {
  if (status === "DRAFT" || status === "AWAITING_APPROVAL") return false;
  if (status === "WITHDRAWN") return activatedAt !== null;
  return true;
}
