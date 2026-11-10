/**
 * Pure rules for skills and skill gaps. No database and no clock (dates are plain "YYYY-MM-DD" days), so every rule is tested exactly.
 *
 * A skill level is a manager's judgement recorded as a fact: it is append-only (a correction is a new assessment), the employee reads all of it, and it changes
 * nothing automatically: no pay, status, appraisal or career proposal. "Not assessed" is never read as a gap.
 */
import { daysBetween } from "@/lib/career";

export const SKILL_LEVELS = [1, 2, 3, 4] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];
export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = { 1: "Basic", 2: "Developing", 3: "Proficient", 4: "Advanced" };
/** What each level means (the founder's definitions of 2026-11-10), shown beside the level wherever a manager chooses one. */
export const SKILL_LEVEL_DESCRIPTIONS: Record<SkillLevel, string> = {
  1: "Understands the skill but requires supervision.",
  2: "Can perform routine tasks with limited supervision.",
  3: "Independently performs the skill to the required standard.",
  4: "Demonstrates expertise and can coach or guide others.",
};
export const COMMENT_MAX = 300;

/** A level is a whole number from 1 to 4. */
export function checkLevel(n: number): string | null {
  return Number.isInteger(n) && n >= 1 && n <= 4 ? null : "Give a level from 1 to 4.";
}

export interface AssessmentLike {
  level: number;
  /** The day it was assessed ("YYYY-MM-DD"). */
  assessedOn: string;
  /** When it was recorded (a sortable number, for two assessments on the same day). */
  recordedAt: number;
}

/** The current level of a skill is the latest assessment, by the day assessed and then by when it was recorded. Null when nobody has assessed it. */
export function currentLevel(history: AssessmentLike[]): number | null {
  if (!history.length) return null;
  const latest = history.reduce((a, b) => (b.assessedOn > a.assessedOn || (b.assessedOn === a.assessedOn && b.recordedAt > a.recordedAt) ? b : a));
  return latest.level;
}

export type GapStatus = "NOT_ASSESSED" | "MET" | "BELOW";

/** The gap of a requirement against a current level. Not assessed is its own state, never a gap. */
export function gapOf(required: number, current: number | null): { status: GapStatus; gap: number } {
  if (current === null) return { status: "NOT_ASSESSED", gap: 0 };
  return current >= required ? { status: "MET", gap: 0 } : { status: "BELOW", gap: required - current };
}

/** A role's skill across its people: at or above, below and not assessed, counted apart. */
export function summariseGaps(currents: Array<number | null>, required: number) {
  let met = 0;
  let below = 0;
  let notAssessed = 0;
  for (const c of currents) {
    const g = gapOf(required, c);
    if (g.status === "MET") met++;
    else if (g.status === "BELOW") below++;
    else notAssessed++;
  }
  return { met, below, notAssessed, total: currents.length };
}

export interface TargetSkill {
  skillId: string;
  name: string;
  requiredLevel: number;
  courses: string[];
}

/** The skills a person would need to build to reach a role: those they are below and those not yet assessed, never those they meet. A guide, not a promise. */
export function pathSkills(target: TargetSkill[], currentBySkill: Map<string, number>) {
  return target
    .map((t) => {
      const current = currentBySkill.get(t.skillId) ?? null;
      return { ...t, current, ...gapOf(t.requiredLevel, current) };
    })
    .filter((x) => x.status !== "MET");
}

/** An assessment is stale once it is older than the company's number of days (0 = never stale). */
export function isStale(assessedOn: string, today: string, days: number): boolean {
  return days > 0 && daysBetween(assessedOn, today) > days;
}
