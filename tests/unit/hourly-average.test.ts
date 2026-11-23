import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { grossBasis, grossDayPay, type PricedDay } from "@/lib/payroll/hourly-average";

/**
 * Hourly pay, the three-month average on GROSS EARNINGS (the founder's confirmed decision of 2026-11-21): a paid sick day and a paid public holiday not worked are paid at the person's AVERAGE DAILY GROSS EARNINGS, which is
 * the gross pay for the hours they worked in the months before (each shift at the approved rate of its own day and kind of day, so a rate change counts from its date), divided by the days they worked. Which kinds of day count is a
 * rule setting (all three by default). Leave pay, sick pay and holiday pay are never in it (they are not hours worked, and counting them would count pay twice). A day with only unpriced hours is not a day of earnings; a window with
 * no earnings has nothing to average. This is the pure step, in whole kobo, rounded half up once. Every figure is INVENTED: a rate of 1,000.00 an hour is 100,000 kobo.
 */
const row = (date: string, dayClass: PricedDay["dayClass"], hours: number, rateNaira: number | null, over: Partial<PricedDay> = {}): PricedDay => ({ date, dayClass, minutes: hours * 60, rateKobo: rateNaira === null ? null : rateNaira * 100, contractId: "k1", beatId: "b1", clientId: "c1", ...over });
const ALL = new Set<PricedDay["dayClass"]>(["WEEKDAY", "WEEKEND", "HOLIDAY"]);

