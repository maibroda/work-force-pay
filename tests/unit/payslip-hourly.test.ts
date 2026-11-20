import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { durationOf, hourlyPayslip, type HourlyLineInput } from "@/lib/payroll/payslip-hourly";

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

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/payslip-hourly.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
