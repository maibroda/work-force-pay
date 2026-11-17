/**
 * Pure rules for company policies and acknowledgements. No database here.
 */
import { addMonths } from "./leave";

export type AckState = "ACKNOWLEDGED" | "PENDING" | "OVERDUE" | "NOT_REQUIRED";

export const ACK_LABELS: Record<AckState, string> = {
  ACKNOWLEDGED: "Acknowledged",
  PENDING: "To acknowledge",
  OVERDUE: "Overdue",
  NOT_REQUIRED: "No acknowledgement needed",
};

/** What a company document is. They share versions, effective dates and the audience; they differ in whether employees must acknowledge them. */
export const POLICY_KINDS = ["POLICY", "HANDBOOK", "SOP"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];
export const POLICY_KIND_LABELS: Record<PolicyKind, string> = { POLICY: "Policy", HANDBOOK: "Handbook", SOP: "Procedure (SOP)" };

/** A handbook or a procedure is read, not signed, unless HR says otherwise; a policy is signed unless HR says otherwise. */
export const acknowledgementDefault = (kind: PolicyKind) => kind === "POLICY";

/**
 * The latest review date a procedure (SOP) may have: the company's number of months (12 unless changed) after it takes effect. A procedure that took effect in the past is counted from today, so
 * marking one reviewed always allows a full period ahead. Plain "YYYY-MM-DD" days.
 */
export function sopReviewLimit(effective: Date, today: Date, months: number): string {
  return addMonths(effective > today ? effective : today, months).toISOString().slice(0, 10);
}

/** Whether an item matches what the employee typed: the title or the summary, ignoring case and spaces at the ends, as plain text (never a pattern). Empty matches everything. */
export function matchesQuery(item: { title: string; summary: string | null }, query: string | undefined): boolean {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  return item.title.toLowerCase().includes(q) || (item.summary ?? "").toLowerCase().includes(q);
}

const DAY = 86_400_000;

/**
 * The day by which an employee must have acknowledged a version: the grace period counted from when the
 * version took effect or the employee joined, whichever is later (a new hire isn't chased for a policy
 * that took effect years ago, and nobody is chased the moment a new version appears).
 */
export function ackDueDate(effectiveDate: Date, employmentDate: Date, graceDays: number): Date {
  const start = Math.max(effectiveDate.getTime(), employmentDate.getTime());
  return new Date(start + graceDays * DAY);
}

/** Overdue only once the due day has passed; the due day itself still counts as pending. */
export function ackState(acknowledged: boolean, due: Date, today: Date): AckState {
  if (acknowledged) return "ACKNOWLEDGED";
  return today.getTime() > due.getTime() ? "OVERDUE" : "PENDING";
}

/** The state for an item that may not need acknowledging: exactly the rule above when it does, "not required" when it does not. */
export function ackStateFor(required: boolean, acknowledged: boolean, due: Date, today: Date): AckState {
  return required ? ackState(acknowledged, due, today) : "NOT_REQUIRED";
}

interface Versioned {
  version: number;
  effectiveDate: Date;
}

/** The version in force today: the highest-numbered one whose effective date has arrived. */
export function currentVersion<T extends Versioned>(versions: T[], today: Date): T | null {
  const live = versions.filter((v) => v.effectiveDate.getTime() <= today.getTime());
  return live.length ? live.reduce((a, v) => (v.version > a.version ? v : a)) : null;
}

/** The next version waiting for its effective date, if any. */
export function scheduledVersion<T extends Versioned>(versions: T[], today: Date): T | null {
  const future = versions.filter((v) => v.effectiveDate.getTime() > today.getTime());
  return future.length ? future.reduce((a, v) => (v.effectiveDate.getTime() < a.effectiveDate.getTime() ? v : a)) : null;
}

/** Whether a policy applies to an employee of this category (no category = everyone). */
export const appliesTo = (policy: { categoryId: string | null }, categoryId: string) => policy.categoryId === null || policy.categoryId === categoryId;
