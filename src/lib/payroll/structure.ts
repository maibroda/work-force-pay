import { round2 } from "../money";
import { evaluateFormula } from "./formula";

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

/**
 * Compute the full-month amount of every component for a given monthly operative gross,
 * then scale by `factor` (paid days / basis days). Employee overrides replace the base
 * definition for that employee only — the structure itself is never modified.
 */
export function computeComponents(
  structure: StructureDef,
  monthlyGross: number,
  factor: number,
  overrides: ComponentOverride[] = [],
  extraVars: Record<string, number> = {},
  round = true,
): ComponentAmount[] {
  const ordered = [...structure.components].filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const vars: Record<string, number> = { GROSS: monthlyGross, ...extraVars };
  const out: ComponentAmount[] = [];
  for (const base of ordered) {
    const ov = overrides.find((o) => o.componentCode === base.code);
    const c = ov
      ? { ...base, calcType: ov.calcType, percentage: ov.percentage, fixedAmount: ov.fixedAmount }
      : base;
    let full = 0;
    if (c.calcType === "PERCENTAGE") full = (monthlyGross * (c.percentage ?? 0)) / 100;
    else if (c.calcType === "FIXED_AMOUNT") full = c.fixedAmount ?? 0;
    else if (c.calcType === "FORMULA") full = evaluateFormula(c.formula ?? "0", vars);
    vars[c.code.toUpperCase()] = full;
    out.push({
      code: c.code,
      name: c.name,
      amount: round ? round2(full * factor) : full * factor,
      taxable: c.taxable,
      pensionable: c.pensionable,
      overridden: Boolean(ov),
    });
  }
  return out;
}

/** 70:30 sharing — the operative's share of the client's agreed rate. */
export function splitAgreedRate(agreedRate: number, operativeSharePct: number) {
  const operativeGross = round2((agreedRate * operativeSharePct) / 100);
  return { operativeGross, managementShare: round2(agreedRate - operativeGross) };
}
