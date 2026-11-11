import { describe, expect, it } from "vitest";
import { asKobo } from "@/lib/money-exact";
import { MIN_GROUP } from "@/lib/welfare";
import { averageKobo, averageTenureYears, completedYears, percentDifference, percentTenths, shareOf, shownGroup, tenureBand, TENURE_BANDS } from "@/lib/workforce-overview";

// The Workforce overview (Analytics): pure rules, no database and no clock. Money is whole kobo and rounded half up once; averages of pay are shown only for a group of at least
// the company-wide minimum (five, the same as the welfare summary and the survey results) so an average can never be one person's pay.

describe("completed years of service", () => {
  it("counts whole years: the day before the anniversary is still the earlier year, the anniversary itself completes it", () => {
    expect(completedYears("2023-03-15", "2026-03-14")).toBe(2);
    expect(completedYears("2023-03-15", "2026-03-15")).toBe(3);
    expect(completedYears("2026-11-11", "2026-11-11")).toBe(0);
  });
  it("handles a leap-day start and never goes below zero", () => {
    expect(completedYears("2024-02-29", "2025-02-28")).toBe(0);
    expect(completedYears("2024-02-29", "2025-03-01")).toBe(1);
    expect(completedYears("2027-01-01", "2026-11-11")).toBe(0);
  });
});

describe("tenure bands", () => {
  it("has the five bands in order, each starting on its lower bound", () => {
    expect([...TENURE_BANDS]).toEqual(["<1", "1–3", "3–5", "5–10", "10+"]);
    expect([0, 1, 2, 3, 4, 5, 9, 10, 25].map(tenureBand)).toEqual(["<1", "1–3", "1–3", "3–5", "3–5", "5–10", "5–10", "10+", "10+"]);
  });
});

describe("average tenure", () => {
  it("is in years to one decimal, rounded half up, from days", () => {
    expect(averageTenureYears([365, 730])).toBe(1.5); // 547.5 days = 1.499 years
    expect(averageTenureYears([19])).toBe(0.1); // 0.052 years = 0.52 tenths
    expect(averageTenureYears([18])).toBe(0); // 0.049 years = 0.49 tenths
    expect(averageTenureYears([])).toBeNull();
  });
});

describe("average pay in whole kobo", () => {
  it("rounds half up once, exactly, with no floating point", () => {
    expect(averageKobo([asKobo(10_000_000), asKobo(10_000_001)])).toBe(10_000_001); // 10,000,000.5 rounds up
    expect(averageKobo([asKobo(100), asKobo(100), asKobo(101)])).toBe(100); // 100.33
    expect(averageKobo([asKobo(100), asKobo(101), asKobo(101)])).toBe(101); // 100.67
    expect(averageKobo([])).toBeNull();
  });
});

describe("the minimum group", () => {
  it("shows a figure only from the minimum number of people", () => {
    expect(MIN_GROUP).toBe(5);
    expect(shownGroup(4)).toBe(false);
    expect(shownGroup(5)).toBe(true);
    expect(shownGroup(2, 2)).toBe(true);
    expect(shownGroup(0)).toBe(false);
  });
});

describe("comparison with the company", () => {
  it("is a whole percent, half away from zero, and nothing when there is no base", () => {
    expect(percentDifference(asKobo(11_000), asKobo(10_000))).toBe(10);
    expect(percentDifference(asKobo(9_450), asKobo(10_000))).toBe(-6); // -5.5 rounds away from zero
    expect(percentDifference(asKobo(10_000), asKobo(10_000))).toBe(0);
    expect(percentDifference(asKobo(10_000), asKobo(0))).toBeNull();
  });
});

describe("shares", () => {
  it("is a whole percent, half up, and 0 for an empty total", () => {
    expect(shareOf(1, 3)).toBe(33);
    expect(shareOf(2, 3)).toBe(67);
    expect(shareOf(1, 2)).toBe(50);
    expect(shareOf(1, 8)).toBe(13); // 12.5 rounds up
    expect(shareOf(0, 0)).toBe(0);
  });
  it("is to one decimal for the people-managers figure", () => {
    expect(percentTenths(28, 152)).toBe(18.4);
    expect(percentTenths(1, 8)).toBe(12.5);
    expect(percentTenths(0, 0)).toBe(0);
  });
});
