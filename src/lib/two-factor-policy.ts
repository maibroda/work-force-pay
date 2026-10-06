/**
 * Pure rules for requiring two-factor sign-in by role. No database here.
 *
 * The company picks the roles and a start day. Before that day the people affected are only reminded; from it,
 * anyone in those roles who hasn't turned two-factor on can reach nothing but the page where they do.
 */

export type TwoFactorState =
  /** The role isn't covered, or no start day has been set. */
  | "NOT_REQUIRED"
  /** Covered, and two-factor is on. */
  | "ENROLLED"
  /** Covered, not on yet, and the start day hasn't arrived. */
  | "GRACE"
  /** Covered, not on, and the start day has passed: only the security page is open. */
  | "BLOCKED";

export interface TwoFactorInput {
  roles: readonly string[];
  /** The first day it is compulsory (a date, no time); null = switched off. */
  enforceFrom: Date | null;
  role: string;
  enrolled: boolean;
  today: Date;
}

export function twoFactorState({ roles, enforceFrom, role, enrolled, today }: TwoFactorInput): TwoFactorState {
  if (!enforceFrom || !roles.includes(role)) return "NOT_REQUIRED";
  if (enrolled) return "ENROLLED";
  return today >= enforceFrom ? "BLOCKED" : "GRACE";
}

/** Whole days until the start day (0 on the day itself). */
export const daysUntilEnforced = (enforceFrom: Date, today: Date) => Math.round((enforceFrom.getTime() - today.getTime()) / 86_400_000);
