import { describe, expect, it } from "vitest";
import { computePaye, NTA_2025_BANDS, taxOnBands, type PayeInput, type TaxRuleDef } from "@/lib/payroll/paye";
import { MoneyError } from "@/lib/money-exact";

/**
 * PAYE worked in whole kobo. Every expected figure below was worked by hand (the working is beside it) and, for the grid, by an independent
 * calculation written here in BigInt. The "tie" cases are ones where the exact monthly tax ends in exactly half a kobo: half up must go UP.
 * The floating-point code this replaced rounded several of these down by 1 kobo; those cases failed on it and pass on the exact code.
 */
const RULE: TaxRuleDef = {
  code: "NTA",
  version: "test",
  bands: NTA_2025_BANDS,
  reliefs: [
    { code: "PENSION", name: "Employee pension", type: "EMPLOYEE_PENSION", active: true },
    { code: "RENT", name: "Rent relief", type: "PERCENT_OF_RENT_CAPPED", rate: 20, cap: 500_000, active: true },
    { code: "NHF", name: "National Housing Fund", type: "NHF", rate: 2.5, active: true },
  ],
  exemptions: [{ code: "MIN_WAGE", description: "Minimum wage earners", annualGrossCeiling: 840_000, active: true }],
};

const paye = (i: Partial<PayeInput>, rule: TaxRuleDef = RULE) =>
  computePaye({ monthlyRegularTaxable: 0, monthlyIrregularTaxable: 0, monthlyEmployeePension: 0, monthlyBasic: 0, ...i }, rule);

