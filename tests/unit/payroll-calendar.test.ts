import { describe, expect, it } from "vitest";
import { addWorkingDays, buildCalendar, DEFAULT_CALENDAR_RULE, daysUntil, datesProblems, milestoneState, ruleProblems } from "@/lib/payroll-calendar";

describe("working days", () => {
  it("skips weekends", () => {
    expect(addWorkingDays("2026-10-23", 1)).toBe("2026-10-26"); // Friday -> Monday
    expect(addWorkingDays("2026-10-20", 3)).toBe("2026-10-23");
    expect(addWorkingDays("2026-10-22", 5)).toBe("2026-10-29");
  });
});

describe("building a month's dates", () => {
  it("works the agreed rhythm out for a month with no weekend in the way", () => {
    // October 2026: the 20th is a Tuesday, the 28th a Wednesday, 10 November a Tuesday
    expect(buildCalendar(DEFAULT_CALENDAR_RULE, 2026, 10)).toEqual({
      inputCutoff: "2026-10-20", draftDue: "2026-10-23", approvalDue: "2026-10-27", payDate: "2026-10-28", remittanceDue: "2026-11-10",
    });
  });

  it("moves a weekend cut-off or pay day to the working day before", () => {
    // November 2026: the 28th is a Saturday; cut-off set to the 21st (Saturday)
    const c = buildCalendar({ ...DEFAULT_CALENDAR_RULE, inputCutoffDay: 21 }, 2026, 11);
    expect(c.inputCutoff).toBe("2026-11-20");
    expect(c.payDate).toBe("2026-11-27");
    expect(c.draftDue).toBe("2026-11-25");
    expect(c.approvalDue).toBe("2026-11-27");
  });

  it("uses the month's last day when the chosen day does not exist, and rolls December's remittance into January", () => {
    expect(buildCalendar({ ...DEFAULT_CALENDAR_RULE, payDayOfMonth: 31 }, 2026, 4).payDate).toBe("2026-04-30");
    expect(buildCalendar({ ...DEFAULT_CALENDAR_RULE, payDayOfMonth: 31 }, 2026, 2).payDate).toBe("2026-02-27"); // 28th is a Saturday
    expect(buildCalendar(DEFAULT_CALENDAR_RULE, 2026, 12).remittanceDue).toBe("2027-01-08"); // the 10th is a Sunday
  });

  it("flags rhythms that cannot work", () => {
    expect(ruleProblems(DEFAULT_CALENDAR_RULE)).toEqual([]);
    expect(ruleProblems({ ...DEFAULT_CALENDAR_RULE, inputCutoffDay: 31 })).toEqual(["The input cut-off day must be between 1 and 28."]);
    expect(ruleProblems({ ...DEFAULT_CALENDAR_RULE, draftWorkingDays: 0 })).toHaveLength(1);
    const late = buildCalendar({ ...DEFAULT_CALENDAR_RULE, inputCutoffDay: 27, draftWorkingDays: 5 }, 2026, 10);
    expect(datesProblems(late).join(" ")).toMatch(/Approval is due .* after the pay date/);
    expect(datesProblems(buildCalendar(DEFAULT_CALENDAR_RULE, 2026, 10))).toEqual([]);
  });
});

describe("where a deadline stands", () => {
  it("is done once done, otherwise overdue, due soon or upcoming", () => {
    expect(milestoneState("2026-10-20", true, "2026-11-30")).toBe("DONE");
    expect(milestoneState("2026-10-20", false, "2026-10-21")).toBe("OVERDUE");
    expect(milestoneState("2026-10-20", false, "2026-10-20")).toBe("DUE_SOON"); // due today is not late
    expect(milestoneState("2026-10-20", false, "2026-10-17")).toBe("DUE_SOON");
    expect(milestoneState("2026-10-20", false, "2026-10-16")).toBe("UPCOMING");
    expect(daysUntil("2026-10-20", "2026-10-23")).toBe(-3);
  });
});
