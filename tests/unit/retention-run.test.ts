import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_MIN,
  MIN_REVIEW_SECONDS,
  NOTE_MIN,
  RUNNABLE_CATEGORIES,
  checkProposable,
  confirmVerdict,
  isRunnable,
  reviewWait,
  stripProbationNotes,
  subjectKind,
} from "@/lib/retention-run";
import { DEFAULT_RULES, RETENTION_CATEGORIES, checkRule } from "@/lib/retention-schedule";

// Governance step 3b-2 (docs/plans/hr-governance-step3b2-plan.md): the retention run. Pure rules, no database and no clock.

const rule = (over: Partial<{ periodMonths: number; trigger: string; action: string }> = {}) => ({ periodMonths: 72, trigger: "AFTER_EXIT", action: "ANONYMISE", ...over });

describe("which categories a run is offered for", () => {
  it("is the nine kinds of record about people, and never the three that run another way or the three that are only reviewed", () => {
    expect([...RUNNABLE_CATEGORIES].sort()).toEqual(["APPRAISALS", "DISCIPLINARY", "FEEDBACK", "IMPROVEMENT_PLANS", "PROBATION", "SKILLS", "SUCCESSION", "TRAINING", "WELFARE_CASES"]);
    for (const c of ["EMPLOYEE_FILE", "RAW_SURVEYS", "UNSUCCESSFUL_APPLICANTS", "AUDIT_LOGS", "ACCESS_LOGS", "SURVEY_REPORTS"]) expect(isRunnable(c), c).toBe(false);
    expect(RETENTION_CATEGORIES.filter(isRunnable)).toHaveLength(9);
  });
  it("counts welfare cases from the closing and succession from the last review as one record each, and every other kind as one person", () => {
    expect(subjectKind("WELFARE_CASES", "AFTER_CLOSURE")).toBe("RECORD");
    expect(subjectKind("WELFARE_CASES", "AFTER_EXIT")).toBe("PERSON");
    expect(subjectKind("SUCCESSION", "AFTER_RECORD_DATE")).toBe("RECORD");
    expect(subjectKind("SUCCESSION", "AFTER_EXIT")).toBe("PERSON");
    expect(subjectKind("DISCIPLINARY", "AFTER_EXIT")).toBe("PERSON");
  });
});

describe("whether a run can be proposed for a rule", () => {
  it("needs the rule to say anonymise: review, keep and delete are refused, and each says why", () => {
    expect(checkProposable("DISCIPLINARY", rule())).toBeNull();
    for (const action of ["REVIEW", "KEEP", "DELETE"]) expect(checkProposable("DISCIPLINARY", rule({ action })), action).toMatch(/nothing to anonymise/i);
  });
  it("explains the categories a run is never offered for", () => {
    expect(checkProposable("EMPLOYEE_FILE", rule())).toMatch(/records retention/i);
    expect(checkProposable("RAW_SURVEYS", rule())).toMatch(/by itself|HR policy/i);
    expect(checkProposable("UNSUCCESSFUL_APPLICANTS", rule())).toMatch(/by itself|HR policy/i);
    expect(checkProposable("AUDIT_LOGS", rule())).toMatch(/never deleted|only reviewed/i);
    expect(checkProposable("ACCESS_LOGS", rule())).toMatch(/never deleted|only reviewed/i);
    expect(checkProposable("NOT_A_CATEGORY", rule())).not.toBeNull();
  });
  it("needs a trigger the system can work out for that category", () => {
    expect(checkProposable("DISCIPLINARY", rule({ trigger: "AFTER_CLOSURE" }))).toMatch(/cannot work out|counted from/i);
    expect(checkProposable("WELFARE_CASES", rule({ trigger: "AFTER_CLOSURE" }))).toBeNull();
  });
  it("is satisfied by every default rule that says anonymise, for a category a run is offered for", () => {
    for (const r of DEFAULT_RULES.filter((x) => x.action === "ANONYMISE" && isRunnable(x.category))) expect(checkProposable(r.category, r), r.category).toBeNull();
  });
});

describe("a rule can only say delete where something deletes", () => {
  it("refuses delete for every category except the raw survey answers, and still allows it there", () => {
    for (const c of RETENTION_CATEGORIES.filter((x) => x !== "RAW_SURVEYS")) expect(checkRule({ periodMonths: 24, trigger: "AFTER_EXIT", action: "DELETE" }, c), c).toMatch(/only .*raw survey/i);
    expect(checkRule({ periodMonths: 24, trigger: "AFTER_SURVEY_CLOSE", action: "DELETE" }, "RAW_SURVEYS")).toBeNull();
    expect(checkRule({ periodMonths: 24, trigger: "AFTER_EXIT", action: "ANONYMISE" }, "SKILLS")).toBeNull();
    // without a category (the older callers) nothing changes
    expect(checkRule({ periodMonths: 24, trigger: "AFTER_EXIT", action: "DELETE" })).toBeNull();
  });
});

