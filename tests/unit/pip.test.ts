import { describe, expect, it } from "vitest";
import {
  approverConflict,
  checkExtension,
  checkLength,
  DEFAULT_PIP_LIMITS,
  employeeMaySee,
  isOpen,
  nextReviewDue,
  nextStatus,
  OBJECTIVE_RESULT_LABELS,
  OUTCOME_LABELS,
  PIP_STATUS_LABELS,
  planEnd,
  reviewState,
} from "@/lib/pip";

// Performance management, step (b): the performance improvement plan (the founder's go of 2026-11-07, plan docs/plans/performance-improvement-plan.md).
// All dates are plain "YYYY-MM-DD" days; no clock is read here, so every case is exact.

const L = DEFAULT_PIP_LIMITS;

describe("the limits (proposed defaults, held as settings, not in the logic)", () => {
  it("default 60 days, longest 90, one extension of at most 30 days, a review every 14 days", () => {
    expect(L).toEqual({ defaultDays: 60, maxDays: 90, maxExtensions: 1, maxExtensionDays: 30, reviewIntervalDays: 14 });
  });
});

describe("the end date", () => {
  it("is the start date plus the number of days", () => {
    expect(planEnd("2026-11-01", 60)).toBe("2026-12-31");
    expect(planEnd("2026-12-15", 30)).toBe("2027-01-14");
    expect(planEnd("2028-02-01", 29)).toBe("2028-03-01"); // a leap year
  });
});

describe("the length of a plan", () => {
  it("must be a whole number of days from 1 up to the longest allowed", () => {
    expect(checkLength(60, L)).toBeNull();
    expect(checkLength(90, L)).toBeNull();
    expect(checkLength(1, L)).toBeNull();
    expect(checkLength(91, L)).toMatch(/90/);
    expect(checkLength(0, L)).toMatch(/at least 1/i);
    expect(checkLength(-5, L)).toMatch(/at least 1/i);
    expect(checkLength(30.5, L)).toMatch(/whole/i);
  });
  it("follows the company's own longest length", () => {
    expect(checkLength(120, { ...L, maxDays: 120 })).toBeNull();
    expect(checkLength(61, { ...L, maxDays: 60 })).toMatch(/60/);
  });
});

describe("an extension", () => {
  const base = { extensionsUsed: 0, currentEnd: "2026-12-31" };
  it("is allowed within the number of extensions and the longest extension", () => {
    expect(checkExtension({ ...base, newEnd: "2027-01-30" }, L)).toBeNull(); // exactly 30 days
    expect(checkExtension({ ...base, newEnd: "2027-01-01" }, L)).toBeNull(); // 1 day
  });
  it("must move the end date later, and by no more than the longest extension", () => {
    expect(checkExtension({ ...base, newEnd: "2026-12-31" }, L)).toMatch(/later/i);
    expect(checkExtension({ ...base, newEnd: "2026-12-01" }, L)).toMatch(/later/i);
    expect(checkExtension({ ...base, newEnd: "2027-01-31" }, L)).toMatch(/30/); // 31 days
  });
  it("is refused once the extensions allowed have been used", () => {
    expect(checkExtension({ extensionsUsed: 1, currentEnd: "2026-12-31", newEnd: "2027-01-10" }, L)).toMatch(/already been extended|no further/i);
    expect(checkExtension({ extensionsUsed: 1, currentEnd: "2026-12-31", newEnd: "2027-01-10" }, { ...L, maxExtensions: 2 })).toBeNull();
    expect(checkExtension({ ...base, newEnd: "2027-01-10" }, { ...L, maxExtensions: 0 })).toMatch(/not allowed|no extension/i);
  });
});

describe("the status moves", () => {
  it("go forward along fixed steps only", () => {
    expect(nextStatus("DRAFT", "SUBMIT")).toBe("AWAITING_APPROVAL");
    expect(nextStatus("AWAITING_APPROVAL", "APPROVE_START")).toBe("ACTIVE");
    expect(nextStatus("AWAITING_APPROVAL", "RETURN")).toBe("DRAFT");
    expect(nextStatus("ACTIVE", "PROPOSE_OUTCOME")).toBe("OUTCOME_PROPOSED");
    expect(nextStatus("OUTCOME_PROPOSED", "RETURN")).toBe("ACTIVE");
  });
  it("closes on a Successful or Unsuccessful outcome, and stays Active on an extension", () => {
    expect(nextStatus("OUTCOME_PROPOSED", "APPROVE_OUTCOME", "SUCCESSFUL")).toBe("CLOSED");
    expect(nextStatus("OUTCOME_PROPOSED", "APPROVE_OUTCOME", "UNSUCCESSFUL")).toBe("CLOSED");
    expect(nextStatus("OUTCOME_PROPOSED", "APPROVE_OUTCOME", "EXTENDED")).toBe("ACTIVE");
  });
  it("lets any open plan be withdrawn, and nothing leave Closed or Withdrawn", () => {
    for (const s of ["DRAFT", "AWAITING_APPROVAL", "ACTIVE", "OUTCOME_PROPOSED"] as const) expect(nextStatus(s, "WITHDRAW"), s).toBe("WITHDRAWN");
    for (const s of ["CLOSED", "WITHDRAWN"] as const)
      for (const a of ["SUBMIT", "APPROVE_START", "RETURN", "PROPOSE_OUTCOME", "APPROVE_OUTCOME", "WITHDRAW"] as const) expect(nextStatus(s, a, "SUCCESSFUL"), `${s} ${a}`).toBeNull();
  });
  it("refuses every jump that skips a step", () => {
    expect(nextStatus("DRAFT", "APPROVE_START")).toBeNull(); // approving a plan nobody submitted
    expect(nextStatus("DRAFT", "PROPOSE_OUTCOME")).toBeNull();
    expect(nextStatus("AWAITING_APPROVAL", "PROPOSE_OUTCOME")).toBeNull();
    expect(nextStatus("ACTIVE", "APPROVE_OUTCOME", "SUCCESSFUL")).toBeNull(); // approving an outcome nobody proposed
    expect(nextStatus("ACTIVE", "SUBMIT")).toBeNull();
    expect(nextStatus("OUTCOME_PROPOSED", "APPROVE_OUTCOME")).toBeNull(); // an approval needs the outcome it approves
  });
  it("knows which statuses are open", () => {
    expect(["DRAFT", "AWAITING_APPROVAL", "ACTIVE", "OUTCOME_PROPOSED"].every((s) => isOpen(s as never))).toBe(true);
    expect(isOpen("CLOSED")).toBe(false);
    expect(isOpen("WITHDRAWN")).toBe(false);
  });
});

