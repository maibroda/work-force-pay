import { describe, expect, it } from "vitest";
import { Exact } from "../../src/lib/exact-fraction";
import type { Kobo } from "../../src/lib/money-exact";
import { calculateEmployeePayroll, type EngineInput, type RateInfo, type WorkDay } from "../../src/lib/payroll/engine";
import { computePayeKobo, type TaxRuleDef } from "../../src/lib/payroll/paye";
import type { StructureDef } from "../../src/lib/payroll/structure";
import {
  calculateGolden,
  expectedGolden,
  goldenBands,
  goldenCases,
  goldenIsVerified,
  goldenParameters,
  nairaToKobo,
  type GoldenResult,
  type GoldenRow,
} from "./reference";

/**
 * The golden dataset (tests/golden/GOLDEN_FORMAT.md): 11 invented workers with an answer key.
 * IMPORTANT: the parameters and bands are PLACEHOLDERS until the tax adviser fills verified_by and verified_on in golden_parameters.csv, and the
 * founder has hand-calculated the cases. These tests prove the key follows its OWN written formulas and that the engine agrees with it where the
 * two follow the same rules. They never loosen a tolerance, and an expected value is never edited to make a test pass.
 */
const params = goldenParameters();
const bands = goldenBands();
const cases = goldenCases();
const fields = [
  "base_pay", "absence_deduction", "overtime_pay", "allowances_paid", "gross", "pension", "nhf",
  "annual_taxable", "annual_paye", "monthly_paye", "loan_coop_allowed", "net_pay", "paye_state",
] as const satisfies readonly (keyof GoldenResult)[];

