/**
 * The golden dataset: loader and a REFERENCE calculator that follows tests/golden/GOLDEN_FORMAT.md, section 2, line by line.
 *
 * Everything is invented (see GOLDEN_FORMAT.md). All arithmetic is exact (BigInt fractions, `Exact`) and every line is rounded half up to the kobo
 * at the line where it is calculated. No floating-point number touches a money value. This file does not call the payroll engine: it is the
 * answer key's own rules written out, so the key can be checked against them and the engine can be checked against the key.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Exact } from "../../src/lib/exact-fraction";

const DIR = __dirname;

/** Minimal CSV reader (quoted values may hold commas); no dependency. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((x) => x !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const read = (file: string) => parseCsv(readFileSync(path.join(DIR, file), "utf8"));

export type GoldenRow = Record<string, string>;
export const goldenCases = (): GoldenRow[] => read("golden_cases.csv");
export const goldenBands = (): GoldenRow[] => read("golden_tax_bands.csv");
export const goldenParameters = (): Record<string, string> => Object.fromEntries(read("golden_parameters.csv").map((r) => [r.key, r.value]));

/** True only when the adviser's name AND date are filled in (GOLDEN_FORMAT.md section 4, point 4). */
export function goldenIsVerified(p = goldenParameters()): boolean {
  return p.verified_by.trim() !== "" && p.verified_on.trim() !== "";
}

// ───────────────────────────── exact helpers ─────────────────────────────

/** A naira text as exact KOBO (a fraction): "100000.5" is 10000050. */
export const nairaToKobo = (text: string): Exact => Exact.decimal(text || "0").mul(Exact.int(100));

/** An exact kobo value that must already be a whole number of kobo (a key cell). */
export function wholeKobo(text: string, what: string): number {
  const k = nairaToKobo(text);
  if (k.d !== 1n) throw new Error(`${what}: "${text}" is not a whole number of kobo.`);
  return Number(k.n);
}

const K = (n: number) => Exact.int(n);
/** Rounds an exact kobo value half up to a whole number of kobo (this is the one rounding rule: the `round2` of the format note). */
const r = (x: Exact): number => x.round();
/** A plain decimal ratio such as "0.025", exact. */
const D = (text: string) => Exact.decimal(text);

export interface GoldenResult {
  base_pay: number;
  absence_deduction: number;
  overtime_pay: number;
  allowances_paid: number;
  gross: number;
  pension: number;
  nhf: number;
  annual_taxable: number;
  annual_paye: number;
  monthly_paye: number;
  loan_coop_allowed: number;
  net_pay: number;
  paye_state: string;
}

