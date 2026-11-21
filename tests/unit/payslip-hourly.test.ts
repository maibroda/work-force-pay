import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { durationOf, hourlyPayslip, type AllowanceLineInput, type HourlyLineInput } from "@/lib/payroll/payslip-hourly";

/**
 * Hourly pay, phase 4c (payslip): what an hourly person's payslip shows beside the usual earnings: the hours worked and the pay for them, by site and by kind of day (weekday, weekend, public holiday), with the
 * rate for each. Pure: the payslip screen and the payslip PDF both draw from this, so the two can never disagree. Hours are shown exactly (hours and minutes), never rounded; every amount is kept in whole kobo.
 * The rates in these tests are INVENTED.
 */
const line = (over: Partial<HourlyLineInput> = {}): HourlyLineInput => ({ siteName: "Site A", dayClass: "WEEKDAY", minutes: 480, rate: "1000.00", amount: "8000.00", ...over });

describe("durationOf: hours and minutes, exactly", () => {
  it("writes whole hours, hours and minutes, and minutes alone", () => {
    expect(durationOf(480)).toBe("8 h");
    expect(durationOf(510)).toBe("8 h 30 min");
    expect(durationOf(45)).toBe("45 min");
    expect(durationOf(0)).toBe("0 h");
    expect(durationOf(61)).toBe("1 h 1 min");
  });
  it("does not round: 1 minute is 1 minute", () => {
    expect(durationOf(1)).toBe("1 min");
    expect(durationOf(1439)).toBe("23 h 59 min");
  });
});

describe("hourlyPayslip: the hours and pay of one payslip", () => {
  it("is nothing for a person with no hourly lines (a monthly payslip is unchanged)", () => {
    expect(hourlyPayslip([])).toBeNull();
  });

  it("lists each site's kinds of day with hours, rate and amount, weekday then weekend then holiday, sites in name order", () => {
    const h = hourlyPayslip([
      line({ siteName: "Site B", dayClass: "HOLIDAY", minutes: 480, rate: "2000.00", amount: "16000.00" }),
      line({ siteName: "Site A", dayClass: "WEEKEND", minutes: 300, rate: "1500.00", amount: "7500.00" }),
      line({ siteName: "Site A", dayClass: "WEEKDAY", minutes: 480, rate: "1000.00", amount: "8000.00" }),
    ])!;
    expect(h.rows.map((r) => [r.site, r.dayLabel, r.duration, r.rate, r.amount])).toEqual([
      ["Site A", "Weekday", "8 h", "1000.00", "8000.00"],
      ["Site A", "Weekend", "5 h", "1500.00", "7500.00"],
      ["Site B", "Public holiday", "8 h", "2000.00", "16000.00"],
    ]);
  });

  it("totals by kind of day and overall, exactly (hours in minutes, pay in kobo)", () => {
    const h = hourlyPayslip([
      line({ siteName: "Site A", dayClass: "WEEKDAY", minutes: 485, rate: "1000.00", amount: "8083.33" }),
      line({ siteName: "Site B", dayClass: "WEEKDAY", minutes: 100, rate: "1000.00", amount: "1666.67" }),
      line({ siteName: "Site A", dayClass: "WEEKEND", minutes: 90, rate: "1500.00", amount: "2250.00" }),
    ])!;
    expect(h.byClass.map((c) => [c.dayLabel, c.duration, c.amount])).toEqual([["Weekday", "9 h 45 min", "9750.00"], ["Weekend", "1 h 30 min", "2250.00"]]);
    expect(h.totalDuration).toBe("11 h 15 min");
    expect(h.totalAmount).toBe("12000.00");
  });

  it("a kind of day with no hours is not listed", () => {
    const h = hourlyPayslip([line()])!;
    expect(h.byClass.map((c) => c.dayLabel)).toEqual(["Weekday"]);
  });

  it("two lines for the same site, kind of day and rate (a supplementary payroll's pieces) are shown as one", () => {
    const h = hourlyPayslip([line({ minutes: 120, amount: "2000.00" }), line({ minutes: 60, amount: "1000.00" })])!;
    expect(h.rows).toHaveLength(1);
    expect([h.rows[0].duration, h.rows[0].amount]).toEqual(["3 h", "3000.00"]);
  });

  it("the same site and kind of day at two different rates stay on two lines", () => {
    const h = hourlyPayslip([line({ rate: "1000.00", amount: "8000.00" }), line({ rate: "1200.00", amount: "9600.00" })])!;
    expect(h.rows).toHaveLength(2);
  });

  it("a site with no name is shown as 'Site not recorded' rather than blank", () => {
    expect(hourlyPayslip([line({ siteName: "" })])!.rows[0].site).toBe("Site not recorded");
  });
});

