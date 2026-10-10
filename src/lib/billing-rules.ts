/**
 * Pure rules for billing rules. No database here.
 *
 * A billing rule says how a service type, or one contract, is billed from a date: the split of each charge-out amount into a
 * direct (pass-through) and an indirect (management) charge, and what VAT and withholding tax are charged on. Rules are
 * dated, proposed by one person and approved by another, and never edited afterwards. A contract's own rule overrides its
 * service type's; a contract with neither is billed on the built-in default (the original treatment).
 */
import { round2 } from "./money";

export type BillingBase = "INDIRECT" | "DIRECT" | "FULL" | "NONE";
export type RuleStatus = "PENDING" | "APPROVED" | "REJECTED";
export type RuleSource = "CONTRACT_OVERRIDE" | "SERVICE_RULE" | "DEFAULT" | "TYPED";

export const BASE_LABELS: Record<BillingBase, string> = {
  INDIRECT: "The indirect (management) charge",
  DIRECT: "The direct charge",
  FULL: "The whole amount",
  NONE: "Nothing (not charged)",
};

export const RULE_STATUS_LABELS: Record<RuleStatus, string> = { PENDING: "Waiting for approval", APPROVED: "Approved", REJECTED: "Turned down" };

export const SOURCE_LABELS: Record<RuleSource, string> = {
  CONTRACT_OVERRIDE: "Contract override",
  SERVICE_RULE: "Service rule",
  DEFAULT: "Built-in default",
  TYPED: "Typed for this run",
};

/** The treatment before billing rules existed, used for a contract that no rule covers. */
export const DEFAULT_TREATMENT = { directPct: 90, indirectPct: 10, vatBase: "INDIRECT" as BillingBase, whtBase: "FULL" as BillingBase };

export interface RuleRow {
  directPct: number;
  indirectPct: number;
  vatBase: BillingBase;
  whtBase: BillingBase;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: RuleStatus;
}

/** The approved rule in force on a date, or null. A proposal that hasn't been approved never applies. */
export function ruleOn<T extends RuleRow>(rules: T[], date: Date): T | null {
  return (
    rules
      .filter((r) => r.status === "APPROVED" && r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo >= date))
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
  );
}

/** Splits a charge-out amount; the two parts always add up to the amount. */
export function splitCharge(amount: number, directPct: number): { direct: number; indirect: number } {
  const direct = round2((amount * directPct) / 100);
  return { direct, indirect: round2(amount - direct) };
}

/** The part of a charge-out amount a tax is charged on. */
export function taxableOf(base: BillingBase, part: { amount: number; direct: number; indirect: number }): number {
  switch (base) {
    case "INDIRECT":
      return part.indirect;
    case "DIRECT":
      return part.direct;
    case "FULL":
      return part.amount;
    default:
      return 0;
  }
}

const day = (x: Date) => x.toISOString().slice(0, 10);
const BASES: BillingBase[] = ["INDIRECT", "DIRECT", "FULL", "NONE"];

/**
 * Everything wrong with a proposed rule, as plain sentences. `existing` is the rules already set for the same service or
 * contract, whatever their status. `lastInvoice` is the date of the latest invoice already issued under that scope.
 */
export function ruleProblems(
  input: { directPct: number; indirectPct: number; vatBase: string; whtBase: string; effectiveFrom: Date | null; effectiveTo: Date | null; reason: string },
  existing: RuleRow[],
  lastInvoice: Date | null,
): string[] {
  const out: string[] = [];
  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
  if (!ok(input.directPct) || !ok(input.indirectPct)) out.push("The direct and indirect charges are percentages between 0 and 100.");
  else if (Math.abs(input.directPct + input.indirectPct - 100) > 0.001) out.push("The direct and indirect charges must add up to 100%.");
  if (!BASES.includes(input.vatBase as BillingBase)) out.push("Choose what VAT is charged on.");
  if (!BASES.includes(input.whtBase as BillingBase)) out.push("Choose what withholding tax is charged on.");
  if (input.reason.trim().length < 10) out.push("Say why the rule is being set (the agreement or decision it follows), in a sentence.");
  const from = input.effectiveFrom && !Number.isNaN(input.effectiveFrom.getTime()) ? input.effectiveFrom : null;
  if (!from) out.push("Choose the date the rule takes effect.");
  if (from && input.effectiveTo && input.effectiveTo < from) out.push("The end date is before the start date.");
  if (from) {
    const latest = existing.filter((r) => r.status !== "REJECTED").reduce<Date | null>((m, r) => (!m || r.effectiveFrom > m ? r.effectiveFrom : m), null);
    if (latest && from <= latest) out.push(`A rule already starts on ${day(latest)}. A new one has to start after it; earlier rules are history and aren't rewritten.`);
    if (lastInvoice && from <= lastInvoice) out.push(`An invoice dated ${day(lastInvoice)} has already been issued under this, so a rule can't start on or before that date.`);
  }
  return out;
}
