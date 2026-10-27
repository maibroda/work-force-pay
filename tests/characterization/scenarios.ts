/**
 * Synthetic payroll scenarios for the CHARACTERIZATION test of the payroll engine.
 *
 * A characterization record says what the engine produced on a given day. It is NOT a statement that those figures are right: it exists so that
 * when the arithmetic is rebuilt (docs/plans/exact-money.md) every difference from what the engine did before is visible, listed and explained.
 * Everything here is invented; there is no real employee, client or amount. The generator is deterministic.
 */
import { d, eachDay } from "../../src/lib/dates";
import {
  calculateEmployeePayroll,
  type EngineInput,
  type EngineResult,
  type RateInfo,
  type WorkDay,
} from "../../src/lib/payroll/engine";
import { NTA_2025_BANDS, type TaxRuleDef } from "../../src/lib/payroll/paye";
import { DEFAULT_EARNINGS, type StructureDef } from "../../src/lib/payroll/structure";

const STANDARD: StructureDef = {
  id: "std",
  code: "STD",
  name: "Standard",
  isPartial: false,
  components: DEFAULT_EARNINGS.map((c, i) => ({ ...c, calcType: "PERCENTAGE" as const, active: true, sortOrder: i })),
};

const base = { taxable: true, employerCost: false, active: true };
/** Percentages that are not round numbers, a fixed amount and a formula component, so every kind of component is exercised. */
const MIXED: StructureDef = {
  id: "mix",
  code: "MIX",
  name: "Mixed",
  isPartial: true,
  components: [
    { ...base, code: "BASIC", name: "Basic", calcType: "PERCENTAGE", percentage: 33.33, pensionable: true, sortOrder: 0 },
    { ...base, code: "HOUSING", name: "Housing", calcType: "PERCENTAGE", percentage: 17.5, pensionable: true, sortOrder: 1 },
    { ...base, code: "TRANSPORT", name: "Transport", calcType: "PERCENTAGE", percentage: 7.5, pensionable: true, sortOrder: 2 },
    { ...base, code: "MEAL", name: "Meal", calcType: "PERCENTAGE", percentage: 12.25, pensionable: false, sortOrder: 3 },
    { ...base, code: "HAZARD", name: "Hazard", calcType: "FIXED_AMOUNT", fixedAmount: 5000.55, pensionable: false, sortOrder: 4 },
    { ...base, code: "RISK", name: "Risk", calcType: "FORMULA", formula: "MIN(GROSS * 2%, 3000)", pensionable: false, sortOrder: 5 },
    { ...base, code: "UTILITY", name: "Utility", calcType: "FORMULA", formula: "(BASIC + HOUSING) / 7", pensionable: false, sortOrder: 6 },
  ],
};

const TAX: TaxRuleDef = {
  code: "NTA",
  version: "characterization",
  bands: NTA_2025_BANDS,
  reliefs: [
    { code: "PENSION", name: "Pension", type: "EMPLOYEE_PENSION", active: true },
    { code: "RENT", name: "Rent relief", type: "PERCENT_OF_RENT_CAPPED", rate: 20, cap: 500_000, active: true },
  ],
  exemptions: [{ code: "MIN_WAGE", description: "Minimum wage earners", annualGrossCeiling: 840_000, active: true }],
};

const PENSIONS = [
  { employeeRate: 8, employerRate: 10, version: "a" },
  { employeeRate: 8, employerRate: 10, version: "a" },
  { employeeRate: 7.5, employerRate: 10, version: "b" },
  { employeeRate: 5, employerRate: 15, version: "c" },
];

const COST_RULE = {
  itfPct: 1,
  nsitfPct: 1,
  nhfMedicalPct: 0.5,
  insurancePct: 7.5,
  uniformKitsPct: 25,
  recruitmentTrainingPct: 10.5,
  leaveRelieverPct: 22,
  outsourcingLeaveAllowancePct: 20,
};

export interface Scenario {
  id: string;
  input: EngineInput;
}

export const SCENARIO_COUNT = 300;

