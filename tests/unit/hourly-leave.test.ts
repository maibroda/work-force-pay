import { describe, expect, it } from "vitest";
import { hourlyLeaveDates, hourlyLeaveFinding, hourlyLeaveNotice } from "@/lib/payroll/hourly-leave";
import type { CompensationRow } from "@/lib/payroll/hourly-rates";

/**
 * Hourly pay, H14 piece 0 (docs/plans/hourly-payroll-h14-build-plan.md): approved annual leave for a person paid by the hour is not paid today (hourly pay is for approved hours only, and the pay run drops their
 * work-register days), and nothing said so. This is the pure part of the safeguard: which approved leave days fall on days the person is paid by the hour, the payroll finding, and the notice shown when leave is
 * asked for or approved. It changes no amount. Calendar: 2042-03-03 is a Monday (2042-03-01 is a Saturday).
 */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const hourlyFrom = (iso: string, status = "APPROVED"): CompensationRow => ({ type: "HOURLY", effectiveFrom: day(iso), status });
const MARCH = { from: day("2042-03-01"), to: day("2042-03-31") };

describe("hourlyLeaveDates: the leave days on which a person is paid by the hour", () => {
  it("is every working day of the approved leave inside the period, for a person paid by the hour throughout", () => {
    // Monday 3 to Friday 7 March, and the weekend between two spells is not a working day (5-day week)
    const leave = [{ startDate: day("2042-03-03"), endDate: day("2042-03-07") }, { startDate: day("2042-03-10"), endDate: day("2042-03-11") }];
    expect(hourlyLeaveDates([hourlyFrom("2040-01-01")], leave, 5, MARCH)).toEqual(["2042-03-03", "2042-03-04", "2042-03-05", "2042-03-06", "2042-03-07", "2042-03-10", "2042-03-11"]);
  });

  it("counts Saturdays when the company's leave week has six working days", () => {
    expect(hourlyLeaveDates([hourlyFrom("2040-01-01")], [{ startDate: day("2042-03-07"), endDate: day("2042-03-09") }], 6, MARCH)).toEqual(["2042-03-07", "2042-03-08"]);
  });

  it("is nothing for a person paid monthly (no approved hourly record), however much leave they take", () => {
    const leave = [{ startDate: day("2042-03-02"), endDate: day("2042-03-06") }];
    expect(hourlyLeaveDates([], leave, 5, MARCH)).toEqual([]);
    expect(hourlyLeaveDates(undefined, leave, 5, MARCH)).toEqual([]);
    expect(hourlyLeaveDates([hourlyFrom("2040-01-01", "PENDING")], leave, 5, MARCH)).toEqual([]); // not approved: still monthly
  });

  it("only counts the days from the date the person became paid by the hour (a mixed month)", () => {
    const leave = [{ startDate: day("2042-03-03"), endDate: day("2042-03-07") }];
    expect(hourlyLeaveDates([hourlyFrom("2042-03-06")], leave, 5, MARCH)).toEqual(["2042-03-06", "2042-03-07"]);
  });

  it("only counts the days inside the pay period, and a day in two requests once", () => {
    const leave = [{ startDate: day("2042-02-26"), endDate: day("2042-03-04") }, { startDate: day("2042-03-04"), endDate: day("2042-03-05") }];
    expect(hourlyLeaveDates([hourlyFrom("2040-01-01")], leave, 5, MARCH)).toEqual(["2042-03-03", "2042-03-04", "2042-03-05"]);
  });
});

describe("hourlyLeaveFinding and hourlyLeaveNotice", () => {
  const a = { employeeId: "e1", label: "EMP-000007 Ada Okafor", periodName: "March 2042" };

  it("is nothing when there are no such days", () => {
    expect(hourlyLeaveFinding({ ...a, dates: [] })).toBeNull();
    expect(hourlyLeaveNotice([])).toBeNull();
  });

  it("is a WARNING (never blocking, nothing to explain) that names the person, the days and that they are not paid", () => {
    const f = hourlyLeaveFinding({ ...a, dates: ["2042-03-02", "2042-03-03"] })!;
    expect(f.severity).toBe("WARNING");
    expect(f.code).toBe("HOURLY_LEAVE_NOT_PAID");
    expect(f.employeeId).toBe("e1");
    expect(f.message).toContain("EMP-000007 Ada Okafor");
    expect(f.message).toContain("2 approved annual leave day(s)");
    expect(f.message).toContain("2042-03-02");
    expect(f.message).toMatch(/not paid/i);
  });

  it("the notice says the days are not paid, in plain words", () => {
    expect(hourlyLeaveNotice(["2042-03-02"])).toMatch(/paid by the hour.*not paid/i);
  });

  it("a long list of days is shortened but the count is exact", () => {
    const dates = Array.from({ length: 12 }, (_, i) => `2042-03-${String(i + 2).padStart(2, "0")}`);
    const f = hourlyLeaveFinding({ ...a, dates })!;
    expect(f.message).toContain("12 approved annual leave day(s)");
    expect(f.message).toContain("and 6 more");
  });
});
