/**
 * Hourly pay, H14 piece 0 (docs/plans/hourly-payroll-h14-build-plan.md): a safeguard, not a pay rule. Approved annual leave for a person paid by the hour is NOT paid today: hourly pay is for approved hours only, and the
 * pay run drops the work-register days (including the "leave" days approving leave writes) on the days a person is paid by the hour, so nobody is paid monthly and hourly for the same day. Nothing said so. This finds the
 * approved leave days that fall on days the person is paid by the hour, so the payroll can warn and the people asking for and approving the leave can be told. It changes no amount. Pure: no database, no framework.
 *
 * What pays leave for hourly staff is decided (a percentage added to every hour worked, the founder's answers of 2026-11-20) and is a later piece; the wording here is for the time until then.
 */
import { workingDatesBetween } from "../leave";
import { compensationTypeOn, type CompensationRow } from "./hourly-rates";

export interface LeaveRange {
  startDate: Date;
  endDate: Date;
}

export interface HourlyLeaveFinding {
  employeeId: string;
  category: string;
  severity: "WARNING";
  code: "HOURLY_LEAVE_NOT_PAID";
  message: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The ISO dates, in order and each once, of approved annual leave inside `window` that are working days of the company's leave week and fall on a day the person is paid by the hour (an approved hourly record
 * starting on or before the day). A person paid monthly, or one whose hourly record is not approved, has none: their leave is paid as before.
 */
export function hourlyLeaveDates(comp: readonly CompensationRow[] | undefined, leave: readonly LeaveRange[], workingDaysPerWeek: number, window: { from: Date; to: Date }): string[] {
  if (!comp || comp.length === 0) return [];
  const out = new Set<string>();
  for (const l of leave) {
    const from = l.startDate > window.from ? l.startDate : window.from;
    const to = l.endDate < window.to ? l.endDate : window.to;
    for (const d of workingDatesBetween(from, to, workingDaysPerWeek)) if (compensationTypeOn(comp, d) === "HOURLY") out.add(iso(d));
  }
  return [...out].sort();
}

const SHOWN = 6;
/** Why the days are not paid: no leave pay is set up, or leave pay is the percentage added to every hour worked (H14 piece 1). */
const reason = (pct?: number) => (pct && pct > 0 ? `their leave pay is the ${pct}% worked out on the hours they work, not a payment for the days` : "pay for their leave is not set up yet");
const listed = (dates: readonly string[]) => (dates.length > SHOWN ? `${dates.slice(0, SHOWN).join(", ")} and ${dates.length - SHOWN} more` : dates.join(", "));

/** The payroll finding: a WARNING (never blocking, nothing to explain) when a person paid by the hour has approved annual leave in the month. */
export function hourlyLeaveFinding(a: { employeeId: string; label: string; periodName: string; dates: readonly string[]; /** The leave percentage in force (0 or left out: none is set up). */ leavePct?: number }): HourlyLeaveFinding | null {
  if (a.dates.length === 0) return null;
  return {
    employeeId: a.employeeId,
    category: "ATTENDANCE",
    severity: "WARNING",
    code: "HOURLY_LEAVE_NOT_PAID",
    message: `${a.label} has ${a.dates.length} approved annual leave day(s) in ${a.periodName} while paid by the hour (${listed(a.dates)}). Pay for staff paid by the hour is for approved hours only, and ${reason(a.leavePct)}, so those days are not paid. This is a warning only: nothing is blocked or changed.`,
  };
}

/** The notice shown when annual leave is asked for or approved on days a person is paid by the hour. */
export function hourlyLeaveNotice(dates: readonly string[], leavePct?: number): string | null {
  if (dates.length === 0) return null;
  return `Note: this person is paid by the hour on ${dates.length} of these leave day(s) (${listed(dates)}), and ${reason(leavePct)}, so those days are not paid.`;
}
