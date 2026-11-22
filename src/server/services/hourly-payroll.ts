import { iso } from "@/lib/dates";
import { compensationTypeOn, type CompensationRow, type HourlyRateRow } from "@/lib/payroll/hourly-rates";
import type { ApprovedPiece, UnresolvedPiece } from "@/lib/payroll/hourly-earnings";
import { hoursOf } from "@/lib/payroll/hourly-report";
import { netLatePieces, type Decrease, type LateNet, type SegRef } from "@/lib/payroll/hourly-late";
import type { AllowanceLineInput, HourlyLineInput } from "@/lib/payroll/payslip-hourly";
import { naira } from "@/lib/payroll/hourly-minimum";
import type { Kobo } from "@/lib/money-exact";
import { parseWatLocal } from "@/lib/payroll/time-entry";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
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
  const pieces: ApprovedPiece[] = segs.map((s) => ({ employeeId: s.employeeId, beatId: s.beatId, contractId: s.contractId, clientId: s.clientId, date: s.date, dayClass: s.dayClass, minutes: s.minutes, entryId: s.entryId, segmentId: s.segmentId }));
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

/**
 * Hourly pay, phase 4c (the founder's H22): the hours that missed the payroll that was locked for the period, for a supplementary payroll to pay. Read for ONE company and one period:
 * - UNPAID: approved pieces that no payroll of the period (a regular or supplementary one that has not been replaced) has marked as paid;
 * - CREDIT: pieces of shifts that were paid and have since been replaced by a correction, and have not yet been set against what the correction owes.
 * `netLatePieces` (src/lib/payroll/hourly-late.ts) sets one against the other. A payroll calculated before pieces were recorded has no marks: the shifts its pay lines name count as paid, so older data is never paid twice.
 * Waiting shifts and holiday doubts are not raised again here: the regular payroll raised them, and an override of them was the approver's decision.
 */
export interface LateHourly extends HourlyForPeriod {
  /** The pieces still owed, each with the credit pieces it was set against. */
  pieces: LateNet["pieces"];
  /** Pieces whose group nets to nothing or to an overpayment: nothing to pay, so they are marked at once. */
  settled: LateNet["settled"];
  /** What was overpaid after a correction, to be recovered by a deduction someone enters. */
  decreases: Decrease[];
}

