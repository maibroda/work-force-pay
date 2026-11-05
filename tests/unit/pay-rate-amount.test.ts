import { describe, expect, it } from "vitest";
import { isIsoDate, parseMonthlyGross } from "@/lib/pay-rate";

/** A personal pay rate is the MONTHLY gross in naira, at most two decimals, kept as exact text, never as a float (founder, 2026-11-05; CLAUDE.md rule 2). */
describe("the monthly gross as typed", () => {
  it("accepts whole naira and naira with one or two decimals, as exact text, without leading zeros", () => {
    expect(parseMonthlyGross("250000")).toBe("250000");
    expect(parseMonthlyGross("250000.5")).toBe("250000.5");
    expect(parseMonthlyGross(" 250000.50 ")).toBe("250000.50");
    expect(parseMonthlyGross("0.1")).toBe("0.1");
    expect(parseMonthlyGross("007500")).toBe("7500");
    expect(parseMonthlyGross(1234.56)).toBe("1234.56");
    expect(parseMonthlyGross(250000)).toBe("250000");
  });

  it("refuses zero, negatives, more than two decimals, separators, exponents, words, blanks and non-finite numbers", () => {
    for (const bad of ["0", "0.00", "-5", "1000.555", "12,000", "1e6", "abc", "", "  ", "₦5000", "5000 naira", null, undefined, {}, Number.NaN, Number.POSITIVE_INFINITY, 0.1 + 0.2]) expect(parseMonthlyGross(bad), String(bad)).toBeNull();
  });

  it("refuses an absurdly large amount (more than 12 digits) rather than storing it", () => {
    expect(parseMonthlyGross("1234567890123")).toBeNull();
    expect(parseMonthlyGross("999999999999.99")).toBe("999999999999.99");
  });
});

describe("a date", () => {
  it("is a real calendar date as YYYY-MM-DD", () => {
    expect(isIsoDate("2026-11-01")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "01/11/2026", "soon", "", null, 20261101]) expect(isIsoDate(bad), String(bad)).toBe(false);
  });
});