describe("PAYE ties round half up (monthly tax ending in exactly half a kobo)", () => {
  it("15% band: 150,000.31 a month, 4,800.01 pension", () => {
    // annual 1,800,003.72 − pension 57,600.12 = 1,742,403.60 chargeable; 15% × 942,403.60 = 141,360.54; ÷ 12 = 11,780.045
    expect(paye({ monthlyRegularTaxable: 150_000.31, monthlyEmployeePension: 4_800.01 }).paye).toBe(11_780.05);
  });
  it("18% band: 500,000.77 a month, 16,000.02 pension", () => {
    // annual 6,000,009.24 − 192,000.24 = 5,808,009.00; 330,000 + 18% × 2,808,009 (505,441.62) = 835,441.62; ÷ 12 = 69,620.135
    expect(paye({ monthlyRegularTaxable: 500_000.77, monthlyEmployeePension: 16_000.02 }).paye).toBe(69_620.14);
  });
  it("21% band: 1,500,004.65 a month, 48,000.15 pension", () => {
    // annual 18,000,055.80 − 576,001.80 = 17,424,054.00; 330,000 + 1,620,000 + 21% × 5,424,054 (1,139,051.34) = 3,089,051.34; ÷ 12 = 257,420.945
    expect(paye({ monthlyRegularTaxable: 1_500_004.65, monthlyEmployeePension: 48_000.15 }).paye).toBe(257_420.95);
  });
  it("25% band: 5,000,000.02 a month, 160,000 pension", () => {
    // annual 60,000,000.24 − 1,920,000 = 58,080,000.24; 330,000 + 1,620,000 + 2,730,000 + 5,750,000 + 25% × 8,080,000.24 (2,020,000.06) = 12,450,000.06; ÷ 12 = 1,037,500.005
    expect(paye({ monthlyRegularTaxable: 5_000_000.02, monthlyEmployeePension: 160_000 }).paye).toBe(1_037_500.01);
  });
  it("one-off pay is taxed at the marginal rate on top: 400,001.29 regular, 49,500 overtime, 12,800.04 pension", () => {
    // regular chargeable 4,800,015.48 − 153,600.48 = 4,646,415.00: tax 626,354.70. With 49,500: 4,695,915.00: tax 635,264.70. Difference 8,910.00.
    // monthly = 626,354.70 ÷ 12 (52,196.225) + 8,910.00 = 61,106.225
    const r = paye({ monthlyRegularTaxable: 400_001.29, monthlyIrregularTaxable: 49_500, monthlyEmployeePension: 12_800.04 });
    expect(r.paye).toBe(61_106.23);
    expect(r).toMatchObject({ annualGross: 4_849_515.48, annualReliefs: 153_600.48, annualChargeable: 4_695_915, annualTax: 635_264.7, exempt: false });
  });
  it("NHF relief when no NHF amount is given: 2.5% of basic × 12, rounded to the kobo on its own line", () => {
    // basic 80,001.21 × 12 = 960,014.52; × 2.5% = 24,000.363 → relief 24,000.36
    // annual 2,400,036.36 − pension 76,801.20 − NHF 24,000.36 = 2,299,234.80; 15% × 1,499,234.80 = 224,885.22; ÷ 12 = 18,740.435
    const r = paye({ monthlyRegularTaxable: 200_003.03, monthlyEmployeePension: 6_400.1, monthlyBasic: 80_001.21 });
    expect(r.paye).toBe(18_740.44);
    expect(r.reliefBreakdown.map((x) => [x.code, x.amount])).toEqual([["PENSION", 76_801.2], ["NHF", 24_000.36]]);
  });
  it("rent relief is 20% of the annual rent, rounded to the kobo: 1,400,003.62 rent gives 280,000.72", () => {
    // annual 2,400,021.84 − pension 76,800.72 − rent relief 280,000.72 = 2,043,220.40; 15% × 1,243,220.40 = 186,483.06; ÷ 12 = 15,540.255
    const r = paye({ monthlyRegularTaxable: 200_001.82, monthlyEmployeePension: 6_400.06, annualRent: 1_400_003.62 });
    expect(r.paye).toBe(15_540.26);
    expect(r.reliefBreakdown.map((x) => [x.code, x.amount])).toEqual([["PENSION", 76_800.72], ["RENT", 280_000.72]]);
  });
  it("rent relief stops at its cap: 4,000,002.11 rent would give 800,000.42, capped at 500,000", () => {
    // annual 2,400,003.72 − 76,800.12 − 500,000 = 1,823,203.60; 15% × 1,023,203.60 = 153,480.54; ÷ 12 = 12,790.045
    const r = paye({ monthlyRegularTaxable: 200_000.31, monthlyEmployeePension: 6_400.01, annualRent: 4_000_002.11 });
    expect(r.paye).toBe(12_790.05);
    expect(r.reliefBreakdown.find((x) => x.code === "RENT")?.amount).toBe(500_000);
  });
  it("tax on an annual amount (taxOnBands) rounds a half-kobo tie up: 15% of 0.10 over the first band is 0.015", () => {
    expect(taxOnBands(800_000.1, NTA_2025_BANDS)).toBe(0.02);
  });
});

