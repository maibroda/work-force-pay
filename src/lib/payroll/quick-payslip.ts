import { Exact } from "../exact-fraction";
import { addKobo, koboFromNaira, koboToNumber, mulPct, pctToRate, roundRatio, subKobo, sumKobo, type Kobo } from "../money-exact";
import { computePayeKobo, payeResultToNaira, type PayeResult, type TaxRuleDef } from "./paye";

/**
 * A quick payslip: given a monthly gross salary and how it splits into Basic, Housing, Transport and other allowances,
 * work out the pension, PAYE and net pay exactly as the payroll engine does (same PAYE rule engine, same pension base,
 * same rounding). Nothing is saved. No database here.
 */

export interface QuickComponent {
  code: string;
  name: string;
  /** Share of the gross, in percent. */
  pct: number;
  taxable: boolean;
  pensionable: boolean;
}

export interface QuickInput {
  monthlyGross: number;
  /** The split of the gross. Must total 100%. */
  components: QuickComponent[];
  employeeRate: number;
  employerRate: number;
  taxRule: TaxRuleDef;
  annualRent?: number | null;
  /** Deductions the employer has agreed to make, each with a name. */
  otherDeductions?: Array<{ name: string; amount: number }>;
}

export interface QuickEarning {
  code: string;
  name: string;
  pct: number;
  amount: number;
  taxable: boolean;
  pensionable: boolean;
}

export interface QuickPayslip {
  earnings: QuickEarning[];
  gross: number;
  pensionBase: number;
  employeePension: number;
  employerPension: number;
  taxableEarnings: number;
  paye: PayeResult;
  otherDeductions: Array<{ name: string; amount: number }>;
  totalDeductions: number;
  netPay: number;
  /** What the employee costs the employer: gross plus the employer's pension contribution. */
  employerCost: number;
  /** Net pay as a share of gross. */
  netPct: number;
}

const cents = (n: number) => Math.round(n * 100);

/** Everything wrong with the inputs, as plain sentences. Empty = fine. */
export function quickProblems(input: { monthlyGross: number; components: Pick<QuickComponent, "code" | "pct">[]; otherDeductions?: Array<{ name: string; amount: number }> }): string[] {
  const out: string[] = [];
  if (!Number.isFinite(input.monthlyGross) || input.monthlyGross <= 0) out.push("Enter the monthly gross salary.");
  if (input.components.some((c) => !Number.isFinite(c.pct) || c.pct < 0)) out.push("A percentage can't be negative.");
  const total = input.components.reduce((s, c) => s + Math.round(c.pct * 10000), 0) / 10000;
  if (input.components.length && Math.abs(total - 100) > 0.0001) out.push(total > 100 ? `The percentages add up to ${total}%, which is more than 100%.` : `The percentages add up to ${total}%, which is less than 100%.`);
  if ((input.otherDeductions ?? []).some((d) => !Number.isFinite(d.amount) || d.amount < 0)) out.push("A deduction can't be negative.");
  return out;
}

/**
 * Splits the "other allowances" share among the allowances a salary structure keeps besides Basic, Housing and Transport, in the
 * proportions the structure gives them. The last takes any rounding so the shares always add up to exactly the share given.
 */
export function distributeOthers(otherPct: number, weights: Array<{ code: string; name: string; weight: number; taxable: boolean; pensionable: boolean }>): QuickComponent[] {
  const live = weights.filter((w) => w.weight > 0);
  const total = live.reduce((s, w) => s.add(Exact.fromNumber(w.weight)), Exact.int(0));
  if (!live.length || total.cmp(Exact.int(0)) <= 0) return [{ code: "OTHER", name: "Other allowances", pct: otherPct, taxable: true, pensionable: false }];
  // Each share is taken to four decimals, half up, exactly; the last takes what is left so the shares always add up to the share given.
  const toFourDecimals = (e: Exact) => Exact.ratio(e.mul(Exact.int(10_000)).round(), 10_000);
  const other = Exact.fromNumber(otherPct);
  let used = Exact.int(0);
  return live.map((w, i) => {
    const share = i === live.length - 1 ? toFourDecimals(other.sub(used)) : toFourDecimals(other.mul(Exact.fromNumber(w.weight)).div(total));
    used = used.add(share);
    return { code: w.code, name: w.name, pct: share.toNumber(), taxable: w.taxable, pensionable: w.pensionable };
  });
}

const HUNDRED = Exact.int(100);
/** A typed amount in naira, taken to the kobo, half up, once. (A person can type any number of decimals; the payslip works in whole kobo.) */
const typedKobo = (naira: number): Kobo => Exact.fromNumber(naira).mul(HUNDRED).round();

export function quickPayslip(input: QuickInput): QuickPayslip {
  const gross = typedKobo(input.monthlyGross);
  const employeeRate = pctToRate(String(input.employeeRate));
  const employerRate = pctToRate(String(input.employerRate));
  // Each allowance is its share of the gross to the kobo; the last one takes the rounding, so the lines always add up to the gross.
  let used = 0 as Kobo;
  const amounts: Kobo[] = [];
  const earnings: QuickEarning[] = input.components.map((c, i) => {
    // A typed percentage can have any number of decimals, so it is read as an exact fraction rather than as a rate unit.
    const amount: Kobo = i === input.components.length - 1 ? subKobo(gross, used) : Exact.int(gross).mul(Exact.fromNumber(c.pct)).div(HUNDRED).round();
    used = addKobo(used, amount);
    amounts.push(amount);
    return { code: c.code, name: c.name, pct: c.pct, amount: koboToNumber(amount), taxable: c.taxable, pensionable: c.pensionable };
  });

  const pensionBase = sumKobo(amounts.filter((_, i) => input.components[i].pensionable));
  const employeePension = mulPct(pensionBase, employeeRate);
  const employerPension = mulPct(pensionBase, employerRate);
  const taxableEarnings = sumKobo(amounts.filter((_, i) => input.components[i].taxable));
  const basicIndex = input.components.findIndex((c) => c.code === "BASIC");
  const basic = basicIndex >= 0 ? amounts[basicIndex] : (0 as Kobo);
  const paye = computePayeKobo(
    { regularTaxable: taxableEarnings, irregularTaxable: 0 as Kobo, employeePension, basic, annualRent: koboFromNaira(input.annualRent ?? 0, "The annual rent") },
    input.taxRule,
  );
  const deductions = (input.otherDeductions ?? []).filter((d) => cents(d.amount) > 0).map((d) => ({ name: d.name, kobo: typedKobo(d.amount) }));
  const totalDeductions = sumKobo([paye.paye, employeePension, ...deductions.map((d) => d.kobo)]);
  const netPay = subKobo(gross, totalDeductions);
  return {
    earnings,
    gross: koboToNumber(gross),
    pensionBase: koboToNumber(pensionBase),
    employeePension: koboToNumber(employeePension),
    employerPension: koboToNumber(employerPension),
    taxableEarnings: koboToNumber(taxableEarnings),
    paye: payeResultToNaira(paye),
    otherDeductions: deductions.map((d) => ({ name: d.name, amount: koboToNumber(d.kobo) })),
    totalDeductions: koboToNumber(totalDeductions),
    netPay: koboToNumber(netPay),
    employerCost: koboToNumber(addKobo(gross, employerPension)),
    // Net pay as a share of the gross, to two decimals, half up: net × 10,000 ÷ gross is hundredths of a percent.
    netPct: gross > 0 ? koboToNumber(roundRatio(BigInt(netPay) * 10_000n, BigInt(gross))) : 0,
  };
}
