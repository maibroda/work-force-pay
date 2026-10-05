/**
 * Staff loans & salary advances — interest-free money lent to an employee and repaid from payroll.
 *
 * Request → approve (a different person; this is when the money is paid out and the GL is posted) →
 * repay. Repayments are *scheduled* into a payroll period as approved LOAN / SALARY_ADVANCE
 * deductions, so the existing payroll run takes them — no engine change — and a repayment counts as
 * repaid once that payroll is locked. Cash paid straight to the company, and the balance recovered on
 * an end-of-service settlement, are recorded the same way. Affordability limits come from HrPolicy.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { checkLoanLimits, installmentFor, loanPosition, monthIndex, nextMonth } from "@/lib/loans";
import { num, round2 } from "@/lib/money";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { postLoanCashRepayment, postLoanDisbursement, postLoanWriteOff } from "./gl-posting";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { nextNumber } from "./numbering";

const CURRENT = ["ACTIVE", "ON_LEAVE"];
const GONE = ["EXITED", "TERMINATED", "RESIGNED"];
const OPEN_PERIOD = ["OPEN", "PROCESSING", "PENDING_VALIDATION", "PENDING_APPROVAL"];

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

/** The monthly pay a loan is measured against: latest payroll's contractual gross, else the personal pay rate. */
async function monthlyGrossFor(orgId: string, employeeId: string): Promise<number | null> {
  const rec = await db.payrollRecord.findFirst({
    where: { organizationId: orgId, employeeId, monthlyGross: { gt: 0 }, run: { type: "REGULAR", status: { not: "SUPERSEDED" } } },
    orderBy: { run: { period: { endDate: "desc" } } },
    select: { monthlyGross: true },
  });
  if (rec) return num(rec.monthlyGross);
  const today = todayUtc();
  const rate = await db.employeePayRate.findFirst({
    where: { organizationId: orgId, employeeId, effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] },
    orderBy: { effectiveFrom: "desc" },
    select: { monthlyGross: true },
  });
  return rate ? num(rate.monthlyGross) : null;
}

type LoanWithInstallments = Awaited<ReturnType<typeof loadWithInstallments>>[number];

async function loadWithInstallments(orgId: string, where: Record<string, unknown>) {
  return db.staffLoan.findMany({
    where: { organizationId: orgId, ...where },
    include: { employee: true, installments: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Attaches each loan's worked-out balance (the status of every deduction behind its instalments is read fresh). */
async function withPositions(loans: LoanWithInstallments[]) {
  const ids = loans.flatMap((l) => l.installments.map((i) => i.deductionId).filter((x): x is string => Boolean(x)));
  const deductions = ids.length ? await db.deduction.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }) : [];
  const status = new Map(deductions.map((x) => [x.id, x.status as string]));
  return loans.map((l) => {
    const items = l.installments.map((i) => ({
      kind: i.kind,
      amount: num(i.amount),
      deductionStatus: i.deductionId ? (status.get(i.deductionId) ?? null) : null,
    }));
    const pos = loanPosition(num(l.principal), items);
    const live = l.status === "ACTIVE";
    return {
      ...l,
      ...pos,
      deductionStatus: status,
      effectiveStatus: live && pos.outstanding === 0 ? ("COMPLETED" as const) : l.status,
    };
  });
}

// ───────────────────────────── Request / decide ─────────────────────────────

export const loanSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum(["LOAN", "SALARY_ADVANCE"]).default("LOAN"),
  principal: z.coerce.number().positive("Amount must be greater than zero"),
  installmentCount: z.coerce.number().int().min(1).max(60).optional(),
  firstDeductionYear: z.coerce.number().int().min(2000).max(2200).optional(),
  firstDeductionMonth: z.coerce.number().int().min(1).max(12).optional(),
  reason: z.string().trim().min(3, "Give a reason"),
});

