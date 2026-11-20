import { iso } from "@/lib/dates";
import { compensationTypeOn, type CompensationRow, type HourlyRateRow } from "@/lib/payroll/hourly-rates";
import type { ApprovedPiece, UnresolvedPiece } from "@/lib/payroll/hourly-earnings";
import { hoursOf } from "@/lib/payroll/hourly-report";
import { parseWatLocal } from "@/lib/payroll/time-entry";
import type { Tx } from "./_base";
import { loadApprovedHourlyRates } from "./hourly-pay";
import { loadApprovedSegments } from "./time-entries";

/**
 * Hourly pay, phase 4b (docs/plans/hourly-payroll-phase4-plan.md): what the pay run needs to pay a person by the hour, and the findings it raises. The facts are read for ONE company and one pay period:
 * the paid pieces of APPROVED shifts (phase 3), the approved hourly rates (phase 2), how each person is paid from which date (phase 2), the shifts still waiting for approval, and the approved shifts whose
 * holiday classing may be doubtful. Nothing here prices a shift: `src/lib/payroll/hourly-earnings.ts` does, and the engine pays it (`src/lib/payroll/engine.ts`).
 *
 * The founder's rules of 2026-11-20 that it carries out: H9 and H21 only approved hours are paid, and hours still waiting for approval (or with no clock-out) are left out and make a BLOCKING finding that
 * says so; H20 a person who is paid by the hour and also has a personal monthly pay rate blocks the payroll; a person is never paid monthly and hourly for the same day (the monthly days on the days they are
 * paid by the hour are dropped by the pay run). A shift is paid in the month it was worked, by the day each paid piece fell on. Hours are read whether or not the company's hourly switch is on: an approved
 * shift is money owed, and the switch only governs the screens and the entering of new shifts.
 */
export interface HourlyForPeriod {
  /** The approved paid pieces in the period, with the shift each came from. */
  pieces: ApprovedPiece[];
  rates: HourlyRateRow[];
  /** Every approved record of how a person is paid, by person. */
  compByEmp: Map<string, CompensationRow[]>;
  /** Shifts that are not approved and started in the period: waiting for approval, or drafts (counting those with no clock-out). */
  waitingByEmp: Map<string, { shifts: number; minutes: number }>;
  /** Approved shifts whose class of day may be doubtful: the holiday list was not confirmed, or the site had no recognised state. */
  doubtfulByEmp: Map<string, { unconfirmed: number; noState: number }>;
  /** The client and site names, for the payslip's list of places worked. */
  names: Map<string, { clientName: string; beatName: string }>;
}

export const EMPTY_HOURLY: HourlyForPeriod = { pieces: [], rates: [], compByEmp: new Map(), waitingByEmp: new Map(), doubtfulByEmp: new Map(), names: new Map() };

