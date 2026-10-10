import { describe, expect, it } from "vitest";
import { DEFAULT_TREATMENT, ruleOn, ruleProblems, splitCharge, taxableOf, type RuleRow } from "@/lib/billing-rules";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const rule = (from: string, to: string | null = null, status: RuleRow["status"] = "APPROVED", over: Partial<RuleRow> = {}): RuleRow => ({
  directPct: 90, indirectPct: 10, vatBase: "INDIRECT", whtBase: "FULL", effectiveFrom: day(from), effectiveTo: to ? day(to) : null, status, ...over,
});

describe("splitCharge", () => {
  it("splits at the percentage and always adds back to the amount", () => {
    expect(splitCharge(1_000_000, 90)).toEqual({ direct: 900_000, indirect: 100_000 });
    expect(splitCharge(1_000_000, 85)).toEqual({ direct: 850_000, indirect: 150_000 });
    for (const [amount, pct] of [[333.33, 90], [100.01, 33.33], [0.05, 90], [987_654.32, 87.5], [1, 100], [1, 0]] as const) {
      const s = splitCharge(amount, pct);
      expect(Math.round((s.direct + s.indirect) * 100)).toBe(Math.round(amount * 100));
    }
  });
});

describe("taxableOf", () => {
  const part = { amount: 1000, direct: 900, indirect: 100 };
  it("picks the part a tax is charged on", () => {
    expect(taxableOf("INDIRECT", part)).toBe(100);
    expect(taxableOf("DIRECT", part)).toBe(900);
    expect(taxableOf("FULL", part)).toBe(1000);
    expect(taxableOf("NONE", part)).toBe(0);
  });
});

describe("ruleOn", () => {
  const rules = [rule("2000-01-01", "2026-10-31"), rule("2026-11-01", null, "APPROVED", { directPct: 85, indirectPct: 15 })];
  it("reads the approved rule in force on a date, to the day", () => {
    expect(ruleOn(rules, day("2026-10-31"))?.directPct).toBe(90);
    expect(ruleOn(rules, day("2026-11-01"))?.directPct).toBe(85);
    expect(ruleOn(rules, day("1999-12-31"))).toBeNull();
  });
  it("ignores proposals that were never approved", () => {
    expect(ruleOn([rule("2026-01-01", null, "PENDING")], day("2026-06-01"))).toBeNull();
    expect(ruleOn([rule("2026-01-01", null, "REJECTED")], day("2026-06-01"))).toBeNull();
  });
  it("has the built-in default as the original treatment", () => {
    expect(DEFAULT_TREATMENT).toEqual({ directPct: 90, indirectPct: 10, vatBase: "INDIRECT", whtBase: "FULL" });
  });
});

describe("ruleProblems", () => {
  const ok = { directPct: 85, indirectPct: 15, vatBase: "FULL", whtBase: "FULL", effectiveFrom: day("2026-11-01"), effectiveTo: null, reason: "Agreed at renewal in October" };
  const existing = [rule("2000-01-01")];

  it("accepts a sound rule that starts after the latest", () => {
    expect(ruleProblems(ok, existing, null)).toEqual([]);
    expect(ruleProblems(ok, [], day("2026-10-31"))).toEqual([]);
  });

  it("says what is wrong with the percentages, bases, reason and dates", () => {
    expect(ruleProblems({ ...ok, directPct: 80 }, existing, null).join(" ")).toMatch(/add up to 100%/);
    expect(ruleProblems({ ...ok, directPct: 120, indirectPct: -20 }, existing, null).join(" ")).toMatch(/between 0 and 100/);
    expect(ruleProblems({ ...ok, vatBase: "HALF" }, existing, null)).toContain("Choose what VAT is charged on.");
    expect(ruleProblems({ ...ok, whtBase: "" }, existing, null)).toContain("Choose what withholding tax is charged on.");
    expect(ruleProblems({ ...ok, reason: "short" }, existing, null).join(" ")).toMatch(/Say why/);
    expect(ruleProblems({ ...ok, effectiveFrom: null }, existing, null)).toContain("Choose the date the rule takes effect.");
    expect(ruleProblems({ ...ok, effectiveTo: day("2026-10-01") }, existing, null)).toContain("The end date is before the start date.");
  });

  it("won't rewrite history: not on or before an existing rule or an invoice already issued", () => {
    expect(ruleProblems({ ...ok, effectiveFrom: day("2000-01-01") }, existing, null).join(" ")).toMatch(/already starts on 2000-01-01/);
    expect(ruleProblems(ok, existing, day("2026-11-01")).join(" ")).toMatch(/invoice dated 2026-11-01 has already been issued/);
    expect(ruleProblems(ok, existing, day("2026-10-31"))).toEqual([]);
    expect(ruleProblems(ok, [...existing, rule("2027-01-01", null, "REJECTED")], null)).toEqual([]);
    expect(ruleProblems(ok, [...existing, rule("2027-01-01", null, "PENDING")], null).join(" ")).toMatch(/already starts on 2027-01-01/);
  });
});
