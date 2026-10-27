import { describe, expect, it } from "vitest";
import { Exact } from "@/lib/exact-fraction";
import { koboToString, MoneyError, toKobo } from "@/lib/money-exact";
import {
  computeComponents,
  computeComponentsExact,
  DEFAULT_EARNINGS,
  splitAgreedRate,
  type ComponentDef,
  type StructureDef,
} from "@/lib/payroll/structure";

/**
 * Salary components and the 70:30 split in exact arithmetic. Expected figures are worked by hand; the "tie" cases are ones where the exact
 * amount ends in exactly half a kobo, so half up must go UP. Today's floating-point code rounded each of these cases down by 1 kobo.
 */
const STD: StructureDef = {
  id: "std",
  code: "STD",
  name: "Standard",
  isPartial: false,
  components: DEFAULT_EARNINGS.map((c, i) => ({ ...c, calcType: "PERCENTAGE" as const, active: true, sortOrder: i })),
};
const base = { taxable: true, pensionable: false, employerCost: false, active: true };
const MIXED: StructureDef = {
  id: "mix",
  code: "MIX",
  name: "Mixed",
  isPartial: true,
  components: [
    { ...base, code: "BASIC", name: "Basic", calcType: "PERCENTAGE", percentage: 33.33, pensionable: true, sortOrder: 0 },
    { ...base, code: "HOUSING", name: "Housing", calcType: "PERCENTAGE", percentage: 17.5, pensionable: true, sortOrder: 1 },
    { ...base, code: "HAZARD", name: "Hazard", calcType: "FIXED_AMOUNT", fixedAmount: 5000.55, sortOrder: 2 },
    { ...base, code: "RISK", name: "Risk", calcType: "FORMULA", formula: "MIN(GROSS * 2%, 3000)", sortOrder: 3 },
    { ...base, code: "UTILITY", name: "Utility", calcType: "FORMULA", formula: "(BASIC + HOUSING) / 7", sortOrder: 4 },
  ] as ComponentDef[],
};

const amountOf = (structure: StructureDef, gross: string, factor: Exact, code: string) => {
  const c = computeComponentsExact(structure, toKobo(gross), factor).find((x) => x.code === code);
  if (!c) throw new Error(`no component ${code}`);
  return c;
};

describe("components: ties round half up", () => {
  it("10% of 50,000.25 is 5,000.025, so 5,000.03 (was 5,000.02)", () => {
    expect(koboToString(amountOf(STD, "50000.25", Exact.int(1), "BASIC").amount.round())).toBe("5000.03");
    expect(computeComponents(STD, 50000.25, 1).find((c) => c.code === "BASIC")!.amount).toBe(5000.03);
  });
  it("10% of 50,000.65 is 5,000.065, so 5,000.07; 10% of 50,001.05 is 5,000.105, so 5,000.11", () => {
    expect(computeComponents(STD, 50000.65, 1).find((c) => c.code === "BASIC")!.amount).toBe(5000.07);
    expect(computeComponents(STD, 50001.05, 1).find((c) => c.code === "BASIC")!.amount).toBe(5000.11);
  });
  it("half a month (factor 0.5): 20% of 50,000.25 is 10,000.05, half of it is 5,000.025, so 5,000.03", () => {
    expect(computeComponents(STD, 50000.25, 0.5).find((c) => c.code === "UTILITY")!.amount).toBe(5000.03);
  });
  it("20 paid days of 30, as an exact fraction: 15% of 50,000.05 is 7,500.0075; two thirds of it is 5,000.005, so 5,000.01", () => {
    const two3 = Exact.ratio(20, 30);
    expect(koboToString(amountOf(STD, "50000.05", two3, "TRANSPORT").amount.round())).toBe("5000.01");
    expect(koboToString(amountOf(STD, "50000.05", two3, "MEAL").amount.round())).toBe("5000.01");
    // 15% of 50,000.15 is 7,500.0225; two thirds is 5,000.015, so 5,000.02
    expect(koboToString(amountOf(STD, "50000.15", two3, "TRANSPORT").amount.round())).toBe("5000.02");
  });
  it("the amount is carried unrounded: 5,000.025 naira is exactly 500,002.5 kobo", () => {
    expect(amountOf(STD, "50000.25", Exact.int(1), "BASIC").amount.cmp(Exact.decimal("500002.5"))).toBe(0);
  });
  it("three paid days of 31 is three thirty-firsts exactly, not 0.0967741935483871", () => {
    const c = amountOf(STD, "100000", Exact.ratio(3, 31), "BASIC");
    // 10% of 100,000 = 10,000 naira = 1,000,000 kobo; × 3/31 = 3,000,000/31 kobo
    expect(c.amount.cmp(Exact.ratio(3_000_000, 31))).toBe(0);
  });
});

