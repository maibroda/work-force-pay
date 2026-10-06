/**
 * Pure rules for company policies and acknowledgements. No database here.
 */

export type AckState = "ACKNOWLEDGED" | "PENDING" | "OVERDUE";

export const ACK_LABELS: Record<AckState, string> = {
  ACKNOWLEDGED: "Acknowledged",
  PENDING: "To acknowledge",
  OVERDUE: "Overdue",
};

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