export function buildScenarios(count = SCENARIO_COUNT): Scenario[] {
  let seed = 20261104;
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const money = (minKobo: number, spanKobo: number) => (minKobo + rnd(spanKobo)) / 100;
  const chance = (percent: number) => rnd(100) < percent;
  const out: Scenario[] = [];

  for (let n = 0; n < count; n++) {
    const basisDays = rnd(2) ? 30 : 31;
    const structure = chance(35) ? MIXED : STANDARD;
    const segmentCount = 1 + rnd(3);
    const rates: RateInfo[] = [];
    for (let s = 0; s < segmentCount; s++) {
      const monthlyGross = money(4_000_000, 36_000_000);
      rates.push({
        key: `rate-${n}-${chance(30) && s > 0 ? 0 : s}`,
        source: "CONTRACT_RATE",
        agreedRate: Math.round(monthlyGross * 100 / 0.7) / 100,
        operativeSharePct: 70,
        monthlyGross,
        structure,
      });
    }
    // Days: cut the month into segmentCount runs; a few are absent, on leave or suspended.
    const month = basisDays === 30 ? ["2026-09-01", "2026-09-30"] : ["2026-10-01", "2026-10-31"];
    const calendar = eachDay(d(month[0]), d(month[1]));
    const days: WorkDay[] = [];
    let segment = 0;
    const cut = new Set<number>();
    while (cut.size < segmentCount - 1) cut.add(1 + rnd(calendar.length - 1));
    calendar.forEach((date, i) => {
      if (cut.has(i)) segment += 1;
      const status = chance(8) ? "ABSENT" : chance(4) ? "LEAVE" : chance(2) ? "SUSPENDED" : chance(6) ? "OFF" : "PRESENT";
      days.push({
        date,
        clientId: `cl-${segment}`,
        clientName: `Client ${segment}`,
        contractId: chance(10) ? null : `ct-${segment}`,
        beatId: `beat-${segment}`,
        beatName: `Beat ${segment}`,
        categoryId: "GUARD",
        status,
        overtimeHours: 0,
      });
    });
    const input: EngineInput = {
      basisDays,
      days,
      resolveRate: (day) => {
        const idx = Number(day.beatId?.split("-")[1] ?? 0);
        return rates[Math.min(idx, rates.length - 1)];
      },
      pension: PENSIONS[rnd(PENSIONS.length)],
      taxRule: TAX,
      annualRent: chance(30) ? money(30_000_000, 90_000_000) : 0,
    };
    if (chance(50)) {
      input.businessLineFor = (contractId) => (contractId ? (Number(contractId.split("-")[1]) % 2 ? "OUTSOURCING" : "GUARDING") : null);
      input.employerCostRule = COST_RULE;
    }
    if (chance(15)) {
      input.overrides = [chance(50)
        ? { componentCode: "BASIC", calcType: "PERCENTAGE", percentage: 12.5, reason: "test" }
        : { componentCode: "BASIC", calcType: "FIXED_AMOUNT", fixedAmount: money(500_000, 1_000_000), reason: "test" }];
    }
    if (chance(30)) {
      input.overtime = Array.from({ length: 1 + rnd(2) }, (_, i) => ({
        id: `ot-${n}-${i}`,
        beatId: `beat-${rnd(segmentCount)}`,
        clientId: "cl-0",
        contractId: "ct-0",
        hours: (1 + rnd(40)) / 2,
        amount: money(100_000, 900_000),
      }));
    }
    if (chance(20)) input.arrears = [{ id: `ar-${n}`, grossImpact: chance(30) ? -money(100_000, 500_000) : money(100_000, 900_000), pensionableImpact: money(50_000, 300_000) }];
    if (chance(25)) input.otherEarnings = [{ id: `oe-${n}`, name: "Bonus", amount: money(100_000, 2_000_000), taxable: chance(70) }];
    if (chance(30)) {
      input.deductions = [{ id: `de-${n}`, type: "LOAN_REPAYMENT", amount: money(50_000, 1_000_000), authorityReference: chance(85) ? "REF-1" : null, reason: "test" }];
    }
    if (chance(10)) {
      input.adjustmentsOnly = true;
      input.payeBase = { regularTaxable: money(5_000_000, 30_000_000), employeePension: money(100_000, 2_000_000), basic: money(500_000, 3_000_000) };
    }
    out.push({ id: `S${String(n).padStart(3, "0")}`, input });
  }
  return out;
}

/** Every money figure the engine produces, flattened to "name" -> number, so two runs can be compared figure by figure. */
export function summarise(r: EngineResult): Record<string, number> {
  const o: Record<string, number> = {};
  const scalars = [
    "daysWorked", "overtimeHours", "monthlyGross", "earnedGross", "overtimeAmount", "arrearsAmount", "otherEarnings", "totalEarnings",
    "pensionBase", "employeePension", "employerPension", "taxableIncome", "otherDeductions", "totalDeductions", "netPay", "clientBilling",
    "managementShare", "employerCost", "itfAmount", "nsitfAmount", "nhfMedicalAmount", "insuranceAmount", "uniformKitsAmount",
    "recruitmentTrainingAmount", "leaveRelieverAmount", "outsourcingLeaveAllowanceAmount", "totalEmployerAddOns",
  ] as const;
  for (const k of scalars) o[k] = r[k];
  o["paye"] = r.paye.paye;
  o["paye.annualTax"] = r.paye.annualTax;
  for (const c of r.components) o[`component.${c.code}`] = c.amount;
  r.segments.forEach((s, i) => {
    for (const k of ["gross", "pensionable", "clientBilling", "managementShare", "itf", "nsitf", "nhfMedical", "insurance", "uniformKits", "recruitmentTraining", "leaveReliever", "outsourcingLeaveAllowance"] as const)
      o[`segment${i}.${k}`] = s[k];
  });
  r.allocations.forEach((a, i) => {
    for (const k of ["grossAmount", "overtimeAmount", "employerPension", "clientBilling", "managementShare", "businessCosts", "netAmount"] as const)
      o[`allocation${i}.${k}`] = a[k];
  });
  return o;
}

export function runAll(count = SCENARIO_COUNT): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const s of buildScenarios(count)) result[s.id] = summarise(calculateEmployeePayroll(s.input));
  return result;
}
