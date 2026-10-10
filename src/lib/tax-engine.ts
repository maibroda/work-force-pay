/**
 * Pure rules for the tax engine. No database here.
 *
 * A tax code (VAT, withholding tax) has rates by date. A rate is proposed by one person and approved by another, and is
 * never edited afterwards: a change is a new rate from a later date. An invoice reads the rate in force on its date and
 * keeps what it used, so a change of rate never touches an invoice already issued.
 */

export type TaxType = "VAT" | "WHT";
export type RateStatus = "PENDING" | "APPROVED" | "REJECTED";

export const TAX_TYPE_LABELS: Record<TaxType, string> = { VAT: "Value added tax", WHT: "Withholding tax" };

export const RATE_STATUS_LABELS: Record<RateStatus, string> = { PENDING: "Waiting for approval", APPROVED: "Approved", REJECTED: "Turned down" };

export interface RateRow {
  ratePct: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: RateStatus;
}

/** The approved rate in force on a date, or null when none is. A proposal that hasn't been approved never applies. */
export function rateOn<T extends RateRow>(rates: T[], date: Date): T | null {
  const hit = rates
    .filter((r) => r.status === "APPROVED" && r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo >= date))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return hit[0] ?? null;
}

const day = (x: Date) => x.toISOString().slice(0, 10);

/**
 * Everything wrong with a proposed rate, as plain sentences. `existing` is the code's rates, whatever their status.
 * A new rate must start after the latest approved or waiting one, because history is never rewritten.
 */
export function rateProblems(input: { ratePct: number; effectiveFrom: Date | null; reason: string }, existing: RateRow[]): string[] {
  const out: string[] = [];
  if (!Number.isFinite(input.ratePct) || input.ratePct < 0 || input.ratePct > 100) out.push("A rate is a percentage between 0 and 100.");
  if (!input.effectiveFrom || Number.isNaN(input.effectiveFrom.getTime())) out.push("Choose the date the rate takes effect.");
  if (input.reason.trim().length < 5) out.push("Say why the rate is being set (for example the law or notice it follows).");
  if (input.effectiveFrom && !Number.isNaN(input.effectiveFrom.getTime())) {
    const live = existing.filter((r) => r.status !== "REJECTED");
    const latest = live.reduce<Date | null>((m, r) => (!m || r.effectiveFrom > m ? r.effectiveFrom : m), null);
    if (latest && input.effectiveFrom <= latest) out.push(`A rate already starts on ${day(latest)}. A new one has to start after it; earlier rates are history and aren't rewritten.`);
  }
  return out;
}
