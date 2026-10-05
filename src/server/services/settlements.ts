/**
 * End-of-service settlement. For an approved exit it works out what's owed on top of the final
 * month's pay (unused leave, gratuity, severance, notice pay / recovery) from the organization's
 * HR policy, lets HR/payroll add manual lines (loan recovery, unreturned property, ex-gratia),
 * then runs it through review: prepared → submitted → approved (a different person, with the
 * clearance checklist done) → released.
 *
 * "Release" doesn't pay anyone directly. It creates approved OtherEarning / Deduction rows in the
 * payroll period containing the last working date, so PAYE, pension, the payslip, payment batches
 * and GL posting all happen in the normal payroll run — or a supplementary run if that period is
 * already locked. The settlement never touches money outside payroll.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { computeSettlementLines, settlementTotals } from "@/lib/eos";
import { num, round2 } from "@/lib/money";
import { assertCan, BusinessError, db, toJson, type Tx } from "./_base";
import { logAudit } from "./audit";
import { eosPolicyOf, getHrPolicy } from "./hr-policy";
import { outstandingKitValue } from "./inventory";
import { getLeavePolicy } from "./leave";
import { employeeLoanBalances } from "./loans";
import { nextNumber } from "./numbering";

const DEDUCTION_CODES = ["LOAN", "SALARY_ADVANCE", "RECOVERY", "PENALTY", "OTHER"] as const;

export const prepareOverridesSchema = z.object({
  monthlyGrossOverride: z.coerce.number().positive().optional(),
  monthlyBasicOverride: z.coerce.number().positive().optional(),
});

/** What monthly pay the formulas should use, and where it came from. */
async function payReference(
  ctx: Ctx,
  employeeId: string,
  lastWorkingDate: Date,
  ov: z.output<typeof prepareOverridesSchema>,
) {
  const notes: string[] = [];
  let monthlyGross = 0;
  let basicShare = 1;
  let source = "";
  if (ov.monthlyGrossOverride) {
    monthlyGross = ov.monthlyGrossOverride;
    source = "Entered manually";
  } else {
    const rec = await db.payrollRecord.findFirst({
      where: {
        organizationId: ctx.orgId,
        employeeId,
        monthlyGross: { gt: 0 },
        run: { type: "REGULAR", status: { not: "SUPERSEDED" } },
      },
      include: { run: { include: { period: true } } },
      orderBy: { run: { period: { endDate: "desc" } } },
    });
    if (rec) {
      monthlyGross = num(rec.monthlyGross);
      const basic = (rec.lines as Array<{ type: string; code: string; amount: number }>).find(
        (l) => l.type === "EARNING" && l.code === "BASIC",
      );
      const earned = num(rec.earnedGross);
      if (basic && earned > 0) basicShare = num(basic.amount) / earned;
      else notes.push("Basic pay couldn't be read from the latest payslip — gross is used for basic-based formulas.");
      source = `Latest payroll (${rec.run.period.name}) contractual gross`;
    } else {
      const rate = await db.employeePayRate.findFirst({
        where: {
          organizationId: ctx.orgId,
          employeeId,
          effectiveFrom: { lte: lastWorkingDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: lastWorkingDate } }],
        },
        orderBy: { effectiveFrom: "desc" },
      });
      if (rate) {
        monthlyGross = num(rate.monthlyGross);
        source = "Personal pay rate in force at the last working date";
        notes.push("No payroll history — basic pay is unknown, so gross is used for basic-based formulas.");
      }
    }
  }
  if (!monthlyGross)
    throw new BusinessError("No pay reference was found for this employee — enter their monthly gross pay manually.");
  if (ov.monthlyBasicOverride) {
    if (ov.monthlyBasicOverride > monthlyGross) throw new BusinessError("Basic pay can't exceed gross pay.");
    basicShare = ov.monthlyBasicOverride / monthlyGross;
    source += "; basic entered manually";
  }
  return { monthlyGross, basicShare, source, notes };
}

async function recomputeTotals(tx: Tx, settlementId: string) {
  const lines = await tx.exitSettlementLine.findMany({ where: { settlementId } });
  const t = settlementTotals(lines.map((l) => ({ kind: l.kind, amount: num(l.amount) })));
  return tx.exitSettlement.update({ where: { id: settlementId }, data: t });
}

