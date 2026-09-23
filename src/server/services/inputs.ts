import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d, daysInMonth } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { DEDUCTION_AUTHORITY_ERROR, overtimeHourlyRate } from "@/lib/payroll/engine";
import { computePaye } from "@/lib/payroll/paye";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { assertPeriodEditable, deploymentOn } from "./operations";
import { loadRateBook } from "./rates";
import { payrollRuleFor, pensionRuleFor, taxRuleFor } from "./statutory";

async function getPeriod(ctx: Ctx, periodId: string) {
  const p = await db.payrollPeriod.findFirst({ where: { id: periodId, organizationId: ctx.orgId } });
  if (!p) throw new BusinessError("Payroll period not found.");
  return p;
}

function basisDays(basis: string, year: number, month: number) {
  return basis === "FIXED_30" ? 30 : daysInMonth(year, month);
}

// ───────────────────────────── Overtime ─────────────────────────────

export const overtimeSchema = z.object({
  employeeId: z.string().min(1),
  beatId: z.string().min(1),
  periodId: z.string().min(1),
  date: z.string().min(10),
  hours: z.coerce.number().positive("Hours must be greater than zero").max(24),
  rate: z.coerce.number().positive().optional(),
  amount: z.coerce.number().positive().optional(),
  approvalReference: z.string().trim().optional(),
  source: z.enum(["CLIENT_SCHEDULE", "MANUAL", "IMPORT"]).default("CLIENT_SCHEDULE"),
});

/** Validates personnel, values, client and location before an overtime line may exist. */
export async function createOvertime(ctx: Ctx, raw: z.input<typeof overtimeSchema>) {
  assertCan(ctx, "payroll.inputs");
  const v = overtimeSchema.parse(raw);
  const date = d(v.date);
  const period = await getPeriod(ctx, v.periodId);
  if (date < period.startDate || date > period.endDate)
    throw new BusinessError("Overtime date is outside the payroll period.");
  await assertPeriodEditable(db, ctx.orgId, date);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee does not exist.");
  if (!["ACTIVE", "ON_LEAVE"].includes(emp.status))
    throw new BusinessError(`Employee ${emp.employeeNumber} is not active.`);
  const beat = await db.beat.findFirst({ where: { id: v.beatId, organizationId: ctx.orgId } });
  if (!beat) throw new BusinessError("Beat not found.");
  const dep = await deploymentOn(db, ctx.orgId, emp.id, date);
  const worked = await db.workRegister.findFirst({
    where: { organizationId: ctx.orgId, employeeId: emp.id, date, beatId: beat.id },
  });
  if ((!dep || dep.beatId !== beat.id) && !worked)
    throw new BusinessError(
      `Employee ${emp.employeeNumber} does not belong to ${beat.name} (client/location) on ${v.date}.`,
    );
  const dup = await db.overtime.findFirst({
    where: {
      organizationId: ctx.orgId,
      employeeId: emp.id,
      date,
      beatId: beat.id,
      status: { notIn: ["REJECTED", "CANCELLED"] },
    },
  });
  if (dup)
    throw new BusinessError("Duplicate overtime: an entry already exists for this employee, beat and date.");
  const rules = await payrollRuleFor(db, ctx.orgId, date);
  const monthTotal = await db.overtime.aggregate({
    where: {
      organizationId: ctx.orgId,
      employeeId: emp.id,
      periodId: period.id,
      status: { notIn: ["REJECTED", "CANCELLED"] },
    },
    _sum: { hours: true },
  });
  const total = num(monthTotal._sum.hours) + v.hours;
  if (total > rules.maxOvertimeHoursPerMonth)
    throw new BusinessError(
      `Overtime limit exceeded: ${total} hours this period (limit ${rules.maxOvertimeHoursPerMonth}).`,
    );

  let rate = v.rate;
  if (!rate) {
    const book = await loadRateBook(
      db,
      ctx.orgId,
      period.startDate,
      period.endDate,
      rules.defaultOperativeSharePct,
    );
    const r = book.resolve(emp.id, {
      contractId: beat.contractId,
      categoryId: dep?.categoryId ?? emp.categoryId,
      date,
    });
    if (!r)
      throw new BusinessError("No agreed rate is configured for this employee's category on this contract.");
    rate = overtimeHourlyRate(
      r.monthlyGross,
      basisDays(rules.prorationBasis, period.year, period.month),
      rules.standardHoursPerDay,
      rules.overtimeMultiplier,
    );
  }
  const expected = round2(v.hours * rate);
  if (v.amount !== undefined && Math.abs(v.amount - expected) > 0.01)
    throw new BusinessError(
      `Overtime amount ${v.amount} does not match the configured calculation (${v.hours}h × ${rate} = ${expected}).`,
    );

  const ot = await db.overtime.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: emp.id,
      clientId: beat.clientId,
      contractId: beat.contractId,
      beatId: beat.id,
      periodId: period.id,
      date,
      hours: v.hours,
      rate,
      amount: expected,
      approvalReference: v.approvalReference || null,
      source: v.source,
      status: "PENDING",
      createdBy: ctx.name,
    },
  });
  await logAudit(ctx, { action: "OVERTIME_ENTRY", entity: "Overtime", entityId: ot.id, newValue: ot });
  return ot;
}

