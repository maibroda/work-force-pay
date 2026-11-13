import { describe, expect, it } from "vitest";
import { erasureBlockers, type ErasureFacts } from "@/lib/employee-retention";
import {
  APPLIED_FROM_POLICY,
  DEFAULT_RULES,
  RETENTION_ACTIONS,
  RETENTION_CATEGORIES,
  RETENTION_CATEGORY_LABELS,
  RETENTION_TRIGGERS,
  checkHoldInput,
  checkRule,
  holdBlocks,
  holdBlocksPerson,
  holdNeedsReview,
  type HoldLike,
} from "@/lib/retention-schedule";

// Governance step 3a (docs/plans/hr-governance-plan.md, section 2.4): the retention schedule as DATA (the founder's proposed defaults, loaded UNVERIFIED until the legal adviser has seen
// them), legal holds that block the deletions that exist, and nothing here deletes anything. Pure rules, no database and no clock (dates are plain "YYYY-MM-DD" days).

describe("the schedule's categories and the founder's proposed defaults", () => {
  it("covers the fifteen record categories of the plan, each with a label and exactly one default", () => {
    expect(RETENTION_CATEGORIES).toHaveLength(15);
    expect(DEFAULT_RULES.map((r) => r.category).sort()).toEqual([...RETENTION_CATEGORIES].sort());
    for (const c of RETENTION_CATEGORIES) expect(RETENTION_CATEGORY_LABELS[c].length).toBeGreaterThan(3);
  });
  it("loads the proposed periods: six years after exit or closure for the employee records, 24 months for raw survey answers and for unsuccessful applicants, indefinitely for the anonymised reports", () => {
    const by = Object.fromEntries(DEFAULT_RULES.map((r) => [r.category, r]));
    for (const c of ["EMPLOYEE_FILE", "APPRAISALS", "PROBATION", "FEEDBACK", "IMPROVEMENT_PLANS", "DISCIPLINARY", "TRAINING", "SKILLS"] as const) expect(by[c], c).toMatchObject({ periodMonths: 72, trigger: "AFTER_EXIT" });
    expect(by.WELFARE_CASES).toMatchObject({ periodMonths: 72, trigger: "AFTER_CLOSURE" });
    expect(by.RAW_SURVEYS).toMatchObject({ periodMonths: 24, trigger: "AFTER_SURVEY_CLOSE", action: "DELETE" });
    expect(by.UNSUCCESSFUL_APPLICANTS).toMatchObject({ periodMonths: 24, trigger: "AFTER_RECRUITMENT_CLOSE" });
    expect(by.SURVEY_REPORTS).toMatchObject({ periodMonths: 0, action: "KEEP" });
    expect(by.SUCCESSION).toMatchObject({ periodMonths: 12, action: "REVIEW" });
  });
  it("never has the application delete the audit log or the access logs: those are only reviewed", () => {
    const by = Object.fromEntries(DEFAULT_RULES.map((r) => [r.category, r]));
    expect(by.AUDIT_LOGS.action).toBe("REVIEW");
    expect(by.ACCESS_LOGS.action).toBe("REVIEW");
  });
  it("knows which three categories the system already applies today, from the HR policy, and which it does not", () => {
    expect(APPLIED_FROM_POLICY).toEqual({ EMPLOYEE_FILE: "employeeRetentionYears", RAW_SURVEYS: "surveyRetentionMonths", UNSUCCESSFUL_APPLICANTS: "candidateRetentionMonths" });
    for (const c of RETENTION_CATEGORIES.filter((x) => !(x in APPLIED_FROM_POLICY))) expect(APPLIED_FROM_POLICY[c], c).toBeUndefined();
  });
  it("has valid triggers and actions in every default", () => {
    for (const r of DEFAULT_RULES) {
      expect(RETENTION_TRIGGERS).toContain(r.trigger);
      expect(RETENTION_ACTIONS).toContain(r.action);
      expect(checkRule(r), r.category).toBeNull();
    }
  });
});

describe("a rule", () => {
  it("is deleted or anonymised only after a period of at least a month; keeping means no period; a review may have a period", () => {
    expect(checkRule({ periodMonths: 0, trigger: "AFTER_EXIT", action: "DELETE" })).not.toBeNull();
    expect(checkRule({ periodMonths: 0, trigger: "AFTER_EXIT", action: "ANONYMISE" })).not.toBeNull();
    expect(checkRule({ periodMonths: 12, trigger: "AFTER_EXIT", action: "KEEP" })).not.toBeNull();
    expect(checkRule({ periodMonths: 0, trigger: "AFTER_EXIT", action: "KEEP" })).toBeNull();
    expect(checkRule({ periodMonths: 12, trigger: "AFTER_RECORD_DATE", action: "REVIEW" })).toBeNull();
    expect(checkRule({ periodMonths: 1, trigger: "AFTER_EXIT", action: "ANONYMISE" })).toBeNull();
  });
  it("is at most one hundred years, in whole months", () => {
    expect(checkRule({ periodMonths: 1201, trigger: "AFTER_EXIT", action: "REVIEW" })).not.toBeNull();
    expect(checkRule({ periodMonths: 1.5, trigger: "AFTER_EXIT", action: "REVIEW" })).not.toBeNull();
    expect(checkRule({ periodMonths: -1, trigger: "AFTER_EXIT", action: "REVIEW" })).not.toBeNull();
    expect(checkRule({ periodMonths: 1200, trigger: "AFTER_EXIT", action: "REVIEW" })).toBeNull();
  });
});

