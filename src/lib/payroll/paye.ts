import { round2 } from "../money";

/**
 * Versioned PAYE rule engine. Tax rules are data (TaxRule / TaxBand / TaxRelief / TaxExemption);
 * nothing here hard-codes rates. The seed loads the Nigeria Tax Act 2025 regime (effective 1 Jan 2026).
 * Tax rules MUST be verified against current Nigerian law and official NRS guidance before production use.
 */
export interface TaxBandDef {
  lowerBound: number;
  upperBound: number | null;
  rate: number; // percent
}

export type ReliefKind =
  "PERCENT_OF_GROSS" | "FIXED_ANNUAL" | "PERCENT_OF_RENT_CAPPED" | "EMPLOYEE_PENSION" | "NHF" | "NHIS";

export interface TaxReliefDef {
  code: string;
  name: string;
  type: ReliefKind;
  rate?: number | null;
  amount?: number | null;
  cap?: number | null;
  active: boolean;
}

export interface TaxExemptionDef {
  code: string;
  description: string;
  annualGrossCeiling: number;
  active: boolean;
}

export interface TaxRuleDef {
  code: string;
  version: string;
  bands: TaxBandDef[];
  reliefs: TaxReliefDef[];
  exemptions: TaxExemptionDef[];
}

export interface PayeInput {
  monthlyRegularTaxable: number; // recurring taxable earnings for the month
  monthlyIrregularTaxable: number; // overtime, arrears, one-off earnings
  monthlyEmployeePension: number;
  monthlyBasic: number;
  annualRent?: number | null;
  nhfMonthly?: number;
  nhisMonthly?: number;
}

export interface PayeResult {
  paye: number;
  annualGross: number;
  annualReliefs: number;
  annualChargeable: number;
  annualTax: number;
  exempt: boolean;
  exemptionCode?: string;
  reliefBreakdown: Array<{ code: string; name: string; amount: number }>;
  ruleVersion: string;
}

/** Progressive tax on an annual chargeable income. */
export function taxOnBands(annualChargeable: number, bands: TaxBandDef[]): number {
  if (annualChargeable <= 0) return 0;
  let tax = 0;
  const sorted = [...bands].sort((a, b) => a.lowerBound - b.lowerBound);
  for (const b of sorted) {
    if (annualChargeable <= b.lowerBound) break;
    const top = b.upperBound === null ? annualChargeable : Math.min(annualChargeable, b.upperBound);
    tax += (top - b.lowerBound) * (b.rate / 100);
  }
  return tax;
}

export function computePaye(input: PayeInput, rule: TaxRuleDef): PayeResult {
  const annualRegular = input.monthlyRegularTaxable * 12;
  const annualIrregular = input.monthlyIrregularTaxable;
  const annualGross = annualRegular + annualIrregular;

  const exemption = rule.exemptions.find((x) => x.active && annualGross <= x.annualGrossCeiling);
  if (exemption && annualGross > 0) {
    return {
      paye: 0,
      annualGross: round2(annualGross),
      annualReliefs: 0,
      annualChargeable: 0,
      annualTax: 0,
      exempt: true,
      exemptionCode: exemption.code,
      reliefBreakdown: [],
      ruleVersion: `${rule.code}@${rule.version}`,
    };
  }

  const reliefBreakdown: PayeResult["reliefBreakdown"] = [];
  for (const r of rule.reliefs.filter((x) => x.active)) {
    let amt = 0;
    switch (r.type) {
      case "PERCENT_OF_GROSS":
        amt = (annualRegular * (r.rate ?? 0)) / 100;
        break;
      case "FIXED_ANNUAL":
        amt = r.amount ?? 0;
        break;
      case "PERCENT_OF_RENT_CAPPED":
        amt = ((input.annualRent ?? 0) * (r.rate ?? 0)) / 100;
        break;
      case "EMPLOYEE_PENSION":
        amt = input.monthlyEmployeePension * 12;
        break;
      case "NHF":
        amt = (input.nhfMonthly ?? (input.monthlyBasic * (r.rate ?? 0)) / 100) * 12;
        break;
      case "NHIS":
        amt = (input.nhisMonthly ?? 0) * 12;
        break;
    }
    if (r.cap !== null && r.cap !== undefined) amt = Math.min(amt, r.cap);
    if (amt > 0) reliefBreakdown.push({ code: r.code, name: r.name, amount: round2(amt) });
  }
  const annualReliefs = reliefBreakdown.reduce((a, r) => a + r.amount, 0);
  const regularChargeable = Math.max(0, annualRegular - annualReliefs);
  const regularTax = taxOnBands(regularChargeable, rule.bands);
  // Non-recurring income is taxed at the marginal rate on top of annualised regular income.
  const withIrregular = taxOnBands(regularChargeable + annualIrregular, rule.bands);
  const monthly = regularTax / 12 + (withIrregular - regularTax);

  return {
    paye: round2(Math.max(0, monthly)),
    annualGross: round2(annualGross),
    annualReliefs: round2(annualReliefs),
    annualChargeable: round2(regularChargeable + annualIrregular),
    annualTax: round2(regularTax + (withIrregular - regularTax)),
    exempt: false,
    reliefBreakdown,
    ruleVersion: `${rule.code}@${rule.version}`,
  };
}

/** Nigeria Tax Act 2025 — personal income tax schedule applicable from 1 January 2026 (seed data). */
export const NTA_2025_BANDS: TaxBandDef[] = [
  { lowerBound: 0, upperBound: 800_000, rate: 0 },
  { lowerBound: 800_000, upperBound: 3_000_000, rate: 15 },
  { lowerBound: 3_000_000, upperBound: 12_000_000, rate: 18 },
  { lowerBound: 12_000_000, upperBound: 25_000_000, rate: 21 },
  { lowerBound: 25_000_000, upperBound: 50_000_000, rate: 23 },
  { lowerBound: 50_000_000, upperBound: null, rate: 25 },
];
