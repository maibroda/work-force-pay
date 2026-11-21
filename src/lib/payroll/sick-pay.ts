/**
 * Hourly pay, H14 piece 2, step 2b (docs/plans/hourly-payroll-h14-build-plan.md): the PAY for a paid sick day of a person paid by the hour. Pure: no database, no framework.
 *
 * The founder's answers of 2026-11-20 and 2026-11-21 (my recommendations for the build plan's questions, which he accepted): a paid sick day is paid at the person's AVERAGE DAILY HOURS times their WEEKDAY RATE; the average is
 * the approved hours of the months before the spell (a company setting, 3 as shipped) divided by the days they worked; a day counts only when it is one of their USUAL days (a day of the week they worked at least once in
 * that period); only the first days of the leave year, up to the entitlement, are paid, in date order (a day that is not a usual day still counts against the entitlement: it was a day of sickness); a person with no hours in the
 * period has nothing to average, and nothing is paid. Every amount is whole kobo, rounded half up once on the whole amount.
 */
import { addMonths } from "../leave";
import type { HourlySiteInput } from "./engine";
import { koboFromNaira, roundRatio, type Kobo } from "../money-exact";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOfWeek = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

export interface WorkedSegment {
  /** The Nigerian calendar day (YYYY-MM-DD). */
  date: string;
  minutes: number;
  beatId: string;
  contractId: string;
  clientId: string;
}

/** The period the average is taken over: from `months` before the first day of the spell, up to (not including) that day. */
export function sickWindow(spellStart: string, months: number): { from: string; to: string } {
  return { from: iso(addMonths(new Date(`${spellStart}T00:00:00Z`), -months)), to: spellStart };
}

export interface SickBasis {
  totalMinutes: number;
  /** The distinct days they worked (two shifts on one day are one day). */
  daysWorked: number;
  /** The days of the week they worked (0 = Sunday ... 6 = Saturday): their usual days. */
  weekdays: Set<number>;
  /** The site they last worked in the window: where the sick pay is split by the site's salary structure. */
  last: { beatId: string; contractId: string; clientId: string };
}

/** What the average is made from: the approved hours in the window (first day in, last day out). Null, never an average of zero, when there are none. */
export function sickBasis(history: readonly WorkedSegment[], from: string, to: string): SickBasis | null {
  const inWindow = history.filter((s) => s.date >= from && s.date < to && s.minutes > 0);
  if (inWindow.length === 0) return null;
  const days = new Set(inWindow.map((s) => s.date));
  const latest = [...inWindow].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.minutes - a.minutes || (a.beatId < b.beatId ? -1 : 1)))[0];
  return {
    totalMinutes: inWindow.reduce((a, s) => a + s.minutes, 0),
    daysWorked: days.size,
    weekdays: new Set([...days].map(dayOfWeek)),
    last: { beatId: latest.beatId, contractId: latest.contractId, clientId: latest.clientId },
  };
}

export interface PaidSickDates {
  /** Within the entitlement and a usual day: paid. */
  paid: string[];
  /** Within the entitlement but not a day of the week they usually work: not paid. */
  notUsual: string[];
  /** Beyond the entitlement of the leave year: not paid. */
  beyondEntitlement: string[];
}

/**
 * Which of `dates` (the working days of approved spells that fall in the pay period) are paid. `yearDates` is every approved working day of spells of the leave year, whenever they fall: the first `entitled` of them,
 * in date order, are within the entitlement.
 */
export function paidSickDates(a: { yearDates: readonly string[]; entitled: number; dates: readonly string[]; weekdays: ReadonlySet<number> }): PaidSickDates {
  const within = new Set([...new Set(a.yearDates)].sort().slice(0, Math.max(0, a.entitled)));
  const out: PaidSickDates = { paid: [], notUsual: [], beyondEntitlement: [] };
  for (const date of [...new Set(a.dates)].sort()) {
    if (!within.has(date)) out.beyondEntitlement.push(date);
    else if (!a.weekdays.has(dayOfWeek(date))) out.notUsual.push(date);
    else out.paid.push(date);
  }
  return out;
}

/**
 * What `days` paid sick days are worth: the average daily hours (the hours divided by the days worked) times the weekday rate. The minutes are for showing (rounded to a whole minute); the amount is worked once from the exact
 * ratio and rounded half up to the kobo, so it never gains or loses a kobo to the number of days.
 */
export function sickPay(weekdayRate: number, basis: { totalMinutes: number; daysWorked: number }, days: number): { minutes: number; amountKobo: Kobo } {
  if (!Number.isInteger(basis.daysWorked) || basis.daysWorked < 1) throw new Error("There must be at least one day worked to average.");
  if (!Number.isInteger(days) || days < 1) throw new Error("There must be at least one sick day to pay.");
  const rateKobo = BigInt(koboFromNaira(weekdayRate, "The weekday rate"));
  const minutes = roundRatio(BigInt(basis.totalMinutes) * BigInt(days), BigInt(basis.daysWorked));
  const amountKobo = roundRatio(rateKobo * BigInt(basis.totalMinutes) * BigInt(days), BigInt(basis.daysWorked) * 60n);
  return { minutes: Number(minutes), amountKobo };
}

/**
 * Puts the sites that carry only extra pay (sick pay: no hours, an allowance) among a person's hourly sites. A site that is already there (the same site, contract and structure) gets the allowances added to it, because
 * one person's pay for one site is ONE piece of pay; any other is added as it is. The sites it is given are never changed.
 */
export function mergeAllowanceSites(sites: readonly HourlySiteInput[], extra: readonly HourlySiteInput[]): HourlySiteInput[] {
  const out = sites.map((s) => ({ ...s }));
  for (const e of extra) {
    const at = out.findIndex((s) => s.key === e.key);
    if (at >= 0) out[at] = { ...out[at], allowances: [...(out[at].allowances ?? []), ...(e.allowances ?? [])] };
    else out.push({ ...e });
  }
  return out;
}