export async function requestLoan(ctx: Ctx, raw: z.input<typeof loanSchema>) {
  assertCan(ctx, "loan.manage");
  const v = loanSchema.parse(raw);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (!CURRENT.includes(emp.status)) throw new BusinessError(`${emp.employeeNumber} isn't a current employee — loans are only for staff still employed.`);

  const count = v.type === "SALARY_ADVANCE" ? 1 : (v.installmentCount ?? 1);
  const next = nextMonth(todayUtc());
  const first = { year: v.firstDeductionYear ?? next.year, month: v.firstDeductionMonth ?? next.month };
  const today = todayUtc();
  if (monthIndex(first.year, first.month) < monthIndex(today.getUTCFullYear(), today.getUTCMonth() + 1))
    throw new BusinessError("The first repayment can't be in a month that has already passed.");
  const installment = installmentFor(v.principal, count);

  // Affordability: measured against monthly pay, counting what the employee already owes on loans of this type.
  const policy = await getHrPolicy(ctx.orgId);
  const limits = {
    loanMaxGrossMultiple: num(policy.loanMaxGrossMultiple),
    loanMaxDeductionPct: policy.loanMaxDeductionPct,
    advanceMaxGrossPct: policy.advanceMaxGrossPct,
  };
  const applicable = v.type === "LOAN" ? limits.loanMaxGrossMultiple > 0 || limits.loanMaxDeductionPct > 0 : limits.advanceMaxGrossPct > 0;
  if (applicable) {
    const gross = await monthlyGrossFor(ctx.orgId, emp.id);
    if (gross === null)
      throw new BusinessError(`${emp.employeeNumber} has no payroll history or personal pay rate yet, so the affordability limits can't be checked — they can borrow after their first payroll.`);
    const others = await withPositions(await loadWithInstallments(ctx.orgId, { employeeId: emp.id, type: v.type, status: { in: ["PENDING_APPROVAL", "ACTIVE"] } }));
    const existingOutstanding = others.reduce((s, l) => s + (l.status === "PENDING_APPROVAL" ? num(l.principal) : l.outstanding), 0);
    const existingInstallments = others.filter((l) => l.status === "PENDING_APPROVAL" || l.outstanding > 0).reduce((s, l) => s + num(l.installmentAmount), 0);
    const breach = checkLoanLimits({ type: v.type, principal: v.principal, installment, monthlyGross: gross, existingOutstanding, existingInstallments }, limits);
    if (breach) throw new BusinessError(breach);
  }

  return db.$transaction(async (tx) => {
    const loanNumber = await nextNumber(tx, ctx.orgId, "LOAN");
    const loan = await tx.staffLoan.create({
      data: {
        organizationId: ctx.orgId,
        loanNumber,
        employeeId: emp.id,
        type: v.type,
        principal: v.principal,
        installmentCount: count,
        installmentAmount: installment,
        firstDeductionYear: first.year,
        firstDeductionMonth: first.month,
        reason: v.reason,
        requestedBy: ctx.name,
        requestedById: ctx.userId,
      },
    });
    await logAudit(ctx, { action: "LOAN_REQUEST", entity: "Employee", entityId: emp.id, newValue: { loanNumber, type: v.type, principal: v.principal, installments: count } }, tx);
    return loan;
  });
}

async function loadLoan(ctx: Ctx, id: string) {
  const loan = await db.staffLoan.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!loan) throw new BusinessError("Loan not found.");
  return loan;
}

const label = (l: { type: string }) => (l.type === "SALARY_ADVANCE" ? "advance" : "loan");

/** Approval is the authority to pay out — the cash leg is posted to the GL here. */
export async function approveLoan(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "loan.approve");
  const loan = await loadLoan(ctx, id);
  if (loan.status !== "PENDING_APPROVAL") throw new BusinessError(`This ${label(loan)} is already ${loan.status.replace(/_/g, " ").toLowerCase()}.`);
  if (loan.requestedById === ctx.userId) throw new BusinessError(`You requested this ${label(loan)} — someone else must approve it.`);
  const emp = await db.employee.findFirstOrThrow({ where: { id: loan.employeeId } });
  if (!CURRENT.includes(emp.status)) throw new BusinessError(`${emp.employeeNumber} is no longer a current employee.`);
  const disbursedOn = todayUtc();
  return db.$transaction(async (tx) => {
    const u = await tx.staffLoan.update({
      where: { id },
      data: { status: "ACTIVE", approvedBy: ctx.name, approvedAt: new Date(), decisionNote: note?.trim() || null, disbursedOn },
    });
    await postLoanDisbursement(ctx, tx, { loanNumber: u.loanNumber, type: u.type, principal: u.principal, disbursedOn });
    await logAudit(ctx, { action: "LOAN_APPROVE", entity: "Employee", entityId: loan.employeeId, newValue: { loanNumber: u.loanNumber, principal: num(u.principal) } }, tx);
    return u;
  });
}