export async function approveOvertime(ctx: Ctx, id: string, approvalReference?: string) {
  assertCan(ctx, "payroll.inputs.approve");
  const ot = await db.overtime.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!ot) throw new BusinessError("Overtime not found.");
  if (ot.status !== "PENDING") throw new BusinessError(`Overtime is already ${ot.status.toLowerCase()}.`);
  const ref = approvalReference?.trim() || ot.approvalReference;
  if (!ref)
    throw new BusinessError(
      "Only authorized overtime schedules can be processed — an approval reference is required.",
    );
  await assertPeriodEditable(db, ctx.orgId, ot.date);
  const u = await db.overtime.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: ctx.name, approvalReference: ref },
  });
  await logAudit(ctx, {
    action: "OVERTIME_APPROVE",
    entity: "Overtime",
    entityId: id,
    newValue: { approvalReference: ref },
  });
  return u;
}

export async function rejectInput(
  ctx: Ctx,
  kind: "overtime" | "deduction" | "arrears" | "otherEarning",
  id: string,
  reason: string,
) {
  assertCan(ctx, "payroll.inputs.approve");
  const where = { id, organizationId: ctx.orgId, status: "PENDING" as const };
  const data = { status: "REJECTED" as const };
  const res =
    kind === "overtime"
      ? await db.overtime.updateMany({ where, data })
      : kind === "deduction"
        ? await db.deduction.updateMany({ where, data })
        : kind === "arrears"
          ? await db.arrears.updateMany({ where, data })
          : await db.otherEarning.updateMany({ where, data });
  if (!res.count) throw new BusinessError("Only pending items can be rejected.");
  await logAudit(ctx, { action: `${kind.toUpperCase()}_REJECT`, entity: kind, entityId: id, reason });
}

export async function listOvertime(ctx: Ctx, periodId?: string) {
  return db.overtime.findMany({
    where: { organizationId: ctx.orgId, ...(periodId ? { periodId } : {}) },
    include: { employee: true, beat: true, client: true, period: true },
    orderBy: [{ date: "desc" }],
    take: 500,
  });
}

// ───────────────────────────── Deductions ─────────────────────────────

export const deductionSchema = z.object({
  employeeId: z.string().min(1),
  deductionType: z.enum(["PENALTY", "RECOVERY", "LOAN", "SALARY_ADVANCE", "OTHER"]),
  amount: z.coerce.number().positive(),
  periodId: z.string().min(1),
  reason: z.string().trim().min(3, "Reason is required"),
  authorityReference: z.string().trim().optional(),
  supportingDocument: z.string().trim().optional(),
});

/** Deductions without documented authority are rejected outright. */
export async function createDeduction(ctx: Ctx, raw: z.input<typeof deductionSchema>) {
  assertCan(ctx, "payroll.inputs");
  const v = deductionSchema.parse(raw);
  if (!v.authorityReference) throw new BusinessError(DEDUCTION_AUTHORITY_ERROR);
  await getPeriod(ctx, v.periodId);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  const ded = await db.deduction.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: v.employeeId,
      deductionType: v.deductionType,
      amount: v.amount,
      periodId: v.periodId,
      reason: v.reason,
      authorityReference: v.authorityReference,
      supportingDocument: v.supportingDocument || null,
      requestedBy: ctx.name,
      status: "PENDING",
    },
  });
  await logAudit(ctx, {
    action: "DEDUCTION_ENTRY",
    entity: "Deduction",
    entityId: ded.id,
    newValue: ded,
    reason: v.reason,
  });
  return ded;
}