export async function loadHourlyForPeriod(tx: Tx, orgId: string, start: Date, end: Date): Promise<HourlyForPeriod> {
  const segs = await loadApprovedSegments(tx, orgId, start, end);
  const pieces: ApprovedPiece[] = segs.map((s) => ({ employeeId: s.employeeId, beatId: s.beatId, contractId: s.contractId, clientId: s.clientId, date: s.date, dayClass: s.dayClass, minutes: s.minutes, entryId: s.entryId }));
  const entryIds = [...new Set(segs.map((s) => s.entryId))];
  const beatIds = [...new Set(segs.map((s) => s.beatId))];
  const from = parseWatLocal(`${iso(start)}T00:00`);
  const until = new Date(parseWatLocal(`${iso(end)}T00:00`).getTime() + 86_400_000);
  const [rates, comp, waiting, approvedEntries, beats] = await Promise.all([
    loadApprovedHourlyRates(tx, orgId, start, end),
    tx.employeeCompensationType.findMany({ where: { organizationId: orgId, status: "APPROVED", effectiveFrom: { lte: end } }, select: { employeeId: true, type: true, effectiveFrom: true, status: true } }),
    tx.timeEntry.findMany({ where: { organizationId: orgId, status: { in: ["DRAFT", "SUBMITTED"] }, clockIn: { gte: from, lt: until } }, select: { employeeId: true, clockIn: true, clockOut: true } }),
    entryIds.length ? tx.timeEntry.findMany({ where: { organizationId: orgId, id: { in: entryIds } }, select: { employeeId: true, calendarConfirmed: true, placeState: true } }) : Promise.resolve([]),
    beatIds.length ? tx.beat.findMany({ where: { organizationId: orgId, id: { in: beatIds } }, select: { id: true, name: true, client: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const compByEmp = new Map<string, CompensationRow[]>();
  for (const c of comp) compByEmp.set(c.employeeId, [...(compByEmp.get(c.employeeId) ?? []), { type: c.type, effectiveFrom: c.effectiveFrom, status: c.status }]);
  const waitingByEmp = new Map<string, { shifts: number; minutes: number }>();
  for (const w of waiting) {
    const cur = waitingByEmp.get(w.employeeId) ?? { shifts: 0, minutes: 0 };
    cur.shifts += 1;
    if (w.clockOut) cur.minutes += (w.clockOut.getTime() - w.clockIn.getTime()) / 60_000;
    waitingByEmp.set(w.employeeId, cur);
  }
  const doubtfulByEmp = new Map<string, { unconfirmed: number; noState: number }>();
  for (const e of approvedEntries) {
    const unconfirmed = e.calendarConfirmed === false;
    const noState = e.placeState === null;
    if (!unconfirmed && !noState) continue;
    const cur = doubtfulByEmp.get(e.employeeId) ?? { unconfirmed: 0, noState: 0 };
    if (unconfirmed) cur.unconfirmed += 1;
    if (noState) cur.noState += 1;
    doubtfulByEmp.set(e.employeeId, cur);
  }
  return { pieces, rates, compByEmp, waitingByEmp, doubtfulByEmp, names: new Map(beats.map((b) => [b.id, { clientName: b.client.name, beatName: b.name }])) };
}

/** Whether a person is paid by the hour on a day (monthly unless an approved record says hourly from a date). */
export function isHourlyOn(comp: readonly CompensationRow[] | undefined, date: Date): boolean {
  return Boolean(comp && comp.length) && compensationTypeOn(comp!, date) === "HOURLY";
}

export interface HourlyFinding {
  employeeId: string;
  category: string;
  severity: "CRITICAL" | "WARNING";
  code: string;
  message: string;
}

/** A rate conflict found while pricing a person's hours (two approved rates at one level): reported as a finding so one person's data never stops the company's payroll. */
export function hourlyRateConflict(employeeId: string, label: string, periodName: string, message: string): HourlyFinding {
  return { employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "HOURLY_RATE_CONFLICT", message: `${label}'s hourly pay for ${periodName} could not be worked out, so their hourly hours are not paid. ${message}` };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The findings for one person's hourly pay in a period. BLOCKING (critical): shifts not approved (H21), hours with no approved rate, hours at a site with no salary structure, and a personal monthly pay rate
 * held by someone paid by the hour (H20). WARNINGS: approved shifts classed while the holiday list was not confirmed, or at a site with no recognised state (so only national holidays were applied).
 */
export function hourlyFindings(a: {
  employeeId: string;
  label: string;
  periodName: string;
  unresolved: readonly UnresolvedPiece[];
  waiting?: { shifts: number; minutes: number };
  doubtful?: { unconfirmed: number; noState: number };
  monthlyRateWhileHourly: boolean;
}): HourlyFinding[] {
  const out: HourlyFinding[] = [];
  const add = (severity: HourlyFinding["severity"], code: string, message: string) => out.push({ employeeId: a.employeeId, category: "ATTENDANCE", severity, code, message });
  if (a.waiting && a.waiting.shifts > 0) {
    const n = a.waiting.shifts;
    add(
      "CRITICAL",
      "HOURLY_HOURS_NOT_APPROVED",
      `${a.label} has ${n} ${plural(n, "shift", "shifts")} in ${a.periodName} that ${plural(n, "is", "are")} not approved (waiting for approval, or with no clock-out${a.waiting.minutes ? `; ${hoursOf(a.waiting.minutes)} h of recorded time` : ""}), so ${plural(n, "it is", "they are")} not paid. Get ${plural(n, "it", "them")} approved and calculate again, or approve the payroll knowing that time is left out (an override needs a reason).`,
    );
  }
  const minutesOf = (list: readonly UnresolvedPiece[]) => list.reduce((s, u) => s + u.minutes, 0);
  const noRate = a.unresolved.filter((u) => u.reason === "NO_RATE");
  if (noRate.length) add("CRITICAL", "HOURLY_NO_RATE", `${a.label} has ${hoursOf(minutesOf(noRate))} h of approved hours in ${a.periodName} with no approved hourly rate for their job role, so they are not paid. Approve an hourly rate (Payroll > Hourly pay) and calculate again.`);
  const noStructure = a.unresolved.filter((u) => u.reason === "NO_STRUCTURE");
  if (noStructure.length) add("CRITICAL", "HOURLY_NO_STRUCTURE", `${a.label} has ${hoursOf(minutesOf(noStructure))} h of approved hours in ${a.periodName} at a site with no salary structure (the contract rate's, the contract's default or the company's default), so they are not paid. Set up a structure and calculate again.`);
  if (a.monthlyRateWhileHourly) add("CRITICAL", "HOURLY_AND_MONTHLY_RATE", `${a.label} is paid by the hour but still has a personal monthly pay rate. A person is never paid monthly and by the hour together: end the monthly pay rate (the day before the hourly date) and calculate again. Only the hourly pay was worked out for the days they are paid by the hour.`);
  if (a.doubtful?.unconfirmed) add("WARNING", "HOURLY_HOLIDAYS_UNCONFIRMED", `${a.doubtful.unconfirmed} approved ${plural(a.doubtful.unconfirmed, "shift", "shifts")} of ${a.label} ${plural(a.doubtful.unconfirmed, "was", "were")} classed while the company's public holiday list for the year was not confirmed, so a public holiday may have been paid as an ordinary day. Confirm the list (Payroll > Pay setup > Public holidays) and check those shifts.`);
  if (a.doubtful?.noState) add("WARNING", "HOURLY_SITE_NO_STATE", `${a.doubtful.noState} approved ${plural(a.doubtful.noState, "shift", "shifts")} of ${a.label} ${plural(a.doubtful.noState, "was", "were")} at a site with no recognised state, so only national holidays were applied. Set the site's state and check those shifts.`);
  return out;
}

/** Whether, on any day of the period, a person is paid by the hour AND holds a personal monthly pay rate (the founder's H20). */
export function monthlyRateWhileHourly(comp: readonly CompensationRow[] | undefined, hasPayRateOn: (date: Date) => boolean, start: Date, end: Date): boolean {
  if (!comp || comp.length === 0) return false;
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const day = new Date(t);
    if (isHourlyOn(comp, day) && hasPayRateOn(day)) return true;
  }
  return false;
}