export async function loadLateHourly(tx: Tx, orgId: string, period: { id: string; startDate: Date; endDate: Date }): Promise<LateHourly> {
  const base = await loadHourlyForPeriod(tx, orgId, period.startDate, period.endDate);
  const runs = await tx.payrollRun.findMany({ where: { organizationId: orgId, periodId: period.id, status: { not: "SUPERSEDED" } }, select: { id: true } });
  const runIds = runs.map((r) => r.id);
  const [marks, lines] = await Promise.all([
    tx.hourlyPayPiece.findMany({ where: { organizationId: orgId, runId: { in: runIds } }, select: { runId: true, segmentId: true, kind: true } }),
    tx.hourlyPayLine.findMany({ where: { organizationId: orgId, runId: { in: runIds } }, select: { runId: true, entryIds: true } }),
  ]);
  const paid = new Set(marks.filter((m) => m.kind === "PAID").map((m) => m.segmentId));
  const credited = new Set(marks.filter((m) => m.kind === "CREDITED").map((m) => m.segmentId));
  // older data: a run with pay lines but no marks at all was calculated before pieces were recorded, and the shifts its lines name were paid
  const marked = new Set(marks.map((m) => m.runId));
  const legacyEntries = new Set(lines.filter((l) => !marked.has(l.runId)).flatMap((l) => l.entryIds));
  const isPaid = (segmentId: string, entryId: string) => paid.has(segmentId) || legacyEntries.has(entryId);
  const unpaid: SegRef[] = base.pieces.flatMap((p) => (p.segmentId && p.entryId && !isPaid(p.segmentId, p.entryId) ? [{ segmentId: p.segmentId, entryId: p.entryId, employeeId: p.employeeId, beatId: p.beatId, contractId: p.contractId, clientId: p.clientId, date: p.date, dayClass: p.dayClass, minutes: p.minutes }] : []));
  const replaced = await tx.timeEntrySegment.findMany({
    where: { organizationId: orgId, date: { gte: period.startDate, lte: period.endDate }, entry: { status: "SUPERSEDED" } },
    include: { entry: { select: { employeeId: true, beatId: true, contractId: true, clientId: true } } },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
  const credit: SegRef[] = replaced
    .filter((r) => isPaid(r.id, r.entryId) && !credited.has(r.id))
    .map((r) => ({ segmentId: r.id, entryId: r.entryId, employeeId: r.entry.employeeId, beatId: r.entry.beatId, contractId: r.entry.contractId, clientId: r.entry.clientId, date: iso(r.date), dayClass: r.dayClass, minutes: r.minutes }));
  const net = netLatePieces(unpaid, credit);
  const known = new Set(base.names.keys());
  const missing = [...new Set(replaced.map((r) => r.entry.beatId))].filter((id) => !known.has(id));
  if (missing.length) for (const b of await tx.beat.findMany({ where: { organizationId: orgId, id: { in: missing } }, select: { id: true, name: true, client: { select: { name: true } } } })) base.names.set(b.id, { clientName: b.client.name, beatName: b.name });
  return { ...base, pieces: net.pieces, waitingByEmp: new Map(), doubtfulByEmp: new Map(), settled: net.settled, decreases: net.decreases };
}

/**
 * Saves the marks of the approved pieces a payroll paid or credited (`HourlyPayPiece`). A payroll for 3,000 people with 30 shifts each saves 90,000 of them, and row by row through the ORM that took 86 seconds in the
 * performance test (docs/plans/hourly-payroll-phase4c-performance-explain-back.md); one statement per 20,000 rows, from arrays passed as parameters (never built into the text), is far quicker. Marks with no
 * payroll record (a settled correction) are few and go through the ORM.
 */
export async function saveHourlyPieces(tx: Tx, rows: readonly Prisma.HourlyPayPieceCreateManyInput[]): Promise<void> {
  const withRecord = rows.filter((r) => r.recordId);
  const without = rows.filter((r) => !r.recordId);
  for (let i = 0; i < withRecord.length; i += 20_000) {
    const part = withRecord.slice(i, i + 20_000);
    await tx.$executeRaw`INSERT INTO "HourlyPayPiece" ("id", "organizationId", "runId", "recordId", "employeeId", "segmentId", "kind")
      SELECT * FROM unnest(${part.map(() => randomUUID())}::text[], ${part.map((r) => r.organizationId)}::text[], ${part.map((r) => r.runId)}::text[], ${part.map((r) => r.recordId as string)}::text[], ${part.map((r) => r.employeeId)}::text[], ${part.map((r) => r.segmentId)}::text[], ${part.map((r) => r.kind)}::"HourlyPieceKind"[])`;
  }
  if (without.length) await tx.hourlyPayPiece.createMany({ data: without });
}

/** The CURRENT names of the clients and sites of some beats: for a stored line from before the names were kept (a payslip made then shows the names as they are now). Read for ONE company. */
async function currentPlaceNames(tx: Tx, orgId: string, beatIds: string[]): Promise<Map<string, { siteName: string; clientName: string }>> {
  const beats = beatIds.length ? await tx.beat.findMany({ where: { organizationId: orgId, id: { in: beatIds } }, select: { id: true, name: true, client: { select: { name: true } } } }) : [];
  return new Map(beats.map((b) => [b.id, { siteName: b.name, clientName: b.client.name }]));
}

/**
 * The hourly pay lines of one payroll record for its payslip (phase 4c): the hours, the rate and the amount of each line as stored, with the name of the site. Read for ONE company; nothing is worked out here, so
 * the payslip can only show what the payroll paid. A record with no hourly lines (a person paid monthly) gives none.
 */
export async function loadPayslipHourly(tx: Tx, orgId: string, recordId: string): Promise<HourlyLineInput[]> {
  const lines = await tx.hourlyPayLine.findMany({ where: { organizationId: orgId, recordId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!lines.length) return [];
  const beatIds = [...new Set(lines.flatMap((l) => (l.beatId ? [l.beatId] : [])))];
  const names = await currentPlaceNames(tx, orgId, beatIds);
  return lines.map((l) => ({ siteName: l.siteName ?? (l.beatId && names.get(l.beatId)?.siteName) ?? "", clientName: l.clientName ?? (l.beatId && names.get(l.beatId)?.clientName) ?? null, dayClass: l.dayClass, minutes: l.minutes, rate: l.rate.toString(), amount: l.amount.toString() }));
}

/** The extra pay lines of one payroll record for its payslip (H14): the leave percentage as stored, with the name of the site. None for a person with no leave pay. Read for ONE company. */
export async function loadPayslipAllowances(tx: Tx, orgId: string, recordId: string): Promise<AllowanceLineInput[]> {
  const lines = await tx.hourlyAllowanceLine.findMany({ where: { organizationId: orgId, recordId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  if (!lines.length) return [];
  const beatIds = [...new Set(lines.flatMap((l) => (l.beatId ? [l.beatId] : [])))];
  const names = await currentPlaceNames(tx, orgId, beatIds);
  return lines.map((l) => ({ kind: l.kind, siteName: l.siteName ?? (l.beatId && names.get(l.beatId)?.siteName) ?? "", clientName: l.clientName ?? (l.beatId && names.get(l.beatId)?.clientName) ?? null, baseAmount: l.baseAmount === null ? null : l.baseAmount.toString(), pct: l.pct === null ? null : l.pct.toString(), amount: l.amount.toString(), minutes: l.minutes, rate: l.rate === null ? null : l.rate.toString(), dates: l.dates }));
}

/** The finding for an overpayment after a correction made once the payroll was locked: no negative pay is made, so someone enters a deduction (or the approver overrides it, with a reason). */
export function hourlyDecreaseFinding(a: { employeeId: string; label: string; periodName: string; siteName: string; decrease: Decrease; /** What the overpaid hours are worth at the rate in force that day; null when no rate applies. */ amount?: Kobo | null }): HourlyFinding {
  const d = a.decrease;
  const worth = a.amount ? ` That is about NGN ${naira(a.amount)} at the rate in force that day.` : "";
  return {
    employeeId: a.employeeId,
    category: "ATTENDANCE",
    severity: "CRITICAL",
    code: "HOURLY_PAY_DECREASED",
    message: `${a.label} was paid for ${hoursOf(d.minutes)} h more than a later correction says they worked on ${d.date} (${a.siteName}, ${d.dayClass.toLowerCase()} rate) in ${a.periodName}.${worth} No negative pay is made: enter a deduction for the overpayment (Payroll > Deductions), or override this finding with a reason. It is raised once only.`,
  };
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

