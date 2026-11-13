/**
 * The retention run (governance step 3b-2, docs/plans/hr-governance-step3b2-plan.md). Pure rules, no database and no clock.
 *
 * A run clears the WORDS of one kind of record for the people (or records) whose period has ended, and keeps the shape (that a record existed, its kind, dates and outcome), exactly as the
 * existing erasure of a former employee does. HR proposes it; a different person (the Company Administrator) confirms it. A rule the legal adviser has not verified runs only if the
 * confirmer writes down why they accept it. A legal hold always wins.
 */
import { RETENTION_ACTION_LABELS, RETENTION_CATEGORIES, RETENTION_CATEGORY_LABELS, RETENTION_TRIGGER_LABELS, triggerMeasurable, type RetentionAction, type RetentionCategory, type RetentionTrigger } from "./retention-schedule";
import { secondPerson } from "./second-person";

/** The kinds of record about people that have a run. The employee file keeps its own request-and-approval erasure; raw survey answers and applicants run from their HR policy; the logs and the reports are never deleted. */
export const RUNNABLE_CATEGORIES = ["APPRAISALS", "PROBATION", "FEEDBACK", "IMPROVEMENT_PLANS", "DISCIPLINARY", "TRAINING", "SKILLS", "WELFARE_CASES", "SUCCESSION"] as const;
export type RunnableCategory = (typeof RUNNABLE_CATEGORIES)[number];
export const isRunnable = (c: string): c is RunnableCategory => (RUNNABLE_CATEGORIES as readonly string[]).includes(c);

/** What a run counts: a person (every record of the kind they hold) or a single record (a welfare case from its closing, a succession entry from its last review). */
export type SubjectKind = "PERSON" | "RECORD";
export function subjectKind(category: RetentionCategory, trigger: RetentionTrigger): SubjectKind {
  if (category === "WELFARE_CASES" && trigger === "AFTER_CLOSURE") return "RECORD";
  if (category === "SUCCESSION" && trigger === "AFTER_RECORD_DATE") return "RECORD";
  return "PERSON";
}

export const NOTE_MIN = 10;
export const ACCEPTANCE_MIN = 20;
/** A run cannot be confirmed in the same minute it is proposed: both people have time to look at the counts. */
export const MIN_REVIEW_SECONDS = 60;

/** Whether a run can be proposed for this category under this rule; the message says why not. */
export function checkProposable(category: string, rule: { periodMonths: number; trigger: string; action: string }): string | null {
  if (!(RETENTION_CATEGORIES as readonly string[]).includes(category)) return "Choose a category of record from the list.";
  const c = category as RetentionCategory;
  if (c === "EMPLOYEE_FILE") return "The employee file is erased person by person under Records retention, with a second person approving; it has no category run.";
  if (c === "RAW_SURVEYS" || c === "UNSUCCESSFUL_APPLICANTS") return "This kind of record runs by itself from its HR policy setting; it has no category run.";
  if (!isRunnable(c)) return "This kind of record is only reviewed or kept: the application never deletes it.";
  if (rule.action !== "ANONYMISE") return `This kind of record is set to "${RETENTION_ACTION_LABELS[rule.action as RetentionAction].toLowerCase()}": there is nothing to anonymise.`;
  if (!triggerMeasurable(c, rule.trigger)) return `The system cannot work out ${RETENTION_CATEGORY_LABELS[c].toLowerCase()} counted from "${RETENTION_TRIGGER_LABELS[rule.trigger as RetentionTrigger] ?? rule.trigger}", so no run can be proposed.`;
  return null;
}

/** Seconds still to wait before a proposed run can be confirmed (0 once the minute has passed). */
export function reviewWait(proposedAt: Date, now: Date): number {
  const left = MIN_REVIEW_SECONDS - Math.floor((now.getTime() - proposedAt.getTime()) / 1000);
  return left > 0 ? left : 0;
}

export type ConfirmVerdict = { ok: true; acceptedUnverified: boolean; singleHolder: boolean } | { ok: false; error: string };

/**
 * Whether this person may confirm this run now. A run must still be waiting, its rule must be the one that was proposed (a changed rule is unverified again and must be proposed again),
 * and the minute must have passed. A different person confirms; the only holder of the right may confirm their own proposal. A note of at least ten characters is always needed; where the
 * rule is unverified, or the confirmer is the only holder, it must be at least twenty (the written acceptance or reason, recorded and flagged).
 */
export function confirmVerdict(x: {
  status: string;
  ruleChanged: boolean;
  ruleVerified: boolean;
  samePerson: boolean;
  otherHolders: number;
  note: string | null | undefined;
  waitSeconds: number;
}): ConfirmVerdict {
  if (x.status !== "PROPOSED") return { ok: false, error: `This run is already ${x.status.toLowerCase()}.` };
  if (x.ruleChanged) return { ok: false, error: "The rule changed since this run was proposed. Reject it and propose it again, so what is confirmed is what was seen." };
  if (x.waitSeconds > 0) return { ok: false, error: `Wait ${x.waitSeconds} seconds: a run cannot be confirmed in the same minute it is proposed, so both people have time to look at the counts.` };
  const note = (x.note ?? "").trim();
  if (note.length < NOTE_MIN) return { ok: false, error: `Say why you are confirming it (at least ${NOTE_MIN} characters).` };
  const sp = secondPerson({ samePerson: x.samePerson, otherHolders: x.otherHolders, reason: note, did: "proposed this run", does: "confirms it" });
  if (!sp.ok) return { ok: false, error: sp.error };
  if (!x.ruleVerified && note.length < ACCEPTANCE_MIN) {
    return { ok: false, error: `This rule is unverified: the legal adviser has not seen it. To run it anyway, write down why you accept it (at least ${ACCEPTANCE_MIN} characters).` };
  }
  return { ok: true, acceptedUnverified: !x.ruleVerified, singleHolder: sp.singleHolder };
}

const PROBATION_LINE = /^(Probation extended \d+m:|Probation failed:|Confirmed after probation)/;

/**
 * The probation steps copy their reason into the contract's notes ("Probation failed: ..."). A probation run clears those lines and keeps every other note on the contract.
 * Returns what should remain, or null when nothing else was written.
 */
export function stripProbationNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const kept = notes.split("\n").filter((line) => !PROBATION_LINE.test(line.trim()));
  return kept.join("\n").trim() ? kept.join("\n") : null;
}
