/**
 * Training cost: the two pure rules, in exact kobo (slice 4A, approved by the founder on 2026-11-17).
 *
 * 1. A session's cost is shared EQUALLY per attendee, to the exact kobo: everyone gets the whole share, and the kobo left over go one each to the first attendees, so the shares always add back
 *    to the exact total (nothing is lost, nothing is invented). The money rule of one half-up rounding per calculated line cannot hold here, because rounding each share would not add back.
 * 2. A breakdown never shows a row that comes from fewer than three attendances, so one named person's cost cannot be read off it. The rows that are too small are combined into one "other" row;
 *    and because the combined row would otherwise be the total minus the shown rows (so a hidden row could be found by subtraction), the smallest shown row joins it until it is large enough.
 *
 * No floating point: every amount is whole kobo (src/lib/money-exact.ts).
 */
import { asKobo, type Kobo } from "./money-exact";

/** A row of a breakdown is shown only when it comes from at least this many attendances. */
export const MIN_ATTENDANCES = 3;

/** Shares a total (in kobo, negative for a reversal) equally among n attendees. Null when nobody attended. */
export function allocateEqually(total: Kobo, n: number): Kobo[] | null {
  if (!Number.isInteger(n) || n <= 0) return null;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const left = abs - base * n;
  return Array.from({ length: n }, (_, i) => asKobo((i < left ? base + 1 : base) * (total < 0 ? -1 : 1)));
}

export interface FoldRow {
  key: string;
  label: string;
  amount: Kobo;
  attendances: number;
}

export interface Folded<T extends FoldRow> {
  shown: T[];
  /** The combined row of everything folded away; its amount is shown only when it has at least MIN_ATTENDANCES attendances itself. */
  other: { amount: Kobo | null; attendances: number; rows: number; shown: boolean } | null;
}

/** Shows only the rows with enough attendances and combines the rest, as described at the top of this file. */
export function foldSmall<T extends FoldRow>(rows: T[]): Folded<T> {
  let shown = rows.filter((r) => r.attendances >= MIN_ATTENDANCES);
  let hidden = rows.filter((r) => r.attendances < MIN_ATTENDANCES);
  if (hidden.length === 0) return { shown, other: null };
  const sum = (xs: T[]) => ({ attendances: xs.reduce((a, r) => a + r.attendances, 0), amount: asKobo(xs.reduce((a, r) => a + r.amount, 0)) });
  // the combined row is the total minus the shown rows: it must itself be large enough, so the smallest shown row joins it until it is
  while (sum(hidden).attendances < MIN_ATTENDANCES && shown.length > 0) {
    const smallest = shown.reduce((a, b) => (b.attendances < a.attendances ? b : a));
    shown = shown.filter((r) => r !== smallest);
    hidden = [...hidden, smallest];
  }
  const s = sum(hidden);
  const ok = s.attendances >= MIN_ATTENDANCES;
  return { shown, other: { amount: ok ? s.amount : null, attendances: s.attendances, rows: hidden.length, shown: ok } };
}