export async function approveDeduction(ctx: Ctx, id: string) {
  assertCan(ctx, "payroll.inputs.approve");
  const x = await db.deduction.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!x) throw new BusinessError("Deduction not found.");
  if (x.status !== "PENDING") throw new BusinessError(`Deduction is already ${x.status.toLowerCase()}.`);
  if (!x.authorityReference?.trim()) throw new BusinessError(DEDUCTION_AUTHORITY_ERROR);
  const u = await db.deduction.update({ where: { id }, data: { status: "APPROVED", approvedBy: ctx.name } });
  await logAudit(ctx, { action: "DEDUCTION_APPROVE", entity: "Deduction", entityId: id });
  return u;
}

export async function listDeductions(ctx: Ctx, periodId?: string) {
  return db.deduction.findMany({
    where: { organizationId: ctx.orgId, ...(periodId ? { periodId } : {}) },
    include: { employee: true, period: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

// ───────────────────────────── Other earnings ─────────────────────────────

export const otherEarningSchema = z.object({
  employeeId: z.string().min(1),
  periodId: z.string().min(1),
  name: z.string().trim().min(2),
  amount: z.coerce.number().positive(),
  taxable: z.coerce.boolean().default(true),
  reason: z.string().trim().min(3),
});

export async function createOtherEarning(ctx: Ctx, raw: z.input<typeof otherEarningSchema>) {
  assertCan(ctx, "payroll.inputs");
  const v = otherEarningSchema.parse(raw);
  await getPeriod(ctx, v.periodId);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  const x = await db.otherEarning.create({ data: { organizationId: ctx.orgId, ...v, status: "PENDING" } });
  await logAudit(ctx, {
    action: "OTHER_EARNING_ENTRY",
    entity: "OtherEarning",
    entityId: x.id,
    newValue: x,
    reason: v.reason,
  });
  return x;
}

export async function approveOtherEarning(ctx: Ctx, id: string) {
  assertCan(ctx, "payroll.inputs.approve");
  const x = await db.otherEarning.findFirst({ where: { id, organizationId: ctx.orgId, status: "PENDING" } });
  if (!x) throw new BusinessError("Only pending earnings can be approved.");
  const u = await db.otherEarning.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: ctx.name },
  });
  await logAudit(ctx, { action: "OTHER_EARNING_APPROVE", entity: "OtherEarning", entityId: id });
  return u;
}

// ───────────────────────────── Arrears ─────────────────────────────

export const arrearsSchema = z.object({
  employeeId: z.string().min(1),
  originalPeriodId: z.string().min(1),
  arrearsType: z.enum([
    "SALARY_ADJUSTMENT",
    "LATE_SALARY_INCREASE",
    "PAYROLL_CORRECTION",
    "MISSED_PAYMENT",
    "RETROSPECTIVE_PROMOTION",
    "APPROVED_ALLOWANCE",
    "APPROVED_CORRECTION",
  ]),
  /** New full-month operative gross that should have applied (salary adjustment / promotion). */
  correctedMonthlyGross: z.coerce.number().positive().optional(),
  /** Or explicit amounts for corrections / missed payments. */
  originalAmount: z.coerce.number().min(0).optional(),
  correctedAmount: z.coerce.number().min(0).optional(),
  reason: z.string().trim().min(3),
  supportingDocument: z.string().optional(),
});

/**
 * Arrears = what the employee should have been paid in a previous period minus what was paid.
 * Gross, tax, pension and net impact are computed so the arrears can be reviewed before approval.
 */
export async function createArrears(ctx: Ctx, raw: z.input<typeof arrearsSchema>) {
  assertCan(ctx, "payroll.inputs");
  const v = arrearsSchema.parse(raw);
  const period = await getPeriod(ctx, v.originalPeriodId);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");

  // The last non-superseded payroll record for the affected period is the "original".
  const rec = await db.payrollRecord.findFirst({
    where: {
      organizationId: ctx.orgId,
      employeeId: emp.id,
      run: { periodId: period.id, type: "REGULAR", status: { not: "SUPERSEDED" } },
    },
    orderBy: { createdAt: "desc" },
  });
  let originalAmount: number;
  let correctedAmount: number;
  let pensionableRatio: number;
  if (v.correctedMonthlyGross !== undefined) {
    if (!rec)
      throw new BusinessError(
        `No payroll record exists for ${emp.employeeNumber} in ${period.name}; enter original and corrected amounts instead.`,
      );
    originalAmount = num(rec.earnedGross);
    const factor = num(rec.monthlyGross) ? num(rec.earnedGross) / num(rec.monthlyGross) : 0;
    correctedAmount = round2(v.correctedMonthlyGross * factor);
    pensionableRatio = num(rec.earnedGross) ? num(rec.pensionBase) / num(rec.earnedGross) : 0;
  } else {
    if (v.originalAmount === undefined || v.correctedAmount === undefined)
      throw new BusinessError(
        "Provide either the corrected monthly gross, or both original and corrected amounts.",
      );
    originalAmount = v.originalAmount;
    correctedAmount = v.correctedAmount;
    const book = await loadRateBook(db, ctx.orgId, period.startDate, period.endDate, 70);
    const std = book.defaultStructure;
    const pct =
      std?.components
        .filter((c) => c.pensionable && c.calcType === "PERCENTAGE")
        .reduce((a, c) => a + (c.percentage ?? 0), 0) ?? 39;
    pensionableRatio = rec && num(rec.earnedGross) ? num(rec.pensionBase) / num(rec.earnedGross) : pct / 100;
  }
  const difference = round2(correctedAmount - originalAmount);
  if (difference === 0)
    throw new BusinessError("Corrected amount equals the original amount — there are no arrears.");
  const pensionableImpact = round2(difference * pensionableRatio);
  const [pension, tax] = await Promise.all([
    pensionRuleFor(db, ctx.orgId, period.endDate),
    taxRuleFor(db, ctx.orgId, period.endDate),
  ]);
  const pensionImpact = round2((pensionableImpact * pension.employeeRate) / 100);
  // Tax impact estimate: marginal tax on the arrears over the employee's regular income for that period.
  const regular = rec
    ? num(rec.taxableIncome) - num(rec.overtimeAmount) - num(rec.arrearsAmount)
    : originalAmount;
  const base = computePaye(
    {
      monthlyRegularTaxable: regular,
      monthlyIrregularTaxable: 0,
      monthlyEmployeePension: rec ? num(rec.employeePension) : 0,
      monthlyBasic: 0,
    },
    tax.def,
  );
  const withArr = computePaye(
    {
      monthlyRegularTaxable: regular,
      monthlyIrregularTaxable: difference,
      monthlyEmployeePension: rec ? num(rec.employeePension) : 0,
      monthlyBasic: 0,
    },
    tax.def,
  );
  const taxImpact = round2(withArr.paye - base.paye);
  const netImpact = round2(difference - taxImpact - pensionImpact);

  const a = await db.arrears.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: emp.id,
      originalPeriodId: period.id,
      arrearsType: v.arrearsType,
      originalAmount,
      correctedAmount,
      difference,
      grossImpact: difference,
      pensionableImpact,
      taxImpact,
      pensionImpact,
      netImpact,
      reason: v.reason,
      supportingDocument: v.supportingDocument || null,
      requestedBy: ctx.name,
      status: "PENDING",
    },
  });
  await logAudit(ctx, {
    action: "ARREARS_REQUEST",
    entity: "Arrears",
    entityId: a.id,
    newValue: a,
    reason: v.reason,
  });
  return a;
}

export async function approveArrears(ctx: Ctx, id: string) {
  assertCan(ctx, "payroll.inputs.approve");
  const a = await db.arrears.findFirst({ where: { id, organizationId: ctx.orgId, status: "PENDING" } });
  if (!a) throw new BusinessError("Only pending arrears can be approved.");
  const u = await db.arrears.update({ where: { id }, data: { status: "APPROVED", approvedBy: ctx.name } });
  await logAudit(ctx, { action: "ARREARS_APPROVE", entity: "Arrears", entityId: id });
  return u;
}

export async function listArrears(ctx: Ctx) {
  return db.arrears.findMany({
    where: { organizationId: ctx.orgId },
    include: { employee: true, originalPeriod: true, processedPeriod: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

export async function listOtherEarnings(ctx: Ctx, periodId?: string) {
  return db.otherEarning.findMany({
    where: { organizationId: ctx.orgId, ...(periodId ? { periodId } : {}) },
    include: { employee: true, period: true },
    orderBy: { createdAt: "desc" },
  });
}
