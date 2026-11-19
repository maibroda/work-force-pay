/**
 * Hourly pay, phase 5 (docs/plans/hourly-payroll-assessment.md): the arithmetic behind the hourly reports. Pure: no database, no framework.
 *
 * The input is the paid pieces of APPROVED time entries (by day and class, from phase 3) and the APPROVED hourly rates (phase 2). The result is an INDICATIVE cost: approved hours x approved rates. It is not
 * payroll (the pay run does not read hours yet, phase 4), so it can differ from what payroll later pays by the way payroll groups its lines.
 *
 * Every figure is worked ONCE, at one grain: a line is one person, one contract, one month, one class of day and one rate. Its amount is the minutes x the rate divided by 60, rounded half up to the kobo once
 * (the shared rule of money-exact.ts). Every report is a roll-up of those same lines, so no report can add up to a different total than another, and nothing is counted twice. A piece with no approved rate is NOT
 * priced as zero: it is kept as hours with no rate, so a gap in the rates is always visible.
 */
import { koboFromNaira, koboToNumber, mulDiv, roundRatio, sumKobo, type Kobo } from "../money-exact";
import type { DayClass } from "./hourly";
import { resolveHourlyRate, type HourlyRateRow } from "./hourly-rates";

export interface Piece {
  employeeId: string;
  contractId: string;
  clientId: string;
  /** The Nigerian calendar day (YYYY-MM-DD) the piece was worked. */
  date: string;
  dayClass: DayClass;
  minutes: number;
}

export interface Line {
  employeeId: string;
  contractId: string;
  clientId: string;
  /** YYYY-MM. */
  month: string;
  dayClass: DayClass;
  /** The hourly rate row that applied; null when none did. */
  rateId: string | null;
  /** The hourly rate for this class in naira; null when none applied. */
  rate: number | null;
  minutes: number;
  /** Whole kobo; null when no rate applied (never zero). */
  amountKobo: number | null;
}

const CLASSES: readonly DayClass[] = ["WEEKDAY", "WEEKEND", "HOLIDAY"];
const RATE_FIELD: Record<DayClass, "weekday" | "weekend" | "holiday"> = { WEEKDAY: "weekday", WEEKEND: "weekend", HOLIDAY: "holiday" };

/**
 * Prices the pieces into lines. The rate for each piece is found as the pay run will find it (the founder's order: the employee's own, then the contract and job role, then the job role; approved and in force
 * on the day the piece was worked). `categoryOf` gives the person's job role.
 */
export function priceLines(pieces: readonly Piece[], rates: readonly HourlyRateRow[], categoryOf: (employeeId: string) => string): Line[] {
  const lines = new Map<string, Line>();
  for (const p of pieces) {
    const found = resolveHourlyRate(rates, { employeeId: p.employeeId, contractId: p.contractId, categoryId: categoryOf(p.employeeId), date: new Date(`${p.date}T00:00:00Z`) });
    const rate = found ? found.rates[RATE_FIELD[p.dayClass]] : null;
    const rateId = found ? found.rateId : null;
    const month = p.date.slice(0, 7);
    const key = [p.employeeId, p.contractId, month, p.dayClass, rateId ?? "none"].join("|");
    const line = lines.get(key);
    if (line) line.minutes += p.minutes;
    else lines.set(key, { employeeId: p.employeeId, contractId: p.contractId, clientId: p.clientId, month, dayClass: p.dayClass, rateId, rate, minutes: p.minutes, amountKobo: null });
  }
  for (const line of lines.values()) line.amountKobo = line.rate === null ? null : mulDiv(koboFromNaira(line.rate, "An hourly rate"), line.minutes, 60);
  return [...lines.values()];
}

export interface Rollup {
  /** All minutes by class, priced or not. */
  minutes: Record<DayClass, number>;
  /** The indicative cost in whole kobo by class: priced lines only. */
  kobo: Record<DayClass, number>;
  /** Minutes that had no approved rate: not in the cost. */
  unpricedMinutes: number;
  totalMinutes: number;
  totalKobo: number;
}

export function rollup(lines: readonly Line[]): Rollup {
  const minutes: Record<DayClass, number> = { WEEKDAY: 0, WEEKEND: 0, HOLIDAY: 0 };
  const parts: Record<DayClass, Kobo[]> = { WEEKDAY: [], WEEKEND: [], HOLIDAY: [] };
  let unpriced = 0;
  for (const l of lines) {
    minutes[l.dayClass] += l.minutes;
    if (l.amountKobo === null) unpriced += l.minutes;
    else parts[l.dayClass].push(l.amountKobo as Kobo);
  }
  const kobo = { WEEKDAY: sumKobo(parts.WEEKDAY), WEEKEND: sumKobo(parts.WEEKEND), HOLIDAY: sumKobo(parts.HOLIDAY) };
  return {
    minutes,
    kobo,
    unpricedMinutes: unpriced,
    totalMinutes: CLASSES.reduce((a, c) => a + minutes[c], 0),
    totalKobo: sumKobo([kobo.WEEKDAY, kobo.WEEKEND, kobo.HOLIDAY]),
  };
}

/** Groups lines by any key (a person, a client and contract, a month). */
export function groupLines(lines: readonly Line[], key: (line: Line) => string): Map<string, Line[]> {
  const out = new Map<string, Line[]>();
  for (const l of lines) {
    const k = key(l);
    const group = out.get(k);
    if (group) group.push(l);
    else out.set(k, [l]);
  }
  return out;
}

/** Minutes as hours to two decimals, half up: for DISPLAY only (60 minutes is 1; 1 minute is 0.02). Every total is kept in minutes and kobo. */
export function hoursOf(minutes: number): number {
  return koboToNumber(roundRatio(BigInt(minutes) * 100n, 60n));
}
