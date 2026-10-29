import { koboFromNaira, koboToNumber, mulPct, pctToRate } from "./money-exact";

/**
 * When PAYE is due, when the annual return is due, and the penalty on PAYE paid late. Pure, no database.
 * These are RULE DATA (CLAUDE.md rule 3): they come from the tax rule in force, as the adviser verified them, and are never hard-coded here.
 * With no value set there is no date and nothing is ever "overdue".
 */
export interface PayeTiming {
  /** Day of the month AFTER the pay month on which PAYE is due (1 to 28). */
  dueDay: number | null;
  /** The annual return is due on this month and day of the year AFTER the tax year. */
  annualReturnMonth: number | null;
  annualReturnDay: number | null;
  /** Percentage of the unremitted PAYE charged when it is late. Interest is not modelled. */
  latePenaltyPct: number | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAY_MS = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** The due date (YYYY-MM-DD) of the PAYE for a pay month, or null when the rule has no due day. */
export function payeDueDate(year: number, month: number, dueDay: number | null): string | null {
  if (dueDay === null) return null;
  const y = month === 12 ? year + 1 : year;
  const m = month === 12 ? 1 : month + 1;
  return `${y}-${pad(m)}-${pad(dueDay)}`;
}

/** The due date of the annual return for a tax year, or null when the rule has no date. */
export function annualReturnDueDate(taxYear: number, month: number | null, day: number | null): string | null {
  if (month === null || day === null) return null;
  return `${taxYear + 1}-${pad(month)}-${pad(day)}`;
}

/** The penalty on an unremitted amount (naira), rounded half up to the kobo. No rate means no penalty. */
export function latePenalty(unremitted: number, pct: number | null): number {
  if (pct === null || pct <= 0 || unremitted <= 0) return 0;
  return koboToNumber(mulPct(koboFromNaira(unremitted, "The unremitted amount"), pctToRate(String(pct))));
}

export interface DueInfo {
  dueDate: string | null;
  overdue: boolean;
  daysLate: number;
  /** null when the rule has no penalty rate (or no due date); 0 when not overdue. */
  penalty: number | null;
}

/** Due date, lateness and penalty for one remittance line. `today` is YYYY-MM-DD. Applies to PAYE lines only. */
export function payeDueInfo(
  line: { type: string; status: string; totalAmount: number; period: { year: number; month: number } },
  timing: PayeTiming | null,
  today: string,
): DueInfo {
  if (line.type !== "PAYE" || !timing) return { dueDate: null, overdue: false, daysLate: 0, penalty: null };
  const dueDate = payeDueDate(line.period.year, line.period.month, timing.dueDay);
  if (!dueDate) return { dueDate: null, overdue: false, daysLate: 0, penalty: null };
  const late = line.status !== "PAID" && toMs(today) > toMs(dueDate);
  const daysLate = late ? Math.round((toMs(today) - toMs(dueDate)) / DAY_MS) : 0;
  const penalty = timing.latePenaltyPct === null ? null : late ? latePenalty(line.totalAmount, timing.latePenaltyPct) : 0;
  return { dueDate, overdue: late, daysLate, penalty };
}

/** Plain-language problems with a rule's timing fields (empty when fine). All blank is fine. */
export function validateTiming(t: PayeTiming): string[] {
  const out: string[] = [];
  if (t.dueDay !== null && (!Number.isInteger(t.dueDay) || t.dueDay < 1 || t.dueDay > 28)) out.push("The PAYE due day must be a whole day from 1 to 28 of the following month.");
  if ((t.annualReturnMonth === null) !== (t.annualReturnDay === null)) out.push("The annual return date needs both a month and a day.");
  else if (t.annualReturnMonth !== null && t.annualReturnDay !== null) {
    const m = t.annualReturnMonth;
    const d = t.annualReturnDay;
    if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > DAYS_IN_MONTH[m - 1]) out.push("The annual return date isn't a real day of the year (month 1 to 12, and a day that exists in that month).");
  }
  if (t.latePenaltyPct !== null && (!Number.isFinite(t.latePenaltyPct) || t.latePenaltyPct < 0 || t.latePenaltyPct > 100)) out.push("The late penalty must be a percentage from 0 to 100.");
  return out;
}

/** Whether two effective-date ranges (inclusive, YYYY-MM-DD, `to` null = still in force) share at least one day. */
export function rangesOverlap(a: { from: string; to: string | null }, b: { from: string; to: string | null }): boolean {
  const aEnd = a.to ?? "9999-12-31";
  const bEnd = b.to ?? "9999-12-31";
  return a.from <= bEnd && b.from <= aEnd;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The first of `existing` versions whose effective dates share a day with a new open-ended version starting on `from`, or undefined. */
export function overlappingVersion<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(existing: readonly T[], from: Date, to: Date | null = null): T | undefined {
  const mine = { from: dayOf(from), to: to ? dayOf(to) : null };
  return existing.find((e) => rangesOverlap(mine, { from: dayOf(e.effectiveFrom), to: e.effectiveTo ? dayOf(e.effectiveTo) : null }));
}

/**
 * The starting values for a rule's filing dates and penalty: the 10th of the next month, 31 January, 10%. They come from the founder's own PAYE seed file
 * ("published summaries", marked there as unverified) and have NOT been verified by the tax adviser. They are only a starting point: they are proposed when a
 * rule has none of its own, shown as such, and can be changed or cleared in the new-version form. A rule only counts as verified once HR and Finance sign it.
 */
export const FOUNDER_FILING_DEFAULTS: PayeTiming = { dueDay: 10, annualReturnMonth: 1, annualReturnDay: 31, latePenaltyPct: 10 };

/** The timing to put in a new-version form: the rule's own values if it has any, otherwise the founder's starting values (`proposed` says which). */
export function filingDefaultsFor(current: PayeTiming): PayeTiming & { proposed: boolean } {
  const hasAny = current.dueDay !== null || current.annualReturnMonth !== null || current.annualReturnDay !== null || current.latePenaltyPct !== null;
  return hasAny ? { ...current, proposed: false } : { ...FOUNDER_FILING_DEFAULTS, proposed: true };
}