/** Creates the settlement for an approved exit, or recomputes its system lines while it's still a draft. */
export async function prepareSettlement(
  ctx: Ctx,
  exitRecordId: string,
  rawOverrides: z.input<typeof prepareOverridesSchema> = {},
) {
  assertCan(ctx, "settlement.manage");
  const exit = await db.exitRecord.findFirst({
    where: { id: exitRecordId, organizationId: ctx.orgId },
    include: { employee: true, settlement: true },
  });
  if (!exit) throw new BusinessError("Exit record not found.");
  if (exit.status !== "APPROVED") throw new BusinessError("Approve the exit before preparing its settlement.");
  const existing = exit.settlement;
  if (existing && !["DRAFT", "CANCELLED"].includes(existing.status))
    throw new BusinessError(`This settlement is already ${existing.status.replace(/_/g, " ").toLowerCase()} and can't be recomputed.`);

  const previous = (existing?.calcTrace as { overrides?: z.input<typeof prepareOverridesSchema> } | null)?.overrides;
  const ov = prepareOverridesSchema.parse(Object.keys(rawOverrides).length ? rawOverrides : (previous ?? {}));
  const emp = exit.employee;
  const [policy, leavePolicy, pay, leave] = await Promise.all([
    getHrPolicy(ctx.orgId),
    getLeavePolicy(ctx.orgId),
    payReference(ctx, emp.id, exit.lastWorkingDate, ov),
    db.leaveRequest.findMany({
      where: { organizationId: ctx.orgId, employeeId: emp.id, status: "APPROVED" },
      select: { cycleStart: true, workingDays: true },
    }),
  ]);
  const eosPolicy = eosPolicyOf(policy);
  const res = computeSettlementLines(
    {
      exitType: exit.exitType,
      reasonCategory: exit.reasonCategory,
      summaryDismissal: exit.summaryDismissal,
      employmentDate: emp.employmentDate,
      noticeDate: exit.noticeDate,
      lastWorkingDate: exit.lastWorkingDate,
      noticeRequiredDays: exit.noticePeriodDays ?? policy.defaultNoticeDays,
      monthlyGross: pay.monthlyGross,
      basicShare: pay.basicShare,
      annualLeaveDays: leavePolicy.annualDays,
      leaveEligibilityMonths: leavePolicy.eligibilityMonths,
      approvedLeave: leave,
    },
    eosPolicy,
  );
  const trace = toJson({
    overrides: ov,
    payBasis: { source: pay.source, monthlyGross: pay.monthlyGross, basicShare: round2(pay.basicShare * 10000) / 10000 },
    rules: eosPolicy,
    notes: [...pay.notes, ...res.notes],
  });

  return db.$transaction(async (tx) => {
    const data = {
      status: "DRAFT" as const,
      monthlyGross: pay.monthlyGross,
      monthlyBasic: res.monthlyBasic,
      dailyRate: res.dailyRate,
      payBasisSource: pay.source,
      serviceDays: res.serviceDays,
      serviceYears: res.serviceYears,
      leaveAccruedDays: res.leaveAccruedDays,
      leaveTakenDays: res.leaveTakenDays,
      leavePayableDays: res.leavePayableDays,
      noticeRequiredDays: res.noticeRequiredDays,
      noticeServedDays: res.noticeServedDays,
      noticeShortfallDays: res.noticeShortfallDays,
      calcTrace: trace,
      computedAt: new Date(),
      preparedBy: ctx.name,
      preparedById: ctx.userId,
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
      remarks: null,
    };
    const s = existing
      ? await tx.exitSettlement.update({ where: { id: existing.id }, data })
      : await tx.exitSettlement.create({
          data: {
            ...data,
            organizationId: ctx.orgId,
            settlementNumber: await nextNumber(tx, ctx.orgId, "SETTLEMENT"),
            exitRecordId: exit.id,
            employeeId: emp.id,
          },
        });
    await tx.exitSettlementLine.deleteMany({ where: { settlementId: s.id, manual: false } });
    if (res.lines.length)
      await tx.exitSettlementLine.createMany({
        data: res.lines.map((l, i) => ({
          organizationId: ctx.orgId,
          settlementId: s.id,
          kind: l.kind,
          code: l.code,
          description: l.description,
          quantity: l.quantity,
          rate: l.rate,
          amount: l.amount,
          taxable: l.taxable,
          sortOrder: i,
        })),
      });
    const out = await recomputeTotals(tx, s.id);
    await logAudit(
      ctx,
      {
        action: existing ? "SETTLEMENT_RECOMPUTE" : "SETTLEMENT_PREPARE",
        entity: "ExitSettlement",
        entityId: s.id,
        newValue: { number: s.settlementNumber, lines: res.lines.length, gross: out.grossEarnings, deductions: out.totalDeductions },
      },
      tx,
    );
    return out;
  });
}

