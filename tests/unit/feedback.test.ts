import { describe, expect, it } from "vitest";
import { checkBody, checkRelatesOn, FEEDBACK_KIND_LABELS, FEEDBACK_KINDS, FEEDBACK_LIMITS, inPeriod, mayGiveFeedback } from "@/lib/feedback";

// Performance management, step (c): continuous feedback (the founder's go of 2026-11-07, plan docs/plans/continuous-feedback-plan.md).
// All dates are plain "YYYY-MM-DD" days; no clock is read here, so every case is exact.

describe("who may give feedback about an employee", () => {
  const target = { employeeId: "e-guard", reportingManagerId: "e-sup" };
  it("the employee's reporting manager may, about a direct report", () => {
    expect(mayGiveFeedback({ giverEmployeeId: "e-sup", isHr: false }, target)).toBeNull();
  });
  it("HR may, about anyone, with or without an employee record of their own", () => {
    expect(mayGiveFeedback({ giverEmployeeId: null, isHr: true }, target)).toBeNull();
    expect(mayGiveFeedback({ giverEmployeeId: "e-hr", isHr: true }, target)).toBeNull();
  });
  it("a manager may not give it about someone who does not report to them, and the answer is only that the person is not found", () => {
    expect(mayGiveFeedback({ giverEmployeeId: "e-other-sup", isHr: false }, target)).toBe("NOT_FOUND");
    expect(mayGiveFeedback({ giverEmployeeId: null, isHr: false }, target)).toBe("NOT_FOUND");
    expect(mayGiveFeedback({ giverEmployeeId: "e-sup", isHr: false }, { employeeId: "e-guard", reportingManagerId: null })).toBe("NOT_FOUND");
  });
  it("nobody may give feedback about themselves, HR included", () => {
    expect(mayGiveFeedback({ giverEmployeeId: "e-guard", isHr: true }, target)).toBe("SELF");
    expect(mayGiveFeedback({ giverEmployeeId: "e-sup", isHr: false }, { employeeId: "e-sup", reportingManagerId: "e-sup" })).toBe("SELF"); // even if recorded as their own manager
  });
});

describe("the text", () => {
  it("needs at least a few words and is short by design", () => {
    expect(FEEDBACK_LIMITS).toEqual({ minChars: 5, maxChars: 1000 });
    expect(checkBody("Well done today")).toBeNull();
    expect(checkBody("   ok   ")).toMatch(/at least 5/);
    expect(checkBody("")).toMatch(/at least 5/);
    expect(checkBody("x".repeat(1000))).toBeNull();
    expect(checkBody("x".repeat(1001))).toMatch(/at most 1000/);
  });
});

describe("the date it relates to", () => {
  it("may be today or earlier, never in the future", () => {
    expect(checkRelatesOn("2026-11-10", "2026-11-10")).toBeNull();
    expect(checkRelatesOn("2026-11-01", "2026-11-10")).toBeNull();
    expect(checkRelatesOn("2026-11-11", "2026-11-10")).toMatch(/future/i);
  });
});

describe("an appraisal period", () => {
  it("includes both its first and its last day, and nothing outside", () => {
    expect(inPeriod("2026-01-01", { from: "2026-01-01", to: "2026-06-30" })).toBe(true);
    expect(inPeriod("2026-06-30", { from: "2026-01-01", to: "2026-06-30" })).toBe(true);
    expect(inPeriod("2025-12-31", { from: "2026-01-01", to: "2026-06-30" })).toBe(false);
    expect(inPeriod("2026-07-01", { from: "2026-01-01", to: "2026-06-30" })).toBe(false);
  });
});

describe("labels", () => {
  it("there are two kinds, Recognition and Coaching, each with a plain label", () => {
    expect([...FEEDBACK_KINDS]).toEqual(["RECOGNITION", "COACHING"]);
    expect(Object.keys(FEEDBACK_KIND_LABELS).sort()).toEqual(["COACHING", "RECOGNITION"]);
  });
});
