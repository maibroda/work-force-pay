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

const STRICTNESS: Record<TwoFactorState, number> = { NOT_REQUIRED: 0, ENROLLED: 0, GRACE: 1, BLOCKED: 2 };

/**
 * A bureau's staff are all covered, whatever their role, from the bureau's start day. Someone who also falls under a rule of their own organization
 * gets whichever of the two is stricter, and the earlier start day of the rules that cover them. Both states describe the same person, so if either says enrolled, they are.
 */
export function combineTwoFactor(
  a: { state: TwoFactorState; enforceFrom: Date | null },
  b: { state: TwoFactorState; enforceFrom: Date | null },
): { state: TwoFactorState; enforceFrom: Date | null } {
  const state: TwoFactorState =
    a.state === "ENROLLED" || b.state === "ENROLLED" ? "ENROLLED" : STRICTNESS[a.state] >= STRICTNESS[b.state] ? a.state : b.state;
  // a start day only counts for a rule that actually covers this person
  const dates = [a, b].filter((x) => x.state !== "NOT_REQUIRED").map((x) => x.enforceFrom).filter((x): x is Date => !!x);
  return { state, enforceFrom: dates.length ? new Date(Math.min(...dates.map((x) => x.getTime()))) : null };
}