export const manualLineSchema = z.object({
  kind: z.enum(["EARNING", "DEDUCTION"]),
  code: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toUpperCase().replace(/\s+/g, "_") : undefined)),
  description: z.string().trim().min(3, "Describe the line"),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  taxable: z.boolean().default(true),
});

async function loadSettlement(ctx: Ctx, id: string) {
  const s = await db.exitSettlement.findFirst({ where: { id, organizationId: ctx.orgId }, include: { exitRecord: true, employee: true } });
  if (!s) throw new BusinessError("Settlement not found.");
  return s;
}

const draftOnly = (s: { status: string }) => {
  if (s.status !== "DRAFT") throw new BusinessError(`This settlement is ${s.status.replace(/_/g, " ").toLowerCase()} — lines can only change while it's a draft.`);
};

/** Loan recovery, unreturned property, ex-gratia payment… anything the policy can't know about. */
export async function addManualLine(ctx: Ctx, settlementId: string, raw: z.input<typeof manualLineSchema>) {
  assertCan(ctx, "settlement.manage");
  const v = manualLineSchema.parse(raw);
  const s = await loadSettlement(ctx, settlementId);
  draftOnly(s);
  const code = v.code ?? (v.kind === "EARNING" ? "EX_GRATIA" : "RECOVERY");
  if (v.kind === "DEDUCTION" && !(DEDUCTION_CODES as readonly string[]).includes(code))
    throw new BusinessError(`A recovery must be one of: ${DEDUCTION_CODES.map((c) => c.replace(/_/g, " ").toLowerCase()).join(", ")}.`);
  return db.$transaction(async (tx) => {
    const max = await tx.exitSettlementLine.aggregate({ where: { settlementId }, _max: { sortOrder: true } });
    const line = await tx.exitSettlementLine.create({
      data: {
        organizationId: ctx.orgId,
        settlementId,
        kind: v.kind,
        code,
        description: v.description,
        amount: v.amount,
        taxable: v.kind === "EARNING" ? v.taxable : false,
        manual: true,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    await recomputeTotals(tx, settlementId);
    await logAudit(ctx, { action: "SETTLEMENT_LINE_ADD", entity: "ExitSettlement", entityId: settlementId, newValue: line }, tx);
    return line;
  });
}

/** Adds the value of uniform & kit the leaver still holds as a recovery — one click instead of working it out by hand. */
export async function addKitRecovery(ctx: Ctx, settlementId: string) {
  assertCan(ctx, "settlement.manage");
  const s = await loadSettlement(ctx, settlementId);
  draftOnly(s);
  const held = await outstandingKitValue(ctx.orgId, s.employeeId);
  if (!held.items) throw new BusinessError("This employee isn't holding any uniform or kit.");
  if (held.value <= 0) throw new BusinessError("The kit this employee holds has no recorded value, so there's nothing to recover.");
  const existing = await db.exitSettlementLine.findFirst({
    where: { settlementId, manual: true, description: { startsWith: "Unreturned uniform & kit" } },
  });
  if (existing) throw new BusinessError("A kit recovery is already on this settlement — remove it first to add it again.");
  return addManualLine(ctx, settlementId, {
    kind: "DEDUCTION",
    code: "RECOVERY",
    description: `Unreturned uniform & kit — ${held.items} item(s)`,
    amount: held.value,
    taxable: false,
  });
}

/**
 * Recovers what the leaver still owes on staff loans and advances — one recovery line per loan, for
 * the part not already queued in payroll. On release each line becomes a deduction that is recorded
 * against its loan, so the loan's balance falls when that payroll is locked.
 */
export async function addLoanRecovery(ctx: Ctx, settlementId: string) {
  assertCan(ctx, "settlement.manage");
  const s = await loadSettlement(ctx, settlementId);
  draftOnly(s);
  const owing = (await employeeLoanBalances(ctx.orgId, s.employeeId)).filter((l) => l.unscheduled > 0);
  if (!owing.length) throw new BusinessError("This employee has no loan balance left to recover (anything outstanding is already queued in payroll).");
  const already = await db.exitSettlementLine.findMany({ where: { settlementId, loanId: { in: owing.map((l) => l.id) } }, select: { loanId: true } });
  const todo = owing.filter((l) => !already.some((a) => a.loanId === l.id));
  if (!todo.length) throw new BusinessError("Every outstanding loan is already on this settlement.");
  return db.$transaction(async (tx) => {
    const max = await tx.exitSettlementLine.aggregate({ where: { settlementId }, _max: { sortOrder: true } });
    let order = (max._max.sortOrder ?? -1) + 1;
    const lines = [];
    for (const l of todo)
      lines.push(
        await tx.exitSettlementLine.create({
          data: {
            organizationId: ctx.orgId,
            settlementId,
            kind: "DEDUCTION",
            code: l.type === "SALARY_ADVANCE" ? "SALARY_ADVANCE" : "LOAN",
            description: `${l.type === "SALARY_ADVANCE" ? "Salary advance" : "Staff loan"} ${l.loanNumber} — balance`,
            amount: l.unscheduled,
            taxable: false,
            manual: true,
            loanId: l.id,
            sortOrder: order++,
          },
        }),
      );
    await recomputeTotals(tx, settlementId);
    await logAudit(ctx, { action: "SETTLEMENT_LOAN_RECOVERY", entity: "ExitSettlement", entityId: settlementId, newValue: { loans: todo.map((l) => l.loanNumber) } }, tx);
    return lines;
  });
}

export async function removeManualLine(ctx: Ctx, lineId: string) {
  assertCan(ctx, "settlement.manage");
  const line = await db.exitSettlementLine.findFirst({ where: { id: lineId, organizationId: ctx.orgId }, include: { settlement: true } });
  if (!line) throw new BusinessError("Settlement line not found.");
  draftOnly(line.settlement);
  if (!line.manual) throw new BusinessError("Policy-calculated lines can't be deleted — change the HR policy or the exit details and recompute.");
  await db.$transaction(async (tx) => {
    await tx.exitSettlementLine.delete({ where: { id: lineId } });
    await recomputeTotals(tx, line.settlementId);
    await logAudit(ctx, { action: "SETTLEMENT_LINE_REMOVE", entity: "ExitSettlement", entityId: line.settlementId, oldValue: line }, tx);
  });
}

export async function submitSettlement(ctx: Ctx, id: string) {
  assertCan(ctx, "settlement.manage");
  const s = await loadSettlement(ctx, id);
  draftOnly(s);
  const lines = await db.exitSettlementLine.count({ where: { settlementId: id } });
  if (!lines) throw new BusinessError("There is nothing to settle — no earnings or recoveries. Cancel the settlement instead.");
  const u = await db.exitSettlement.update({ where: { id }, data: { status: "PENDING_APPROVAL", submittedAt: new Date() } });
  await logAudit(ctx, { action: "SETTLEMENT_SUBMIT", entity: "ExitSettlement", entityId: id, newValue: { number: s.settlementNumber } });
  return u;
}

/** Clearance steps that must be done before the money is approved. */
async function outstandingClearance(orgId: string, exitRecordId: string) {
  const tasks = await db.exitTask.findMany({
    where: { organizationId: orgId, exitRecordId, status: "PENDING", mandatory: true, blocksSettlement: true },
    orderBy: { sortOrder: "asc" },
  });
  return tasks.map((t) => t.taskName);
}

export async function approveSettlement(ctx: Ctx, id: string) {
  assertCan(ctx, "settlement.approve");
  const s = await loadSettlement(ctx, id);
  if (s.status !== "PENDING_APPROVAL") throw new BusinessError(`This settlement is ${s.status.replace(/_/g, " ").toLowerCase()}, not awaiting approval.`);
  if (s.preparedById === ctx.userId) throw new BusinessError("You prepared this settlement — someone else must approve it.");
  const outstanding = await outstandingClearance(ctx.orgId, s.exitRecordId);
  if (outstanding.length)
    throw new BusinessError(`Clearance isn't finished — still outstanding: ${outstanding.join("; ")}. Complete or waive each step first.`);
  return db.$transaction(async (tx) => {
    const u = await tx.exitSettlement.update({ where: { id }, data: { status: "APPROVED", approvedBy: ctx.name, approvedAt: new Date() } });
    await tx.exitTask.updateMany({
      where: { exitRecordId: s.exitRecordId, systemKey: "FINAL_SETTLEMENT", status: "PENDING" },
      data: { status: "DONE", completedBy: ctx.name, completedAt: new Date() },
    });
    await logAudit(ctx, { action: "SETTLEMENT_APPROVE", entity: "ExitSettlement", entityId: id, newValue: { number: s.settlementNumber, net: num(s.netSettlement) } }, tx);
    return u;
  });
}

export async function returnSettlement(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "settlement.approve");
  if (!reason || reason.trim().length < 3) throw new BusinessError("Say what needs to change.");
  const s = await loadSettlement(ctx, id);
  if (s.status !== "PENDING_APPROVAL") throw new BusinessError("Only a settlement awaiting approval can be sent back.");
  const u = await db.exitSettlement.update({ where: { id }, data: { status: "DRAFT", submittedAt: null, remarks: reason.trim() } });
  await logAudit(ctx, { action: "SETTLEMENT_RETURN", entity: "ExitSettlement", entityId: id, reason });
  return u;
}

export async function cancelSettlement(ctx: Ctx, id: string, reason: string) {
  if (!reason || reason.trim().length < 3) throw new BusinessError("Give a reason for cancelling.");
  const s = await loadSettlement(ctx, id);
  try {
    assertCan(ctx, "settlement.manage");
  } catch {
    assertCan(ctx, "settlement.approve");
  }
  if (s.status === "RELEASED")
    throw new BusinessError("This settlement has already been released into payroll — correct it with a payroll adjustment (arrears or a deduction) instead.");
  if (s.status === "CANCELLED") throw new BusinessError("This settlement is already cancelled.");
  return db.$transaction(async (tx) => {
    const u = await tx.exitSettlement.update({ where: { id }, data: { status: "CANCELLED", remarks: reason.trim() } });
    if (s.status === "APPROVED")
      await tx.exitTask.updateMany({
        where: { exitRecordId: s.exitRecordId, systemKey: "FINAL_SETTLEMENT", status: "DONE" },
        data: { status: "PENDING", completedBy: null, completedAt: null },
      });
    await logAudit(ctx, { action: "SETTLEMENT_CANCEL", entity: "ExitSettlement", entityId: id, reason }, tx);
    return u;
  });
}

/** The payroll period a settlement must be released into: the one containing the last working date. */
export async function releasePeriodFor(ctx: Ctx, exitRecordId: string) {
  const exit = await db.exitRecord.findFirst({ where: { id: exitRecordId, organizationId: ctx.orgId } });
  if (!exit) return null;
  return db.payrollPeriod.findFirst({
    where: { organizationId: ctx.orgId, startDate: { lte: exit.lastWorkingDate }, endDate: { gte: exit.lastWorkingDate } },
  });
}

const LOCKED = ["LOCKED", "PAID", "CLOSED"];

export async function releaseSettlement(ctx: Ctx, id: string, periodId: string) {
  assertCan(ctx, "settlement.approve");
  const s = await loadSettlement(ctx, id);
  if (s.status !== "APPROVED") throw new BusinessError("Only an approved settlement can be released into payroll.");
  const period = await db.payrollPeriod.findFirst({ where: { id: periodId, organizationId: ctx.orgId } });
  if (!period) throw new BusinessError("Payroll period not found.");
  const lwd = s.exitRecord.lastWorkingDate;
  // An exited employee only appears in the payroll for the period they last worked in.
  if (lwd < period.startDate || lwd > period.endDate)
    throw new BusinessError(`${s.employee.employeeNumber}'s last working day is ${iso(lwd)} — release into the payroll period that contains it.`);
  if (period.status === "APPROVED")
    throw new BusinessError(`${period.name} payroll is approved but not yet locked — lock it first (the settlement then goes in a supplementary run), or return it for recalculation.`);
  const lines = await db.exitSettlementLine.findMany({ where: { settlementId: id }, orderBy: { sortOrder: "asc" } });
  if (!lines.length) throw new BusinessError("This settlement has no lines.");

  return db.$transaction(async (tx) => {
    for (const l of lines) {
      if (l.kind === "EARNING") {
        const e = await tx.otherEarning.create({
          data: {
            organizationId: ctx.orgId,
            employeeId: s.employeeId,
            periodId,
            name: `End of service — ${l.description}`,
            amount: l.amount,
            taxable: l.taxable,
            reason: `Settlement ${s.settlementNumber}`,
            approvedBy: ctx.name,
            status: "APPROVED",
          },
        });
        await tx.exitSettlementLine.update({ where: { id: l.id }, data: { otherEarningId: e.id } });
      } else {
        const type = (DEDUCTION_CODES as readonly string[]).includes(l.code) ? l.code : l.code === "NOTICE_RECOVERY" ? "RECOVERY" : "OTHER";
        const ded = await tx.deduction.create({
          data: {
            organizationId: ctx.orgId,
            employeeId: s.employeeId,
            deductionType: type as never,
            amount: l.amount,
            periodId,
            reason: l.description,
            authorityReference: s.settlementNumber,
            requestedBy: s.preparedBy,
            approvedBy: ctx.name,
            status: "APPROVED",
          },
        });
        await tx.exitSettlementLine.update({ where: { id: l.id }, data: { deductionId: ded.id } });
        // A loan recovery is also an instalment of that loan, repaid once this payroll is locked.
        if (l.loanId)
          await tx.loanInstallment.create({
            data: { organizationId: ctx.orgId, loanId: l.loanId, kind: "SETTLEMENT", amount: l.amount, deductionId: ded.id, periodId, createdBy: ctx.name },
          });
      }
    }
    const u = await tx.exitSettlement.update({
      where: { id },
      data: { status: "RELEASED", payrollPeriodId: periodId, releasedBy: ctx.name, releasedAt: new Date() },
    });
    await logAudit(
      ctx,
      { action: "SETTLEMENT_RELEASE", entity: "ExitSettlement", entityId: id, newValue: { number: s.settlementNumber, period: period.name, lines: lines.length } },
      tx,
    );
    return { settlement: u, route: LOCKED.includes(period.status) ? ("supplementary" as const) : ("regular" as const), periodName: period.name };
  });
}

// ───────────────────────────── Queries ─────────────────────────────

export async function listSettlements(ctx: Ctx, f: { status?: string } = {}) {
  assertCan(ctx, "payroll.view");
  return db.exitSettlement.findMany({
    where: { organizationId: ctx.orgId, ...(f.status ? { status: f.status as never } : {}) },
    include: { employee: true, exitRecord: true, payrollPeriod: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function getSettlement(ctx: Ctx, id: string) {
  assertCan(ctx, "payroll.view");
  const s = await db.exitSettlement.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      employee: { include: { category: true } },
      exitRecord: { include: { tasks: { orderBy: { sortOrder: "asc" } } } },
      payrollPeriod: true,
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!s) return null;
  const earningIds = s.lines.map((l) => l.otherEarningId).filter((x): x is string => Boolean(x));
  const deductionIds = s.lines.map((l) => l.deductionId).filter((x): x is string => Boolean(x));
  const [earnings, deductions, period] = await Promise.all([
    earningIds.length ? db.otherEarning.findMany({ where: { id: { in: earningIds } }, select: { status: true } }) : [],
    deductionIds.length ? db.deduction.findMany({ where: { id: { in: deductionIds } }, select: { status: true } }) : [],
    releasePeriodFor(ctx, s.exitRecordId),
  ]);
  const linked = [...earnings, ...deductions];
  return {
    ...s,
    paidThroughPayroll: linked.length > 0 && linked.every((x) => x.status === "PROCESSED"),
    suggestedPeriod: period,
    outstandingClearance: await outstandingClearance(ctx.orgId, s.exitRecordId),
    heldKit: await outstandingKitValue(ctx.orgId, s.employeeId),
    owingLoans: (await employeeLoanBalances(ctx.orgId, s.employeeId)).filter((l) => l.unscheduled > 0),
  };
}

export async function settlementForExit(ctx: Ctx, exitRecordId: string) {
  assertCan(ctx, "payroll.view");
  return db.exitSettlement.findFirst({ where: { exitRecordId, organizationId: ctx.orgId } });
}

