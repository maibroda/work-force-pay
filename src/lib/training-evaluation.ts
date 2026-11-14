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

/** The three added participant questions (stage 1) are optional in the rule and asked in the form: when given, each is a whole number from 1 to 5. */
export function checkOptionalRating(n: number | null | undefined): string | null {
  return n === undefined || n === null ? null : checkRating(n);
}

// ───────────────────────────── Stage 3: effectiveness ─────────────────────────────

/** Did the person's performance on the work this training targets improve? A manager is never forced to judge: "not yet visible" is a choice. */
export const EFFECTIVENESS_OUTCOMES = ["CLEARLY_IMPROVED", "SOMEWHAT_IMPROVED", "NO_VISIBLE_CHANGE", "NOT_YET_VISIBLE"] as const;
export type EffectivenessOutcome = (typeof EFFECTIVENESS_OUTCOMES)[number];
export const EFFECTIVENESS_LABELS: Record<EffectivenessOutcome, string> = {
  CLEARLY_IMPROVED: "Clearly improved",
  SOMEWHAT_IMPROVED: "Somewhat improved",
  NO_VISIBLE_CHANGE: "No visible change",
  NOT_YET_VISIBLE: "Not yet visible",
};

/** The manager is asked the company's number of days after the session (120 by default; 0 = never asked). */
export const effectivenessDue = (sessionDay: string, today: string, days: number): boolean => days > 0 && daysBetween(sessionDay, today) >= days;

/** Why the effectiveness question cannot be answered now, or null. Checked in this order: attended, the programme is marked, the company asks, the days have passed, once. */
export function effectivenessRefusal(x: { attended: boolean; flagged: boolean; days: number; sessionDay: string; today: string; alreadyAnswered: boolean }): string | null {
  if (!x.attended) return "Only a course the person attended can be evaluated.";
  if (!x.flagged) return "This programme is not marked for effectiveness evaluation.";
  if (x.days === 0) return "Effectiveness evaluations are switched off by the company.";
  if (!effectivenessDue(x.sessionDay, x.today, x.days)) return `Not yet: the manager is asked ${x.days} days after the session.`;
  if (x.alreadyAnswered) return "This course has already had an effectiveness evaluation.";
  return null;
}

export interface EffectivenessSummary {
  shown: boolean;
  /** null while hidden (fewer than the minimum), 0 when there are no answers at all. */
  count: number | null;
  counts: Record<EffectivenessOutcome, number> | null;
  /** The answers that were a judgement (everything except "not yet visible"), which is counted apart and is never an improvement or a failure. */
  judged: number | null;
}

/** The spread of effectiveness answers for one programme: nothing below five answers (the minimum counts everyone who answered, so a hidden answer cannot be found by subtraction). */
export function summariseEffectiveness(outcomes: EffectivenessOutcome[]): EffectivenessSummary {
  const n = outcomes.length;
  if (n === 0) return { shown: false, count: 0, counts: null, judged: null };
  if (n < MIN_GROUP) return { shown: false, count: null, counts: null, judged: null };
  const counts = { CLEARLY_IMPROVED: 0, SOMEWHAT_IMPROVED: 0, NO_VISIBLE_CHANGE: 0, NOT_YET_VISIBLE: 0 } as Record<EffectivenessOutcome, number>;
  for (const o of outcomes) counts[o] += 1;
  return { shown: true, count: n, counts, judged: n - counts.NOT_YET_VISIBLE };
}

export interface SkillLevelOn {
  level: number;
  on: string;
}
export interface SkillEvidenceRow {
  skillId: string;
  skillName: string;
  before: SkillLevelOn | null;
  after: SkillLevelOn | null;
}

/**
 * The evidence shown beside an effectiveness answer, never a score and never a change: for each skill the course builds, the latest assessment on or before the session day and the
 * latest after it. A skill nobody assessed on one side is null ("not assessed"). The skills are listed by name; an assessment of a skill the course does not build is ignored.
 */
export function skillEvidence(
  assessments: Array<{ skillId: string; skillName: string; level: number; assessedOn: string }>,
  skills: Array<{ id: string; name: string }>,
  sessionDay: string,
): SkillEvidenceRow[] {
  const latest = (rows: Array<{ level: number; assessedOn: string }>): SkillLevelOn | null => {
    if (!rows.length) return null;
    const last = [...rows].sort((a, b) => (a.assessedOn < b.assessedOn ? -1 : a.assessedOn > b.assessedOn ? 1 : 0))[rows.length - 1];
    return { level: last.level, on: last.assessedOn };
  };
  return [...skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((sk) => {
      const mine = assessments.filter((a) => a.skillId === sk.id);
      return { skillId: sk.id, skillName: sk.name, before: latest(mine.filter((a) => a.assessedOn <= sessionDay)), after: latest(mine.filter((a) => a.assessedOn > sessionDay)) };
    });
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