describe("golden dataset: the files", () => {
  it("has eleven cases, numbered 1 to 11, and the rounding rule the engine uses", () => {
    expect(cases.map((c) => Number(c.case))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(params.rounding_mode).toBe("half_up_to_kobo");
  });

  it("obeys the validation rules for a case (GOLDEN_FORMAT.md section 1)", () => {
    for (const c of cases) {
      const D = Number(c.days_in_month);
      expect(Number(c.days_at_rate_1) + Number(c.days_at_rate_2), `case ${c.case}`).toBeLessThanOrEqual(D);
      expect(Number(c.allowance_days), `case ${c.case}`).toBeLessThanOrEqual(D);
      if (Number(c.days_at_rate_2) === 0) expect(Number(c.rate_2), `case ${c.case}`).toBe(0);
      if (Number(c.overtime_hours) === 0) expect(Number(c.overtime_multiplier), `case ${c.case}`).toBe(0);
    }
  });

  it("gives each tax band an incremental rate equal to its rate minus the previous band's", () => {
    let previous = Exact.int(0);
    for (const b of bands) {
      const rate = Exact.decimal(b.rate);
      expect(rate.sub(previous).cmp(Exact.decimal(b.incremental_rate)), `band ${b.band}`).toBe(0);
      previous = rate;
    }
    expect(bands[0].lower_limit).toBe("0");
    expect(bands.at(-1)?.upper_limit).toBe("");
  });

  it("knows whether the settings carry the adviser's sign-off (name and date both needed)", () => {
    expect(goldenIsVerified({ ...params, verified_by: "", verified_on: "" })).toBe(false);
    expect(goldenIsVerified({ ...params, verified_by: "A. Adviser", verified_on: "" })).toBe(false);
    expect(goldenIsVerified({ ...params, verified_by: "", verified_on: "2026-11-02" })).toBe(false);
    expect(goldenIsVerified({ ...params, verified_by: "A. Adviser", verified_on: "2026-11-02" })).toBe(true);
  });
});

describe("golden dataset: the answer key follows its own formulas (exact arithmetic, to the kobo)", () => {
  for (const c of cases) {
    it(`case ${c.case}: ${c.scenario}`, () => {
      const got = calculateGolden(c, params, bands);
      const want = expectedGolden(c);
      for (const f of fields) expect(got[f], `${f}`).toBe(want[f]);
    });
  }

  it("reproduces the format note's worked example for case 2 (net pay 106,596.55)", () => {
    const c2 = cases.find((c) => c.case === "2")!;
    const r = calculateGolden(c2, params, bands);
    expect(r.base_pay).toBe(11_200_000);
    expect(r.gross).toBe(12_200_000);
    expect(r.pension).toBe(683_200);
    expect(r.nhf).toBe(152_500);
    expect(r.annual_taxable).toBe(136_371_600);
    expect(r.annual_paye).toBe(8_455_740);
    expect(r.monthly_paye).toBe(704_645);
    expect(r.net_pay).toBe(10_659_655);
  });
});

/** The bands as the engine's tax rule holds them, with pension and NHF as reliefs (no other relief, no exemption), as the key assumes. */
function goldenTaxRule(): TaxRuleDef {
  return {
    code: "GOLDEN",
    version: "golden-dataset",
    bands: bands.map((b) => ({
      lowerBound: Number(b.lower_limit),
      upperBound: b.upper_limit === "" ? null : Number(b.upper_limit),
      rate: Exact.decimal(b.rate).mul(Exact.int(100)).toNumber(),
    })),
    reliefs: [
      { code: "PENSION", name: "Employee pension", type: "EMPLOYEE_PENSION", active: true },
      { code: "NHF", name: "NHF", type: "NHF", rate: Exact.decimal(params.nhf_rate_on_basic).mul(Exact.int(100)).toNumber(), active: true },
    ],
    exemptions: [],
  };
}

describe("golden dataset: the engine's PAYE calculation agrees with the key", () => {
  for (const c of cases) {
    it(`case ${c.case}: ${c.scenario}`, () => {
      const want = expectedGolden(c);
      const r = computePayeKobo(
        {
          regularTaxable: want.gross as Kobo,
          irregularTaxable: 0 as Kobo,
          employeePension: want.pension as Kobo,
          basic: Exact.int(want.gross).mul(Exact.decimal(params.basic_share_of_gross)).round(),
          nhfMonthly: want.nhf as Kobo,
        },
        goldenTaxRule(),
      );
      expect(r.annualChargeable, "annual taxable").toBe(want.annual_taxable);
      expect(r.annualTax, "annual PAYE").toBe(want.annual_paye);
      expect(r.paye, "monthly PAYE").toBe(want.monthly_paye);
    });
  }
});

// ───────────────────────────── the whole payroll engine ─────────────────────────────

const base = { taxable: true, employerCost: false, active: true };
/** Salary structure that gives the key's shares: 70% of gross pensionable (basic 50, housing 10, transport 10), basic 50% of gross. */
const GOLDEN_STRUCTURE: StructureDef = {
  id: "golden",
  code: "GOLDEN",
  name: "Golden shares",
  isPartial: false,
  components: [
    { ...base, code: "BASIC", name: "Basic", calcType: "PERCENTAGE", percentage: 50, pensionable: true, sortOrder: 0 },
    { ...base, code: "HOUSING", name: "Housing", calcType: "PERCENTAGE", percentage: 10, pensionable: true, sortOrder: 1 },
    { ...base, code: "TRANSPORT", name: "Transport", calcType: "PERCENTAGE", percentage: 10, pensionable: true, sortOrder: 2 },
    { ...base, code: "OTHER", name: "Other", calcType: "PERCENTAGE", percentage: 30, pensionable: false, sortOrder: 3 },
  ],
};

/** The engine's figures for a case, with the allowances carried inside each period's monthly gross (rate + allowances). Only for cases with no absence/overtime. */
function runEngine(c: GoldenRow) {
  const d1 = Number(c.days_at_rate_1);
  const d2 = Number(c.days_at_rate_2);
  const allowances = Number(c.monthly_allowances);
  const rates: RateInfo[] = [Number(c.rate_1), Number(c.rate_2)].map((rate, i) => ({
    key: `rate-${i}`,
    source: "EMPLOYEE_PAY_RATE",
    agreedRate: null,
    operativeSharePct: null,
    monthlyGross: rate + allowances,
    structure: GOLDEN_STRUCTURE,
  }));
  const days: WorkDay[] = [];
  for (let day = 1; day <= d1 + d2; day++)
    days.push({ date: new Date(Date.UTC(2026, 8, day)), clientId: null, clientName: "-", contractId: null, beatId: `beat-${day <= d1 ? 0 : 1}`, beatName: "-", categoryId: "GUARD", status: "PRESENT", overtimeHours: 0 });
  const input: EngineInput = {
    basisDays: Number(c.days_in_month),
    days,
    resolveRate: (day) => rates[Number(day.beatId?.split("-")[1] ?? 0)],
    pension: { employeeRate: Exact.decimal(params.employee_pension_rate).mul(Exact.int(100)).toNumber(), employerRate: 10, version: "golden" },
    // the key's NHF rate, loaded the way GOLDEN_FORMAT.md section 4 says: from the golden parameters, into the setting the engine reads
    nhfEmployeeRatePct: Exact.decimal(params.nhf_rate_on_basic).mul(Exact.int(100)).toNumber(),
    taxRule: goldenTaxRule(),
  };
  return calculateEmployeePayroll(input);
}

const kobo = (naira: number) => Number(nairaToKobo(String(naira)).round());

describe("golden dataset: the payroll engine agrees with the key on gross, pension, NHF, PAYE and net pay", () => {
  // Cases the engine can be given the same inputs for, and whose rules are the same on these three lines.
  // Case 9 is left out on purpose: see the todo below (the key rounds basic pay and allowances separately).
  for (const n of [1, 2, 3, 6, 7, 8, 11]) {
    const c = cases.find((x) => Number(x.case) === n)!;
    it(`case ${c.case}: ${c.scenario}`, () => {
      const want = expectedGolden(c);
      const r = runEngine(c);
      expect(kobo(r.earnedGross), "gross").toBe(want.gross);
      expect(kobo(r.employeePension), "pension").toBe(want.pension);
      expect(kobo(r.paye.annualChargeable), "annual taxable").toBe(want.annual_taxable);
      expect(kobo(r.paye.annualTax), "annual PAYE").toBe(want.annual_paye);
      expect(kobo(r.paye.paye), "monthly PAYE").toBe(want.monthly_paye);
      expect(kobo(r.employeeNhf), "NHF").toBe(want.nhf);
      expect(kobo(r.netPay), "net pay").toBe(want.net_pay);
    });
  }

  // Where the engine follows DIFFERENT RULES from the key. Not failures to hide: each needs the founder's (and the adviser's) decision on which rule is right.
  // When a decision is made, the rule is changed in one place and the key regenerated (GOLDEN_FORMAT.md section 2), and the todo becomes a test.
  it.todo("Net-pay floor: the key limits loan and cooperative deductions so at least half of gross is taken home (case 10); the engine only flags deductions above a percentage of earnings");
  it.todo("Unpaid absence: the key leaves allowances unreduced by absence days (case 4); the engine pays everything pro rata to the days paid");
  it.todo("Overtime base: the key's hourly rate uses the rate without allowances (case 5); the app derives it from the whole operative monthly gross");
  it.todo("Rounding of basic pay and allowances: the key rounds them as two lines (case 9: 66,666.67 + 6,666.67 = 73,333.34); the engine rounds each salary component (73,333.33)");
});
