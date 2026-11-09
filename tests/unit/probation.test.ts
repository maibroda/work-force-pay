import { describe, expect, it } from "vitest";
import { AGAINST_REASON_MIN, checkAgainstReason, daysOverdue, decisionConflict, departsFromRecommendation, employeeLine, escalated } from "@/lib/probation";

// Performance management, step (d): the probation review and its decision (the founder's go of 2026-11-09, plan docs/plans/probation-review-plan.md).
// Dates are plain "YYYY-MM-DD" days; no clock is read here.

describe("a decision that goes against the appraisal's recommendation", () => {
  it("confirming someone whose appraisal recommended a plan or more training goes against it", () => {
    expect(departsFromRecommendation("CONFIRMED", "PERFORMANCE_PLAN")).toBe(true);
    expect(departsFromRecommendation("CONFIRMED", "TRAINING")).toBe(true);
  });
  it("failing someone whose appraisal recommended confirmation, an increment or a promotion goes against it", () => {
    for (const r of ["CONFIRM_EMPLOYMENT", "INCREMENT", "PROMOTION"]) expect(departsFromRecommendation("FAILED", r), r).toBe(true);
  });
  it("extending probation when the appraisal recommended confirmation goes against it", () => {
    expect(departsFromRecommendation("EXTENDED", "CONFIRM_EMPLOYMENT")).toBe(true);
  });
  it("a decision in line with the recommendation, with no recommendation, or with no appraisal, does not", () => {
    expect(departsFromRecommendation("CONFIRMED", "CONFIRM_EMPLOYMENT")).toBe(false);
    expect(departsFromRecommendation("CONFIRMED", "INCREMENT")).toBe(false);
    expect(departsFromRecommendation("EXTENDED", "PERFORMANCE_PLAN")).toBe(false);
    expect(departsFromRecommendation("EXTENDED", "TRAINING")).toBe(false);
    expect(departsFromRecommendation("FAILED", "PERFORMANCE_PLAN")).toBe(false);
    expect(departsFromRecommendation("FAILED", "TRAINING")).toBe(false);
    for (const k of ["CONFIRMED", "EXTENDED", "FAILED"] as const) {
      expect(departsFromRecommendation(k, "NONE"), `${k} NONE`).toBe(false);
      expect(departsFromRecommendation(k, null), `${k} none on file`).toBe(false);
    }
  });
});

describe("the fuller reason", () => {
  it("is at least 20 characters once spaces at the ends are trimmed", () => {
    expect(AGAINST_REASON_MIN).toBe(20);
    expect(checkAgainstReason("Short reason")).toMatch(/at least 20/);
    expect(checkAgainstReason("   " + "x".repeat(19) + "   ")).toMatch(/at least 20/);
    expect(checkAgainstReason("x".repeat(20))).toBeNull();
    expect(checkAgainstReason(undefined)).toMatch(/at least 20/);
    expect(checkAgainstReason(null)).toMatch(/at least 20/);
  });
});

describe("who may decide", () => {
  const appraisal = { reviewerUserId: "u-reviewer", approvedByUserId: "u-signer" };
  it("not the person who reviewed the probation appraisal, nor the one who signed it off", () => {
    expect(decisionConflict("u-reviewer", appraisal)).toMatch(/reviewed/i);
    expect(decisionConflict("u-signer", appraisal)).toMatch(/signed off/i);
  });
  it("anyone else may, and so may anyone when there is no probation appraisal", () => {
    expect(decisionConflict("u-other", appraisal)).toBeNull();
    expect(decisionConflict("u-reviewer", null)).toBeNull();
    expect(decisionConflict("u-reviewer", { reviewerUserId: null, approvedByUserId: null })).toBeNull();
  });
});

describe("a probation past its end with no decision", () => {
  it("counts whole days after the end date, and zero on or before it", () => {
    expect(daysOverdue("2026-11-01", "2026-11-01")).toBe(0);
    expect(daysOverdue("2026-11-01", "2026-10-25")).toBe(0);
    expect(daysOverdue("2026-11-01", "2026-11-02")).toBe(1);
    expect(daysOverdue("2026-11-01", "2026-11-08")).toBe(7);
    expect(daysOverdue("2026-02-27", "2026-03-02")).toBe(3);
  });
  it("is escalated once it has been overdue for the company's number of days", () => {
    expect(escalated(6, 7)).toBe(false);
    expect(escalated(7, 7)).toBe(true);
    expect(escalated(30, 7)).toBe(true);
    expect(escalated(0, 7)).toBe(false);
    expect(escalated(3, 3)).toBe(true);
  });
  it("is never escalated when the company sets zero (switched off)", () => {
    expect(escalated(30, 0)).toBe(false);
  });
});

describe("the line the employee sees", () => {
  it("only once HR has told them, never the reasons", () => {
    expect(employeeLine({ decision: "CONFIRMED", informed: false, date: "2026-03-03" })).toBeNull();
    expect(employeeLine({ decision: "FAILED", informed: false, date: null })).toBeNull();
    expect(employeeLine({ decision: "CONFIRMED", informed: true, date: "2026-03-03" })).toBe("Probation confirmed: permanent from 03 Mar 2026.");
    expect(employeeLine({ decision: "EXTENDED", informed: true, date: "2026-06-03" })).toBe("Probation extended to 03 Jun 2026.");
    expect(employeeLine({ decision: "FAILED", informed: true, date: null })).toBe("Probation not confirmed.");
  });
});
