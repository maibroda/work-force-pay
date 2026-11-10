import { describe, expect, it } from "vitest";
import { AWARD_STATUS_LABELS, awardStatusAfter, nominatorConflict, parseMilestoneYears, upcomingMilestones } from "@/lib/recognition";
import { hideSmallGroups, MIN_GROUP, WELFARE_KIND_LABELS, WELFARE_KINDS } from "@/lib/welfare";

// Welfare and recognition, step 1 (the founder's go of 2026-11-10, plan docs/plans/welfare-recognition-plan.md).
// Dates are plain "YYYY-MM-DD" days; no clock is read here.

describe("welfare kinds", () => {
  it("are a short fixed list, each with a plain label", () => {
    expect([...WELFARE_KINDS]).toEqual(["BEREAVEMENT", "FINANCIAL_HARDSHIP", "HEALTH_WELLBEING", "FAMILY", "HOUSING_TRANSPORT", "OTHER"]);
    expect(Object.keys(WELFARE_KIND_LABELS).sort()).toEqual([...WELFARE_KINDS].sort());
  });
});

describe("counts without names", () => {
  it("hide any group of fewer than 5, so a person cannot be identified, and show the rest", () => {
    expect(MIN_GROUP).toBe(5);
    expect(hideSmallGroups({ BEREAVEMENT: 7, FAMILY: 4, OTHER: 5, HEALTH_WELLBEING: 1 })).toEqual({ BEREAVEMENT: 7, FAMILY: null, OTHER: 5, HEALTH_WELLBEING: null });
  });
  it("show a zero as zero (nobody is identified by nothing)", () => {
    expect(hideSmallGroups({ FAMILY: 0 })).toEqual({ FAMILY: 0 });
  });
  it("follow a different minimum when asked", () => {
    expect(hideSmallGroups({ FAMILY: 3 }, 3)).toEqual({ FAMILY: 3 });
  });
});

describe("the life of an award", () => {
  it("a nomination is approved, rejected or withdrawn, and nothing then leaves Rejected or Withdrawn", () => {
    expect(awardStatusAfter("NOMINATED", "APPROVE")).toBe("APPROVED");
    expect(awardStatusAfter("NOMINATED", "REJECT")).toBe("REJECTED");
    expect(awardStatusAfter("NOMINATED", "WITHDRAW")).toBe("WITHDRAWN");
    for (const s of ["REJECTED", "WITHDRAWN"] as const) for (const e of ["APPROVE", "REJECT", "WITHDRAW"] as const) expect(awardStatusAfter(s, e), `${s} ${e}`).toBeNull();
  });
  it("an approved award can only be withdrawn (a correction), never approved or rejected again", () => {
    expect(awardStatusAfter("APPROVED", "WITHDRAW")).toBe("WITHDRAWN");
    expect(awardStatusAfter("APPROVED", "APPROVE")).toBeNull();
    expect(awardStatusAfter("APPROVED", "REJECT")).toBeNull();
  });
  it("has a plain label for each status", () => {
    expect(Object.keys(AWARD_STATUS_LABELS).sort()).toEqual(["APPROVED", "NOMINATED", "REJECTED", "WITHDRAWN"]);
  });
});

describe("who may approve an award", () => {
  it("not the person who nominated it", () => {
    expect(nominatorConflict("u-nominator", "u-nominator")).toMatch(/nominated/i);
    expect(nominatorConflict("u-other", "u-nominator")).toBeNull();
  });
});

describe("the company's long-service years", () => {
  it("are read from a comma-separated list, sorted and without repeats", () => {
    expect(parseMilestoneYears("5, 10 ,15,20")).toEqual([5, 10, 15, 20]);
    expect(parseMilestoneYears("20,5,5,10")).toEqual([5, 10, 20]);
    expect(parseMilestoneYears("")).toEqual([]); // none: no milestones
  });
  it("are refused when not whole numbers from 1 to 60, or more than ten", () => {
    expect(parseMilestoneYears("5, ten")).toBeNull();
    expect(parseMilestoneYears("0, 5")).toBeNull();
    expect(parseMilestoneYears("61")).toBeNull();
    expect(parseMilestoneYears("2.5")).toBeNull();
    expect(parseMilestoneYears("1,2,3,4,5,6,7,8,9,10,11")).toBeNull();
  });
});

describe("milestone anniversaries coming up", () => {
  const emps = [
    { id: "a", employmentDate: "2021-11-20" }, // 5 years on 2026-11-20
    { id: "b", employmentDate: "2016-12-30" }, // 10 years on 2026-12-30
    { id: "c", employmentDate: "2022-11-20" }, // 4 years: not a milestone
    { id: "d", employmentDate: "2016-03-01" }, // 10 years in March: outside the window
    { id: "e", employmentDate: "2021-11-09" }, // 5 years yesterday: already past
  ];
  it("lists those whose anniversary of a milestone year falls in the window, soonest first", () => {
    const r = upcomingMilestones(emps, "2026-11-10", [5, 10, 15, 20], 60);
    expect(r).toEqual([
      { employeeId: "a", years: 5, on: "2026-11-20" },
      { employeeId: "b", years: 10, on: "2026-12-30" },
    ]);
  });
  it("includes today and the last day of the window, nothing outside", () => {
    expect(upcomingMilestones([{ id: "t", employmentDate: "2021-11-10" }], "2026-11-10", [5], 60).map((x) => x.employeeId)).toEqual(["t"]);
    expect(upcomingMilestones([{ id: "t", employmentDate: "2022-01-09" }], "2026-11-10", [5], 60).map((x) => x.employeeId)).toEqual(["t"]); // 2027-01-09, day 60
    expect(upcomingMilestones([{ id: "t", employmentDate: "2022-01-10" }], "2026-11-10", [5], 60)).toEqual([]); // day 61
  });
  it("finds a window that crosses the new year, and follows the company's own years", () => {
    expect(upcomingMilestones([{ id: "t", employmentDate: "2012-01-05" }], "2026-12-20", [15], 30)).toEqual([{ employeeId: "t", years: 15, on: "2027-01-05" }]);
    expect(upcomingMilestones(emps, "2026-11-10", [4], 60).map((x) => x.employeeId)).toEqual(["c"]);
    expect(upcomingMilestones(emps, "2026-11-10", [], 60)).toEqual([]);
  });
  it("puts a 29 February joiner's anniversary on 28 February in a year without one", () => {
    expect(upcomingMilestones([{ id: "t", employmentDate: "2020-02-29" }], "2026-02-01", [6], 60)).toEqual([{ employeeId: "t", years: 6, on: "2026-02-28" }]);
    expect(upcomingMilestones([{ id: "t", employmentDate: "2016-02-29" }], "2028-02-01", [12], 60)).toEqual([{ employeeId: "t", years: 12, on: "2028-02-29" }]);
  });
});
