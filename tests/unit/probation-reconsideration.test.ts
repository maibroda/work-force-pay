import { describe, expect, it } from "vitest";
import {
  RECONSIDERATION_STATUSES,
  STATEMENT_WORDING_REVIEWED,
  ceilingProblem,
  checkExpectations,
  checkJustification,
  countsTowardLimit,
  extensionEnd,
  isOpenStatus,
  statementFor,
  windowOpen,
} from "@/lib/probation-reconsideration";

// Failed-probation reconsideration (the founder's approval of 2026-11-17, F1 to F4 as recommended; docs/plans/failed-probation-renewal-proposal.md). A failed probation stays recorded as failed;
// a separately approved reconsideration may extend it, never automatically. These are the pure rules: no database and no clock (dates are plain "YYYY-MM-DD" days).

describe("the reconsideration window", () => {
  it("is open on the day of the failed decision and for the company's number of days after it, then closed", () => {
    expect(windowOpen("2026-11-01", "2026-11-01", 14)).toBe(true);
    expect(windowOpen("2026-11-01", "2026-11-15", 14)).toBe(true);
    expect(windowOpen("2026-11-01", "2026-11-16", 14)).toBe(false);
  });

  it("follows the company's own number of days", () => {
    expect(windowOpen("2026-11-01", "2026-11-08", 7)).toBe(true);
    expect(windowOpen("2026-11-01", "2026-11-09", 7)).toBe(false);
  });
});

describe("the ceiling on the total probation", () => {
  it("allows a total up to the ceiling and refuses anything over it", () => {
    expect(ceilingProblem(3, 6, 9)).toBeNull();
    expect(ceilingProblem(3, 7, 9)).toMatch(/10 month/);
    expect(ceilingProblem(3, 7, 9)).toMatch(/ceiling .* is 9/);
    expect(ceilingProblem(6, 3, 9)).toBeNull();
    expect(ceilingProblem(6, 5, 9)).toMatch(/11 month/);
  });

  it("wants a whole number of months, at least one", () => {
    expect(ceilingProblem(3, 0, 9)).toMatch(/at least one month/i);
    expect(ceilingProblem(3, 1.5, 9)).toMatch(/whole number/i);
  });
});

describe("the revised review date", () => {
  it("is the extension period counted from the day it takes effect, ending the day before the same date months later", () => {
    expect(extensionEnd("2026-11-17", 3)).toBe("2027-02-16");
    expect(extensionEnd("2026-11-17", 1)).toBe("2026-12-16");
  });

  it("copes with a short month (31 August plus six months is 28 February, so the period ends on 27 February)", () => {
    expect(extensionEnd("2026-08-31", 6)).toBe("2027-02-27");
  });
});

describe("what has to be written", () => {
  it("the supervisor's justification must be at least the company's number of characters, ignoring spaces at the ends", () => {
    expect(checkJustification("x".repeat(50), 50)).toBeNull();
    expect(checkJustification("   " + "x".repeat(49) + "   ", 50)).toMatch(/50 characters/);
    expect(checkJustification(undefined, 50)).toMatch(/50 characters/);
  });

  it("there must be at least the company's number of measurable expectations, each with a measure, a target and a review date that is a real day not in the past", () => {
    const ok = { measure: "Rota gaps per month", target: "No more than one", reviewOn: "2026-12-15" };
    expect(checkExpectations([ok], 1, "2026-11-17")).toBeNull();
    expect(checkExpectations([], 1, "2026-11-17")).toMatch(/at least 1/);
    expect(checkExpectations([{ ...ok, measure: "" }], 1, "2026-11-17")).toMatch(/measure/i);
    expect(checkExpectations([{ ...ok, target: " " }], 1, "2026-11-17")).toMatch(/target/i);
    expect(checkExpectations([{ ...ok, reviewOn: "soon" }], 1, "2026-11-17")).toMatch(/review date/i);
    expect(checkExpectations([{ ...ok, reviewOn: "2026-11-01" }], 1, "2026-11-17")).toMatch(/past/i);
    expect(checkExpectations([ok], 2, "2026-11-17")).toMatch(/at least 2/);
  });
});

describe("which reconsiderations count against the limit per contract", () => {
  it("counts one that is asked, forwarded, approved, effective or declined; not one returned for more work or withdrawn", () => {
    for (const s of ["REQUESTED", "FORWARDED", "APPROVED", "EFFECTIVE", "DECLINED"] as const) expect(countsTowardLimit(s), s).toBe(true);
    for (const s of ["RETURNED", "WITHDRAWN"] as const) expect(countsTowardLimit(s), s).toBe(false);
  });

  it("is still in progress while asked, forwarded or approved (not yet effective)", () => {
    for (const s of ["REQUESTED", "FORWARDED", "APPROVED"] as const) expect(isOpenStatus(s), s).toBe(true);
    for (const s of ["RETURNED", "DECLINED", "EFFECTIVE", "WITHDRAWN"] as const) expect(isOpenStatus(s), s).toBe(false);
  });

  it("has exactly the seven statuses", () => {
    expect([...RECONSIDERATION_STATUSES]).toEqual(["REQUESTED", "RETURNED", "FORWARDED", "APPROVED", "DECLINED", "EFFECTIVE", "WITHDRAWN"]);
  });
});

describe("the written statement to the employee", () => {
  const s = statementFor({ failedOn: "2026-11-01", months: 3, newEnd: "2027-02-16", expectations: [{ measure: "Rota gaps per month", target: "No more than one", reviewOn: "2026-12-15" }] });

  it("states the facts only: the earlier decision, the extension and the new review date, the conditions with their review dates, and the right to respond once", () => {
    expect(s).toContain("1 November 2026");
    expect(s).toMatch(/extended by 3 months/);
    expect(s).toContain("16 February 2027");
    expect(s).toContain("Rota gaps per month");
    expect(s).toContain("No more than one");
    expect(s).toContain("15 December 2026");
    expect(s).toMatch(/respond once/i);
  });

  it("says nothing about pay, and the wording is marked as not yet reviewed by a lawyer until someone says it has been", () => {
    expect(s.toLowerCase()).not.toMatch(/\bpay\b|salary|wage/);
    expect(STATEMENT_WORDING_REVIEWED).toBe(false);
  });

  it("says one month, not one months", () => {
    expect(statementFor({ failedOn: "2026-11-01", months: 1, newEnd: "2026-12-16", expectations: [{ measure: "m", target: "t", reviewOn: "2026-12-01" }] })).toMatch(/extended by 1 month\b/);
  });
});