/** Every result is whole kobo. */
export function calculateGolden(c: GoldenRow, p: Record<string, string>, bands: GoldenRow[]): GoldenResult {
  const days = Exact.int(Number(c.days_in_month));
  const d1 = Exact.int(Number(c.days_at_rate_1));
  const d2 = Exact.int(Number(c.days_at_rate_2));
  const rate1 = nairaToKobo(c.rate_1);
  const rate2 = nairaToKobo(c.rate_2);
  const hours = Exact.int(Number(p.hours_per_shift_day));

  const weightedTotal = rate1.mul(d1).add(rate2.mul(d2));
  const paidDays = d1.add(d2);
  const weightedRate = paidDays.isZero() ? K(0) : weightedTotal.div(paidDays);

  const basePay = r(weightedTotal.div(days));
  const absence = r(Exact.decimal(c.unpaid_absence_days).mul(weightedRate).div(days));
  const overtimeHourly = weightedRate.div(days.mul(hours)); // not rounded
  const overtime = r(Exact.decimal(c.overtime_hours).mul(overtimeHourly).mul(Exact.decimal(c.overtime_multiplier)));
  const allowances = r(nairaToKobo(c.monthly_allowances).mul(Exact.decimal(c.allowance_days)).div(days));
  const gross = basePay - absence + overtime + allowances;

  const pension = r(K(gross).mul(D(p.pensionable_share_of_gross)).mul(D(p.employee_pension_rate)));
  const nhf = r(K(gross).mul(D(p.basic_share_of_gross)).mul(D(p.nhf_rate_on_basic)));

  const afterRelief = K(12).mul(K(gross - pension - nhf)).sub(nairaToKobo(p.other_annual_relief));
  const annualTaxable = afterRelief.cmp(K(0)) > 0 ? r(afterRelief) : 0;

  let annualTaxUnits = K(0);
  for (const b of bands) {
    const over = K(annualTaxable).sub(nairaToKobo(b.lower_limit));
    if (over.cmp(K(0)) > 0) annualTaxUnits = annualTaxUnits.add(over.mul(D(b.incremental_rate)));
  }
  const annualPaye = r(annualTaxUnits);
  const monthlyPaye = r(K(annualPaye).div(K(12))); // the key rounds the annual figure FIRST, then the month

  const room = K(gross - pension - nhf - monthlyPaye).sub(K(gross).mul(D(p.min_takehome_share_of_gross)));
  const allowedUnrounded = Exact.min(nairaToKobo(c.loan_deduction).add(nairaToKobo(c.coop_deduction)), Exact.max(K(0), room));
  const loanCoop = r(allowedUnrounded);
  const net = r(K(gross - pension - nhf - monthlyPaye).sub(nairaToKobo(c.sanction_deduction)).sub(K(loanCoop)));

  return {
    base_pay: basePay,
    absence_deduction: absence,
    overtime_pay: overtime,
    allowances_paid: allowances,
    gross,
    pension,
    nhf,
    annual_taxable: annualTaxable,
    annual_paye: annualPaye,
    monthly_paye: monthlyPaye,
    loan_coop_allowed: loanCoop,
    net_pay: net,
    paye_state: c.state_of_residence,
  };
}

/** The key's expected figures for a case, in whole kobo. */
export function expectedGolden(c: GoldenRow): GoldenResult {
  const k = (col: string) => wholeKobo(c[`expected_${col}`], `case ${c.case} ${col}`);
  return {
    base_pay: k("base_pay"),
    absence_deduction: k("absence_deduction"),
    overtime_pay: k("overtime_pay"),
    allowances_paid: k("allowances_paid"),
    gross: k("gross"),
    pension: k("pension"),
    nhf: k("nhf"),
    annual_taxable: k("annual_taxable"),
    annual_paye: k("annual_paye"),
    monthly_paye: k("monthly_paye"),
    loan_coop_allowed: k("loan_coop_allowed"),
    net_pay: k("net_pay"),
    paye_state: c.expected_paye_state,
  };
}

// ───────────────────── the same cases worked in the payroll engine's pay model ─────────────────────

/**
 * The golden cases worked the way the payroll ENGINE models pay, independently of the engine (exact arithmetic again; nothing is taken from the engine's code).
 * The key describes pay as "a rate plus allowances"; the engine has one monthly gross per site (rate + allowances) split by percentages across salary components, and:
 *   - a component is each period's gross x its share x days paid / days in the month, added across periods and rounded half up to the kobo ONCE (not basic pay
 *     and allowances as two rounded lines);
 *   - days of unpaid absence are simply not paid, and the allowances go with them;
 *   - overtime is hours x an hourly rate rounded to the kobo once (monthly gross / days / hours x multiplier), is not pensionable, and is taxed ONCE as a one-off on
 *     top of the annualised regular pay (the key annualises the whole gross: the one difference of tax treatment, for the tax adviser);
 *   - NHF is the key's rate on the basic component for a worker who contributes; the take-home floor and the PAYE bands work as in the key.
 * Wherever the key has no absence, no overtime and a whole-month rounding it gives the key's own figures, which a test proves for eight cases. Cases 4, 5 and 9 give the
 * regenerated figures in golden_cases_structure_model.csv.
 */
export interface StructureModelResult {
  gross: number;
  overtime_pay: number;
  pension: number;
  nhf: number;
  annual_taxable: number;
  annual_paye: number;
  monthly_paye: number;
  loan_coop_allowed: number;
  net_pay: number;
}

const SHARES = { basic: 50, housing: 10, transport: 10, other: 30 } as const;