export async function rejectLoan(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "loan.approve");
  if (!note || note.trim().length < 3) throw new BusinessError("Give a reason for rejecting.");
  const loan = await loadLoan(ctx, id);
  if (loan.status !== "PENDING_APPROVAL") throw new BusinessError(`This ${label(loan)} is already ${loan.status.replace(/_/g, " ").toLowerCase()}.`);
  if (loan.requestedById === ctx.userId) throw new BusinessError(`You requested this ${label(loan)} — cancel it instead.`);
  const u = await db.staffLoan.update({ where: { id }, data: { status: "REJECTED", approvedBy: ctx.name, approvedAt: new Date(), decisionNote: note.trim() } });
  await logAudit(ctx, { action: "LOAN_REJECT", entity: "Employee", entityId: loan.employeeId, newValue: { loanNumber: loan.loanNumber }, reason: note });
  return u;
}

export async function cancelLoan(ctx: Ctx, id: string) {
  assertCan(ctx, "loan.manage");
  const loan = await loadLoan(ctx, id);
  if (loan.status !== "PENDING_APPROVAL") throw new BusinessError("Only a request still awaiting approval can be cancelled.");
  const u = await db.staffLoan.update({ where: { id }, data: { status: "CANCELLED" } });
  await logAudit(ctx, { action: "LOAN_CANCEL", entity: "Employee", entityId: loan.employeeId, newValue: { loanNumber: loan.loanNumber } });
  return u;
}

// ───────────────────────────── Repayment ─────────────────────────────

/**
 * Puts each active loan's next instalment into a payroll period as an approved deduction. Safe to
 * run again — a loan that already has an instalment in the period is skipped — and a rejected
 * deduction frees that amount to be scheduled again.
 */
export async function scheduleInstallments(ctx: Ctx, periodId: string) {
  assertCan(ctx, "loan.manage");
  const period = await db.payrollPeriod.findFirst({ where: { id: periodId, organizationId: ctx.orgId } });
  if (!period) throw new BusinessError("Payroll period not found.");
  if (!OPEN_PERIOD.includes(period.status))
    throw new BusinessError(`${period.name} payroll is ${period.status.toLowerCase()} — schedule repayments into an open period.`);
  const idx = monthIndex(period.year, period.month);
  const loans = await withPositions(
    await loadWithInstallments(ctx.orgId, { status: "ACTIVE", OR: [{ firstDeductionYear: { lt: period.year } }, { firstDeductionYear: period.year, firstDeductionMonth: { lte: period.month } }] }),
  );
  const skipped: Array<{ loanNumber: string; reason: string }> = [];
  const toCreate: Array<{ loan: (typeof loans)[number]; amount: number; n: number }> = [];
  for (const l of loans) {
    if (monthIndex(l.firstDeductionYear, l.firstDeductionMonth) > idx) continue;
    if (GONE.includes(l.employee.status)) {
      if (l.outstanding > 0) skipped.push({ loanNumber: l.loanNumber, reason: `${l.employee.employeeNumber} has left — recover the balance on their settlement` });
      continue;
    }
    if (l.unscheduled <= 0) continue;
    const live = l.installments.filter((i) => i.deductionId && ["PENDING", "APPROVED", "PROCESSED"].includes(l.deductionStatus.get(i.deductionId) ?? ""));
    if (live.some((i) => i.periodId === periodId)) {
      skipped.push({ loanNumber: l.loanNumber, reason: "already scheduled in this period" });
      continue;
    }
    toCreate.push({ loan: l, amount: Math.min(num(l.installmentAmount), l.unscheduled), n: live.length + 1 });
  }
  await db.$transaction(async (tx) => {
    for (const { loan, amount, n } of toCreate) {
      const ded = await tx.deduction.create({
        data: {
          organizationId: ctx.orgId,
          employeeId: loan.employeeId,
          deductionType: loan.type,
          amount: round2(amount),
          periodId,
          reason: `${loan.loanNumber} ${loan.type === "SALARY_ADVANCE" ? "advance recovery" : `instalment ${n} of ${loan.installmentCount}`}`,
          authorityReference: loan.loanNumber,
          requestedBy: ctx.name,
          approvedBy: loan.approvedBy ?? ctx.name,
          status: "APPROVED",
        },
      });
      await tx.loanInstallment.create({
        data: { organizationId: ctx.orgId, loanId: loan.id, kind: "PAYROLL", amount: round2(amount), deductionId: ded.id, periodId, createdBy: ctx.name },
      });
    }
    if (toCreate.length)
      await logAudit(ctx, { action: "LOAN_SCHEDULE", entity: "PayrollPeriod", entityId: periodId, newValue: { period: period.name, scheduled: toCreate.length, total: round2(toCreate.reduce((s, x) => s + x.amount, 0)) } }, tx);
  });
  return { periodName: period.name, scheduled: toCreate.length, total: round2(toCreate.reduce((s, x) => s + x.amount, 0)), skipped };
}