describe("PAYE: results that must not change", () => {
  it("the band edges, to the kobo", () => {
    expect(taxOnBands(0, NTA_2025_BANDS)).toBe(0);
    expect(taxOnBands(-100, NTA_2025_BANDS)).toBe(0);
    expect(taxOnBands(800_000, NTA_2025_BANDS)).toBe(0);
    expect(taxOnBands(3_000_000, NTA_2025_BANDS)).toBe(330_000);
    expect(taxOnBands(12_000_000, NTA_2025_BANDS)).toBe(1_950_000);
    expect(taxOnBands(25_000_000, NTA_2025_BANDS)).toBe(4_680_000);
    expect(taxOnBands(50_000_000, NTA_2025_BANDS)).toBe(10_430_000);
    expect(taxOnBands(60_000_000, NTA_2025_BANDS)).toBe(12_930_000);
  });
  it("the same answer whichever order the bands are listed in", () => {
    expect(taxOnBands(5_568_000, [...NTA_2025_BANDS].reverse())).toBe(taxOnBands(5_568_000, NTA_2025_BANDS));
  });
  it("a minimum-wage earner is exempt up to and including the ceiling, and taxed one kobo above it", () => {
    expect(paye({ monthlyRegularTaxable: 70_000 })).toMatchObject({ paye: 0, exempt: true, exemptionCode: "MIN_WAGE", annualGross: 840_000 });
    // 70,000.01 × 12 = 840,000.12: 15% × 40,000.12 = 6,000.018; ÷ 12 = 500.0015 → 500.00
    expect(paye({ monthlyRegularTaxable: 70_000.01 })).toMatchObject({ paye: 500, exempt: false });
  });
  it("an exemption that is switched off does not apply", () => {
    const off: TaxRuleDef = { ...RULE, exemptions: [{ ...RULE.exemptions[0], active: false }] };
    expect(paye({ monthlyRegularTaxable: 70_000 }, off).exempt).toBe(false);
  });
  it("nothing earned means no tax and no exemption claimed", () => {
    expect(paye({})).toMatchObject({ paye: 0, exempt: false, annualGross: 0, annualChargeable: 0, annualTax: 0 });
  });
  it("reliefs that wipe out the income leave no tax", () => {
    expect(paye({ monthlyRegularTaxable: 100_000, monthlyEmployeePension: 100_000 })).toMatchObject({ paye: 0, annualChargeable: 0, exempt: false });
  });
  it("negative one-off income (arrears being corrected down) lowers the tax by the marginal amount: 200,000 regular, −10,000", () => {
    // annual 2,400,000: tax 240,000. With −10,000: 2,390,000: tax 238,500. Difference −1,500. Monthly 240,000 ÷ 12 − 1,500 = 18,500
    expect(paye({ monthlyRegularTaxable: 200_000, monthlyIrregularTaxable: -10_000 }).paye).toBe(18_500);
  });
  it("every kind of relief, a cap, and inactive reliefs left out", () => {
    const rule: TaxRuleDef = {
      ...RULE,
      reliefs: [
        { code: "FIXED", name: "Fixed", type: "FIXED_ANNUAL", amount: 200_000, cap: 150_000, active: true },
        { code: "GROSS", name: "1% of gross", type: "PERCENT_OF_GROSS", rate: 1, active: true },
        { code: "NHIS", name: "Health insurance", type: "NHIS", active: true },
        { code: "NHF", name: "NHF", type: "NHF", rate: 2.5, active: true },
        { code: "OFF", name: "Switched off", type: "FIXED_ANNUAL", amount: 999_999, active: false },
      ],
    };
    // annual 1,800,000. Fixed 200,000 capped to 150,000; 1% = 18,000; NHIS 1,000.55 × 12 = 12,006.60; NHF given 2,000.25 × 12 = 24,003.00
    // reliefs 204,009.60; chargeable 1,595,990.40; 15% × 795,990.40 = 119,398.56; ÷ 12 = 9,949.88
    const r = paye({ monthlyRegularTaxable: 150_000, nhisMonthly: 1_000.55, nhfMonthly: 2_000.25, monthlyBasic: 99_999 }, rule);
    expect(r.reliefBreakdown.map((x) => [x.code, x.amount])).toEqual([["FIXED", 150_000], ["GROSS", 18_000], ["NHIS", 12_006.6], ["NHF", 24_003]]);
    expect(r).toMatchObject({ annualReliefs: 204_009.6, annualChargeable: 1_595_990.4, paye: 9_949.88 });
  });
  it("reports which rule version it used", () => {
    expect(paye({ monthlyRegularTaxable: 100_000 }).ruleVersion).toBe("NTA@test");
  });
});

describe("PAYE refuses what it cannot calculate exactly", () => {
  it("accepts floating-point dust left by earlier arithmetic (0.1 + 0.2) as the kobo it was meant to be", () => {
    const dusty = paye({ monthlyRegularTaxable: 200_000, monthlyIrregularTaxable: 0.1 + 0.2 });
    const clean = paye({ monthlyRegularTaxable: 200_000, monthlyIrregularTaxable: 0.3 });
    expect(dusty).toEqual(clean);
  });
  it("refuses an amount that is part-way through a kobo, or not a number", () => {
    expect(() => paye({ monthlyRegularTaxable: 84_000.005 })).toThrow(MoneyError);
    expect(() => paye({ monthlyEmployeePension: 0.004 })).toThrow(MoneyError);
    expect(() => paye({ monthlyRegularTaxable: Number.NaN })).toThrow(MoneyError);
    expect(() => paye({ monthlyRegularTaxable: Number.POSITIVE_INFINITY })).toThrow(MoneyError);
    expect(() => taxOnBands(1_000_000.001, NTA_2025_BANDS)).toThrow(MoneyError);
  });
});

