/**
 * The retention schedule and legal holds (governance step 3a, docs/plans/hr-governance-plan.md section 2.4). Pure rules: no database and no clock (dates are plain "YYYY-MM-DD" days).
 *
 * The schedule is DATA, not code: for each category of record, how long it is kept, counted from what, and what happens then (delete, anonymise, review, or keep). The founder’s proposed
 * defaults are loaded UNVERIFIED, with a "legal adviser verified on and by" field, exactly as statutory settings are handled: they are a starting point for the lawyer, not advice
 * (the periods differ between the Labour Act, the data protection principle of "no longer than necessary" and the tax and accounting rules).
 *
 * A legal hold suspends deletion: on one person, on a whole category of record, or on the whole company, with a reason and a review day. Nothing here deletes anything; the holds are
 * checked by the deletions that already exist (erasing a former employee, anonymising stale candidates, purging old survey answers).
 */

export const RETENTION_CATEGORIES = [
  "EMPLOYEE_FILE",
  "APPRAISALS",
  "PROBATION",
  "FEEDBACK",
  "IMPROVEMENT_PLANS",
  "DISCIPLINARY",
  "TRAINING",
  "SKILLS",
  "WELFARE_CASES",
  "SUCCESSION",
  "RAW_SURVEYS",
  "SURVEY_REPORTS",
  "AUDIT_LOGS",
  "UNSUCCESSFUL_APPLICANTS",
  "ACCESS_LOGS",
] as const;
export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export const RETENTION_CATEGORY_LABELS: Record<RetentionCategory, string> = {
  EMPLOYEE_FILE: "Employee file",
  APPRAISALS: "Appraisals",
  PROBATION: "Probation records",
  FEEDBACK: "Feedback",
  IMPROVEMENT_PLANS: "Performance improvement plans",
  DISCIPLINARY: "Disciplinary records",
  TRAINING: "Training and evaluations",
  SKILLS: "Skills records",
  WELFARE_CASES: "Welfare cases",
  SUCCESSION: "Succession list",
  RAW_SURVEYS: "Raw survey answers",
  SURVEY_REPORTS: "Anonymised survey reports",
  AUDIT_LOGS: "Audit logs",
  UNSUCCESSFUL_APPLICANTS: "Unsuccessful applicants",
  ACCESS_LOGS: "Access and authentication logs",
};

export const RETENTION_TRIGGERS = ["AFTER_EXIT", "AFTER_CLOSURE", "AFTER_RECORD_DATE", "AFTER_SURVEY_CLOSE", "AFTER_RECRUITMENT_CLOSE", "AFTER_ACCOUNT_CLOSURE"] as const;
export type RetentionTrigger = (typeof RETENTION_TRIGGERS)[number];
export const RETENTION_TRIGGER_LABELS: Record<RetentionTrigger, string> = {
  AFTER_EXIT: "after the person leaves",
  AFTER_CLOSURE: "after the case is closed",
  AFTER_RECORD_DATE: "after the record’s date",
  AFTER_SURVEY_CLOSE: "after the survey closes",
  AFTER_RECRUITMENT_CLOSE: "after the recruitment closes",
  AFTER_ACCOUNT_CLOSURE: "after the account is closed",
};

/** What happens at the end of the period. The application deletes or anonymises only where a deletion already exists; the others are a reminder to review, or kept. */
export const RETENTION_ACTIONS = ["DELETE", "ANONYMISE", "REVIEW", "KEEP"] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];
export const RETENTION_ACTION_LABELS: Record<RetentionAction, string> = { DELETE: "Delete", ANONYMISE: "Anonymise", REVIEW: "Review", KEEP: "Keep" };

export interface RuleDefault {
  category: RetentionCategory;
  periodMonths: number;
  trigger: RetentionTrigger;
  action: RetentionAction;
  /** Why this is the default, in a line: for the legal adviser. */
  note: string;
}

const SIX_YEARS = 72;

