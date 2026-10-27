import { Exact } from "../exact-fraction";
import { round2 } from "../money";
import { koboFromNaira, koboToNumber, mulPct, pctToRate, RATE_SCALE, subKobo, type Kobo } from "../money-exact";
import { evaluateFormulaExact } from "./formula";

export type CalcType = "PERCENTAGE" | "FIXED_AMOUNT" | "FORMULA";

export interface ComponentDef {
  code: string;
  name: string;
  calcType: CalcType;
  percentage?: number | null;
  fixedAmount?: number | null;
  formula?: string | null;
  taxable: boolean;
  pensionable: boolean;
  employerCost?: boolean;
  active: boolean;
  sortOrder: number;
}

export interface StructureDef {
  id: string;
  code: string;
  name: string;
  isPartial: boolean;
  calculationMethod?: "PERCENTAGE_OF_GROSS" | "MIXED";
  components: ComponentDef[];
}

export interface ComponentOverride {
  componentCode: string;
  calcType: CalcType;
  percentage?: number | null;
  fixedAmount?: number | null;
  reason: string;
}

export interface ComponentAmount {
  code: string;
  name: string;
  amount: number;
  taxable: boolean;
  pensionable: boolean;
  overridden: boolean;
}

/** The seeded default — "Standard Security Workforce Structure" (percent of operative gross). */
export const DEFAULT_EARNINGS: Array<Omit<ComponentDef, "sortOrder" | "active" | "calcType">> = [
  { code: "BASIC", name: "Basic", percentage: 10, taxable: true, pensionable: true },
  { code: "HOUSING", name: "Housing", percentage: 14, taxable: true, pensionable: true },
  { code: "TRANSPORT", name: "Transport", percentage: 15, taxable: true, pensionable: true },
  { code: "ENTERTAINMENT", name: "Entertainment", percentage: 5, taxable: true, pensionable: false },
  { code: "MEAL", name: "Meal", percentage: 15, taxable: true, pensionable: false },
  { code: "UTILITY", name: "Utility", percentage: 20, taxable: true, pensionable: false },
  { code: "LEAVE", name: "Leave", percentage: 2.5, taxable: true, pensionable: false },
  { code: "MEDICAL", name: "Medical", percentage: 5, taxable: true, pensionable: false },
  { code: "CLOTHING", name: "Clothing", percentage: 13.5, taxable: true, pensionable: false },
];

export const STRUCTURE_TOTAL_ERROR = "Salary structure percentages must total 100%.";

export function percentageTotal(
  components: Pick<ComponentDef, "calcType" | "percentage" | "active">[],
): number {
  return round2(
    components
      .filter((c) => c.active && c.calcType === "PERCENTAGE")
      .reduce((a, c) => a + (c.percentage ?? 0), 0),
  );
}

/** Returns a list of validation errors; empty list = structure may be activated. */
export function validateStructure(s: {
  isPartial: boolean;
  components: Pick<ComponentDef, "code" | "calcType" | "percentage" | "fixedAmount" | "formula" | "active">[];
}): string[] {
  const errors: string[] = [];
  const active = s.components.filter((c) => c.active);
  if (active.length === 0) errors.push("Salary structure must have at least one active component.");
  const codes = new Set<string>();
  for (const c of s.components) {
    if (codes.has(c.code)) errors.push(`Duplicate component code ${c.code}.`);
    codes.add(c.code);
    if (
      c.calcType === "PERCENTAGE" &&
      (c.percentage === null || c.percentage === undefined || c.percentage < 0)
    )
      errors.push(`${c.code}: percentage is required.`);
    if (
      c.calcType === "FIXED_AMOUNT" &&
      (c.fixedAmount === null || c.fixedAmount === undefined || c.fixedAmount < 0)
    )
      errors.push(`${c.code}: fixed amount is required.`);
    if (c.calcType === "FORMULA" && !c.formula) errors.push(`${c.code}: formula is required.`);
  }
  if (!s.isPartial && Math.abs(percentageTotal(active as ComponentDef[]) - 100) > 0.0001) {
    errors.push(STRUCTURE_TOTAL_ERROR);
  }
  return errors;
}

