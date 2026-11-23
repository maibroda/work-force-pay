/**
 * Hourly pay, the late-approved public-holiday adjustment, PIECE A: the record and its review (docs/plans/hourly-holiday-adjustment-plan.md; the founder's confirmed decision of 2026-11-21). NO PAY is changed here.
 *
 * When a shift is approved on a public holiday that a payroll with a FINAL period (approved, locked, paid or closed) already paid as NOT WORKED, the person would be paid for the day twice. A holiday adjustment is proposed
 * automatically, ONE for each person and holiday (a unique key, so it can never be made twice): linked to the shift, who approved it and when, the original payroll run and the stored line, what was paid and how it was classified;
 * with the corrected entitlement (the hours worked that day at the holiday rate, as any worked holiday is paid) and the net difference (corrected less paid: positive, zero or negative), in whole kobo, rounded half up once.
 * A second shift the same day is added to the adjustment while it waits for review. If the original period is still OPEN there is nothing to propose: recalculating it already leaves the day out of the not-worked pay.
 *
 * A payroll reviewer (the payroll approval right) approves or rejects it, and NEVER the person who approved the shift or the person it is about; a rejection needs a reason, kept on the record and never in the audit log, which
 * holds ids and numbers only. The decision is final. The original payroll and its stored lines are never touched; applying the net difference in the next open payroll is a later piece.
 */
