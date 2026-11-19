/**
 * Hourly pay, phase 2 (docs/plans/hourly-payroll-assessment.md): which hourly rate applies, how a person is paid on a day, and which public holidays apply at a place of work. Pure: no database, no framework.
 * Nothing in the pay run reads this yet (phase 4).
 *
 * The founder's rules of 2026-11-19:
 *   H1  the rate is the employee's own, else the contract-and-job-role rate, else the job-role rate; only an APPROVED rate in force on the day counts.
 *   H11 the public holidays that apply are those of the state of the WORK LOCATION; a holiday with no states is national and applies everywhere.
 *
 * "No rate" is an answer (null), never zero: whoever asks must refuse to pay hours that have no rate. The rates here are naira numbers (at most two decimals, checked where they are saved), as in the
 * rest of the payroll code; the exact kobo arithmetic is in hourly.ts.
 */
import { isEffective } from "../dates";
import { MoneyError } from "../money-exact";
import { normaliseState } from "../nigeria-states";
import type { HourlyRates } from "./hourly";

export type HourlyRateScope = "EMPLOYEE" | "CONTRACT_CATEGORY" | "CATEGORY";
export type CompensationKind = "MONTHLY" | "HOURLY";

export interface HourlyRateRow {
  id: string;
  scope: HourlyRateScope;
  employeeId: string | null;
  contractId: string | null;
  categoryId: string | null;
  weekdayRate: number;
  weekendRate: number;
  holidayRate: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: string;
}

export interface ResolvedHourlyRate {
  rateId: string;
  scope: HourlyRateScope;
  rates: HourlyRates;
}

/** Most specific first (the founder's H1). */
const PRECEDENCE: readonly HourlyRateScope[] = ["EMPLOYEE", "CONTRACT_CATEGORY", "CATEGORY"];

/**
 * The hourly rate that applies to a person on a day, or null when none does. `contractId` is null for a person with no contract (back office), who has no contract-and-role level.
 * Two approved rates in force on the same day at the same level is refused, not guessed: the services prevent it, and this is the second line of defence.
 */
export function resolveHourlyRate(rows: readonly HourlyRateRow[], who: { employeeId: string; contractId: string | null; categoryId: string; date: Date }): ResolvedHourlyRate | null {
  const inForce = rows.filter((r) => r.status === "APPROVED" && isEffective(who.date, r.effectiveFrom, r.effectiveTo));
  for (const scope of PRECEDENCE) {
    const level = inForce.filter((r) => {
      if (r.scope !== scope) return false;
      if (scope === "EMPLOYEE") return r.employeeId === who.employeeId;
      if (scope === "CONTRACT_CATEGORY") return who.contractId !== null && r.contractId === who.contractId && r.categoryId === who.categoryId;
      return r.categoryId === who.categoryId;
    });
    if (level.length === 0) continue;
    if (level.length > 1) throw new MoneyError("Two approved hourly rates apply to the same person on the same day at the same level. Check the rates and end one of them.");
    const r = level[0];
    return { rateId: r.id, scope: r.scope, rates: { weekday: r.weekdayRate, weekend: r.weekendRate, holiday: r.holidayRate } };
  }
  return null;
}

export interface CompensationRow {
  type: CompensationKind;
  effectiveFrom: Date;
  status: string;
}

/** How a person is paid on a day: monthly unless an approved record starting on or before the day says hourly. The latest such record decides. */
export function compensationTypeOn(rows: readonly CompensationRow[], date: Date): CompensationKind {
  let latest: CompensationRow | null = null;
  for (const r of rows) {
    if (r.status !== "APPROVED" || r.effectiveFrom.getTime() > date.getTime()) continue;
    if (!latest || r.effectiveFrom.getTime() > latest.effectiveFrom.getTime()) latest = r;
  }
  return latest ? latest.type : "MONTHLY";
}

/**
 * The ISO dates of the public holidays that apply at a place of work in the given state. A holiday with no states is national and always applies. A place whose state is missing or not recognised gets the
 * national holidays only: a state holiday is never assumed. States are compared as the rest of the application reads them (spelling and case).
 */
export function holidaysApplying(holidays: ReadonlyArray<{ date: string; states: readonly string[] }>, placeState: string | null | undefined): Set<string> {
  const place = normaliseState(placeState ?? null);
  const dates = new Set<string>();
  for (const h of holidays) {
    if (h.states.length === 0) dates.add(h.date);
    else if (place && h.states.some((s) => normaliseState(s) === place)) dates.add(h.date);
  }
  return dates;
}