export const cashSchema = z.object({
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  paidOn: opt,
  reference: opt,
});

/** The employee pays some of it straight to the company (cash or transfer). */
export async function recordCashRepayment(ctx: Ctx, id: string, raw: z.input<typeof cashSchema>) {
  assertCan(ctx, "loan.manage");
  const v = cashSchema.parse(raw);
  const [loan] = await withPositions(await loadWithInstallments(ctx.orgId, { id }));
  if (!loan) throw new BusinessError("Loan not found.");
  if (loan.status !== "ACTIVE") throw new BusinessError(`This ${label(loan)} is ${loan.status.replace(/_/g, " ").toLowerCase()}.`);
  if (v.amount > loan.unscheduled + 0.005)
    throw new BusinessError(
      loan.unscheduled === 0 && loan.outstanding > 0
        ? "The whole balance is already queued in payroll — nothing is left to pay in cash."
        : `Only ${round2(loan.unscheduled)} is outstanding and not already queued in payroll.`,
    );
  const paidOn = v.paidOn ? d(v.paidOn) : todayUtc();
  return db.$transaction(async (tx) => {
    const inst = await tx.loanInstallment.create({
      data: { organizationId: ctx.orgId, loanId: id, kind: "CASH", amount: round2(v.amount), paidOn, reference: v.reference ?? null, createdBy: ctx.name },
    });
    await postLoanCashRepayment(ctx, tx, loan, round2(v.amount), paidOn);
    await logAudit(ctx, { action: "LOAN_CASH_REPAYMENT", entity: "Employee", entityId: loan.employeeId, newValue: { loanNumber: loan.loanNumber, amount: v.amount } }, tx);
    return inst;
  });
}

/** Forgives what's left as bad debt. Needs a reason, a second person, and nothing waiting in payroll. */
export async function writeOffLoan(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "loan.approve");
  if (!reason || reason.trim().length < 5) throw new BusinessError("Record why the balance is being written off.");
  const [loan] = await withPositions(await loadWithInstallments(ctx.orgId, { id }));
  if (!loan) throw new BusinessError("Loan not found.");
  if (loan.status !== "ACTIVE") throw new BusinessError(`This ${label(loan)} is ${loan.status.replace(/_/g, " ").toLowerCase()}.`);
  if (loan.requestedById === ctx.userId) throw new BusinessError(`You requested this ${label(loan)} — someone else must write it off.`);
  if (loan.scheduled > 0) throw new BusinessError("There are repayments still queued in payroll — let them run, or reject them, before writing the rest off.");
  if (loan.outstanding <= 0) throw new BusinessError("Nothing is outstanding.");
  return db.$transaction(async (tx) => {
    const u = await tx.staffLoan.update({ where: { id }, data: { status: "WRITTEN_OFF", writtenOffAmount: loan.outstanding, writtenOffReason: reason.trim() } });
    await postLoanWriteOff(ctx, tx, loan, loan.outstanding, todayUtc());
    await logAudit(ctx, { action: "LOAN_WRITE_OFF", entity: "Employee", entityId: loan.employeeId, newValue: { loanNumber: loan.loanNumber, amount: loan.outstanding }, reason }, tx);
    return u;
  });
}