describe("who may approve", () => {
  const people = { drafterId: "u-draft", ownerId: "u-owner", proposerId: "u-prop" };
  it("a plan is started by someone who is neither its drafter nor its owner", () => {
    expect(approverConflict("APPROVE_START", people, "u-draft")).toMatch(/drafted/i);
    expect(approverConflict("APPROVE_START", people, "u-owner")).toMatch(/owner/i);
    expect(approverConflict("APPROVE_START", people, "u-prop")).toBeNull(); // the proposer of an outcome has no part in starting it
    expect(approverConflict("APPROVE_START", people, "u-other")).toBeNull();
  });
  it("an outcome is approved by someone who is neither the person who proposed it nor the owner", () => {
    expect(approverConflict("APPROVE_OUTCOME", people, "u-prop")).toMatch(/proposed/i);
    expect(approverConflict("APPROVE_OUTCOME", people, "u-owner")).toMatch(/owner/i);
    expect(approverConflict("APPROVE_OUTCOME", people, "u-draft")).toBeNull(); // the drafter may approve the outcome (a different step)
    expect(approverConflict("APPROVE_OUTCOME", people, "u-other")).toBeNull();
  });
  it("returning a plan or an outcome follows the same separation as approving it", () => {
    expect(approverConflict("RETURN_START", people, "u-draft")).toMatch(/drafted/i);
    expect(approverConflict("RETURN_OUTCOME", people, "u-prop")).toMatch(/proposed/i);
  });
});

describe("when a review is due", () => {
  it("the next review is one interval after the last, never later than the end date", () => {
    expect(nextReviewDue("2026-11-01", "2026-12-31", L)).toBe("2026-11-15");
    expect(nextReviewDue("2026-12-25", "2026-12-31", L)).toBe("2026-12-31");
    expect(nextReviewDue("2026-12-31", "2026-12-31", L)).toBe("2026-12-31");
  });
  it("states Overdue after the day, Due on the day, Upcoming before, and nothing for a plan that is not active", () => {
    expect(reviewState({ status: "ACTIVE", nextReviewDue: "2026-11-15" }, "2026-11-16")).toBe("OVERDUE");
    expect(reviewState({ status: "ACTIVE", nextReviewDue: "2026-11-15" }, "2026-11-15")).toBe("DUE");
    expect(reviewState({ status: "ACTIVE", nextReviewDue: "2026-11-15" }, "2026-11-14")).toBe("UPCOMING");
    expect(reviewState({ status: "DRAFT", nextReviewDue: null }, "2026-11-14")).toBe("NONE");
    expect(reviewState({ status: "CLOSED", nextReviewDue: "2026-11-15" }, "2026-11-20")).toBe("NONE");
    expect(reviewState({ status: "OUTCOME_PROPOSED", nextReviewDue: "2026-11-15" }, "2026-11-20")).toBe("NONE");
  });
});

describe("what the employee may see", () => {
  it("nothing until the plan has been started, and everything after, including a closed one", () => {
    expect(employeeMaySee("DRAFT", null)).toBe(false);
    expect(employeeMaySee("AWAITING_APPROVAL", null)).toBe(false);
    expect(employeeMaySee("ACTIVE", new Date())).toBe(true);
    expect(employeeMaySee("OUTCOME_PROPOSED", new Date())).toBe(true);
    expect(employeeMaySee("CLOSED", new Date())).toBe(true);
  });
  it("a withdrawn plan only if it had been started", () => {
    expect(employeeMaySee("WITHDRAWN", null)).toBe(false); // withdrawn before anyone told the employee
    expect(employeeMaySee("WITHDRAWN", new Date())).toBe(true);
  });
});

describe("labels", () => {
  it("every status, outcome and objective result has a plain label", () => {
    expect(Object.keys(PIP_STATUS_LABELS).sort()).toEqual(["ACTIVE", "AWAITING_APPROVAL", "CLOSED", "DRAFT", "OUTCOME_PROPOSED", "WITHDRAWN"]);
    expect(Object.keys(OUTCOME_LABELS).sort()).toEqual(["EXTENDED", "SUCCESSFUL", "UNSUCCESSFUL"]);
    expect(Object.keys(OBJECTIVE_RESULT_LABELS).sort()).toEqual(["MET", "NOT_MET", "OPEN", "PARTLY_MET"]);
  });
});
