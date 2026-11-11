/**
 * Pure rules for engagement surveys. No database and no clock (dates are plain "YYYY-MM-DD" days), so every rule is tested exactly.
 *
 * The promise to employees is that an answer cannot be tied to a person. These rules carry most of it: nothing is shown below five answers; a group is shown only
 * with at least ten invited and five answers; a group that is hidden is combined with the others, and when exactly one would be hidden a second is hidden too, so a hidden
 * group cannot be worked out by subtraction. A group under ten may still take part: only its display is suppressed.
 */
import { createHash, randomInt } from "node:crypto";
import { monthsBetween } from "@/lib/career";
import { MIN_GROUP } from "@/lib/welfare";

export const MAX_QUESTIONS = 15;
export const QUESTION_TEXT_MAX = 200;
export const COMMENT_MAX = 500;
/** Answers needed before any result is shown (the same minimum as the welfare summary and training evaluation). */
export const MIN_RESPONSES = MIN_GROUP;
/** Invited employees a group needs before its results are shown on their own. */
export const MIN_INVITED_FOR_GROUP = 10;

export { SCALE_LABELS } from "@/lib/survey-scale";

// ───────────────────────────── Access codes ─────────────────────────────

// Crockford's base 32: no I, L, O or U, so a code read off a sheet cannot be mistyped for another character.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 12;

/** A random code of 12 characters (60 bits), shown in groups of four, for example "7K2M-9QDX-4HVB". */
export function generateCode(): string {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** A code read the same however it is typed: upper case, no spaces or hyphens, and O is 0 and I or L is 1. */
export function normaliseCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** Only this is stored: a code is high-entropy and single-use, so a plain hash is enough. */
export const hashCode = (normalised: string) => createHash("sha256").update(normalised).digest("hex");

// ───────────────────────────── Results ─────────────────────────────

export type Distribution = Record<1 | 2 | 3 | 4 | 5, number>;

export function distribution(values: number[]): Distribution {
  const d: Distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const v of values) if (v >= 1 && v <= 5) d[v as 1 | 2 | 3 | 4 | 5]++;
  return d;
}

export interface ScaleSummary {
  shown: boolean;
  /** null while hidden (fewer than the minimum), 0 when there are no answers at all. */
  count: number | null;
  average: number | null;
  distribution: Distribution | null;
}

/** The result of a question without picking a person out: below five answers nothing is shown. The average is to one decimal, rounding half up. */
export function summarise(values: number[]): ScaleSummary {
  const n = values.length;
  if (n === 0) return { shown: false, count: 0, average: null, distribution: null };
  if (n < MIN_RESPONSES) return { shown: false, count: null, average: null, distribution: null };
  const sum = values.reduce((a, b) => a + b, 0);
  return { shown: true, count: n, average: Math.floor((sum * 20 + n) / (2 * n)) / 10, distribution: distribution(values) };
}

export interface GroupCount {
  key: string;
  label: string;
  /** Employees invited in this group. */
  invited: number;
  /** Answers (or participants) in this group. */
  answers: number;
}

const eligible = (invited: number, answers: number) => invited >= MIN_INVITED_FOR_GROUP && answers >= MIN_RESPONSES;

/**
 * Which groups may be shown on their own. A group needs at least ten invited and five answers. The rest are combined into one "other" row, shown only if the combined row
 * is itself large enough. If exactly one group would be hidden, the smallest group that could be shown is hidden too, so the hidden one cannot be found by subtracting the
 * shown groups from the total.
 */
export function breakdown(groups: GroupCount[]): { shown: GroupCount[]; other: { invited: number; answers: number; shown: boolean } | null } {
  let shown = groups.filter((g) => eligible(g.invited, g.answers));
  let hidden = groups.filter((g) => !eligible(g.invited, g.answers));
  if (hidden.length === 1 && shown.length >= 1) {
    const smallest = shown.reduce((a, b) => (b.answers < a.answers ? b : a));
    shown = shown.filter((g) => g !== smallest);
    hidden = [...hidden, smallest];
  }
  if (!hidden.length) return { shown, other: null };
  const invited = hidden.reduce((a, g) => a + g.invited, 0);
  const answers = hidden.reduce((a, g) => a + g.answers, 0);
  return { shown, other: { invited, answers, shown: eligible(invited, answers) } };
}

// ───────────────────────────── The life of a survey ─────────────────────────────

export type SurveyStatusLike = "DRAFT" | "OPEN" | "CLOSED";
export type SurveyState = "DRAFT" | "SCHEDULED" | "OPEN" | "CLOSED";

/** Draft until opened; Scheduled before its first day; Open through its closing day; Closed once closed or past its closing day. */
export function surveyState(status: SurveyStatusLike, opensOn: string, closesOn: string, today: string): SurveyState {
  if (status === "DRAFT") return "DRAFT";
  if (status === "CLOSED") return "CLOSED";
  if (today < opensOn) return "SCHEDULED";
  return today > closesOn ? "CLOSED" : "OPEN";
}

/** Raw answers expire the stated number of months after the survey closed (0 = never deleted automatically). */
export function retentionDue(closedDay: string, today: string, months: number): boolean {
  return months > 0 && monthsBetween(closedDay, today) >= months;
}
