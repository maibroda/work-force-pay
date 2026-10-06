/**
 * Pure rules for training compliance: given the certificates an employee holds and a requirement,
 * is the employee covered? No database here.
 */

export type ComplianceState = "VALID" | "EXPIRING" | "EXPIRED" | "MISSING" | "GRACE";

export const STATE_LABELS: Record<ComplianceState, string> = {
  VALID: "Valid",
  EXPIRING: "Expiring soon",
  EXPIRED: "Expired",
  MISSING: "Missing",
  GRACE: "Due (new joiner)",
};

/** Missing or expired — what counts against an employee. Expiring and still-in-grace do not. */
export const isGap = (s: ComplianceState) => s === "MISSING" || s === "EXPIRED";

export interface Cert {
  courseName: string;
  expiryDate: Date | null;
  status: "VALID" | "EXPIRED" | "REVOKED";
}

export interface RequirementLike {
  courseName: string;
  graceDays: number;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const DAY = 86_400_000;

export interface Assessment {
  state: ComplianceState;
  /** The certificate that decided it (the one valid the longest), if any. */
  expiryDate: Date | null;
  /** Days until it expires (negative = expired); null when there is none or it never expires. */
  daysLeft: number | null;
}

/**
 * How one requirement stands for one employee on `today`.
 * - A revoked certificate never counts. Of the rest, the one that lasts longest decides; no expiry date means it never lapses.
 * - With nothing on file the employee is MISSING — unless they joined within the requirement's grace period.
 */
export function assess(req: RequirementLike, certs: Cert[], employmentDate: Date, today: Date, alertDays: number): Assessment {
  const held = certs.filter((c) => c.status !== "REVOKED" && norm(c.courseName) === norm(req.courseName));
  if (!held.length) {
    const graceEnds = employmentDate.getTime() + req.graceDays * DAY;
    return { state: today.getTime() < graceEnds ? "GRACE" : "MISSING", expiryDate: null, daysLeft: null };
  }
  if (held.some((c) => c.expiryDate === null)) return { state: "VALID", expiryDate: null, daysLeft: null };
  const best = held.reduce((a, c) => (c.expiryDate!.getTime() > a.expiryDate!.getTime() ? c : a));
  const daysLeft = Math.round((best.expiryDate!.getTime() - today.getTime()) / DAY);
  if (daysLeft < 0) return { state: "EXPIRED", expiryDate: best.expiryDate, daysLeft };
  return { state: alertDays > 0 && daysLeft <= alertDays ? "EXPIRING" : "VALID", expiryDate: best.expiryDate, daysLeft };
}

/** Whether a requirement applies to an employee of this category. */
export const appliesTo = (req: { categoryId: string | null }, categoryId: string) => req.categoryId === null || req.categoryId === categoryId;
