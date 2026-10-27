import {
  addKobo,
  koboFromNaira as kobo,
  koboToNumber,
  mulDiv,
  mulPct,
  pctToRate,
  RATE_SCALE,
  roundRatio,
  subKobo,
  sumKobo,
  type Kobo,
  type Rate,
} from "../money-exact";

/**
 * Versioned PAYE rule engine. Tax rules are data (TaxRule / TaxBand / TaxRelief / TaxExemption);
 * nothing here hard-codes rates. The seed loads the Nigeria Tax Act 2025 regime (effective 1 Jan 2026).
 * Tax rules MUST be verified against current Nigerian law and official NRS guidance before production use.
 *
 * The arithmetic is exact: amounts are whole kobo, rates are whole units, and the slices of tax are added as exact whole numbers and rounded half up
 * ONCE, to the kobo, when they become a month's PAYE (see money-exact.ts). The inputs and results are still naira numbers, because the payroll engine
 * above this still passes numbers; `kobo()` below is the temporary bridge (koboFromNaira in money-exact.ts); it goes when the services pass kobo (stage 4 of docs/plans/exact-money.md).
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

/** A percentage as exact rate units. Rates come from the database as Decimal, so their text is clean. */
const rateOf = (pct: number): Rate => pctToRate(String(pct));

interface ExactBand {
  lower: bigint; // kobo
  upper: bigint | null; // kobo
  rate: bigint; // rate units
}

function exactBands(bands: TaxBandDef[]): ExactBand[] {
  return [...bands]
    .sort((a, b) => a.lowerBound - b.lowerBound)
    .map((b) => ({
      lower: BigInt(kobo(b.lowerBound, "A band's lower limit")),
      upper: b.upperBound === null ? null : BigInt(kobo(b.upperBound, "A band's upper limit")),
      rate: BigInt(rateOf(b.rate)),
    }));
}

/**
 * Exact tax on an annual chargeable income, as kobo × rate units (divide by RATE_SCALE for kobo). Nothing is rounded here; the caller rounds once.
 * An income at or below zero has no tax.
 */
function bandTaxUnits(chargeable: bigint, bands: ExactBand[]): bigint {
  if (chargeable <= 0n) return 0n;
  let total = 0n;
  for (const b of bands) {
    if (chargeable <= b.lower) break;
    const top = b.upper === null || chargeable < b.upper ? chargeable : b.upper;
    total += (top - b.lower) * b.rate;
  }
  return total;
}

/** Progressive tax on an annual chargeable income, rounded half up to the kobo once. */
export function taxOnBands(annualChargeable: number, bands: TaxBandDef[]): number {
  const units = bandTaxUnits(BigInt(kobo(annualChargeable, "The chargeable income")), exactBands(bands));
  return koboToNumber(roundRatio(units, RATE_SCALE));
}

export function computePaye(input: PayeInput, rule: TaxRuleDef): PayeResult {
  const regular = kobo(input.monthlyRegularTaxable, "Regular taxable pay");
  const irregular = kobo(input.monthlyIrregularTaxable, "One-off taxable pay");
  const annualRegular = mulDiv(regular, 12, 1);
  const annualGross = addKobo(annualRegular, irregular);
  const ruleVersion = `${rule.code}@${rule.version}`;

  const exemption = rule.exemptions.find((x) => x.active && annualGross <= kobo(x.annualGrossCeiling, "An exemption ceiling"));
  if (exemption && annualGross > 0) {
    return {
      paye: 0,
      annualGross: koboToNumber(annualGross),
      annualReliefs: 0,
      annualChargeable: 0,
      annualTax: 0,
      exempt: true,
      exemptionCode: exemption.code,
      reliefBreakdown: [],
      ruleVersion,
    };
  }

  const reliefBreakdown: PayeResult["reliefBreakdown"] = [];
  const reliefKobo: Kobo[] = [];
  for (const r of rule.reliefs.filter((x) => x.active)) {
    let amt: Kobo;
    switch (r.type) {
      case "PERCENT_OF_GROSS":
        amt = mulPct(annualRegular, rateOf(r.rate ?? 0));
        break;
      case "FIXED_ANNUAL":
        amt = kobo(r.amount ?? 0, `The ${r.code} relief amount`);
        break;
      case "PERCENT_OF_RENT_CAPPED":
        amt = mulPct(kobo(input.annualRent ?? 0, "The annual rent"), rateOf(r.rate ?? 0));
        break;
      case "EMPLOYEE_PENSION":
        amt = mulDiv(kobo(input.monthlyEmployeePension, "The employee pension"), 12, 1);
        break;
      case "NHF":
        // An NHF amount actually deducted wins; otherwise the relief is the rate on a year of basic pay, rounded on its own line.
        amt =
          input.nhfMonthly !== undefined && input.nhfMonthly !== null
            ? mulDiv(kobo(input.nhfMonthly, "The NHF deduction"), 12, 1)
            : mulPct(mulDiv(kobo(input.monthlyBasic, "Basic pay"), 12, 1), rateOf(r.rate ?? 0));
        break;
      case "NHIS":
        amt = mulDiv(kobo(input.nhisMonthly ?? 0, "The NHIS deduction"), 12, 1);
        break;
    }
    if (r.cap !== null && r.cap !== undefined) {
      const cap = kobo(r.cap, `The ${r.code} relief cap`);
      if (cap < amt) amt = cap;
    }
    if (amt > 0) {
      reliefBreakdown.push({ code: r.code, name: r.name, amount: koboToNumber(amt) });
      reliefKobo.push(amt);
    }
  }
  const annualReliefs = sumKobo(reliefKobo);
  const regularChargeable = annualRegular > annualReliefs ? subKobo(annualRegular, annualReliefs) : (0 as Kobo);
  const bands = exactBands(rule.bands);
  const regularUnits = bandTaxUnits(BigInt(regularChargeable), bands);
  // Non-recurring income is taxed at the marginal rate on top of annualised regular income.
  const withIrregularUnits = bandTaxUnits(BigInt(regularChargeable) + BigInt(irregular), bands);
  // Monthly PAYE = regular tax ÷ 12 + the one-off tax, all kept exact and rounded once.
  const monthlyUnits = regularUnits + 12n * (withIrregularUnits - regularUnits);
  const monthly = monthlyUnits <= 0n ? (0 as Kobo) : roundRatio(monthlyUnits, 12n * RATE_SCALE);

  return {
    paye: koboToNumber(monthly),
    annualGross: koboToNumber(annualGross),
    annualReliefs: koboToNumber(annualReliefs),
    annualChargeable: koboToNumber(addKobo(regularChargeable, irregular)),
    annualTax: koboToNumber(roundRatio(withIrregularUnits, RATE_SCALE)),
    exempt: false,
    reliefBreakdown,
    ruleVersion,
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
