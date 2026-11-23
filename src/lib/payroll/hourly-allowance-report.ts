/**
 * Hourly pay, H14 follow-up (docs/plans/hourly-reports-allowances-plan.md, option A): the totals behind the extra pays shown in the hourly cost reports. Pure: no database, no framework.
 *
 * The three extra pays for a person paid by the hour (the leave percentage, a paid sick day, a paid public holiday not worked) are worked out by the pay run and stored as lines on the payroll record. The reports do NOT work
 * them out again (no second copy of the pay rules): they read those stored lines and total them here, in whole kobo, once. Every report is a roll-up of the same lines, so no two reports add up differently.
 */
import { addKobo, asKobo, sumKobo, type Kobo } from "../money-exact";

export type AllowanceKind = "LEAVE_PERCENT" | "SICK_DAY" | "HOLIDAY_NOT_WORKED" | "HOLIDAY_ADJUSTMENT";

export interface AllowanceRow {
  employeeId: string;
  contractId: string | null;
  clientId: string | null;
  /** The payroll month, YYYY-MM. */
  month: string;
  kind: AllowanceKind;
  /** Whole kobo. */
  amountKobo: number;
}

export interface AllowanceRollup {
  leaveKobo: number;
  sickKobo: number;
  holidayKobo: number;
  totalKobo: number;
}

/** The three extra pays of a set of stored lines, apart and together. An amount that is not a whole number of kobo is refused, never rounded. */
export function rollupAllowances(rows: readonly AllowanceRow[]): AllowanceRollup {
  const of = (kind: AllowanceKind): Kobo => sumKobo(rows.filter((r) => r.kind === kind).map((r) => asKobo(r.amountKobo)));
  const leave = of("LEAVE_PERCENT");
  const sick = of("SICK_DAY");
  const holiday = addKobo(of("HOLIDAY_NOT_WORKED"), of("HOLIDAY_ADJUSTMENT")); // the net difference of a holiday adjustment is holiday pay
  return { leaveKobo: leave, sickKobo: sick, holidayKobo: holiday, totalKobo: addKobo(addKobo(leave, sick), holiday) };
}

/** The lines grouped by a key (a person, a contract, a month); every line is in exactly one group. */
export function groupAllowances(rows: readonly AllowanceRow[], key: (row: AllowanceRow) => string): Map<string, AllowanceRow[]> {
  const out = new Map<string, AllowanceRow[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}
