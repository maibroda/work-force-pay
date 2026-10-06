/**
 * Pure rules for performance appraisals: the rating scale, weighted scoring, when a comment is
 * required, and the starter criteria. No database here.
 */

export const RATING_LABELS: Record<number, string> = {
  1: "Unsatisfactory",
  2: "Needs improvement",
  3: "Meets expectations",
  4: "Exceeds expectations",
  5: "Outstanding",
};
export const RATINGS = [1, 2, 3, 4, 5] as const;

/** How an appraisal that hasn't been signed off is described in a sentence. */
export const STATUS_PHRASES = { DRAFT: "still being written", SUBMITTED: "awaiting sign-off" } as const;

export const KIND_LABELS = { ANNUAL: "Annual review", PROBATION: "Probation review", AD_HOC: "Ad-hoc review" } as const;

export const RECOMMENDATIONS = ["NONE", "CONFIRM_EMPLOYMENT", "INCREMENT", "PROMOTION", "TRAINING", "PERFORMANCE_PLAN"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  NONE: "No recommendation",
  CONFIRM_EMPLOYMENT: "Confirm employment",
  INCREMENT: "Salary increment",
  PROMOTION: "Promotion",
  TRAINING: "Further training",
  PERFORMANCE_PLAN: "Performance improvement plan",
};

/** What a new organization starts with — weights are relative, so they needn't add up to 100. */
export const DEFAULT_CRITERIA: Array<{ name: string; description: string; weight: number }> = [
  { name: "Job knowledge & skills", description: "Knows the job and applies the training received", weight: 20 },
  { name: "Quality & reliability of work", description: "Does the work properly and can be depended on", weight: 20 },
  { name: "Attendance & punctuality", description: "Reports for duty on time and as rostered", weight: 20 },
  { name: "Discipline & integrity", description: "Follows rules and procedures, honest in dealings", weight: 15 },
  { name: "Teamwork & communication", description: "Works well with colleagues, supervisors and clients", weight: 15 },
  { name: "Initiative & problem solving", description: "Acts without being told and deals with problems", weight: 10 },
];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface WeightedRating {
  rating: number | null | undefined;
  weight: number;
}

/** Weighted average of the ratings given (1–5), and whether every criterion has one. */
export function weightedScore(rows: WeightedRating[]): { score: number | null; complete: boolean } {
  const rated = rows.filter((r): r is { rating: number; weight: number } => typeof r.rating === "number");
  const totalWeight = rated.reduce((a, r) => a + r.weight, 0);
  if (!rated.length || totalWeight <= 0) return { score: null, complete: false };
  return { score: round2(rated.reduce((a, r) => a + r.rating * r.weight, 0) / totalWeight), complete: rated.length === rows.length };
}

/** The label a score falls in. */
export function bandFor(score: number): string {
  const s = round2(score);
  if (s >= 4.5) return RATING_LABELS[5];
  if (s >= 3.5) return RATING_LABELS[4];
  if (s >= 2.5) return RATING_LABELS[3];
  if (s >= 1.5) return RATING_LABELS[2];
  return RATING_LABELS[1];
}

export interface CommentPolicy {
  appraisalCommentAtOrBelow: number;
  appraisalCommentAtOrAbove: number;
}

/** A very low or very high rating has to be explained (0 switches a side off). */
export function commentRequired(rating: number, p: CommentPolicy): boolean {
  return (p.appraisalCommentAtOrBelow > 0 && rating <= p.appraisalCommentAtOrBelow) || (p.appraisalCommentAtOrAbove > 0 && rating >= p.appraisalCommentAtOrAbove);
}

/** How far the employee's own rating sits above (+) or below (−) the reviewer's, on average. */
export function selfGap(rows: Array<{ selfRating: number | null; rating: number | null }>): number | null {
  const both = rows.filter((r) => r.selfRating != null && r.rating != null);
  if (!both.length) return null;
  return round2(both.reduce((a, r) => a + (r.selfRating! - r.rating!), 0) / both.length);
}
