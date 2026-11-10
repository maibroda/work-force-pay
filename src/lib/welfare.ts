/**
 * Pure rules for welfare support. Welfare support is a case (src/server/services/relations.ts) of the always-confidential type WELFARE, with a short fixed list of
 * kinds. Nothing here handles money: help with money stays in the staff loans and advances process, with its own approvals.
 */

export const WELFARE_KINDS = ["BEREAVEMENT", "FINANCIAL_HARDSHIP", "HEALTH_WELLBEING", "FAMILY", "HOUSING_TRANSPORT", "OTHER"] as const;
export type WelfareKind = (typeof WELFARE_KINDS)[number];
export const WELFARE_KIND_LABELS: Record<WelfareKind, string> = {
  BEREAVEMENT: "Bereavement",
  FINANCIAL_HARDSHIP: "Financial hardship",
  HEALTH_WELLBEING: "Health and wellbeing",
  FAMILY: "Family",
  HOUSING_TRANSPORT: "Housing or transport",
  OTHER: "Other",
};

/** A group smaller than this is not shown in a count, so a person cannot be identified by it. */
export const MIN_GROUP = 5;

/** Counts without names: a group below the minimum becomes null (shown as "fewer than 5"); zero is shown as zero. */
export function hideSmallGroups(counts: Record<string, number>, min: number = MIN_GROUP): Record<string, number | null> {
  return Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n === 0 || n >= min ? n : null]));
}
