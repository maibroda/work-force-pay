/**
 * Deal values, as exact money. A deal's value is its MONTHLY contract value (a stored amount); the annual value is that times 12 and is never stored.
 * A deal's weighted value is its monthly value times its probability over 100, rounded half up to the kobo ONCE per deal; a total of weighted values is
 * the sum of those rounded figures (exact, no further rounding). All of it goes through the shared kobo arithmetic, never floating point.
 */
import { mulDiv, sumKobo, toKobo, koboToString, type Kobo } from "../money-exact";

export function checkProbability(p: number): number {
  if (!Number.isInteger(p) || p < 0 || p > 100) throw new Error("A probability is a whole number from 0 to 100.");
  return p;
}

export const weightedValueKobo = (monthlyValue: unknown, probability: number): Kobo => mulDiv(toKobo(monthlyValue), checkProbability(probability), 100);
export const annualValueKobo = (monthlyValue: unknown): Kobo => mulDiv(toKobo(monthlyValue), 12, 1);

export interface DealFacts {
  monthlyContractValue: unknown;
  probability: number;
}
export interface Totals {
  count: number;
  value: string;
  weighted: string;
}

export function totalsOf(deals: readonly DealFacts[]): Totals {
  return {
    count: deals.length,
    value: koboToString(sumKobo(deals.map((d) => toKobo(d.monthlyContractValue)))),
    weighted: koboToString(sumKobo(deals.map((d) => weightedValueKobo(d.monthlyContractValue, d.probability)))),
  };
}

const NO_DATE = "No close date";

/** Open deals grouped by the month they are expected to close (YYYY-MM), oldest first, deals with no date last. */
export function forecastByCloseMonth(deals: ReadonlyArray<DealFacts & { expectedCloseDate: Date | string | null }>): Array<Totals & { month: string }> {
  const groups = new Map<string, DealFacts[]>();
  for (const d of deals) {
    const month = d.expectedCloseDate ? new Date(d.expectedCloseDate).toISOString().slice(0, 7) : NO_DATE;
    groups.set(month, [...(groups.get(month) ?? []), d]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_DATE ? 1 : b === NO_DATE ? -1 : a.localeCompare(b)))
    .map(([month, list]) => ({ month, ...totalsOf(list) }));
}
