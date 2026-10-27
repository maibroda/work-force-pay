/**
 * The arithmetic behind the inputs to a payroll run: overtime pay, arrears and recurring percentage deductions. Pure: no database, no framework.
 *
 * Every figure is worked in whole kobo and exact fractions and rounded half up, ONCE, at the line where it is calculated (see money-exact.ts and
 * exact-fraction.ts). The inputs and results are naira numbers because the services around this pass numbers; a stored amount is read through
 * `koboFromNaira`, which refuses an amount that is part-way through a kobo. A number a person TYPED (an hourly rate, hours, a corrected amount) can
 * have any number of decimals and is read exactly as written.
 */
import { Exact } from "../exact-fraction";
import { koboFromNaira, koboToNumber, mulPct, pctToRate, subKobo, sumKobo, type Kobo } from "../money-exact";
import { computePayeKobo, type TaxRuleDef } from "./paye";

const HUNDRED = Exact.int(100);
const ZERO = 0 as Kobo;

/** A number a person TYPED, taken to the kobo, half up, once (it can have any number of decimals). */
const typedKobo = (naira: number): Kobo => Exact.fromNumber(naira).mul(HUNDRED).round();

/** A number a person typed, as naira taken to the kobo, half up, once (what the database would store). */
export const typedAmount = (naira: number): number => koboToNumber(typedKobo(naira));

// ─────────────────────────────── Overtime ───────────────────────────────

/** Overtime pay: hours × the hourly rate, rounded half up to the kobo once. */
export function overtimePay(hours: number, hourlyRate: number): number {
  return koboToNumber(Exact.fromNumber(hours).mul(Exact.fromNumber(hourlyRate)).mul(HUNDRED).round());
}

/** An entered overtime amount is accepted if it is within one kobo of the calculated one. The comparison is exact. */
export function overtimeAmountAcceptable(entered: number, calculated: number): boolean {
  const gap = Exact.fromNumber(entered).sub(Exact.fromNumber(calculated));
  return (gap.cmp(Exact.int(0)) < 0 ? gap.neg() : gap).cmp(Exact.decimal("0.01")) <= 0;
}

// ─────────────────────────────── Percentages and sums ───────────────────────────────

/** A percentage of a stored amount, rounded half up to the kobo (a recurring percentage deduction). */
export function percentOfAmount(amount: number, pct: number): number {
  return koboToNumber(mulPct(koboFromNaira(amount, "The amount"), pctToRate(String(pct))));
}

/** The exact total of stored amounts. */
export function totalOf(amounts: readonly number[]): number {
  return koboToNumber(sumKobo(amounts.map((a) => koboFromNaira(a, "An amount to add up"))));
}

/** The first amount less each of the others, exactly. */
export function minus(first: number, ...rest: number[]): number {
  return koboToNumber(rest.reduce<Kobo>((acc, x) => subKobo(acc, koboFromNaira(x, "An amount to subtract")), koboFromNaira(first, "An amount")));
}

// ─────────────────────────────── Arrears ───────────────────────────────

/**
 * What the corrected monthly gross comes to for the part of the month actually worked: the corrected gross × (earned gross ÷ monthly gross),
 * both stored amounts, rounded half up to the kobo once. A month with no monthly gross gives nothing.
 */
export function correctedAmountFor(correctedMonthlyGross: number, earnedGross: number, monthlyGross: number): number {
  const monthly = koboFromNaira(monthlyGross, "The monthly gross");
  if (monthly === 0) return 0;
  const earned = koboFromNaira(earnedGross, "The earned gross");
  return koboToNumber(Exact.fromNumber(correctedMonthlyGross).mul(HUNDRED).mul(Exact.ratio(earned, monthly)).round());
}

/** Corrected less original, rounded half up to the kobo once (the amounts can be typed with any number of decimals). */
export function arrearsDifference(originalAmount: number, correctedAmount: number): number {
  return koboToNumber(Exact.fromNumber(correctedAmount).sub(Exact.fromNumber(originalAmount)).mul(HUNDRED).round());
}

/** The share of a payment that is pensionable, from a recorded payroll month: pension base over earned gross. */
export function pensionableShareOf(pensionBase: number, earnedGross: number): Exact {
  const earned = koboFromNaira(earnedGross, "The earned gross");
  return earned === 0 ? Exact.int(0) : Exact.ratio(koboFromNaira(pensionBase, "The pension base"), earned);
}

/** The same when there is no record: the percentages of the structure's pensionable components, added exactly. */
export function pensionableShareFromPercentages(percentages: readonly number[]): Exact {
  return percentages.reduce((a, p) => a.add(Exact.fromNumber(p)), Exact.int(0)).div(HUNDRED);
}

export interface ArrearsImpactInput {
  /** Gross impact: corrected less original, naira (negative for a correction downwards). */
  difference: number;
  pensionableShare: Exact;
  employeePensionRatePct: number;
  /** The month's regular taxable pay and employee pension, as recorded (or, with no record, as typed: taken to the kobo half up). */
  regularTaxable: number;
  employeePension: number;
  taxRule: TaxRuleDef;
}

/**
 * What an arrears amount does to pension, tax and net pay, so it can be reviewed before approval. The pensionable part is the difference × its
 * pensionable share; the pension is the employee rate on that; the tax is PAYE with the difference on top of the month less PAYE without it
 * (each rounded to the kobo as PAYE is); net is the difference less tax and pension.
 */
export function arrearsImpacts(i: ArrearsImpactInput) {
  const difference = koboFromNaira(i.difference, "The arrears difference");
  const pensionableImpact = Exact.int(difference).mul(i.pensionableShare).round();
  const pensionImpact = mulPct(pensionableImpact, pctToRate(String(i.employeePensionRatePct)));
  const common = { regularTaxable: typedKobo(i.regularTaxable), employeePension: koboFromNaira(i.employeePension, "The employee pension"), basic: ZERO };
  const base = computePayeKobo({ ...common, irregularTaxable: ZERO }, i.taxRule);
  const withArrears = computePayeKobo({ ...common, irregularTaxable: difference }, i.taxRule);
  const taxImpact = subKobo(withArrears.paye, base.paye);
  const netImpact = subKobo(subKobo(difference, taxImpact), pensionImpact);
  return {
    pensionableImpact: koboToNumber(pensionableImpact),
    pensionImpact: koboToNumber(pensionImpact),
    taxImpact: koboToNumber(taxImpact),
    netImpact: koboToNumber(netImpact),
  };
}
