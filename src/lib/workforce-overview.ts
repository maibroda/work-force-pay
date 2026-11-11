/**
 * Pure rules for the Workforce overview (Analytics). No database and no clock: dates are plain "YYYY-MM-DD" days, money is whole kobo.
 *
 * Money is averaged in whole kobo and rounded half up once, through the shared exact-money helpers (no floating point). An average of pay is shown only for a group of at
 * least `MIN_GROUP` people (five, as for the welfare summary and the survey results), so an average can never be one person's pay. Nothing here reads or changes a record.
 */
import { daysBetween } from "@/lib/career";
import { roundRatio, sumKobo, type Kobo } from "@/lib/money-exact";
import { MIN_GROUP } from "@/lib/welfare";

export const TENURE_BANDS = ["<1", "1–3", "3–5", "5–10", "10+"] as const;
export type TenureBand = (typeof TENURE_BANDS)[number];

/** Whole years of service completed on `to` (the anniversary itself completes the year); never below zero. */
export function completedYears(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const years = ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
  return Math.max(0, years);
}

/** Each band starts on its lower bound: 1 year completed is "1–3", 3 is "3–5", 5 is "5–10", 10 is "10+". */
export function tenureBand(years: number): TenureBand {
  if (years < 1) return "<1";
  if (years < 3) return "1–3";
  if (years < 5) return "3–5";
  if (years < 10) return "5–10";
  return "10+";
}

/** The average length of service in years to one decimal, rounded half up, from each person's days of service. Null when there is nobody. */
export function averageTenureYears(days: number[]): number | null {
  const n = days.length;
  if (n === 0) return null;
  const sum = days.reduce((a, b) => a + b, 0);
  const tenths = Math.floor((2 * sum * 1000 + n * 36525) / (2 * n * 36525)); // sum / n / 365.25 years, times 10, in whole numbers
  return tenths / 10;
}

/** The average of amounts in whole kobo, rounded half up once. Null when there are none. */
export function averageKobo(values: Kobo[]): Kobo | null {
  if (values.length === 0) return null;
  return roundRatio(BigInt(sumKobo(values)), BigInt(values.length));
}

/** A pay figure may be shown for a group of at least the minimum number of people. */
export const shownGroup = (count: number, min: number = MIN_GROUP): boolean => count >= min;

/** How far above (+) or below (-) the base a value is, as a whole percent, half away from zero. Null when the base is zero. */
export function percentDifference(value: Kobo, base: Kobo): number | null {
  if (base === 0) return null;
  const diff = BigInt(value) - BigInt(base);
  const negative = diff < 0n;
  const magnitude = negative ? -diff : diff;
  const den = BigInt(base);
  const pct = Number((2n * magnitude * 100n + den) / (2n * den));
  return negative ? -pct : pct;
}

/** A part of a whole as a whole percent, rounded half up; 0 when the whole is empty. */
export function shareOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((2 * part * 100 + total) / (2 * total));
}

/** A part of a whole as a percent to one decimal, rounded half up; 0 when the whole is empty. */
export function percentTenths(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((2 * part * 1000 + total) / (2 * total)) / 10;
}

/** Days of service between two plain days (never negative). */
export const serviceDays = (from: string, to: string): number => Math.max(0, daysBetween(from, to));
