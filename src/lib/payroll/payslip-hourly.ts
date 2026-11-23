/**
 * Hourly pay, phase 4c (payslip): what an hourly person's payslip shows beside the usual earnings lines: the hours worked and the pay for them, by site and by kind of day (weekday, weekend, public holiday),
 * with the rate for each. Pure: no database, no framework. The payslip screen and the payslip PDF both draw from this, so they can never disagree.
 *
 * The earnings lines of such a payslip are the site's established salary structure (Basic, Housing, ...) dividing the hourly gross (the founder's H8 and H12); this section shows how that gross was made up.
 * Hours are shown exactly (hours and minutes), never rounded; every amount is whole kobo, added exactly. A line is the stored `HourlyPayLine` of the payroll record (one per site, kind of day and rate).
 */
import { koboToString, sumKobo, toKobo, type Kobo } from "../money-exact";
import { naira } from "./hourly-minimum";
import type { DayClass } from "./hourly";

export interface HourlyLineInput {
  siteName: string;
  /** The client's name as it was when the payroll was calculated (the payslip names the client; never what the client is charged). */
  clientName?: string | null;
  dayClass: DayClass;
  minutes: number;
  /** Naira per hour, as stored ("1000.00"). */
  rate: string;
  /** Naira for the line, as stored ("8000.00"). */
  amount: string;
}

/** Extra pay for the site's hours as stored on the payroll record (H14): the leave percentage, and in later pieces paid sick days and holidays not worked. */
export interface AllowanceLineInput {
  kind: "LEAVE_PERCENT" | "SICK_DAY" | "HOLIDAY_NOT_WORKED" | "HOLIDAY_ADJUSTMENT";
  siteName: string;
  clientName?: string | null;
  /** LEAVE_PERCENT: the pay for the hours the percentage was worked on, as stored ("4000.00"). */
  baseAmount: string | null;
  /** LEAVE_PERCENT: the percentage used, as stored ("10.00"). */
  pct: string | null;
  /** LEAVE_PERCENT: BASIC when the base is the Basic part of the pay; null for a line whose base is all the pay (made before the founder's decision). */
  basis?: "ALL_PAY" | "BASIC" | null;
  amount: string;
  /** The day-based kinds (sick pay): the minutes paid, the hourly rate used ("1000.00") and the days paid. */
  minutes?: number | null;
  rate?: string | null;
  dates?: string[];
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

const KIND_LABEL: Record<AllowanceLineInput["kind"], string> = { LEAVE_PERCENT: "Leave pay", SICK_DAY: "Sick pay", HOLIDAY_NOT_WORKED: "Holiday pay", HOLIDAY_ADJUSTMENT: "Holiday adjustment" };
const plainPct = (p: string) => (p.includes(".") ? p.replace(/\.?0+$/, "") : p);

/** The label of an extra pay line: "Leave pay (2.5% of Basic 400.00)" (the base is the Basic part of the pay) or, for a line whose base is all the pay, "Leave pay (10% of 4,000.00)". */
function allowanceLabel(a: AllowanceLineInput): string {
  const name = KIND_LABEL[a.kind];
  if (a.kind === "LEAVE_PERCENT" && a.pct !== null && a.baseAmount !== null) return `${name} (${plainPct(a.pct)}% of ${a.basis === "BASIC" ? "Basic " : ""}${naira(toKobo(a.baseAmount))})`;
  const n = a.dates?.length ?? 0;
  if ((a.kind === "HOLIDAY_NOT_WORKED" || a.kind === "HOLIDAY_ADJUSTMENT") && n === 1) return `${name} (${a.dates![0]})`;
  return n > 0 ? `${name} (${n} ${n === 1 ? "day" : "days"})` : name;
}

/** The place of a line as the payslip shows it: "Client - Site" when the client is named, else the site alone. */
export const placeLabel = (l: { siteName: string; clientName?: string | null }): string => {
  const site = l.siteName.trim() || "Site not recorded";
  const client = (l.clientName ?? "").trim();
  return client ? `${client} - ${site}` : site;
};

export function hourlyPayslip(lines: readonly HourlyLineInput[], allowances: readonly AllowanceLineInput[] = []): HourlyPayslip | null {
  if (lines.length === 0 && allowances.length === 0) return null;
  // one row per site, kind of day and rate (the pieces of a supplementary payroll's one line are shown as one)
  const rows = new Map<string, { site: string; dayClass: DayClass; rate: Kobo; minutes: number; amounts: Kobo[] }>();
  for (const l of lines) {
    const site = placeLabel(l);
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
  const extra = allowances.map((a) => ({ site: placeLabel(a), label: allowanceLabel(a), kind: a.kind, amount: toKobo(a.amount), minutes: a.minutes ?? 0, rate: a.rate ? koboToString(toKobo(a.rate)) : "" }));
  const shown: HourlyPayslipRow[] = [];
  for (const site of [...new Set(sorted.map((r) => r.site)), ...extra.map((x) => x.site).filter((s) => !sorted.some((r) => r.site === s))].filter((s, i, all) => all.indexOf(s) === i)) {
    for (const r of sorted.filter((x) => x.site === site)) shown.push({ site: r.site, dayLabel: LABEL[r.dayClass], duration: durationOf(r.minutes), rate: koboToString(r.rate), amount: koboToString(sumKobo(r.amounts)) });
    for (const x of extra.filter((y) => y.site === site)) shown.push({ site, dayLabel: x.label, duration: x.minutes > 0 ? durationOf(x.minutes) : "", rate: x.rate, amount: koboToString(x.amount) });
  }
  const byKind = (Object.keys(KIND_LABEL) as Array<AllowanceLineInput["kind"]>).flatMap((k) => {
    const mine = extra.filter((x) => x.kind === k);
    const mins = mine.reduce((s, x) => s + x.minutes, 0);
    return mine.length ? [{ dayLabel: KIND_LABEL[k], duration: mins > 0 ? durationOf(mins) : "", amount: koboToString(sumKobo(mine.map((x) => x.amount))) }] : [];
  });
  return {
    rows: shown,
    byClass: [...byClass, ...byKind],
    totalDuration: durationOf(sorted.reduce((s, r) => s + r.minutes, 0) + extra.reduce((s, x) => s + x.minutes, 0)),
    totalAmount: koboToString(sumKobo([...sorted.flatMap((r) => r.amounts), ...extra.map((x) => x.amount)])),
  };
}