describe("the wait before a run can be confirmed", () => {
  const at = new Date("2026-11-13T10:00:00Z");
  it("is a minute from the proposal, counting down, and nothing after", () => {
    expect(MIN_REVIEW_SECONDS).toBe(60);
    expect(reviewWait(at, new Date("2026-11-13T10:00:00Z"))).toBe(60);
    expect(reviewWait(at, new Date("2026-11-13T10:00:45Z"))).toBe(15);
    expect(reviewWait(at, new Date("2026-11-13T10:01:00Z"))).toBe(0);
    expect(reviewWait(at, new Date("2026-11-14T10:00:00Z"))).toBe(0);
  });
});

describe("confirming a run", () => {
  const ok = { status: "PROPOSED", ruleChanged: false, ruleVerified: true, samePerson: false, otherHolders: 1, note: "Counts seen.", waitSeconds: 0 };
  it("goes ahead for a different person with a note, when the rule is verified", () => {
    expect(confirmVerdict(ok)).toEqual({ ok: true, acceptedUnverified: false, singleHolder: false });
  });
  it("refuses a run that is not waiting, or whose rule changed since it was proposed, or that is too new", () => {
    expect(confirmVerdict({ ...ok, status: "EXECUTED" })).toMatchObject({ ok: false });
    expect(confirmVerdict({ ...ok, status: "REJECTED" })).toMatchObject({ ok: false });
    expect(confirmVerdict({ ...ok, ruleChanged: true })).toMatchObject({ ok: false, error: expect.stringMatching(/changed since/i) });
    expect(confirmVerdict({ ...ok, waitSeconds: 20 })).toMatchObject({ ok: false, error: expect.stringMatching(/20 seconds/) });
  });
  it("needs a note of at least ten characters", () => {
    expect(NOTE_MIN).toBe(10);
    expect(confirmVerdict({ ...ok, note: "ok" })).toMatchObject({ ok: false });
    expect(confirmVerdict({ ...ok, note: "          " })).toMatchObject({ ok: false });
  });
  it("lets an unverified rule run only with a written acceptance of at least twenty characters, and flags it", () => {
    expect(ACCEPTANCE_MIN).toBe(20);
    expect(confirmVerdict({ ...ok, ruleVerified: false })).toMatchObject({ ok: false, error: expect.stringMatching(/unverified|adviser/i) });
    expect(confirmVerdict({ ...ok, ruleVerified: false, note: "Ten chars!!" })).toMatchObject({ ok: false });
    expect(confirmVerdict({ ...ok, ruleVerified: false, note: "We accept this period unverified, the lawyer is away." })).toEqual({ ok: true, acceptedUnverified: true, singleHolder: false });
  });
  it("refuses the person who proposed it while another person could confirm", () => {
    expect(confirmVerdict({ ...ok, samePerson: true, otherHolders: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/different person/i) });
  });
  it("lets the only person who can confirm confirm their own proposal, with a written reason, flagged", () => {
    expect(confirmVerdict({ ...ok, samePerson: true, otherHolders: 0 })).toMatchObject({ ok: false });
    expect(confirmVerdict({ ...ok, samePerson: true, otherHolders: 0, note: "I am the only administrator here, and the counts were checked." })).toEqual({ ok: true, acceptedUnverified: false, singleHolder: true });
  });
  it("flags both when the rule is unverified and the confirmer is the only holder", () => {
    expect(confirmVerdict({ ...ok, ruleVerified: false, samePerson: true, otherHolders: 0, note: "The only administrator here, and the lawyer is away this month." })).toEqual({ ok: true, acceptedUnverified: true, singleHolder: true });
  });
});

describe("clearing the probation words that were copied into a contract's notes", () => {
  it("removes only the three lines the probation steps write and keeps every other note", () => {
    const notes = ["Joined from the Lagos branch.", "Probation extended 3m: slow to learn the sites", "Probation failed: absent without notice", "Confirmed after probation: strong reports", "Uniform issued."].join("\n");
    expect(stripProbationNotes(notes)).toBe("Joined from the Lagos branch.\nUniform issued.");
  });
  it("gives nothing back when nothing else was written, and leaves empty notes empty", () => {
    expect(stripProbationNotes("Confirmed after probation")).toBeNull();
    expect(stripProbationNotes("Probation extended 6m: reason")).toBeNull();
    expect(stripProbationNotes(null)).toBeNull();
    expect(stripProbationNotes("")).toBeNull();
    expect(stripProbationNotes("A note that merely mentions probation in passing.")).toBe("A note that merely mentions probation in passing.");
  });
});