/** A component's amount before rounding: an exact fraction counted in KOBO. */
export interface ExactComponent {
  code: string;
  name: string;
  amount: Exact;
  taxable: boolean;
  pensionable: boolean;
  overridden: boolean;
}

/**
 * Compute the full-month amount of every component for a given monthly operative gross, then scale by `factor` (paid days / basis days, as an exact
 * fraction). Employee overrides replace the base definition for that employee only — the structure itself is never modified.
 * Nothing is rounded here: each amount is an exact fraction of kobo, so that amounts from different sites can be added before the payslip line is
 * rounded once (`amount.round()`). Formulas work in naira and see the FULL-month value of the components before them.
 */
export function computeComponentsExact(
  structure: StructureDef,
  monthlyGross: Kobo,
  factor: Exact,
  overrides: ComponentOverride[] = [],
  extraVars: Record<string, Exact> = {},
): ExactComponent[] {
  const ordered = [...structure.components].filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const vars: Record<string, Exact> = { GROSS: Exact.ratio(monthlyGross, 100), ...extraVars };
  const out: ExactComponent[] = [];
  for (const base of ordered) {
    const ov = overrides.find((o) => o.componentCode === base.code);
    const c = ov
      ? { ...base, calcType: ov.calcType, percentage: ov.percentage, fixedAmount: ov.fixedAmount }
      : base;
    let full = Exact.int(0); // kobo
    if (c.calcType === "PERCENTAGE") full = Exact.ratio(BigInt(monthlyGross) * BigInt(pctToRate(String(c.percentage ?? 0))), RATE_SCALE);
    else if (c.calcType === "FIXED_AMOUNT") full = Exact.int(koboFromNaira(c.fixedAmount ?? 0, `The ${c.code} fixed amount`));
    else if (c.calcType === "FORMULA") full = evaluateFormulaExact(c.formula ?? "0", vars).mul(Exact.int(100));
    vars[c.code.toUpperCase()] = full.div(Exact.int(100));
    out.push({
      code: c.code,
      name: c.name,
      amount: full.mul(factor),
      taxable: c.taxable,
      pensionable: c.pensionable,
      overridden: Boolean(ov),
    });
  }
  return out;
}

/**
 * The same, for callers that work in naira numbers (the structure page, tests, and the engine until it moves to exact values).
 * `round = false` gives the unrounded amount as the nearest number, for that last caller only.
 */
export function computeComponents(
  structure: StructureDef,
  monthlyGross: number,
  factor: number,
  overrides: ComponentOverride[] = [],
  extraVars: Record<string, number> = {},
  round = true,
): ComponentAmount[] {
  const extra: Record<string, Exact> = {};
  for (const [name, v] of Object.entries(extraVars)) extra[name] = Exact.fromNumber(v);
  const exact = computeComponentsExact(structure, koboFromNaira(monthlyGross, "The monthly gross"), Exact.fromNumber(factor), overrides, extra);
  return exact.map((c) => ({
    code: c.code,
    name: c.name,
    amount: round ? koboToNumber(c.amount.round()) : c.amount.toNumber() / 100,
    taxable: c.taxable,
    pensionable: c.pensionable,
    overridden: c.overridden,
  }));
}

/** 70:30 sharing — the operative's share of the client's agreed rate, rounded half up to the kobo; management gets the rest. */
export function splitAgreedRate(agreedRate: number, operativeSharePct: number) {
  const agreed = koboFromNaira(agreedRate, "The agreed rate");
  const operative = mulPct(agreed, pctToRate(String(operativeSharePct)));
  return { operativeGross: koboToNumber(operative), managementShare: koboToNumber(subKobo(agreed, operative)) };
}