// ───────────────────────────── Queries ─────────────────────────────

export async function listLoans(ctx: Ctx, f: { status?: string; employeeId?: string; q?: string } = {}) {
  assertCan(ctx, "payroll.view");
  const loans = await withPositions(
    await loadWithInstallments(ctx.orgId, {
      ...(f.status && f.status !== "COMPLETED" ? { status: f.status } : {}),
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
      ...(f.q
        ? {
            OR: [
              { loanNumber: { contains: f.q, mode: "insensitive" } },
              { employee: { firstName: { contains: f.q, mode: "insensitive" } } },
              { employee: { lastName: { contains: f.q, mode: "insensitive" } } },
              { employee: { employeeNumber: { contains: f.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    }),
  );
  return f.status === "COMPLETED" ? loans.filter((l) => l.effectiveStatus === "COMPLETED") : loans;
}

export async function getLoan(ctx: Ctx, id: string) {
  assertCan(ctx, "payroll.view");
  const [loan] = await withPositions(await loadWithInstallments(ctx.orgId, { id }));
  if (!loan) return null;
  const periods = await db.payrollPeriod.findMany({
    where: { id: { in: loan.installments.map((i) => i.periodId).filter((x): x is string => Boolean(x)) } },
    select: { id: true, name: true },
  });
  const name = new Map(periods.map((p) => [p.id, p.name]));
  return { ...loan, installmentRows: loan.installments.map((i) => ({ ...i, periodName: i.periodId ? name.get(i.periodId) ?? null : null, deductionState: i.deductionId ? (loan.deductionStatus.get(i.deductionId) ?? null) : null })) };
}

export async function loansSummary(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  const loans = await withPositions(await loadWithInstallments(ctx.orgId, { status: { in: ["ACTIVE", "PENDING_APPROVAL"] } }));
  const active = loans.filter((l) => l.status === "ACTIVE" && l.outstanding > 0);
  return {
    pending: loans.filter((l) => l.status === "PENDING_APPROVAL").length,
    pendingValue: round2(loans.filter((l) => l.status === "PENDING_APPROVAL").reduce((s, l) => s + num(l.principal), 0)),
    active: active.length,
    outstanding: round2(active.reduce((s, l) => s + l.outstanding, 0)),
    queuedInPayroll: round2(active.reduce((s, l) => s + l.scheduled, 0)),
    holdersWhoLeft: new Set(active.filter((l) => GONE.includes(l.employee.status)).map((l) => l.employeeId)).size,
  };
}

/** What an employee still owes on live loans and how much of it isn't already queued in payroll — used at exit. */
export async function employeeLoanBalances(orgId: string, employeeId: string) {
  const loans = await withPositions(await loadWithInstallments(orgId, { employeeId, status: "ACTIVE" }));
  return loans
    .filter((l) => l.outstanding > 0)
    .map((l) => ({ id: l.id, loanNumber: l.loanNumber, type: l.type, outstanding: l.outstanding, scheduled: l.scheduled, unscheduled: l.unscheduled }));
}

/** Live loans still owed by people who have left, one row per leaver — for reminders (no permission check). */
export async function loansOwedByLeavers(orgId: string) {
  const loans = await withPositions(await loadWithInstallments(orgId, { status: "ACTIVE" }));
  const byEmployee = new Map<string, { employee: (typeof loans)[number]["employee"]; loans: number; outstanding: number }>();
  for (const l of loans) {
    if (!GONE.includes(l.employee.status) || l.outstanding <= 0) continue;
    const e = byEmployee.get(l.employeeId) ?? { employee: l.employee, loans: 0, outstanding: 0 };
    e.loans += 1;
    e.outstanding = round2(e.outstanding + l.outstanding);
    byEmployee.set(l.employeeId, e);
  }
  return [...byEmployee.values()];
}
