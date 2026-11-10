/**
 * Pure rules for training evaluation and manager training requests. No database and no clock (dates are plain "YYYY-MM-DD" days), so every rule is tested exactly.
 *
 * An evaluation is about the course, not a score on the person: it changes no pay, status, certificate or appraisal. Results are shown without picking a person out:
 * fewer than five answers show no count, no average and no comment (the same minimum as the welfare summary).
 */
import { daysBetween } from "@/lib/career";
import { MIN_GROUP } from "@/lib/welfare";

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const COMMENT_MAX = 300;

export const EVALUATION_KINDS = ["PARTICIPANT", "MANAGER"] as const;
export type EvaluationKind = (typeof EVALUATION_KINDS)[number];

/** A rating is a whole number from 1 to 5. */
export function checkRating(n: number): string | null {
  return Number.isInteger(n) && n >= RATING_MIN && n <= RATING_MAX ? null : `Give a whole number from ${RATING_MIN} to ${RATING_MAX}.`;
}

/** The manager is asked once the company's number of days has passed since the session (0 = never asked). */
export function managerEvaluationDue(sessionDay: string, today: string, days: number): boolean {
  return days > 0 && daysBetween(sessionDay, today) >= days;
}

export interface RatingSummary {
  shown: boolean;
  /** null while hidden (fewer than the minimum), 0 when there are no answers at all. */
  count: number | null;
  average: number | null;
}

/** Results without picking a person out: below the minimum number of answers nothing is shown. The average is to one decimal, rounding half up. */
export function summariseRatings(ratings: number[]): RatingSummary {
  const n = ratings.length;
  if (n === 0) return { shown: false, count: 0, average: null };
  if (n < MIN_GROUP) return { shown: false, count: null, average: null };
  const sum = ratings.reduce((a, b) => a + b, 0);
  const tenths = Math.floor((sum * 20 + n) / (2 * n)); // sum * 10 / n, rounded half up, in whole numbers
  return { shown: true, count: n, average: tenths / 10 };
}

export const TRAINING_REQUEST_STATUSES = ["REQUESTED", "ACCEPTED", "DECLINED", "WITHDRAWN"] as const;
export type TrainingRequestStatus = (typeof TRAINING_REQUEST_STATUSES)[number];
export const TRAINING_REQUEST_STATUS_LABELS: Record<TrainingRequestStatus, string> = { REQUESTED: "Requested", ACCEPTED: "Accepted", DECLINED: "Declined", WITHDRAWN: "Withdrawn" };
export type TrainingRequestAction = "ACCEPT" | "DECLINE" | "WITHDRAW";

/** An undecided request can be accepted, declined or withdrawn; every other status is final. */
export function requestStatusAfter(from: TrainingRequestStatus, action: TrainingRequestAction): TrainingRequestStatus | null {
  if (from !== "REQUESTED") return null;
  return action === "ACCEPT" ? "ACCEPTED" : action === "DECLINE" ? "DECLINED" : "WITHDRAWN";
}

/** The person who requested a course never decides the request. */
export function requesterConflict(userId: string, requesterUserId: string): string | null {
  return userId === requesterUserId ? "You made this request, so someone else decides." : null;
}
