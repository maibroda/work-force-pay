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

/**
 * What to tell someone on every page: only people who are covered, haven't set it up, and still have time —
 * once the day arrives they can't reach the pages at all. Null = nothing to say.
 */
export function twoFactorReminder(state: TwoFactorState, enforceFrom: Date | null, today: Date): string | null {
  if (state !== "GRACE" || !enforceFrom) return null;
  const days = daysUntilEnforced(enforceFrom, today);
  const when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  return `Two-factor sign-in becomes compulsory for your role ${when} (${enforceFrom.toISOString().slice(0, 10)}). Set it up now, or you will be locked out of everything except My security.`;
}

/** Whole days until the start day (0 on the day itself). */
export const daysUntilEnforced = (enforceFrom: Date, today: Date) => Math.round((enforceFrom.getTime() - today.getTime()) / 86_400_000);