/** The founder’s proposed defaults of 2026-11-10: a starting point for the lawyer, never advice. */
export const DEFAULT_RULES: RuleDefault[] = [
  { category: "EMPLOYEE_FILE", periodMonths: SIX_YEARS, trigger: "AFTER_EXIT", action: "ANONYMISE", note: "Six years after the person leaves (the founder’s proposal). Tax and pension duties may differ." },
  { category: "APPRAISALS", periodMonths: SIX_YEARS, trigger: "AFTER_EXIT", action: "ANONYMISE", note: "Follows the employee file." },
  { category: "PROBATION", periodMonths: SIX_YEARS, trigger: "AFTER_EXIT", action: "ANONYMISE", note: "Follows the employee file." },
  { category: "FEEDBACK", periodMonths: SIX_YEARS, trigger: "AFTER_EXIT", action: "ANONYMISE", note: "Follows the employee file." },
  { category: "IMPROVEMENT_PLANS", periodMonths: SIX_YEARS, trigger: "AFTER_EXIT", action: "ANONYMISE", note: "Follows the employee file." },
  { category: "DISCIPLINARY", periodMonths: SIX_YEARS, trigger: "AFTER_EXIT", action: "ANONYMISE", note: "Follows the employee file." },
  { category: "TRAINING", periodMonths: SIX_YEARS, trigger: "AFTER_EXIT", action: "ANONYMISE", note: "Follows the employee file." },
  { category: "SKILLS", periodMonths: SIX_YEARS, trigger: "AFTER_EXIT", action: "ANONYMISE", note: "Follows the employee file." },
  { category: "WELFARE_CASES", periodMonths: SIX_YEARS, trigger: "AFTER_CLOSURE", action: "ANONYMISE", note: "Six years after the case is closed (the founder’s proposal): the most sensitive records we hold." },
  { category: "SUCCESSION", periodMonths: 12, trigger: "AFTER_RECORD_DATE", action: "REVIEW", note: "Reviewed annually by the HR administrator." },
  { category: "RAW_SURVEYS", periodMonths: 24, trigger: "AFTER_SURVEY_CLOSE", action: "DELETE", note: "Twenty-four months after the survey closes; the anonymised result is kept." },
  { category: "SURVEY_REPORTS", periodMonths: 0, trigger: "AFTER_SURVEY_CLOSE", action: "KEEP", note: "The anonymised report identifies no one and is kept indefinitely." },
  { category: "AUDIT_LOGS", periodMonths: SIX_YEARS, trigger: "AFTER_RECORD_DATE", action: "REVIEW", note: "The audit log is append-only by design: the application never deletes it, so expiry is a review for the lawyer and the host’s archiving." },
  { category: "UNSUCCESSFUL_APPLICANTS", periodMonths: 24, trigger: "AFTER_RECRUITMENT_CLOSE", action: "ANONYMISE", note: "Two years after the recruitment closes (the founder’s proposal)." },
  { category: "ACCESS_LOGS", periodMonths: 24, trigger: "AFTER_ACCOUNT_CLOSURE", action: "REVIEW", note: "Two years after the account is closed (the founder’s proposal); a review, not a deletion by the application." },
];

/** The three categories the system already applies automatically or on request today, each from its own HR policy setting (shown in the schedule so the two never disagree silently). */
export const APPLIED_FROM_POLICY: Partial<Record<RetentionCategory, "employeeRetentionYears" | "surveyRetentionMonths" | "candidateRetentionMonths">> = {
  EMPLOYEE_FILE: "employeeRetentionYears",
  RAW_SURVEYS: "surveyRetentionMonths",
  UNSUCCESSFUL_APPLICANTS: "candidateRetentionMonths",
};

export const MAX_PERIOD_MONTHS = 1200;

/**
 * The triggers the system can work out today for each category. A rule may name another trigger (the schedule is a record for the lawyer); the due view then says it is not measured
 * rather than guessing. ACCESS_LOGS has no account-closure date to count from, and the anonymised survey reports are kept indefinitely.
 */