describe("components: every kind, and the things that must not change", () => {
  it("percentages, a fixed amount (prorated) and formulas that use the gross and earlier components", () => {
    const by = Object.fromEntries(computeComponents(MIXED, 100000, 1).map((c) => [c.code, c.amount]));
    // 33.33% = 33,330; 17.5% = 17,500; fixed 5,000.55; risk MIN(2,000, 3,000) = 2,000; utility (33,330 + 17,500) / 7 = 7,261.428571… = 7,261.43
    expect(by).toEqual({ BASIC: 33330, HOUSING: 17500, HAZARD: 5000.55, RISK: 2000, UTILITY: 7261.43 });
    const half = Object.fromEntries(computeComponents(MIXED, 100000, 0.5).map((c) => [c.code, c.amount]));
    // fixed 5,000.55 × 0.5 = 2,500.275 → 2,500.28 (a tie); the formulas see the FULL-month components, then are scaled: 2,000 × 0.5; 7,261.428571… × 0.5 = 3,630.714285… = 3,630.71
    expect(half).toEqual({ BASIC: 16665, HOUSING: 8750, HAZARD: 2500.28, RISK: 1000, UTILITY: 3630.71 });
  });
  it("an override replaces the structure's rule for that component only", () => {
    const c = computeComponents(STD, 84000, 1, [{ componentCode: "BASIC", calcType: "FIXED_AMOUNT", fixedAmount: 10080, reason: "test" }]);
    expect(c.find((x) => x.code === "BASIC")).toMatchObject({ amount: 10080, overridden: true });
    expect(c.find((x) => x.code === "HOUSING")).toMatchObject({ amount: 11760, overridden: false });
    const p = computeComponents(STD, 84000, 1, [{ componentCode: "BASIC", calcType: "PERCENTAGE", percentage: 12.5, reason: "test" }]);
    expect(p.find((x) => x.code === "BASIC")!.amount).toBe(10500);
  });
  it("inactive components are left out, and the order follows sortOrder", () => {
    const s: StructureDef = { ...STD, components: [{ ...STD.components[1], active: false }, STD.components[2], STD.components[0]] };
    expect(computeComponents(s, 84000, 1).map((c) => c.code)).toEqual(["BASIC", "TRANSPORT"]);
  });
  it("round = false gives the unrounded amount in naira, for callers not yet moved to exact fractions", () => {
    expect(computeComponents(STD, 50000.25, 1, [], {}, false).find((c) => c.code === "BASIC")!.amount).toBe(5000.025);
  });
  it("extra variables reach the formulas", () => {
    const s: StructureDef = { ...MIXED, components: [{ ...base, code: "PER_DAY", name: "Per day", calcType: "FORMULA", formula: "GROSS / DAYS", sortOrder: 0 } as ComponentDef] };
    expect(computeComponents(s, 90000, 1, [], { DAYS: 30 }).find((c) => c.code === "PER_DAY")!.amount).toBe(3000);
  });
  it("a gross or a percentage that is not exact kobo / four decimals is refused, not rounded", () => {
    expect(() => computeComponents(STD, 84000.005, 1)).toThrow(MoneyError);
    const odd: StructureDef = { ...STD, components: [{ ...STD.components[0], percentage: 12.34567 }] };
    expect(() => computeComponents(odd, 84000, 1)).toThrow(MoneyError);
  });
});

describe("the 70:30 split rounds half up", () => {
  it("₦50,002.45 at 70% gives the operative ₦35,001.72 (was ₦35,001.71) and management ₦15,000.73", () => {
    expect(splitAgreedRate(50002.45, 70)).toEqual({ operativeGross: 35001.72, managementShare: 15000.73 });
  });
  it("₦54,615.45 at 30% gives ₦16,384.64 (was ₦16,384.63) and management ₦38,230.81", () => {
    expect(splitAgreedRate(54615.45, 30)).toEqual({ operativeGross: 16384.64, managementShare: 38230.81 });
  });
  it("the two shares always add back to the agreed rate, to the kobo", () => {
    let seed = 7;
    for (let i = 0; i < 500; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const agreed = (5_000_000 + (seed % 20_000_000)) / 100;
      const s = splitAgreedRate(agreed, 70);
      expect(Math.round((s.operativeGross + s.managementShare) * 100)).toBe(Math.round(agreed * 100));
    }
  });
  it("keeps the figures that were already right: ₦120,000 at 70% is ₦84,000 and ₦36,000; 0% and 100%", () => {
    expect(splitAgreedRate(120000, 70)).toEqual({ operativeGross: 84000, managementShare: 36000 });
    expect(splitAgreedRate(120000, 0)).toEqual({ operativeGross: 0, managementShare: 120000 });
    expect(splitAgreedRate(120000, 100)).toEqual({ operativeGross: 120000, managementShare: 0 });
  });
  it("refuses a rate part-way through a kobo, or a share with more than four decimals", () => {
    expect(() => splitAgreedRate(100.005, 70)).toThrow(MoneyError);
    expect(() => splitAgreedRate(100, 70.00005)).toThrow(MoneyError);
  });
});
