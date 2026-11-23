/**
 * Hourly pay, the three-month average on GROSS EARNINGS (the founder's confirmed decision of 2026-11-21). Pure: no database, no framework.
 *
 * A paid sick day and a paid public holiday not worked are paid at the person's AVERAGE DAILY GROSS EARNINGS: the gross pay for the hours they worked in the months before the day (the window), divided by the days they worked.
 * - Each shift is valued at the approved hourly rate of ITS OWN day and kind of day (weekday, weekend, holiday), so a rate change counts from its date and a past month is never re-priced at today's rate.
 * - Which kinds of day count is a rule setting (all three by default). A kind that is left out is left out of the earnings AND of the days.
 * - Leave pay, sick pay and holiday pay are not in it (they are not hours worked, and counting them would count pay twice): the input is only approved hours, never allowances.
 * - Hours with no approved rate for their day are not earnings (they are counted apart, so the pay run can say so); a day with only such hours is not a day of earnings.
 * - A window with no earnings has nothing to average: null, never an average of zero. A new starter or a person who joined part-way through the window is averaged over the days they have; days not worked (absence, unpaid
 *   leave) are not in the days, so they do not dilute the average.
 * Every amount is whole kobo, worked exactly (kobo x minutes) and rounded half up ONCE, on the whole amount for all the days paid.
 */
import { koboToString, roundRatio, type Kobo } from "../money-exact";

export type AverageDayClass = "WEEKDAY" | "WEEKEND" | "HOLIDAY";

/** One person's approved hours of one kind of day, at one site, on one day, with the hourly rate (in kobo) in force that day. */
export interface PricedDay {
  /** The Nigerian calendar day (YYYY-MM-DD). */
  date: string;
  dayClass: AverageDayClass;
  minutes: number;
  /** The approved hourly rate for this kind of day, in whole kobo an hour; null when no approved rate applied that day. */
  rateKobo: number | null;
  beatId: string;
  contractId: string;
  clientId: string;
}

export interface GrossBasis {
  /** The window it was worked over: from (included) up to (not including) to. */
  from: string;
  to: string;
  /** The gross earnings as an exact count of kobo x minutes (divide by 60 for kobo): the sum of each row's rate in kobo an hour times its minutes. */
  koboMinutes: bigint;
  /** The minutes worked on the counted days that were priced. */
  minutes: number;
  /** The distinct days with earnings of a counted kind. */
  daysWorked: number;
  /** Minutes in the window (of a counted kind) that had no approved rate: not in the earnings. */
  unpricedMinutes: number;
  /** The days of the week worked in the window, of any kind (0 = Sunday ... 6 = Saturday): their usual days. */
  weekdays: Set<number>;
  /** The site of the latest hours in the window, whatever the kind: where the day's pay is split by the site's salary structure. */
  last: { beatId: string; contractId: string; clientId: string };
}

const dayOfWeek = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

/** What the average is made from. Null, never an average of zero, when there are no earnings of a counted kind in the window. */
export function grossBasis(history: readonly PricedDay[], from: string, to: string, counted: ReadonlySet<AverageDayClass>): GrossBasis | null {
  const inWindow = history.filter((r) => r.date >= from && r.date < to && r.minutes > 0);
  if (inWindow.length === 0) return null;
  const earning = inWindow.filter((r) => counted.has(r.dayClass) && r.rateKobo !== null);
  if (earning.length === 0) return null;
  let koboMinutes = 0n;
  let minutes = 0;
  for (const r of earning) {
    koboMinutes += BigInt(r.rateKobo as number) * BigInt(r.minutes);
    minutes += r.minutes;
  }
  const latest = [...inWindow].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.minutes - a.minutes || (a.beatId < b.beatId ? -1 : a.beatId > b.beatId ? 1 : 0)))[0];
  return {
    from,
    to,
    koboMinutes,
    minutes,
    daysWorked: new Set(earning.map((r) => r.date)).size,
    unpricedMinutes: inWindow.filter((r) => counted.has(r.dayClass) && r.rateKobo === null).reduce((n, r) => n + r.minutes, 0),
    weekdays: new Set(inWindow.map((r) => dayOfWeek(r.date))),
    last: { beatId: latest.beatId, contractId: latest.contractId, clientId: latest.clientId },
  };
}

/** What `days` paid days are worth: the average daily gross times the days, worked once from the whole ratio and rounded half up to the kobo (it never gains or loses a kobo to the number of days). */
export function grossDayPay(basis: Pick<GrossBasis, "koboMinutes" | "daysWorked">, days: number): Kobo {
  if (!Number.isInteger(basis.daysWorked) || basis.daysWorked < 1) throw new Error("There must be at least one day worked to average.");
  if (!Number.isInteger(days) || days < 1) throw new Error("There must be at least one day to pay.");
  return roundRatio(basis.koboMinutes * BigInt(days), BigInt(basis.daysWorked) * 60n);
}

/** How an average was worked out, kept on the stored pay line for the payroll audit: the window, the gross earnings in it, the days worked, the daily average, the days paid and the kinds of day counted (amounts in naira text). */
export interface GrossBreakdown {
  basis: "GROSS_EARNINGS";
  from: string;
  to: string;
  grossEarnings: string;
  daysWorked: number;
  dailyAverage: string;
  daysPaid: number;
  counted: AverageDayClass[];
  /** Minutes in the window of a counted kind that had no approved rate and are NOT in the earnings. */
  unpricedMinutes: number;
}

export function grossBreakdown(basis: GrossBasis, daysPaid: number, counted: ReadonlySet<AverageDayClass>): GrossBreakdown {
  return {
    basis: "GROSS_EARNINGS",
    from: basis.from,
    to: basis.to,
    grossEarnings: koboToString(roundRatio(basis.koboMinutes, 60n)),
    daysWorked: basis.daysWorked,
    dailyAverage: koboToString(grossDayPay(basis, 1)),
    daysPaid,
    counted: (["WEEKDAY", "WEEKEND", "HOLIDAY"] as const).filter((c) => counted.has(c)),
    unpricedMinutes: basis.unpricedMinutes,
  };
}