describe("a legal hold", () => {
  const hold = (over: Partial<HoldLike> = {}): HoldLike => ({ id: "h1", scope: "EMPLOYEE", employeeId: "e1", category: null, releasedAt: null, reviewOn: "2027-01-31", ...over });
  it("on one person blocks that person for the categories about a person, and nobody else", () => {
    expect(holdBlocks([hold()], { category: "EMPLOYEE_FILE", employeeId: "e1" })).toMatchObject({ id: "h1" });
    expect(holdBlocks([hold()], { category: "EMPLOYEE_FILE", employeeId: "e2" })).toBeNull();
    expect(holdBlocks([hold()], { category: "RAW_SURVEYS" })).toBeNull(); // a person’s hold is not a survey’s
  });
  it("on a whole category blocks everything in that category and nothing in another", () => {
    const h = hold({ scope: "CATEGORY", employeeId: null, category: "RAW_SURVEYS" });
    expect(holdBlocks([h], { category: "RAW_SURVEYS" })).toMatchObject({ id: "h1" });
    expect(holdBlocks([h], { category: "EMPLOYEE_FILE", employeeId: "e1" })).toBeNull();
  });
  it("on the whole company blocks every category", () => {
    const h = hold({ scope: "COMPANY", employeeId: null });
    for (const c of RETENTION_CATEGORIES) expect(holdBlocks([h], { category: c, employeeId: "e9" }), c).toMatchObject({ id: "h1" });
  });
  it("stops blocking once released", () => {
    expect(holdBlocks([hold({ releasedAt: "2026-11-01" })], { category: "EMPLOYEE_FILE", employeeId: "e1" })).toBeNull();
  });
  it("blocks erasing a whole person when any record category about them, or the company, is held, but not a survey or log hold", () => {
    expect(holdBlocksPerson([hold()], "e1")).toMatchObject({ id: "h1" });
    expect(holdBlocksPerson([hold()], "e2")).toBeNull();
    expect(holdBlocksPerson([hold({ scope: "CATEGORY", employeeId: null, category: "DISCIPLINARY" })], "e2")).toMatchObject({ id: "h1" });
    expect(holdBlocksPerson([hold({ scope: "CATEGORY", employeeId: null, category: "RAW_SURVEYS" })], "e1")).toBeNull();
    expect(holdBlocksPerson([hold({ scope: "CATEGORY", employeeId: null, category: "AUDIT_LOGS" })], "e1")).toBeNull();
    expect(holdBlocksPerson([hold({ scope: "COMPANY", employeeId: null })], "e9")).toMatchObject({ id: "h1" });
    expect(holdBlocksPerson([hold({ releasedAt: "2026-11-01" })], "e1")).toBeNull();
  });
  it("is due for review on and after its review day, never once released", () => {
    expect(holdNeedsReview(hold({ reviewOn: "2027-01-31" }), "2027-01-30")).toBe(false);
    expect(holdNeedsReview(hold({ reviewOn: "2027-01-31" }), "2027-01-31")).toBe(true);
    expect(holdNeedsReview(hold({ reviewOn: "2027-01-31", releasedAt: "2027-01-01" }), "2027-02-15")).toBe(false);
  });
  it("needs a reason, a review day in the future, and the thing it covers", () => {
    const ok = { scope: "EMPLOYEE" as const, employeeId: "e1", category: null, reason: "A tribunal claim is expected.", reviewOn: "2027-02-01", today: "2026-11-13" };
    expect(checkHoldInput(ok)).toBeNull();
    expect(checkHoldInput({ ...ok, reason: "short" })).not.toBeNull();
    expect(checkHoldInput({ ...ok, reviewOn: "2026-11-13" })).not.toBeNull(); // must be after today
    expect(checkHoldInput({ ...ok, employeeId: null })).not.toBeNull();
    expect(checkHoldInput({ ...ok, scope: "CATEGORY", employeeId: null, category: null })).not.toBeNull();
    expect(checkHoldInput({ ...ok, scope: "CATEGORY", employeeId: null, category: "RAW_SURVEYS" })).toBeNull();
    expect(checkHoldInput({ ...ok, scope: "COMPANY", employeeId: null })).toBeNull();
  });
});

describe("the existing erasure rules know about a hold", () => {
  const facts: ErasureFacts = { years: 6, status: "EXITED", exitDate: new Date("2015-01-01T00:00:00Z"), anonymizedAt: null, today: new Date("2026-11-13T00:00:00Z"), loanOwed: 0, settlementsOpen: 0, casesOpen: 0, dataRequestsOpen: 0, alreadyPending: false };
  it("blocks erasure while a hold covers the person, whatever else is clear, and says so without giving the reason", () => {
    expect(erasureBlockers(facts)).toEqual([]);
    const blocked = erasureBlockers({ ...facts, onHold: true });
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatch(/legal hold/i);
  });
});
