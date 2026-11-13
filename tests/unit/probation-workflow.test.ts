import { describe, expect, it } from "vitest";
import { can, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import {
  FEEDBACK_MAX,
  NOTE_MIN,
  RECOMMENDATIONS,
  RESPONSE_MAX,
  checkFeedback,
  checkRecommendationNote,
  checkResponse,
  departsFromReview,
  deciderConflict,
  recommendationWindowOpen,
  responseOpen,
  reviewerConflict,
  toDecision,
} from "@/lib/probation-workflow";

// The probation workflow (docs/plans/probation-workflow-plan.md): the manager recommends, HR reviews, an independent designated decider decides, the employee gets documented
// feedback and may respond once. Pure rules: no database, no clock (dates are plain "YYYY-MM-DD" days).

describe("recommendations", () => {
  it("has the three the register names, each mapping to the decision that already exists", () => {
    expect([...RECOMMENDATIONS]).toEqual(["CONFIRM", "EXTEND", "NOT_CONFIRM"]);
    expect(RECOMMENDATIONS.map(toDecision)).toEqual(["CONFIRMED", "EXTENDED", "FAILED"]);
  });
  it("needs a reasoned note of at least 20 characters", () => {
    expect(NOTE_MIN).toBe(20);
    expect(checkRecommendationNote("too short")).not.toBeNull();
    expect(checkRecommendationNote("   " + "x".repeat(19) + "   ")).not.toBeNull(); // spaces do not count
    expect(checkRecommendationNote("x".repeat(20))).toBeNull();
  });
});

describe("when a manager may recommend", () => {
  it("opens the alert window (default 30 days) before the end date and stays open after it", () => {
    expect(recommendationWindowOpen("2026-12-31", "2026-11-30", 30)).toBe(false); // 31 days before the end: not yet
    expect(recommendationWindowOpen("2026-12-31", "2026-12-01", 30)).toBe(true); // the 30th day before: the window opens
    expect(recommendationWindowOpen("2026-12-31", "2026-11-29", 30)).toBe(false);
    expect(recommendationWindowOpen("2026-12-31", "2027-01-15", 30)).toBe(true); // overdue: still open
    expect(recommendationWindowOpen("2026-12-31", "2026-12-31", 0)).toBe(true);
    expect(recommendationWindowOpen("2026-12-31", "2026-12-30", 0)).toBe(false);
  });
});

describe("who may review and who may decide", () => {
  it("the HR reviewer is not the person who recorded the recommendation", () => {
    expect(reviewerConflict("u1", "u1")).not.toBeNull();
    expect(reviewerConflict("u2", "u1")).toBeNull();
  });
  const base = { recommenderUserId: "rec", reviewerUserId: "hr", employeeId: "e1", deciderEmployeeId: "e9", appraisal: { reviewerUserId: "apr", approvedByUserId: "aps" } };
  it("the decider is never the recommender, the HR reviewer, the appraisal's reviewer or signer, or the employee", () => {
    expect(deciderConflict("rec", base)).not.toBeNull();
    expect(deciderConflict("hr", base)).not.toBeNull();
    expect(deciderConflict("apr", base)).not.toBeNull();
    expect(deciderConflict("aps", base)).not.toBeNull();
    expect(deciderConflict("someone", { ...base, deciderEmployeeId: "e1" })).not.toBeNull(); // the employee's own login
    expect(deciderConflict("someone", base)).toBeNull();
  });
  it("with no probation appraisal, only the recommender, the HR reviewer and the employee are excluded", () => {
    expect(deciderConflict("apr", { ...base, appraisal: null })).toBeNull();
    expect(deciderConflict("rec", { ...base, appraisal: null })).not.toBeNull();
  });
});

describe("a decision against the recommendation", () => {
  it("is any decision other than the one recommended", () => {
    expect(departsFromReview("CONFIRMED", "CONFIRM")).toBe(false);
    expect(departsFromReview("EXTENDED", "EXTEND")).toBe(false);
    expect(departsFromReview("FAILED", "NOT_CONFIRM")).toBe(false);
    expect(departsFromReview("FAILED", "CONFIRM")).toBe(true);
    expect(departsFromReview("CONFIRMED", "EXTEND")).toBe(true);
    expect(departsFromReview("EXTENDED", "NOT_CONFIRM")).toBe(true);
  });
});

describe("the feedback the employee receives", () => {
  it("is required for Extend and Not confirmed, optional for Confirm, and at most 1,000 characters", () => {
    expect(FEEDBACK_MAX).toBe(1000);
    expect(checkFeedback("EXTENDED", "")).not.toBeNull();
    expect(checkFeedback("FAILED", undefined)).not.toBeNull();
    expect(checkFeedback("FAILED", "short")).not.toBeNull();
    expect(checkFeedback("FAILED", "A clear statement of what was found.")).toBeNull();
    expect(checkFeedback("CONFIRMED", "")).toBeNull();
    expect(checkFeedback("CONFIRMED", undefined)).toBeNull();
    expect(checkFeedback("CONFIRMED", "x".repeat(1001))).not.toBeNull();
  });
});

describe("the employee's response", () => {
  it("is one agree or disagree; disagreeing needs a sentence; at most 1,000 characters", () => {
    expect(RESPONSE_MAX).toBe(1000);
    expect(checkResponse(true, "")).toBeNull();
    expect(checkResponse(false, "")).not.toBeNull();
    expect(checkResponse(false, "no")).not.toBeNull();
    expect(checkResponse(false, "I was never given the targets.")).toBeNull();
    expect(checkResponse(true, "x".repeat(1001))).not.toBeNull();
  });
  it("can be given inside the company's window, counted from the day HR told the employee (the day itself counts); 0 means no time limit", () => {
    expect(responseOpen("2026-11-10", "2026-11-17", 7)).toBe(true);
    expect(responseOpen("2026-11-10", "2026-11-18", 7)).toBe(false);
    expect(responseOpen("2026-11-10", "2027-05-01", 0)).toBe(true);
  });
});

describe("who can open the probation pages", () => {
  const roles = Object.keys(ROLE_PERMISSIONS) as Role[];
  it("every staff role can open the Probation page (a decider may hold any of them); client and sales roles cannot", () => {
    const staff: Role[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN", "HR_OFFICER", "OPERATIONS", "PAYROLL_ADMIN", "FINANCE", "AUDITOR", "SUPERVISOR", "EMPLOYEE"];
    for (const r of staff) expect(can(r, "probation.view"), r).toBe(true);
    for (const r of roles.filter((x) => !staff.includes(x))) expect(can(r, "probation.view"), r).toBe(false);
  });
  it("designating deciders stays with the Company Administrator and platform staff, never the HR administrator", () => {
    expect(roles.filter((r) => can(r, "probation.designate")).sort()).toEqual(["COMPANY_ADMIN", "SUPER_ADMIN"]);
  });
});