export function calculateStructureModel(c: GoldenRow, p: Record<string, string>, bands: GoldenRow[]): StructureModelResult {
  const basis = Exact.int(Number(c.days_in_month));
  const absence = Number(c.unpaid_absence_days);
  const allowances = nairaToKobo(c.monthly_allowances);
  const d1 = Number(c.days_at_rate_1);
  const d2 = Number(c.days_at_rate_2);
  // unpaid absence comes off the last period that has days
  const periods = [
    { monthly: nairaToKobo(c.rate_1).add(allowances), days: d1 - Math.max(0, absence - d2) },
    { monthly: nairaToKobo(c.rate_2).add(allowances), days: Math.max(0, d2 - absence) },
  ].filter((x) => x.days > 0);
  const component = (pct: number): number => {
    let sum: Exact = K(0);
    for (const x of periods) sum = sum.add(x.monthly.mul(Exact.ratio(pct, 100)).mul(Exact.int(x.days)).div(basis));
    return r(sum);
  };
  const basic = component(SHARES.basic);
  const gross = basic + component(SHARES.housing) + component(SHARES.transport) + component(SHARES.other);
  const pensionable = basic + component(SHARES.housing) + component(SHARES.transport);

  const otHours = Exact.decimal(c.overtime_hours);
  if (!otHours.isZero() && periods.length !== 1) throw new Error("overtime across more than one rate is not modelled");
  const hourly = otHours.isZero() ? 0 : r(periods[0].monthly.div(basis).div(Exact.int(Number(p.hours_per_shift_day))).mul(Exact.decimal(c.overtime_multiplier)));
  const overtime = r(otHours.mul(K(hourly)));

  const pension = r(K(pensionable).mul(D(p.employee_pension_rate)));
  const nhf = r(K(basic).mul(D(p.nhf_rate_on_basic)));

  const taxUnits = (chargeable: Exact): Exact => {
    let t: Exact = K(0);
    for (const b of bands) {
      const over = chargeable.sub(nairaToKobo(b.lower_limit));
      if (over.cmp(K(0)) > 0) t = t.add(over.mul(D(b.incremental_rate)));
    }
    return t;
  };
  const reliefs = K(12 * (pension + nhf)).add(nairaToKobo(p.other_annual_relief));
  const regularCharged = Exact.max(K(0), K(12 * gross).sub(reliefs));
  const withOvertime = regularCharged.add(K(overtime));
  const regularTax = taxUnits(regularCharged);
  const monthlyExact = regularTax.div(K(12)).add(taxUnits(withOvertime).sub(regularTax));
  const paye = monthlyExact.cmp(K(0)) > 0 ? r(monthlyExact) : 0;

  const totalEarnings = gross + overtime;
  const sanction = r(nairaToKobo(c.sanction_deduction));
  const requested = r(nairaToKobo(c.loan_deduction).add(nairaToKobo(c.coop_deduction)));
  const floor = r(K(totalEarnings).mul(D(p.min_takehome_share_of_gross)));
  const room = Math.max(0, totalEarnings - (pension + nhf + paye + sanction) - floor);
  const loanCoop = Math.min(requested, room);
  return {
    gross,
    overtime_pay: overtime,
    pension,
    nhf,
    annual_taxable: r(withOvertime),
    annual_paye: r(taxUnits(withOvertime)),
    monthly_paye: paye,
    loan_coop_allowed: loanCoop,
    net_pay: totalEarnings - paye - pension - nhf - sanction - loanCoop,
  };
}

/** The regenerated expectations for the cases whose key follows a different pay model (golden_cases_structure_model.csv), in whole kobo. */
export function goldenStructureModelCases(): Record<string, StructureModelResult> {
  const out: Record<string, StructureModelResult> = {};
  for (const row of read("golden_cases_structure_model.csv")) {
    const k = (col: string) => wholeKobo(row[`expected_${col}`], `case ${row.case} ${col}`);
    out[row.case] = { gross: k("gross"), overtime_pay: k("overtime_pay"), pension: k("pension"), nhf: k("nhf"), annual_taxable: k("annual_taxable"), annual_paye: k("annual_paye"), monthly_paye: k("monthly_paye"), loan_coop_allowed: k("loan_coop_allowed"), net_pay: k("net_pay") };
  }
  return out;
}
