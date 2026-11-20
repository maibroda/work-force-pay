/**
 * Hourly pay, phase 4c (payslip): what an hourly person's payslip shows beside the usual earnings lines: the hours worked and the pay for them, by site and by kind of day (weekday, weekend, public holiday),
 * with the rate for each. Pure: no database, no framework. The payslip screen and the payslip PDF both draw from this, so they can never disagree.
 *
 * The earnings lines of such a payslip are the site's established salary structure (Basic, Housing, ...) dividing the hourly gross (the founder's H8 and H12); this section shows how that gross was made up.
 * Hours are shown exactly (hours and minutes), never rounded; every amount is whole kobo, added exactly. A line is the stored `HourlyPayLine` of the payroll record (one per site, kind of day and rate).
 */
import { koboToString, sumKobo, toKobo, type Kobo } from "../money-exact";
import type { DayClass } from "./hourly";

export interface HourlyLineInput {
  siteName: string;
  dayClass: DayClass;
  minutes: number;
  /** Naira per hour, as stored ("1000.00"). */
  rate: string;
  /** Naira for the line, as stored ("8000.00"). */
  amount: string;
}

export interface HourlyPayslipRow {
  site: string;
  dayLabel: string;
  duration: string;
  rate: string;
  amount: string;
}

export interface HourlyPayslip {
  rows: HourlyPayslipRow[];
  /** Totals by kind of day (weekday, weekend, public holiday), only those with hours. */
  byClass: Array<{ dayLabel: string; duration: string; amount: string }>;
  totalDuration: string;
  totalAmount: string;
}

const ORDER: DayClass[] = ["WEEKDAY", "WEEKEND", "HOLIDAY"];
const LABEL: Record<DayClass, string> = { WEEKDAY: "Weekday", WEEKEND: "Weekend", HOLIDAY: "Public holiday" };

/** Minutes as hours and minutes, exactly: "8 h", "8 h 30 min", "45 min". */
export function durationOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0 && m === 0) return "0 h";
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

export function hourlyPayslip(lines: readonly HourlyLineInput[]): HourlyPayslip | null {
  if (lines.length === 0) return null;
  // one row per site, kind of day and rate (the pieces of a supplementary payroll's one line are shown as one)
  const rows = new Map<string, { site: string; dayClass: DayClass; rate: Kobo; minutes: number; amounts: Kobo[] }>();
  for (const l of lines) {
    const site = l.siteName.trim() || "Site not recorded";
    const rate = toKobo(l.rate);
    const key = `${site}|${l.dayClass}|${rate}`;
    const cur = rows.get(key) ?? { site, dayClass: l.dayClass, rate, minutes: 0, amounts: [] };
    cur.minutes += l.minutes;
    cur.amounts.push(toKobo(l.amount));
    rows.set(key, cur);
  }
  const sorted = [...rows.values()].sort((a, b) => a.site.localeCompare(b.site) || ORDER.indexOf(a.dayClass) - ORDER.indexOf(b.dayClass) || a.rate - b.rate);
  const byClass = ORDER.flatMap((c) => {
    const mine = sorted.filter((r) => r.dayClass === c);
    if (!mine.length) return [];
    return [{ dayLabel: LABEL[c], duration: durationOf(mine.reduce((s, r) => s + r.minutes, 0)), amount: koboToString(sumKobo(mine.flatMap((r) => r.amounts))) }];
  });
  return {
    rows: sorted.map((r) => ({ site: r.site, dayLabel: LABEL[r.dayClass], duration: durationOf(r.minutes), rate: koboToString(r.rate), amount: koboToString(sumKobo(r.amounts)) })),
    byClass,
    totalDuration: durationOf(sorted.reduce((s, r) => s + r.minutes, 0)),
    totalAmount: koboToString(sumKobo(sorted.flatMap((r) => r.amounts))),
  };
}
