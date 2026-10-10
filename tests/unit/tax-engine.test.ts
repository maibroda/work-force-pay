import { describe, expect, it } from "vitest";
import { rateOn, rateProblems, type RateRow } from "@/lib/tax-engine";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const rate = (ratePct: number, from: string, to: string | null = null, status: RateRow["status"] = "APPROVED"): RateRow => ({ ratePct, effectiveFrom: day(from), effectiveTo: to ? day(to) : null, status });

describe("rateOn", () => {
  const rates = [rate(5, "2020-02-01", "2026-05-31"), rate(7.5, "2026-06-01")];

  it("reads the rate in force on a date, including the first and last day of each", () => {
    expect(rateOn(rates, day("2026-05-31"))?.ratePct).toBe(5);
    expect(rateOn(rates, day("2026-06-01"))?.ratePct).toBe(7.5);
    expect(rateOn(rates, day("2020-02-01"))?.ratePct).toBe(5);
    expect(rateOn(rates, day("2031-01-01"))?.ratePct).toBe(7.5); // open-ended
  });

  it("finds nothing before the first rate", () => {
    expect(rateOn(rates, day("2020-01-31"))).toBeNull();
  });

  it("ignores a proposal that hasn't been approved, and one that was turned down", () => {
    expect(rateOn([rate(10, "2026-01-01", null, "PENDING")], day("2026-06-01"))).toBeNull();
    expect(rateOn([rate(10, "2026-01-01", null, "REJECTED")], day("2026-06-01"))).toBeNull();
    expect(rateOn([...rates, rate(12, "2026-09-01", null, "PENDING")], day("2026-10-01"))?.ratePct).toBe(7.5);
  });
});

describe("rateProblems", () => {
  const existing = [rate(5, "2020-02-01", "2026-05-31"), rate(7.5, "2026-06-01")];
  const ok = { ratePct: 7.5, effectiveFrom: day("2026-09-01"), reason: "Finance Act" };

  it("accepts a rate that starts after the latest", () => {
    expect(rateProblems(ok, existing)).toEqual([]);
    expect(rateProblems({ ...ok, effectiveFrom: day("2020-01-01") }, [])).toEqual([]);
  });

  it("refuses a percentage outside 0 to 100, a missing date or reason", () => {
    expect(rateProblems({ ...ok, ratePct: -1 }, existing)).toContain("A rate is a percentage between 0 and 100.");
    expect(rateProblems({ ...ok, ratePct: 101 }, existing)).toContain("A rate is a percentage between 0 and 100.");
    expect(rateProblems({ ...ok, ratePct: Number.NaN }, existing)).toContain("A rate is a percentage between 0 and 100.");
    expect(rateProblems({ ...ok, effectiveFrom: null }, existing)).toContain("Choose the date the rate takes effect.");
    expect(rateProblems({ ...ok, reason: " " }, existing).join(" ")).toMatch(/Say why/);
  });

  it("won't rewrite history: a new rate must start after the latest, whatever its status except turned down", () => {
    expect(rateProblems({ ...ok, effectiveFrom: day("2026-06-01") }, existing).join(" ")).toMatch(/already starts on 2026-06-01/);
    expect(rateProblems({ ...ok, effectiveFrom: day("2026-01-01") }, existing).join(" ")).toMatch(/earlier rates are history/);
    expect(rateProblems(ok, [...existing, rate(9, "2026-12-01", null, "PENDING")]).join(" ")).toMatch(/already starts on 2026-12-01/);
    expect(rateProblems(ok, [...existing, rate(9, "2026-12-01", null, "REJECTED")])).toEqual([]);
  });
});