export const MEASURABLE_TRIGGERS: Partial<Record<RetentionCategory, readonly RetentionTrigger[]>> = {
  EMPLOYEE_FILE: ["AFTER_EXIT"],
  APPRAISALS: ["AFTER_EXIT"],
  PROBATION: ["AFTER_EXIT"],
  FEEDBACK: ["AFTER_EXIT"],
  IMPROVEMENT_PLANS: ["AFTER_EXIT"],
  DISCIPLINARY: ["AFTER_EXIT"],
  TRAINING: ["AFTER_EXIT"],
  SKILLS: ["AFTER_EXIT"],
  WELFARE_CASES: ["AFTER_CLOSURE", "AFTER_EXIT"],
  SUCCESSION: ["AFTER_RECORD_DATE", "AFTER_EXIT"],
  RAW_SURVEYS: ["AFTER_SURVEY_CLOSE"],
  AUDIT_LOGS: ["AFTER_RECORD_DATE"],
  UNSUCCESSFUL_APPLICANTS: ["AFTER_RECRUITMENT_CLOSE"],
};
export const triggerMeasurable = (category: RetentionCategory, trigger: string): boolean => (MEASURABLE_TRIGGERS[category] as readonly string[] | undefined)?.includes(trigger) ?? false;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The day a period of whole months ends, counted from a day ("YYYY-MM-DD"): the same day of the month, or the last day of a shorter month. */
export function expiryDay(base: string, months: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${pad2(nm + 1)}-${pad2(Math.min(d, lastDay))}`;
}

const plusDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export const SOON_DAYS = 90;
export type Expiry = "NONE" | "PAST" | "SOON" | "LATER";

/** Where a record stands against its period: past it (on or after the expiry day), expiring within 90 days, later, or no period at all. */
export function expiryStatus(base: string, months: number, today: string, soonDays = SOON_DAYS): Expiry {
  if (months <= 0) return "NONE";
  const end = expiryDay(base, months);
  if (end <= today) return "PAST";
  return end <= plusDays(today, soonDays) ? "SOON" : "LATER";
}

/** A rule must make sense: deleting or anonymising needs a period of at least a month; keeping has no period; a period is whole months up to a hundred years. */
export function checkRule(r: { periodMonths: number; trigger: string; action: string }): string | null {
  if (!Number.isInteger(r.periodMonths) || r.periodMonths < 0 || r.periodMonths > MAX_PERIOD_MONTHS) return `The period is a whole number of months, from 0 to ${MAX_PERIOD_MONTHS}.`;
  if (!(RETENTION_TRIGGERS as readonly string[]).includes(r.trigger)) return "Choose what the period is counted from.";
  if (!(RETENTION_ACTIONS as readonly string[]).includes(r.action)) return "Choose what happens at the end.";
  if ((r.action === "DELETE" || r.action === "ANONYMISE") && r.periodMonths < 1) return "Deleting or anonymising needs a period of at least one month. To keep it, choose Keep.";
  if (r.action === "KEEP" && r.periodMonths !== 0) return "Keeping has no period: set it to 0, or choose Review.";
  return null;
}

// ───────────────────────────── Legal holds ─────────────────────────────

export type HoldScope = "EMPLOYEE" | "CATEGORY" | "COMPANY";

export interface HoldLike {
  id: string;
  scope: HoldScope;
  employeeId?: string | null;
  category?: RetentionCategory | null;
  releasedAt?: Date | string | null;
  /** The day the hold must be looked at again ("YYYY-MM-DD"). */
  reviewOn: string;
}

/** The categories that are about one person: a hold on a person covers these, and not a survey or a log. */
const PERSON_CATEGORIES = new Set<RetentionCategory>(["EMPLOYEE_FILE", "APPRAISALS", "PROBATION", "FEEDBACK", "IMPROVEMENT_PLANS", "DISCIPLINARY", "TRAINING", "SKILLS", "WELFARE_CASES", "SUCCESSION"]);

/** The first live hold that covers this record, or null. A released hold never blocks. */
export function holdBlocks(holds: readonly HoldLike[], target: { category: RetentionCategory; employeeId?: string | null }): HoldLike | null {
  for (const h of holds) {
    if (h.releasedAt) continue;
    if (h.scope === "COMPANY") return h;
    if (h.scope === "CATEGORY" && h.category === target.category) return h;
    if (h.scope === "EMPLOYEE" && target.employeeId && h.employeeId === target.employeeId && PERSON_CATEGORIES.has(target.category)) return h;
  }
  return null;
}

/** Erasing a whole former employee removes every record about them at once, so a live hold on any of the categories about a person (or on the company) stops it. */
export function holdBlocksPerson(holds: readonly HoldLike[], employeeId: string): HoldLike | null {
  for (const category of PERSON_CATEGORIES) {
    const h = holdBlocks(holds, { category, employeeId });
    if (h) return h;
  }
  return null;
}

/** A hold must be looked at again on and after its review day, until it is released. */
export const holdNeedsReview = (h: Pick<HoldLike, "releasedAt" | "reviewOn">, today: string): boolean => !h.releasedAt && h.reviewOn <= today;

export const HOLD_REASON_MIN = 10;

export function checkHoldInput(x: { scope: HoldScope; employeeId?: string | null; category?: string | null; reason: string; reviewOn: string; today: string }): string | null {
  if (x.reason.trim().length < HOLD_REASON_MIN) return `Give the reason for the hold (at least ${HOLD_REASON_MIN} characters).`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.reviewOn)) return "Give the day the hold will be looked at again.";
  if (x.reviewOn <= x.today) return "The review day must be after today.";
  if (x.scope === "EMPLOYEE" && !x.employeeId) return "Choose the person the hold covers.";
  if (x.scope === "CATEGORY" && !(RETENTION_CATEGORIES as readonly string[]).includes(x.category ?? "")) return "Choose the category of record the hold covers.";
  return null;
}