import type { PeriodStatus, Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { koboFromNaira, koboToString, mulDiv, subKobo, sumKobo, toKobo, type Kobo } from "@/lib/money-exact";
import type { HourlySiteInput } from "@/lib/payroll/engine";
import { naira } from "@/lib/payroll/hourly-minimum";
import { resolveHourlyRate } from "@/lib/payroll/hourly-rates";
import type { StructureDef } from "@/lib/payroll/structure";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { loadApprovedHourlyRates } from "./hourly-pay";

const FINAL_PERIOD: PeriodStatus[] = ["APPROVED", "LOCKED", "PAID", "CLOSED"];
const KIND = "HOLIDAY_NOT_WORKED" as const;

/** What the person is owed for the holiday they worked: their approved HOLIDAY-class hours of the day at the approved holiday rate of each contract, in whole kobo; null when a rate is missing. */
async function correctedEntitlement(tx: Tx, orgId: string, employeeId: string, categoryId: string, date: string): Promise<{ minutes: number; entitlement: Kobo | null; rate: string | null }> {
  const segments = await tx.timeEntrySegment.findMany({
    where: { organizationId: orgId, date: d(date), dayClass: "HOLIDAY", entry: { organizationId: orgId, employeeId, status: "APPROVED" } },
    select: { minutes: true, entry: { select: { contractId: true } } },
  });
  const minutes = segments.reduce((n, s) => n + s.minutes, 0);
  if (minutes === 0) return { minutes: 0, entitlement: null, rate: null };
  const rates = await loadApprovedHourlyRates(tx, orgId, d(date), d(date));
  const byContract = new Map<string, number>();
  for (const s of segments) byContract.set(s.entry.contractId, (byContract.get(s.entry.contractId) ?? 0) + s.minutes);
  const parts: Kobo[] = [];
  let shownRate: string | null = null;
  for (const [contractId, mins] of byContract) {
    let rate;
    try {
      rate = resolveHourlyRate(rates, { employeeId, contractId, categoryId, date: d(date) });
    } catch {
      return { minutes, entitlement: null, rate: null };
    }
    if (!rate) return { minutes, entitlement: null, rate: null };
    shownRate = String(rate.rates.holiday);
    parts.push(mulDiv(koboFromNaira(rate.rates.holiday, "The holiday rate"), mins, 60));
  }
  return { minutes, entitlement: sumKobo(parts), rate: shownRate };
}

const figures = (paid: Kobo, entitlement: Kobo | null, minutes: number) => ({ workedMinutes: minutes, originalPaid: koboToString(paid), correctedEntitlement: entitlement === null ? null : koboToString(entitlement), netDifference: entitlement === null ? null : koboToString(subKobo(entitlement, paid)) });

/**
 * Called when a time entry is approved (in the same transaction): proposes, or adds to, the holiday adjustment of each public holiday the entry worked that a payroll with a final period already paid as not worked.
 */
export async function proposeHolidayAdjustments(ctx: Ctx, tx: Tx, entry: { id: string; employeeId: string }): Promise<void> {
  const segs = await tx.timeEntrySegment.findMany({ where: { organizationId: ctx.orgId, entryId: entry.id, dayClass: "HOLIDAY" }, select: { date: true } });
  const dates = [...new Set(segs.map((s) => iso(s.date)))];
  if (!dates.length) return;
  const emp = await tx.employee.findFirst({ where: { id: entry.employeeId, organizationId: ctx.orgId }, select: { categoryId: true } });
  if (!emp) return;
  for (const date of dates) {
    // paid as not worked by a payroll of a final period, and not replaced
    const runs = await tx.payrollRun.findMany({ where: { organizationId: ctx.orgId, status: { not: "SUPERSEDED" }, period: { status: { in: FINAL_PERIOD }, startDate: { lte: d(date) }, endDate: { gte: d(date) } } }, select: { id: true } });
    if (!runs.length) continue;
    const line = await tx.hourlyAllowanceLine.findFirst({ where: { organizationId: ctx.orgId, employeeId: entry.employeeId, kind: KIND, dates: { has: date }, runId: { in: runs.map((r) => r.id) } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!line) continue;
    const paid = mulDiv(toKobo(line.amount), 1, line.dates.length || 1); // a line normally holds one day; a line of several days is shared equally
    const worked = await correctedEntitlement(tx, ctx.orgId, entry.employeeId, emp.categoryId, date);
    const existing = await tx.holidayAdjustment.findUnique({ where: { organizationId_employeeId_holidayDate: { organizationId: ctx.orgId, employeeId: entry.employeeId, holidayDate: d(date) } } });
    const net = worked.entitlement === null ? null : subKobo(worked.entitlement, paid);
    const data = {
      workedMinutes: worked.minutes,
      correctedEntitlement: worked.entitlement === null ? null : koboToString(worked.entitlement),
      netDifference: net === null ? null : koboToString(net),
      breakdown: { holidayRate: worked.rate, minutes: worked.minutes } as Prisma.InputJsonObject,
    };
    if (!existing) {
      const row = await tx.holidayAdjustment.create({
        data: {
          organizationId: ctx.orgId,
          employeeId: entry.employeeId,
          holidayDate: d(date),
          timeEntryId: entry.id,
          shiftApprovedBy: ctx.name,
          shiftApprovedByUserId: ctx.userId,
          shiftApprovedAt: new Date(),
          originalRunId: line.runId,
          originalLineId: line.id,
          originalClassification: KIND,
          originalPaid: koboToString(paid),
          ...data,
        },
      });
      await logAudit(ctx, { action: "HOLIDAY_ADJUSTMENT_PROPOSED", entity: "HolidayAdjustment", entityId: row.id, newValue: { employeeId: entry.employeeId, holiday: date, timeEntryId: entry.id, originalRunId: line.runId, originalLineId: line.id, ...figures(paid, worked.entitlement, worked.minutes) } }, tx);
    } else if (existing.status === "PROPOSED") {
      await tx.holidayAdjustment.update({ where: { id: existing.id }, data });
      await logAudit(ctx, { action: "HOLIDAY_ADJUSTMENT_UPDATED", entity: "HolidayAdjustment", entityId: existing.id, newValue: { employeeId: entry.employeeId, holiday: date, timeEntryId: entry.id, ...figures(paid, worked.entitlement, worked.minutes) } }, tx);
    }
    // an adjustment already reviewed is left as it is: a later piece deals with a shift approved after the review
  }
}

/**
 * The holiday adjustments of the company (a reader of payroll), newest first. Each one carries `nextOpenPeriod`: the open payroll period that would take it (the earliest open period after the one that paid the day as not
 * worked), or null when there is none (an approved adjustment with none is escalated).
 */
export async function listHolidayAdjustments(ctx: Ctx, filter: { status?: "PROPOSED" | "APPROVED" | "REJECTED" | "APPLIED" } = {}) {
  assertCan(ctx, "payroll.view");
  const rows = await db.holidayAdjustment.findMany({
    where: { organizationId: ctx.orgId, ...(filter.status ? { status: filter.status } : {}) },
    include: { employee: { select: { employeeNumber: true, firstName: true, middleName: true, lastName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  const ends = new Map<string, Date | null>();
  const out = [];
  for (const r of rows) {
    let next: { id: string; name: string } | null = null;
    if (r.status === "PROPOSED" || r.status === "APPROVED") {
      if (!ends.has(r.originalRunId)) ends.set(r.originalRunId, await originalPeriodEnd(db, ctx.orgId, r.originalRunId));
      const end = ends.get(r.originalRunId);
      const p = end ? await nextOpenPeriodAfter(db, ctx.orgId, end) : null;
      next = p ? { id: p.id, name: p.name } : null;
    }
    out.push({ ...r, nextOpenPeriod: next });
  }
  return out;
}

/** A payroll reviewer approves or rejects a proposed adjustment. Never the person who approved the shift or the person it is about; a rejection needs a reason; the decision is final. Changes no pay. */
export async function reviewHolidayAdjustment(ctx: Ctx, id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  assertCan(ctx, "payroll.inputs.approve");
  const adj = await db.holidayAdjustment.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!adj) throw new BusinessError("Holiday adjustment not found.");
  if (adj.status !== "PROPOSED") throw new BusinessError(`This holiday adjustment is already ${adj.status.toLowerCase()}.`);
  if (adj.shiftApprovedByUserId === ctx.userId) throw new BusinessError("You approved the shift this adjustment is about: someone else has to review it.");
  if (ctx.employeeId && ctx.employeeId === adj.employeeId) throw new BusinessError("This is your own pay: someone else has to review it.");
  if (decision === "REJECTED" && (!note || note.trim().length < 3)) throw new BusinessError("Give a reason when rejecting a holiday adjustment.");
  return db.$transaction(async (tx) => {
    const date = iso(adj.holidayDate);
    // worked out again at the moment of the decision, so the figures decided on are the current ones (another shift that day, a rate approved since)
    const emp = await tx.employee.findFirst({ where: { id: adj.employeeId, organizationId: ctx.orgId }, select: { categoryId: true } });
    const worked = emp ? await correctedEntitlement(tx, ctx.orgId, adj.employeeId, emp.categoryId, date) : { minutes: adj.workedMinutes, entitlement: null, rate: null };
    if (decision === "APPROVED" && worked.entitlement === null) throw new BusinessError("There is no approved hourly rate for the holiday on this day, so the adjustment cannot be worked out: approve the rate first.");
    const paid = toKobo(adj.originalPaid);
    const net = worked.entitlement === null ? null : subKobo(worked.entitlement, paid);
    const updated = await tx.holidayAdjustment.update({
      where: { id },
      data: {
        status: decision,
        reviewedBy: ctx.name,
        reviewedByUserId: ctx.userId,
        reviewedAt: new Date(),
        reviewNote: decision === "REJECTED" ? (note ?? "").trim() : null,
        workedMinutes: worked.minutes,
        correctedEntitlement: worked.entitlement === null ? null : koboToString(worked.entitlement),
        netDifference: net === null ? null : koboToString(net),
      },
    });
    // the audit log keeps ids and numbers only: the words of a rejection stay on the record
    await logAudit(ctx, { action: decision === "APPROVED" ? "HOLIDAY_ADJUSTMENT_APPROVED" : "HOLIDAY_ADJUSTMENT_REJECTED", entity: "HolidayAdjustment", entityId: id, newValue: { employeeId: adj.employeeId, holiday: date, timeEntryId: adj.timeEntryId, ...figures(paid, worked.entitlement, worked.minutes) } }, tx);
    return updated;
  });
}

// ─────────────── Pieces B and D: holding back the late shift, and paying the net difference in the next open payroll ───────────────

/** The earliest OPEN period after the one that paid the day as not worked (the founder's "next open payroll"); null when there is none. */
async function nextOpenPeriodAfter(tx: Tx, orgId: string, originalPeriodEnd: Date) {
  return tx.payrollPeriod.findFirst({
    where: { organizationId: orgId, startDate: { gt: originalPeriodEnd }, status: { notIn: FINAL_PERIOD } },
    orderBy: { startDate: "asc" },
    select: { id: true, name: true },
  });
}

/** The end of the period of the payroll that paid the day as not worked. */
async function originalPeriodEnd(tx: Tx, orgId: string, originalRunId: string): Promise<Date | null> {
  const run = await tx.payrollRun.findFirst({ where: { id: originalRunId, organizationId: orgId }, select: { period: { select: { endDate: true } } } });
  return run?.period.endDate ?? null;
}

/**
 * Piece D: the days (person and date) whose late shift is HELD BACK from a supplementary payroll because a holiday adjustment settles it: one waiting for review, one approved and waiting for the next open payroll, and one
 * already applied. A REJECTED adjustment holds nothing: its shift is paid by the supplementary payroll as before. Read for ONE company, for the days of one period.
 */
export async function heldShiftDays(tx: Tx, orgId: string, from: Date, to: Date): Promise<Array<{ employeeId: string; date: string; status: "PROPOSED" | "APPROVED" | "APPLIED" }>> {
  const rows = await tx.holidayAdjustment.findMany({ where: { organizationId: orgId, holidayDate: { gte: from, lte: to }, status: { in: ["PROPOSED", "APPROVED", "APPLIED"] } }, select: { employeeId: true, holidayDate: true, status: true } });
  return rows.map((r) => ({ employeeId: r.employeeId, date: iso(r.holidayDate), status: r.status as "PROPOSED" | "APPROVED" | "APPLIED" }));
}

/** Approved adjustments that no open period can take: there is no open period after the original one. A supplementary payroll raises each as a critical finding (an authorised way is needed, for example opening the next period). */
export async function escalatedAdjustments(tx: Tx, orgId: string): Promise<Array<{ id: string; employeeId: string; date: string }>> {
  const approved = await tx.holidayAdjustment.findMany({ where: { organizationId: orgId, status: "APPROVED" }, select: { id: true, employeeId: true, holidayDate: true, originalRunId: true } });
  const out: Array<{ id: string; employeeId: string; date: string }> = [];
  for (const a of approved) {
    const end = await originalPeriodEnd(tx, orgId, a.originalRunId);
    if (end && !(await nextOpenPeriodAfter(tx, orgId, end))) out.push({ id: a.id, employeeId: a.employeeId, date: iso(a.holidayDate) });
  }
  return out;
}

export interface AdjustmentFinding {
  employeeId: string;
  category: string;
  severity: "CRITICAL" | "WARNING";
  code: string;
  message: string;
}

export interface AdjustmentPayArgs {
  orgId: string;
  period: { id: string; name: string; startDate: Date; endDate: Date };
  /** The regular payroll run being calculated again: an adjustment this run already applied is paid again, so calculating twice changes nothing. */
  currentRunId?: string | null;
  structureFor: (q: { contractId: string; categoryId: string; date: string }) => StructureDef | null;
  namesOf: (beatId: string) => { clientName: string; beatName: string };
  /** The people in the payroll and their job role. */
  people: ReadonlyMap<string, { categoryId: string; label: string }>;
}

/**
 * Piece B: the approved holiday adjustments this REGULAR payroll pays. An adjustment is taken by the EARLIEST open period after the one that paid the day as not worked, once: its net difference (the corrected entitlement
 * less what was paid) is an extra pay line at the site of the shift, split by that site's salary structure like the hours. A net of zero is applied with no pay. A NET BELOW ZERO (an overpayment) is NOT recovered here (a later
 * piece): it stays approved, nothing is taken, and a critical finding says so. The caller marks the returned `toApply` as applied, with its run, when the payroll is saved. Read for ONE company.
 */
export async function loadAdjustmentPay(tx: Tx, a: AdjustmentPayArgs): Promise<{ pay: Map<string, HourlySiteInput[]>; toApply: Array<{ id: string; employeeId: string; date: string; netKobo: Kobo }>; findings: AdjustmentFinding[] }> {
  const out = { pay: new Map<string, HourlySiteInput[]>(), toApply: [] as Array<{ id: string; employeeId: string; date: string; netKobo: Kobo }>, findings: [] as AdjustmentFinding[] };
  const candidates = await tx.holidayAdjustment.findMany({
    where: { organizationId: a.orgId, OR: [{ status: "APPROVED" }, ...(a.currentRunId ? [{ status: "APPLIED" as const, appliedRunId: a.currentRunId }] : [])] },
    orderBy: [{ holidayDate: "asc" }, { id: "asc" }],
  });
  for (const adj of candidates) {
    const who = a.people.get(adj.employeeId);
    if (!who || adj.netDifference === null) continue;
    const date = iso(adj.holidayDate);
    const again = adj.status === "APPLIED"; // this run applied it: pay it again so a recalculation is the same
    if (!again) {
      const end = await originalPeriodEnd(tx, a.orgId, adj.originalRunId);
      const next = end ? await nextOpenPeriodAfter(tx, a.orgId, end) : null;
      if (!next || next.id !== a.period.id) continue; // not this period's turn: the earliest open period after the original takes it
    }
    const net = toKobo(adj.netDifference);
    if (net < 0) {
      out.findings.push({ employeeId: adj.employeeId, category: "DEDUCTIONS", severity: "CRITICAL", code: "HOLIDAY_ADJUSTMENT_RECOVERY_PENDING", message: `${who.label} was paid more for the public holiday on ${date} (as a day not worked) than the shift they worked that day is worth: about NGN ${naira(subKobo(0 as Kobo, net))} too much. Recovering an overpayment from pay is not available yet, so the holiday adjustment stays approved and nothing is taken: enter a deduction by hand if it is to be recovered.` });
      continue;
    }
    if (net === 0) {
      if (!again) out.toApply.push({ id: adj.id, employeeId: adj.employeeId, date, netKobo: net });
      continue; // nothing to pay
    }
    const entry = await tx.timeEntry.findFirst({ where: { id: adj.timeEntryId, organizationId: a.orgId }, select: { beatId: true, contractId: true, clientId: true } });
    if (!entry) continue;
    const structure = a.structureFor({ contractId: entry.contractId, categoryId: who.categoryId, date });
    if (!structure) {
      out.findings.push({ employeeId: adj.employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "HOLIDAY_ADJUSTMENT_NO_STRUCTURE", message: `${who.label} is owed NGN ${naira(net)} for the public holiday on ${date} (a holiday adjustment) at a site with no salary structure, so it is not paid. Set up a structure and calculate again.` });
      continue;
    }
    if (!again) out.toApply.push({ id: adj.id, employeeId: adj.employeeId, date, netKobo: net });
    const names = a.namesOf(entry.beatId);
    const site: HourlySiteInput = {
      key: `${entry.beatId}|${entry.contractId}|${structure.id}`,
      clientId: entry.clientId,
      clientName: names.clientName,
      contractId: entry.contractId,
      beatId: entry.beatId,
      beatName: names.beatName,
      structure,
      from: date,
      to: date,
      dates: [],
      lines: [],
      allowances: [{ kind: "HOLIDAY_ADJUSTMENT", amountKobo: net, minutes: adj.workedMinutes, dates: [date], breakdown: { adjustmentId: adj.id, holiday: date, originalPaid: koboToString(toKobo(adj.originalPaid)), correctedEntitlement: adj.correctedEntitlement === null ? null : koboToString(toKobo(adj.correctedEntitlement)), netDifference: koboToString(net) } }],
    };
    out.pay.set(adj.employeeId, [...(out.pay.get(adj.employeeId) ?? []), site]);
  }
  return out;
}

/** The pay run marks the adjustments it paid as APPLIED (once), with the run and the time, and audits each one. A recalculation finds them already applied and does nothing more. */
export async function markAdjustmentsApplied(ctx: Ctx, tx: Tx, runId: string, applied: ReadonlyArray<{ id: string; employeeId: string; date: string; netKobo: Kobo }>): Promise<void> {
  for (const x of applied) {
    const done = await tx.holidayAdjustment.updateMany({ where: { id: x.id, organizationId: ctx.orgId, status: "APPROVED" }, data: { status: "APPLIED", appliedRunId: runId, appliedAt: new Date() } });
    if (done.count === 1) await logAudit(ctx, { action: "HOLIDAY_ADJUSTMENT_APPLIED", entity: "HolidayAdjustment", entityId: x.id, newValue: { employeeId: x.employeeId, holiday: x.date, runId, netDifference: koboToString(x.netKobo) } }, tx);
  }
}
