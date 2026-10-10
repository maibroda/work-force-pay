import { round2 } from "../money";
import { computePaye, type PayeResult, type TaxRuleDef } from "./paye";

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
  const total = live.reduce((s, w) => s + w.weight, 0);
  if (!live.length || total <= 0) return [{ code: "OTHER", name: "Other allowances", pct: otherPct, taxable: true, pensionable: false }];
  let used = 0;
  return live.map((w, i) => {
    const pct = i === live.length - 1 ? Math.round((otherPct - used) * 10000) / 10000 : Math.round(((otherPct * w.weight) / total) * 10000) / 10000;
    used += pct;
    return { code: w.code, name: w.name, pct, taxable: w.taxable, pensionable: w.pensionable };
  });
}

export function quickPayslip(input: QuickInput): QuickPayslip {
  const gross = round2(input.monthlyGross);
  // Each allowance is its share of the gross to the kobo; the last one takes the rounding, so the lines always add up to the gross.
  let used = 0;
  const earnings: QuickEarning[] = input.components.map((c, i) => {
    const amount = i === input.components.length - 1 ? round2(gross - used) : round2((gross * c.pct) / 100);
    used = round2(used + amount);
    return { code: c.code, name: c.name, pct: c.pct, amount, taxable: c.taxable, pensionable: c.pensionable };
  });

  const pensionBase = round2(earnings.filter((e) => e.pensionable).reduce((s, e) => s + e.amount, 0));
  const employeePension = round2((pensionBase * input.employeeRate) / 100);
  const employerPension = round2((pensionBase * input.employerRate) / 100);
  const taxableEarnings = round2(earnings.filter((e) => e.taxable).reduce((s, e) => s + e.amount, 0));
  const basic = earnings.find((e) => e.code === "BASIC")?.amount ?? 0;
  const paye = computePaye(
    { monthlyRegularTaxable: taxableEarnings, monthlyIrregularTaxable: 0, monthlyEmployeePension: employeePension, monthlyBasic: basic, annualRent: input.annualRent ?? 0 },
    input.taxRule,
  );
  const otherDeductions = (input.otherDeductions ?? []).filter((d) => cents(d.amount) > 0).map((d) => ({ name: d.name, amount: round2(d.amount) }));
  const totalDeductions = round2(paye.paye + employeePension + otherDeductions.reduce((s, d) => s + d.amount, 0));
  const netPay = round2(gross - totalDeductions);
  return {
    earnings,
    gross,
    pensionBase,
    employeePension,
    employerPension,
    taxableEarnings,
    paye,
    otherDeductions,
    totalDeductions,
    netPay,
    employerCost: round2(gross + employerPension),
    netPct: gross > 0 ? round2((netPay / gross) * 100) : 0,
  };
}