describe("hourlyPayslip: the leave pay line (H14 piece 1)", () => {
  const leave = (over: Partial<AllowanceLineInput> = {}): AllowanceLineInput => ({ kind: "LEAVE_PERCENT", siteName: "Site A", baseAmount: "8000.00", pct: "10.00", amount: "800.00", ...over });
  it("is shown after the hours of its site, named with the percentage and what it was worked on, with no hours or rate", () => {
    const h = hourlyPayslip([line(), line({ siteName: "Site B", dayClass: "WEEKEND", minutes: 60, rate: "1500.00", amount: "1500.00" })], [leave()])!;
    expect(h.rows.map((r) => [r.site, r.dayLabel, r.duration, r.rate, r.amount])).toEqual([
      ["Site A", "Weekday", "8 h", "1000.00", "8000.00"],
      ["Site A", "Leave pay (10% of 8,000.00)", "", "", "800.00"],
      ["Site B", "Weekend", "1 h", "1500.00", "1500.00"],
    ]);
  });
  it("is counted in the total, listed in the summary by kind, and does not change the hours", () => {
    const h = hourlyPayslip([line()], [leave()])!;
    expect(h.totalAmount).toBe("8800.00");
    expect(h.totalDuration).toBe("8 h");
    expect(h.byClass.map((c) => [c.dayLabel, c.amount])).toEqual([["Weekday", "8000.00"], ["Leave pay", "800.00"]]);
  });
  it("writes the percentage plainly: 10, 8.33, 8.3", () => {
    expect(hourlyPayslip([line()], [leave({ pct: "10.00" })])!.rows[1].dayLabel).toContain("(10% of");
    expect(hourlyPayslip([line()], [leave({ pct: "8.33" })])!.rows[1].dayLabel).toContain("(8.33% of");
    expect(hourlyPayslip([line()], [leave({ pct: "8.30" })])!.rows[1].dayLabel).toContain("(8.3% of");
    expect(hourlyPayslip([line()], [leave({ pct: "100.00" })])!.rows[1].dayLabel).toContain("(100% of");
  });
  it("is nothing extra for a person with no leave pay", () => {
    expect(hourlyPayslip([line()], [])!.rows).toHaveLength(1);
    expect(hourlyPayslip([line()])!.totalAmount).toBe("8000.00");
  });
});

describe("hourlyPayslip: paid sick days (H14 piece 2, step 2b)", () => {
  const sick = (over: Partial<AllowanceLineInput> = {}): AllowanceLineInput => ({ kind: "SICK_DAY", siteName: "Site A", baseAmount: null, pct: null, amount: "16000.00", minutes: 960, rate: "1000.00", dates: ["2043-06-01", "2043-06-02"], ...over });
  it("is shown with the days, the hours and the rate, and the hours count in the total", () => {
    const h = hourlyPayslip([line({ minutes: 480, amount: "8000.00" })], [sick()])!;
    expect(h.rows.map((r) => [r.dayLabel, r.duration, r.rate, r.amount])).toEqual([["Weekday", "8 h", "1000.00", "8000.00"], ["Sick pay (2 days)", "16 h", "1000.00", "16000.00"]]);
    expect(h.totalDuration).toBe("24 h");
    expect(h.totalAmount).toBe("24000.00");
  });
  it("says 1 day for one day, and a person with sick pay and no hours still has a section", () => {
    const h = hourlyPayslip([], [sick({ dates: ["2043-06-01"], minutes: 480, amount: "8000.00" })])!;
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0].dayLabel).toBe("Sick pay (1 day)");
    expect(h.totalAmount).toBe("8000.00");
    expect(hourlyPayslip([], [])).toBeNull();
  });
});

describe("hourlyPayslip: a paid public holiday not worked (H14 piece 3)", () => {
  const holiday = (over: Partial<AllowanceLineInput> = {}): AllowanceLineInput => ({ kind: "HOLIDAY_NOT_WORKED", siteName: "Site A", baseAmount: null, pct: null, amount: "8000.00", minutes: 480, rate: "1000.00", dates: ["2043-06-12"], ...over });
  it("names the holiday by its date, with the hours and the rate, and counts it in the total", () => {
    const h = hourlyPayslip([], [holiday()])!;
    expect(h.rows.map((r) => [r.dayLabel, r.duration, r.rate, r.amount])).toEqual([["Holiday pay (2043-06-12)", "8 h", "1000.00", "8000.00"]]);
    expect(h.totalAmount).toBe("8000.00");
    expect(h.byClass.map((c) => [c.dayLabel, c.amount])).toEqual([["Holiday pay", "8000.00"]]);
  });
  it("says the number of days when a line holds more than one", () => {
    expect(hourlyPayslip([], [holiday({ dates: ["2043-06-12", "2043-06-13"], minutes: 960, amount: "16000.00" })])!.rows[0].dayLabel).toBe("Holiday pay (2 days)");
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/payslip-hourly.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
