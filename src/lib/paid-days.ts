import { eachDay, daysInMonth, iso, isEffective, monthEnd, monthStart } from "./dates";
import { isWorkingDay } from "./leave";

export { isWorkingDay };

/**
 * The paid-days basis agreed with each client (the founder's decisions of 2026-11-05; docs/plans/paid-days-basis.md and docs/plans/founder-decisions-2026-11-05.md). A month's pay is the
 * monthly gross multiplied by days paid, divided by the month's DIVISOR. This file decides the divisor and which days add no basic pay. It is pure: no database, no clock.
 *
 *  - No setting on the contract: the company's rule, exactly as before (its basis days, and no day set aside).
 *  - CALENDAR_DAYS: the days in the month (31 for January, 28 or 29 for February, 30 for April).
 *  - WORKING_DAYS: the working days in the month (for example 22). The working week is the contract's own, or the company's "working days per week" (Monday to Friday by default).
 *    Optionally the confirmed public holidays are not working days. A day that is not a working day adds no basic pay: work on it is paid only as overtime.
 *
 * Because only working days count and the divisor is the number of working days, pay on the working-days basis can never exceed one full month's gross.
 */
export type PaidDaysBasis = "CALENDAR_DAYS" | "WORKING_DAYS";

export interface BasisSetting {
  basis: PaidDaysBasis;
  /** Working-days basis only: the confirmed public holidays are not working days (work on them is overtime). */
  excludePublicHolidays: boolean;
  /** 5 = Monday to Friday, 6 = Monday to Saturday, 7 = every day. Null: the company's "working days per week". */
  workingDaysPerWeek: number | null;
}

export interface BasisRow {
  contractId: string;
  /** Only APPROVED rows count; a pending or rejected proposal never changes pay. */
  status: string;
  setting: BasisSetting;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface Proration {
  basisDays: number;
  /** ISO dates in the month that add no basic pay (empty unless the working-days basis). */
  nonProratedDates: string[];
  mode: "COMPANY_DEFAULT" | PaidDaysBasis;
}

export function monthProration(year: number, month: number, setting: BasisSetting | null, ctx: { companyBasisDays: number; leaveWorkingDaysPerWeek: number; holidays: readonly string[] }): Proration {
  if (!setting) return { basisDays: ctx.companyBasisDays, nonProratedDates: [], mode: "COMPANY_DEFAULT" };
  if (setting.basis === "CALENDAR_DAYS") return { basisDays: daysInMonth(year, month), nonProratedDates: [], mode: "CALENDAR_DAYS" };
  const perWeek = setting.workingDaysPerWeek ?? ctx.leaveWorkingDaysPerWeek;
  const holidays = new Set(setting.excludePublicHolidays ? ctx.holidays : []);
  const off: string[] = [];
  let working = 0;
  for (const day of eachDay(monthStart(year, month), monthEnd(year, month))) {
    if (isWorkingDay(day, perWeek) && !holidays.has(iso(day))) working += 1;
    else off.push(iso(day));
  }
  return { basisDays: working, nonProratedDates: off, mode: "WORKING_DAYS" };
}

/** The approved setting in force for a contract on a date; the newest start wins if two overlap; null if the contract has none (so the company's rule applies). */
export function resolveSetting(rows: readonly BasisRow[], contractId: string, onDate: Date): BasisSetting | null {
  const hit = rows
    .filter((r) => r.contractId === contractId && r.status === "APPROVED" && isEffective(onDate, r.effectiveFrom, r.effectiveTo))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
  return hit ? hit.setting : null;
}

/**
 * The one setting for an employee's month: the setting in force (at the start of the pay month) on every contract the person worked on. If those differ (a person who moved between
 * contracts with different bases, or between one with a setting and one without) the answer is "mixed": the pay run flags it for review rather than paying on a guess.
 */
export function employeeProration(rows: readonly BasisRow[], contractIds: readonly string[], at: Date): { kind: "ok"; setting: BasisSetting | null } | { kind: "mixed" } {
  const ids = [...new Set(contractIds)];
  if (ids.length === 0) return { kind: "ok", setting: null };
  const settings = ids.map((id) => resolveSetting(rows, id, at));
  const key = (s: BasisSetting | null) => JSON.stringify(s);
  return settings.every((s) => key(s) === key(settings[0])) ? { kind: "ok", setting: settings[0] } : { kind: "mixed" };
}