describe("grossBasis: the gross earnings in the window and the days they were earned on", () => {
  it("adds each shift at its own rate and counts the distinct days: 8 h weekday + 8 h weekday + 8 h weekend at 1,500 = 28,000.00 over 3 days", () => {
    const b = grossBasis([row("2043-03-02", "WEEKDAY", 8, 1000), row("2043-03-03", "WEEKDAY", 8, 1000), row("2043-03-07", "WEEKEND", 8, 1500)], "2043-03-01", "2043-04-01", ALL)!;
    expect(b.daysWorked).toBe(3);
    expect(b.koboMinutes).toBe(168_000_000n); // 28,000.00 = 2,800,000 kobo x 60 minutes
    expect(b.minutes).toBe(1440);
  });

  it("two shifts on one day are one day, and their pay is added", () => {
    const b = grossBasis([row("2043-03-02", "WEEKDAY", 4, 1000), row("2043-03-02", "WEEKDAY", 4, 1000, { beatId: "b2" })], "2043-03-01", "2043-04-01", ALL)!;
    expect(b.daysWorked).toBe(1);
    expect(b.koboMinutes).toBe(48_000_000n); // 8,000.00
  });

  it("counts a day from the first day of the window and not the last (the window is from, up to but not including, to)", () => {
    const rows = [row("2043-03-01", "WEEKDAY", 8, 1000), row("2043-03-31", "WEEKDAY", 8, 1000), row("2043-04-01", "WEEKDAY", 8, 1000), row("2043-02-28", "WEEKDAY", 8, 1000)];
    const b = grossBasis(rows, "2043-03-01", "2043-04-01", ALL)!;
    expect(b.daysWorked).toBe(2);
  });

  it("only the kinds of day the company counts are in the earnings and in the days (weekday only: the weekend day is left out of both)", () => {
    const rows = [row("2043-03-02", "WEEKDAY", 8, 1000), row("2043-03-03", "WEEKDAY", 8, 1000), row("2043-03-07", "WEEKEND", 8, 1500)];
    const b = grossBasis(rows, "2043-03-01", "2043-04-01", new Set(["WEEKDAY"]))!;
    expect(b.daysWorked).toBe(2);
    expect(grossDayPay(b, 1)).toBe(800_000); // 16,000.00 over 2 days = 8,000.00
  });

  it("hours with no approved rate are not earnings: they are counted apart, and a day with only such hours is not a day of earnings", () => {
    const rows = [row("2043-03-02", "WEEKDAY", 8, 1000), row("2043-03-03", "WEEKDAY", 8, null), row("2043-03-04", "WEEKDAY", 4, 1000, { beatId: "b2" }), row("2043-03-04", "WEEKDAY", 4, null)];
    const b = grossBasis(rows, "2043-03-01", "2043-04-01", ALL)!;
    expect(b.daysWorked).toBe(2); // the 2nd and the 4th; the 3rd had only unpriced hours
    expect(b.unpricedMinutes).toBe(12 * 60);
    expect(b.koboMinutes).toBe(72_000_000n); // 8 h + 4 h at 1,000.00 = 12,000.00
  });

  it("is null, never an average of zero, when there are no earnings in the window (no hours, none priced, none of a counted kind)", () => {
    expect(grossBasis([], "2043-03-01", "2043-04-01", ALL)).toBeNull();
    expect(grossBasis([row("2043-03-02", "WEEKDAY", 8, null)], "2043-03-01", "2043-04-01", ALL)).toBeNull();
    expect(grossBasis([row("2043-03-07", "WEEKEND", 8, 1500)], "2043-03-01", "2043-04-01", new Set(["WEEKDAY"]))).toBeNull();
    expect(grossBasis([row("2042-12-01", "WEEKDAY", 8, 1000)], "2043-03-01", "2043-04-01", ALL)).toBeNull();
  });

  it("the usual days of the week and the last site come from ALL the hours in the window, whatever kinds of day are counted", () => {
    const rows = [row("2043-03-02", "WEEKDAY", 8, 1000), row("2043-03-07", "WEEKEND", 8, 1500, { beatId: "b9", contractId: "k9", clientId: "c9" })]; // Monday, Saturday (the later day, at the other site)
    const b = grossBasis(rows, "2043-03-01", "2043-04-01", new Set(["WEEKDAY"]))!;
    expect([...b.weekdays].sort()).toEqual([1, 6]);
    expect(b.last).toEqual({ beatId: "b9", contractId: "k9", clientId: "c9" });
  });

  it("a new starter (a few days of history) or a person who joined part-way through the window is averaged over the days they have", () => {
    const b = grossBasis([row("2043-03-25", "WEEKDAY", 8, 1000), row("2043-03-26", "WEEKDAY", 8, 1000)], "2043-01-01", "2043-04-01", ALL)!;
    expect(b.daysWorked).toBe(2);
    expect(grossDayPay(b, 1)).toBe(800_000);
  });

  it("a rate change counts from its date: each row carries the rate of its own day", () => {
    const b = grossBasis([row("2043-02-10", "WEEKDAY", 8, 1000), row("2043-03-10", "WEEKDAY", 8, 1200)], "2043-01-01", "2043-04-01", ALL)!;
    expect(grossDayPay(b, 1)).toBe(880_000); // (8,000 + 9,600) / 2 = 8,800.00
  });
});

describe("grossDayPay: the average daily gross times the days, rounded half up to the kobo once", () => {
  it("28,000.00 over 3 days: 2 days are 18,666.67 (worked once from the whole ratio, not 2 x a rounded 9,333.33)", () => {
    const b = grossBasis([row("2043-03-02", "WEEKDAY", 8, 1000), row("2043-03-03", "WEEKDAY", 8, 1000), row("2043-03-07", "WEEKEND", 8, 1500)], "2043-03-01", "2043-04-01", ALL)!;
    expect(grossDayPay(b, 2)).toBe(1_866_667);
    expect(grossDayPay(b, 1)).toBe(933_333); // 9,333.33
    expect(grossDayPay(b, 3)).toBe(2_800_000);
  });

  it("refuses no days to pay", () => {
    const b = grossBasis([row("2043-03-02", "WEEKDAY", 8, 1000)], "2043-03-01", "2043-04-01", ALL)!;
    expect(() => grossDayPay(b, 0)).toThrow();
    expect(() => grossDayPay(b, 1.5)).toThrow();
  });
});

describe("the file keeps to the exact-money rules", () => {
  it("uses no floating-point rounding or parsing", () => {
    expect(readFileSync("src/lib/payroll/hourly-average.ts", "utf8")).not.toMatch(/toFixed|parseFloat|Math\.round/);
  });
});