// ── An independent exact calculation, written differently from the code under test (all in BigInt kobo), to check a spread of salaries ──
const half = (n: bigint, d: bigint) => (n * 2n + d) / (d * 2n);
function oracleUnits(chargeable: bigint): bigint {
  let total = 0n; // kobo × (rate in ten-thousandths of a percent)
  for (const b of NTA_2025_BANDS) {
    const lo = BigInt(b.lowerBound) * 100n;
    if (chargeable <= lo) break;
    const hi = b.upperBound === null ? chargeable : BigInt(b.upperBound) * 100n;
    total += ((chargeable < hi ? chargeable : hi) - lo) * BigInt(Math.round(b.rate * 10_000));
  }
  return total;
}
function oraclePaye(reg: bigint, irr: bigint, pen: bigint, basic: bigint, rent: bigint): bigint {
  const annualRegular = reg * 12n;
  if (annualRegular + irr > 0n && annualRegular + irr <= 84_000_000n) return 0n;
  let relief = pen * 12n;
  let rentRelief = half(rent * 200_000n, 1_000_000n);
  if (rentRelief > 50_000_000n) rentRelief = 50_000_000n;
  relief += rentRelief + half(basic * 12n * 25_000n, 1_000_000n);
  const chargeable = annualRegular - relief > 0n ? annualRegular - relief : 0n;
  const a = oracleUnits(chargeable);
  const b = oracleUnits(chargeable + irr);
  const numerator = a + 12n * (b - a);
  return numerator <= 0n ? 0n : half(numerator, 12_000_000n);
}

describe("PAYE agrees with an independent exact calculation across the salary range", () => {
  it("4,000 salaries from ₦50,000 to ₦4,000,000 a month, with and without one-off pay, rent and NHF", () => {
    let seed = 20261027;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const reg = BigInt(5_000_000 + rnd(395_000_000));
      const pen = half(reg * 32n, 1000n);
      const irr = rnd(2) ? BigInt(rnd(2_000_000)) : 0n;
      const rent = rnd(2) ? BigInt(rnd(600_000_000)) : 0n;
      const basic = rnd(2) ? half(reg * 4n, 10n) : 0n;
      const got = computePaye(
        { monthlyRegularTaxable: Number(reg) / 100, monthlyIrregularTaxable: Number(irr) / 100, monthlyEmployeePension: Number(pen) / 100, monthlyBasic: Number(basic) / 100, annualRent: Number(rent) / 100 },
        RULE,
      ).paye;
      expect(Math.round(got * 100), `reg ${reg} irr ${irr} pen ${pen} basic ${basic} rent ${rent}`).toBe(Number(oraclePaye(reg, irr, pen, basic, rent)));
      checked++;
    }
    expect(checked).toBe(4000);
  });
});

describe("PAYE speed", () => {
  it("3,000 employees, three calculations each (a normal run and a supplementary before/after), well inside a second or two", () => {
    const started = Date.now();
    for (let i = 0; i < 3000; i++) {
      const reg = Math.round((80_000 + i * 17.31) * 100) / 100;
      const common = { monthlyEmployeePension: Math.round(reg * 3.2) / 100, monthlyBasic: Math.round(reg * 40) / 100, annualRent: 600_000 };
      paye({ ...common, monthlyRegularTaxable: reg, monthlyIrregularTaxable: 0 });
      paye({ ...common, monthlyRegularTaxable: reg, monthlyIrregularTaxable: 12_345.67 });
      paye({ ...common, monthlyRegularTaxable: Math.round((reg + 500) * 100) / 100, monthlyIrregularTaxable: 0 });
    }
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
