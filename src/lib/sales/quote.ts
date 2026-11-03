/**
 * Quote arithmetic, as exact money. A line has TWO numbers of people: the guards the client is BILLED for (revenue = bill rate x billed guards) and the personnel
 * actually needed to cover the agreed shifts (cost = cost of one person x personnel needed), which is often more (a 24/7 post needs more people than it bills).
 * Totals are exact sums in whole kobo, and a margin
 * percentage is held as basis points (hundredths of a percent), rounded half up once. Nothing here uses floating point for money.
 * `clientView` is what may go to the client: bill rates and totals only, never the company's costs or margin.
 */
import { mulDiv, roundRatio, subKobo, sumKobo, toKobo, koboToString } from "../money-exact";

export interface LineFacts {
  /** The guards the client is billed for. */
  headcount: number;
  /** The people needed to cover the shifts; when not given, the billed headcount. */
  requiredPersonnel?: number;
  billPerHead: string;
  costPerHead: string;
}

export function checkHeadcount(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error("The number of guards must be a whole number from 1 to 10,000.");
  return n;
}

export function checkPersonnel(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error("The personnel needed to cover the shifts must be a whole number from 1 to 10,000.");
  return n;
}

export function lineTotals(l: LineFacts) {
  const billed = checkHeadcount(l.headcount);
  const people = checkPersonnel(l.requiredPersonnel ?? l.headcount);
  const bill = mulDiv(toKobo(l.billPerHead), billed, 1);
  const cost = mulDiv(toKobo(l.costPerHead), people, 1);
  return { bill: koboToString(bill), cost: koboToString(cost), margin: koboToString(subKobo(bill, cost)) };
}

/** Margin as basis points of the bill (905 = 9.05%), rounded half up; zero when there is no bill. A loss is negative. */
export function marginBps(margin: string, bill: string): number {
  const b = toKobo(bill);
  if (b <= 0) return 0;
  const m = toKobo(margin);
  return m < 0 ? -roundRatio(BigInt(-m) * 10000n, BigInt(b)) : roundRatio(BigInt(m) * 10000n, BigInt(b));
}

export function quoteTotals(lines: readonly LineFacts[]) {
  const per = lines.map(lineTotals);
  const bill = sumKobo(per.map((p) => toKobo(p.bill)));
  const cost = sumKobo(per.map((p) => toKobo(p.cost)));
  const margin = subKobo(bill, cost);
  return { monthlyBill: koboToString(bill), monthlyCost: koboToString(cost), monthlyMargin: koboToString(margin), marginBps: marginBps(koboToString(margin), koboToString(bill)) };
}

export const belowMinimum = (bps: number, minBps: number) => minBps > 0 && bps < minBps;
export const bpsToPercent = (bps: number) => (bps / 100).toFixed(2);

export function percentToBps(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error("A margin percentage is between 0 and 100.");
  const bps = Math.round(pct * 100);
  if (Math.abs(pct * 100 - bps) > 1e-6) throw new Error("A margin percentage can have at most two decimals.");
  return bps;
}

/** Everything the client may see of a quote: sites, posts, headcount, the bill rate and the totals. No cost, no margin, no rules. */
export function clientView(
  lines: ReadonlyArray<{ siteName: string; siteAddress?: string | null; postLabel?: string | null; shiftPattern?: string | null; headcount: number; billPerHead: string }>,
) {
  const rows = lines.map((l) => ({ siteName: l.siteName, siteAddress: l.siteAddress ?? null, postLabel: l.postLabel ?? null, shiftPattern: l.shiftPattern ?? null, headcount: l.headcount, billPerHead: l.billPerHead, monthly: koboToString(mulDiv(toKobo(l.billPerHead), checkHeadcount(l.headcount), 1)) }));
  const total = koboToString(sumKobo(rows.map((r) => toKobo(r.monthly))));
  return { rows, total };
}

