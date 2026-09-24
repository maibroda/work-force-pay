import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { daysInMonth, eachDay, iso, monthEnd, monthStart, periodName } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { fullName } from "@/lib/utils";
import {
  calculateEmployeePayroll,
  type AttendanceStatus,
  type EngineResult,
  type WorkDay,
} from "@/lib/payroll/engine";
import type { ComponentOverride } from "@/lib/payroll/structure";
import { postRunToGl } from "./accounting";
import { assertCan, BusinessError, db, toJson } from "./_base";
import { logAudit } from "./audit";
import { activeRecurringDeductionRules } from "./deduction-rules";
import { findDuplicates } from "./employees";
import { CLIENT_MISMATCH, LOCATION_MISMATCH } from "./operations";
import { loadRateBook } from "./rates";
import { employerCostRuleFor, payrollRuleFor, pensionRuleFor, taxRuleFor } from "./statutory";

const FROZEN_STATUSES = ["APPROVED", "LOCKED", "PAID", "CLOSED"] as const;
const EXITED = ["TERMINATED", "RESIGNED", "EXITED"];

// ───────────────────────────── Periods ─────────────────────────────

export async function createPeriod(ctx: Ctx, year: number, month: number) {
  assertCan(ctx, "payroll.run");
  if (month < 1 || month > 12) throw new BusinessError("Month must be between 1 and 12.");
  const exists = await db.payrollPeriod.findFirst({ where: { organizationId: ctx.orgId, year, month } });
  if (exists) throw new BusinessError(`Payroll period ${periodName(year, month)} already exists.`);
  const p = await db.payrollPeriod.create({
    data: {
      organizationId: ctx.orgId,
      name: periodName(year, month),
      year,
      month,
      startDate: monthStart(year, month),
      endDate: monthEnd(year, month),
      status: "OPEN",
    },
  });
  await logAudit(ctx, {
    action: "PAYROLL_PERIOD_CREATE",
    entity: "PayrollPeriod",
    entityId: p.id,
    newValue: p,
  });
  return p;
}

export async function listPeriods(ctx: Ctx) {
  return db.payrollPeriod.findMany({
    where: { organizationId: ctx.orgId },
    include: { runs: { orderBy: { runNumber: "asc" } } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

export async function getPeriod(ctx: Ctx, id: string) {
  return db.payrollPeriod.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { runs: { orderBy: { runNumber: "asc" } } },
  });
}

export async function currentRun(ctx: Ctx, periodId: string) {
  return db.payrollRun.findFirst({
    where: { organizationId: ctx.orgId, periodId, type: "REGULAR", status: { not: "SUPERSEDED" } },
    orderBy: { runNumber: "desc" },
  });
}

// ───────────────────────────── Engine input assembly ─────────────────────────────

interface Issue {
  employeeId: string | null;
  category: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  code: string;
  message: string;
}

/**
 * Builds engine inputs for every employee in the period from the WORK REGISTER (plus pay-rate
 * employees who are not deployed). Current location is never used.
 */
async function assemble(
  ctx: Ctx,
  period: { id: string; year: number; month: number; startDate: Date; endDate: Date },
  opts: { runId?: string; supplementary?: boolean },
) {
  const [tax, pension, rules, employerCosts] = await Promise.all([
    taxRuleFor(db, ctx.orgId, period.endDate),
    pensionRuleFor(db, ctx.orgId, period.endDate),
    payrollRuleFor(db, ctx.orgId, period.endDate),
    employerCostRuleFor(db, ctx.orgId, period.endDate),
  ]);
  const basisDays = rules.prorationBasis === "FIXED_30" ? 30 : daysInMonth(period.year, period.month);
  const book = await loadRateBook(
    db,
    ctx.orgId,
    period.startDate,
    period.endDate,
    rules.defaultOperativeSharePct,
  );

  const [
    employees,
    work,
    overrides,
    overtime,
    arrears,
    others,
    deductions,
    movements,
    recurringDeductionRules,
  ] = await Promise.all([
    db.employee.findMany({
      where: {
        organizationId: ctx.orgId,
        employmentDate: { lte: period.endDate },
        OR: [
          { status: { notIn: ["TERMINATED", "RESIGNED", "EXITED"] } },
          { exitDate: { gte: period.startDate } },
          { workRegister: { some: { date: { gte: period.startDate, lte: period.endDate } } } },
        ],
      },
      include: { category: true, department: true, deployments: true },
    }),
    db.workRegister.findMany({
      where: { organizationId: ctx.orgId, date: { gte: period.startDate, lte: period.endDate } },
      include: { client: true, beat: true, contract: true, category: true },
      orderBy: { date: "asc" },
    }),
    db.employeeSalaryOverride.findMany({
      where: {
        organizationId: ctx.orgId,
        status: "APPROVED",
        effectiveFrom: { lte: period.endDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }],
      },
    }),
    db.overtime.findMany({
      where: {
        organizationId: ctx.orgId,
        periodId: period.id,
        status: opts.supplementary ? "APPROVED" : { in: ["APPROVED", "PROCESSED"] },
      },
    }),
    db.arrears.findMany({
      where: {
        organizationId: ctx.orgId,
        status: { in: ["APPROVED", "PROCESSED"] },
        OR: [
          { processedRunId: null, status: "APPROVED" },
          ...(opts.runId ? [{ processedRunId: opts.runId }] : []),
        ],
      },
    }),
    db.otherEarning.findMany({
      where: {
        organizationId: ctx.orgId,
        periodId: period.id,
        status: opts.supplementary ? "APPROVED" : { in: ["APPROVED", "PROCESSED"] },
      },
    }),
    db.deduction.findMany({
      where: {
        organizationId: ctx.orgId,
        periodId: period.id,
        status: opts.supplementary ? "APPROVED" : { in: ["APPROVED", "PROCESSED"] },
      },
    }),
    db.staffMovement.findMany({
      where: {
        organizationId: ctx.orgId,
        status: "APPROVED",
        effectiveDate: { gte: period.startDate, lte: period.endDate },
      },
    }),
    activeRecurringDeductionRules(ctx.orgId, period.endDate),
  ]);
  return {
    tax,
    pension,
    rules,
    employerCosts,
    basisDays,
    book,
    employees,
    work,
    overrides,
    overtime,
    arrears,
    others,
    recurringDeductionRules,
    deductions,
    movements,
  };
}

type Assembled = Awaited<ReturnType<typeof assemble>>;

function workDaysFor(a: Assembled, employeeId: string): WorkDay[] {
  return a.work
    .filter((w) => w.employeeId === employeeId)
    .map((w) => ({
      date: w.date,
      clientId: w.clientId,
      clientName: w.client.name,
      contractId: w.contractId,
      beatId: w.beatId,
      beatName: w.beat.name,
      categoryId: w.categoryId,
      status: w.attendanceStatus as AttendanceStatus,
      overtimeHours: num(w.overtimeHours),
    }));
}

type EngineDeductionInput = NonNullable<Parameters<typeof calculateEmployeePayroll>[0]["deductions"]>[number];

/**
 * Recurring deduction rules (Global / Location / Individual, see RecurringDeductionRule) that
 * apply to this employee this period. GLOBAL applies to every paid employee; LOCATION applies if
 * the employee worked any day at that beat; INDIVIDUAL applies only to the named employee.
 * A rule being active/effective IS the authorization, so it always passes the engine's
 * authority-reference check.
 */
function recurringDeductionsFor(
  a: Assembled,
  employeeId: string,
  days: WorkDay[],
  totalEarnings: number,
): EngineDeductionInput[] {
  const beatIds = new Set(days.map((d) => d.beatId).filter((x): x is string => Boolean(x)));
  const applicable = a.recurringDeductionRules.filter((r) => {
    if (r.scope === "GLOBAL") return true;
    if (r.scope === "LOCATION") return r.beatId !== null && beatIds.has(r.beatId);
    return r.employeeId === employeeId;
  });
  return applicable.map((r) => ({
    id: r.id,
    type: r.code,
    amount:
      r.calcType === "PERCENTAGE_OF_GROSS"
        ? round2((totalEarnings * num(r.percentage)) / 100)
        : num(r.fixedAmount),
    authorityReference: r.code,
    reason: r.reason,
  }));
}

function overridesFor(a: Assembled, employeeId: string): ComponentOverride[] {
  return a.overrides
    .filter((o) => o.employeeId === employeeId)
    .sort((x, y) => y.effectiveFrom.getTime() - x.effectiveFrom.getTime())
    .filter((o, i, arr) => arr.findIndex((z) => z.componentCode === o.componentCode) === i)
    .map((o) => ({
      componentCode: o.componentCode,
      calcType: o.calcType,
      percentage: o.percentage === null ? null : num(o.percentage),
      fixedAmount: o.fixedAmount === null ? null : num(o.fixedAmount),
      reason: o.reason,
    }));
}

// ───────────────────────────── Run payroll ─────────────────────────────

/**
 * Calculates (or recalculates) the REGULAR payroll for an OPEN period. May be repeated any number
 * of times while the period is open — after new activations, joiners, leavers, movements,
 * overtime, arrears, penalties or salary adjustments.
 */
export async function runPayroll(ctx: Ctx, periodId: string) {
  assertCan(ctx, "payroll.run");
  const period = await db.payrollPeriod.findFirst({ where: { id: periodId, organizationId: ctx.orgId } });
  if (!period) throw new BusinessError("Payroll period not found.");
  if ((FROZEN_STATUSES as readonly string[]).includes(period.status))
    throw new BusinessError(
      `Payroll for ${period.name} is ${period.status.toLowerCase()} and cannot be recalculated. Use a supplementary payroll for corrections.`,
    );

  let run = await currentRun(ctx, periodId);
  const a = await assemble(ctx, period, { runId: run?.id });
  const issues: Issue[] = [];
  type Row = { emp: Assembled["employees"][number]; res: EngineResult };
  const rows: Row[] = [];

  for (const emp of a.employees) {
    let days = workDaysFor(a, emp.id);
    const exited = EXITED.includes(emp.status);
    // Pay-rate employees (office staff/supervisors) without a work register: pay for employment days.
    if (!days.length && !exited) {
      const hasPayRate =
        a.book.employeePayRate(emp.id, period.endDate) || a.book.employeePayRate(emp.id, period.startDate);
      if (hasPayRate) {
        const from = emp.employmentDate > period.startDate ? emp.employmentDate : period.startDate;
        const to = emp.exitDate && emp.exitDate < period.endDate ? emp.exitDate : period.endDate;
        days = eachDay(from, to).map((dt) => ({
          date: dt,
          clientId: null,
          clientName: "Head Office",
          contractId: null,
          beatId: null,
          beatName: emp.department?.name ?? "Head Office",
          categoryId: emp.categoryId,
          status: "PRESENT" as const,
          overtimeHours: 0,
        }));
      }
    }
    const ot = a.overtime.filter((o) => o.employeeId === emp.id);
    const arr = a.arrears.filter((x) => x.employeeId === emp.id);
    const oth = a.others.filter((x) => x.employeeId === emp.id);
    const ded = a.deductions.filter((x) => x.employeeId === emp.id);
    if (!days.length && !ot.length && !arr.length && !oth.length) {
      if (!exited && ["ACTIVE", "ON_LEAVE"].includes(emp.status))
        issues.push({
          employeeId: emp.id,
          category: "ATTENDANCE",
          severity: "WARNING",
          code: "NO_ATTENDANCE",
          message: `${emp.employeeNumber} ${fullName(emp)} has no work register records for ${period.name} and was not paid.`,
        });
      continue;
    }
    const adHocDeductions: EngineDeductionInput[] = ded.map((x) => ({
      id: x.id,
      type: x.deductionType,
      amount: num(x.amount),
      authorityReference: x.authorityReference,
      reason: x.reason,
    }));
    const buildInput = (deductions: EngineDeductionInput[]) => ({
      basisDays: a.basisDays,
      days,
      resolveRate: (day: WorkDay) => a.book.resolve(emp.id, day),
      businessLineFor: (contractId: string | null) => a.book.businessLineOf(contractId),
      employerCostRule: a.employerCosts,
      overrides: overridesFor(a, emp.id),
      overtime: ot.map((o) => ({
        id: o.id,
        beatId: o.beatId,
        clientId: o.clientId,
        contractId: o.contractId,
        hours: num(o.hours),
        amount: num(o.amount),
      })),
      arrears: arr.map((x) => ({
        id: x.id,
        grossImpact: num(x.grossImpact),
        pensionableImpact: num(x.pensionableImpact),
      })),
      otherEarnings: oth.map((x) => ({ id: x.id, name: x.name, amount: num(x.amount), taxable: x.taxable })),
      deductions,
      pension: {
        employeeRate: a.pension.employeeRate,
        employerRate: a.pension.employerRate,
        version: a.pension.version,
      },
      taxRule: a.tax.def,
      annualRent: emp.annualRent ? num(emp.annualRent) : 0,
    });
    let res = calculateEmployeePayroll(buildInput(adHocDeductions));
    // Recurring deduction rules (Global/Location/Individual) need this pass's totalEarnings to
    // compute a percentage-of-gross amount, so — only when at least one applies — recalculate
    // once more with them included. Pure/cheap function; a second pass costs nothing meaningful.
    const recurring = recurringDeductionsFor(a, emp.id, days, res.totalEarnings);
    if (recurring.length) res = calculateEmployeePayroll(buildInput([...adHocDeductions, ...recurring]));
    rows.push({ emp, res });
  }

  issues.push(...(await validate(ctx, period, a, rows)));

  const totals = summarize(rows.map((r) => r.res));
  const result = await db.$transaction(
    async (tx) => {
      const isRecalc = Boolean(run);
      if (!run) {
        run = await tx.payrollRun.create({
          data: {
            organizationId: ctx.orgId,
            periodId,
            runNumber: 1,
            type: "REGULAR",
            status: "DRAFT",
            description: `${period.name} regular payroll`,
          },
        });
      }
      const runId = run.id;
      const keptOverrides = await tx.payrollValidationIssue.findMany({ where: { runId, overridden: true } });
      await tx.payrollValidationIssue.deleteMany({ where: { runId } });
      await tx.payrollRecord.deleteMany({ where: { runId } });

      const recordData: Prisma.PayrollRecordCreateManyInput[] = [];
      const allocData: Prisma.PayrollAllocationCreateManyInput[] = [];
      for (const { emp, res } of rows) {
        const id = randomUUID();
        recordData.push(recordRow(ctx.orgId, runId, id, emp, res, a.tax.def.code + "@" + a.tax.def.version));
        for (const al of res.allocations)
          allocData.push({
            id: randomUUID(),
            organizationId: ctx.orgId,
            runId,
            recordId: id,
            employeeId: emp.id,
            clientId: al.clientId,
            contractId: al.contractId,
            beatId: al.beatId,
            days: al.days,
            grossAmount: al.grossAmount,
            overtimeAmount: al.overtimeAmount,
            employerPension: al.employerPension,
            clientBilling: al.clientBilling,
            managementShare: al.managementShare,
            itf: al.itf,
            nsitf: al.nsitf,
            nhfMedical: al.nhfMedical,
            insurance: al.insurance,
            uniformKits: al.uniformKits,
            recruitmentTraining: al.recruitmentTraining,
            leaveReliever: al.leaveReliever,
            outsourcingLeaveAllowance: al.outsourcingLeaveAllowance,
            businessCosts: al.businessCosts,
            netAmount: al.netAmount,
          });
      }
      if (recordData.length) await tx.payrollRecord.createMany({ data: recordData });
      if (allocData.length) await tx.payrollAllocation.createMany({ data: allocData });

      const overrideKey = (i: { code: string; employeeId: string | null; message: string }) =>
        `${i.code}|${i.employeeId ?? ""}|${i.message}`;
      const kept = new Map(keptOverrides.map((k) => [overrideKey(k), k]));
      if (issues.length)
        await tx.payrollValidationIssue.createMany({
          data: issues.map((i) => {
            const k = kept.get(overrideKey(i));
            return {
              organizationId: ctx.orgId,
              runId,
              employeeId: i.employeeId,
              category: i.category,
              severity: i.severity,
              code: i.code,
              message: i.message,
              overridden: Boolean(k),
              overrideReason: k?.overrideReason ?? null,
              overriddenBy: k?.overriddenBy ?? null,
            };
          }),
        });

      // Attach arrears to this run so they're not double-paid.
      const arrearsIds = rows.flatMap((r) =>
        a.arrears.filter((x) => x.employeeId === r.emp.id).map((x) => x.id),
      );
      if (arrearsIds.length)
        await tx.arrears.updateMany({
          where: { id: { in: arrearsIds }, organizationId: ctx.orgId },
          data: { processedRunId: runId, processedPeriodId: period.id },
        });

      const updated = await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: "CALCULATED",
          taxRuleVersion: `${a.tax.def.code}@${a.tax.def.version}`,
          pensionRuleVersion: a.pension.version,
          ...totals,
          calculatedBy: ctx.name,
          calculatedAt: new Date(),
          calculationCount: { increment: 1 },
        },
      });
      await tx.payrollPeriod.update({ where: { id: period.id }, data: { status: "PENDING_VALIDATION" } });
      await logAudit(
        ctx,
        {
          action: isRecalc ? "PAYROLL_RECALCULATION" : "PAYROLL_CALCULATION",
          entity: "PayrollRun",
          entityId: runId,
          newValue: {
            period: period.name,
            employees: rows.length,
            gross: totals.totalGross,
            net: totals.totalNet,
            issues: issues.length,
          },
        },
        tx,
      );
      return updated;
    },
    { timeout: 120_000 },
  );
  return result;
}

function recordRow(
  orgId: string,
  runId: string,
  id: string,
  emp: {
    id: string;
    employeeNumber: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    category: { name: string };
    department: { name: string } | null;
    bankName: string | null;
    accountNumber: string | null;
    accountName: string | null;
    pensionPin: string | null;
    pfa: string | null;
    taxId: string | null;
  },
  res: EngineResult,
  taxVersion: string,
): Prisma.PayrollRecordCreateManyInput {
  return {
    id,
    organizationId: orgId,
    runId,
    employeeId: emp.id,
    employeeNumber: emp.employeeNumber,
    employeeName: fullName(emp),
    categoryName: emp.category.name,
    departmentName: emp.department?.name ?? null,
    bankName: emp.bankName,
    accountNumber: emp.accountNumber,
    accountName: emp.accountName,
    pensionPin: emp.pensionPin,
    pfa: emp.pfa,
    taxId: emp.taxId,
    basisDays: res.basisDays,
    daysWorked: res.daysWorked,
    daysAbsent: res.daysAbsent,
    suspensionDays: res.suspensionDays,
    overtimeHours: res.overtimeHours,
    monthlyGross: res.monthlyGross,
    earnedGross: res.earnedGross,
    overtimeAmount: res.overtimeAmount,
    arrearsAmount: res.arrearsAmount,
    otherEarnings: res.otherEarnings,
    totalEarnings: res.totalEarnings,
    pensionBase: res.pensionBase,
    employeePension: res.employeePension,
    employerPension: res.employerPension,
    taxableIncome: res.taxableIncome,
    paye: res.paye.paye,
    otherDeductions: res.otherDeductions,
    totalDeductions: res.totalDeductions,
    netPay: res.netPay,
    clientBilling: res.clientBilling,
    managementShare: res.managementShare,
    employerCost: res.employerCost,
    itfAmount: res.itfAmount,
    nsitfAmount: res.nsitfAmount,
    nhfMedicalAmount: res.nhfMedicalAmount,
    insuranceAmount: res.insuranceAmount,
    uniformKitsAmount: res.uniformKitsAmount,
    recruitmentTrainingAmount: res.recruitmentTrainingAmount,
    leaveRelieverAmount: res.leaveRelieverAmount,
    outsourcingLeaveAllowanceAmount: res.outsourcingLeaveAllowanceAmount,
    totalEmployerAddOns: res.totalEmployerAddOns,
    businessLine: res.businessLine,
    taxRuleVersion: taxVersion,
    hasOverride: res.hasOverride,
    lines: toJson(res.lines),
    locations: toJson(res.locations),
    calcTrace: toJson({
      segments: res.segments.map((s) => ({
        beat: s.beatName,
        client: s.clientName,
        paidDays: s.paidDays,
        factor: round2(s.factor * 10000) / 10000,
        agreedRate: s.rate.agreedRate,
        sharePct: s.rate.operativeSharePct,
        monthlyGross: s.rate.monthlyGross,
        structure: s.rate.structure.name,
        gross: s.gross,
        clientBilling: s.clientBilling,
        managementShare: s.managementShare,
      })),
      paye: res.paye,
      rejectedDeductions: res.rejectedDeductions,
    }),
  };
}

function summarize(list: EngineResult[]) {
  const s = (f: (r: EngineResult) => number) => round2(list.reduce((a, r) => a + f(r), 0));
  return {
    employeeCount: list.length,
    totalGross: s((r) => r.totalEarnings),
    totalNet: s((r) => r.netPay),
    totalPaye: s((r) => r.paye.paye),
    totalEmployeePension: s((r) => r.employeePension),
    totalEmployerPension: s((r) => r.employerPension),
    totalDeductions: s((r) => r.otherDeductions),
    totalOvertime: s((r) => r.overtimeAmount),
    totalArrears: s((r) => r.arrearsAmount),
    totalClientBilling: s((r) => r.clientBilling),
    totalManagementShare: s((r) => r.managementShare),
    totalEmployerCost: s((r) => r.employerCost),
    totalItf: s((r) => r.itfAmount),
    totalNsitf: s((r) => r.nsitfAmount),
    totalNhfMedical: s((r) => r.nhfMedicalAmount),
    totalInsurance: s((r) => r.insuranceAmount),
    totalUniformKits: s((r) => r.uniformKitsAmount),
    totalRecruitmentTraining: s((r) => r.recruitmentTrainingAmount),
    totalLeaveReliever: s((r) => r.leaveRelieverAmount),
    totalOutsourcingLeaveAllowance: s((r) => r.outsourcingLeaveAllowanceAmount),
    totalEmployerAddOns: s((r) => r.totalEmployerAddOns),
  };
}

// ───────────────────────────── Validation ─────────────────────────────

async function validate(
  ctx: Ctx,
  period: { id: string; name: string; startDate: Date; endDate: Date },
  a: Assembled,
  rows: Array<{ emp: Assembled["employees"][number]; res: EngineResult }>,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const add = (
    employeeId: string | null,
    category: string,
    severity: Issue["severity"],
    code: string,
    message: string,
  ) => issues.push({ employeeId, category, severity, code, message });
  const inPeriod = (x?: Date | null) => Boolean(x && x >= period.startDate && x <= period.endDate);
  const paidIds = new Set(rows.map((r) => r.emp.id));

  for (const emp of a.employees) {
    const tag = `${emp.employeeNumber} ${fullName(emp)}`;
    // POPULATION — joiners, leavers, assignment changes, no deployment
    if (inPeriod(emp.employmentDate))
      add(
        emp.id,
        "POPULATION",
        "INFO",
        "NEW_EMPLOYEE",
        `New employee: ${tag} joined on ${iso(emp.employmentDate)}.`,
      );
    if (EXITED.includes(emp.status)) {
      if (emp.exitDate && emp.exitDate < period.startDate && paidIds.has(emp.id))
        add(
          emp.id,
          "POPULATION",
          "CRITICAL",
          "PAYING_EXITED",
          `${tag} exited on ${iso(emp.exitDate)} but has earnings in ${period.name}.`,
        );
      else if (inPeriod(emp.exitDate))
        add(
          emp.id,
          "POPULATION",
          "WARNING",
          "LEAVER",
          `Leaver: ${tag} exited on ${iso(emp.exitDate)} — confirm final pay.`,
        );
      const after = emp.exitDate
        ? a.work.filter((w) => w.employeeId === emp.id && w.date > emp.exitDate!)
        : [];
      if (after.length)
        add(
          emp.id,
          "ATTENDANCE",
          "CRITICAL",
          "WORK_AFTER_EXIT",
          `${tag} has ${after.length} work record(s) after exit date ${iso(emp.exitDate)}.`,
        );
    }
    if (a.movements.some((m) => m.employeeId === emp.id))
      add(
        emp.id,
        "POPULATION",
        "INFO",
        "ASSIGNMENT_CHANGED",
        `Assignment changed during ${period.name}: ${tag}.`,
      );
    const active = emp.deployments.some((x) => x.status === "ACTIVE");
    if (emp.status === "ACTIVE" && !active && !a.book.employeePayRate(emp.id, period.endDate))
      add(emp.id, "POPULATION", "WARNING", "NO_DEPLOYMENT", `${tag} has no current deployment.`);
    if (emp.status === "SUSPENDED" && paidIds.has(emp.id))
      add(
        emp.id,
        "POPULATION",
        "WARNING",
        "SUSPENDED_PAID",
        `${tag} is suspended but has paid days in ${period.name}.`,
      );
  }

  for (const { emp, res } of rows) {
    const tag = `${emp.employeeNumber} ${fullName(emp)}`;
    // SALARY
    if (res.unratedDays.length) {
      const sample = res.unratedDays[0];
      add(
        emp.id,
        "SALARY",
        "CRITICAL",
        "NO_RATE",
        `${tag}: no agreed rate / salary structure for ${sample.clientName} — ${sample.beatName} on ${res.unratedDays.length} paid day(s). Those days were not paid.`,
      );
    }
    if (res.hasOverride)
      add(emp.id, "SALARY", "INFO", "SALARY_OVERRIDE", `Employee Salary Override applied for ${tag}.`);
    if (res.segments.length > 1)
      add(
        emp.id,
        "LOCATION",
        "INFO",
        "MULTI_LOCATION",
        `${tag} worked at ${res.locations.length} location range(s) across ${new Set(res.segments.map((s) => s.beatId)).size} beat(s).`,
      );
    // BANK
    const missing = [
      !emp.bankName && "bank",
      !emp.accountNumber && "account number",
      !emp.accountName && "account name",
    ].filter(Boolean);
    if (missing.length)
      add(
        emp.id,
        "BANK",
        "CRITICAL",
        "BANK_MISSING",
        `${tag}: missing ${missing.join(", ")} — no payment account.`,
      );
    else if (!/^\d{10}$/.test(emp.accountNumber ?? ""))
      add(
        emp.id,
        "BANK",
        "CRITICAL",
        "BANK_INVALID",
        `${tag}: account number ${emp.accountNumber} is not a valid 10-digit NUBAN.`,
      );
    // PENSION / PAYE
    if (res.employeePension > 0 && (!emp.pensionPin || !emp.pfa))
      add(
        emp.id,
        "PENSION",
        "WARNING",
        "PENSION_DETAILS",
        `${tag}: pension PIN or PFA missing — remittance cannot be allocated.`,
      );
    if (res.paye.paye > 0 && !emp.taxId)
      add(emp.id, "PAYE", "WARNING", "TAX_ID_MISSING", `${tag}: Tax ID missing for PAYE remittance.`);
    // DEDUCTIONS
    if (res.netPay < 0)
      add(
        emp.id,
        "DEDUCTIONS",
        "CRITICAL",
        "NEGATIVE_NET",
        `${tag}: deductions exceed earnings (net ${res.netPay}).`,
      );
    if (
      res.totalEarnings > 0 &&
      (res.otherDeductions / res.totalEarnings) * 100 > a.rules.maxDeductionPctOfGross
    )
      add(
        emp.id,
        "DEDUCTIONS",
        "WARNING",
        "DEDUCTION_LIMIT",
        `${tag}: other deductions exceed ${a.rules.maxDeductionPctOfGross}% of earnings.`,
      );
    for (const r of res.rejectedDeductions)
      add(emp.id, "DEDUCTIONS", "WARNING", "DEDUCTION_REJECTED", `${tag}: ${r.reason}`);
    // ATTENDANCE
    if (res.suspensionDays)
      add(
        emp.id,
        "ATTENDANCE",
        "INFO",
        "SUSPENSION_DAYS",
        `${tag}: ${res.suspensionDays} suspension day(s) unpaid.`,
      );
  }

  // LOCATION — wrong mapping controls (client & location mismatch)
  const deps = await db.deployment.findMany({
    where: {
      organizationId: ctx.orgId,
      startDate: { lte: period.endDate },
      OR: [{ endDate: null }, { endDate: { gte: period.startDate } }],
    },
    include: { client: true, beat: true },
  });
  for (const w of a.work.filter((x) => x.locationMismatch && !x.mismatchResolved)) {
    const emp = a.employees.find((e) => e.id === w.employeeId);
    const dep = deps
      .filter(
        (x) => x.employeeId === w.employeeId && x.startDate <= w.date && (!x.endDate || x.endDate >= w.date),
      )
      .sort((p, q) => q.startDate.getTime() - p.startDate.getTime())[0];
    const tag = `${emp?.employeeNumber ?? ""} on ${iso(w.date)}`;
    if (dep && dep.clientId !== w.clientId)
      add(
        w.employeeId,
        "LOCATION",
        "CRITICAL",
        "CLIENT_MISMATCH",
        `RED ALERT — ${CLIENT_MISMATCH} ${tag}: assigned client ${dep.client.name}, work register client ${w.client.name}.`,
      );
    else
      add(
        w.employeeId,
        "LOCATION",
        "CRITICAL",
        "LOCATION_MISMATCH",
        `${LOCATION_MISMATCH} ${tag}: recorded at ${w.beat.name}${dep ? `, assigned to ${dep.beat.name}` : ", no assignment"}.`,
      );
  }

  // OVERTIME — pending schedules & overtime at a beat the employee did not work that day
  const pendingOt = await db.overtime.count({
    where: { organizationId: ctx.orgId, periodId: period.id, status: "PENDING" },
  });
  if (pendingOt)
    add(
      null,
      "OVERTIME",
      "WARNING",
      "OVERTIME_PENDING",
      `${pendingOt} overtime line(s) awaiting approval are not included.`,
    );
  for (const o of a.overtime) {
    const worked = a.work.find((w) => w.employeeId === o.employeeId && w.date.getTime() === o.date.getTime());
    if (!worked || worked.beatId !== o.beatId)
      add(
        o.employeeId,
        "OVERTIME",
        "WARNING",
        "OVERTIME_LOCATION",
        `Overtime on ${iso(o.date)} is at a beat with no matching work register entry.`,
      );
  }
  // ARREARS / DEDUCTIONS pending
  const [pendingArr, pendingDed] = await Promise.all([
    db.arrears.count({ where: { organizationId: ctx.orgId, status: "PENDING" } }),
    db.deduction.count({ where: { organizationId: ctx.orgId, periodId: period.id, status: "PENDING" } }),
  ]);
  if (pendingArr)
    add(
      null,
      "ARREARS",
      "INFO",
      "ARREARS_PENDING",
      `${pendingArr} arrears request(s) awaiting approval are not included.`,
    );
  if (pendingDed)
    add(
      null,
      "DEDUCTIONS",
      "INFO",
      "DEDUCTION_PENDING",
      `${pendingDed} deduction(s) awaiting approval are not included.`,
    );

  // DUPLICATES — flag for review, never delete
  const dups = await findDuplicates(ctx, [...paidIds]);
  for (const f of dups) {
    const sev = f.type === "BANK_ACCOUNT" ? "CRITICAL" : "WARNING";
    add(
      f.employees[0].id,
      "DUPLICATES",
      sev,
      `DUPLICATE_${f.type}`,
      `Suspected duplicate (${f.type.replace("_", " ").toLowerCase()} ${f.value}): ${f.employees.map((e) => e.employeeNumber).join(", ")}.`,
    );
  }
  return issues;
}

// ───────────────────────────── Approval workflow ─────────────────────────────

async function getRun(ctx: Ctx, runId: string) {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, organizationId: ctx.orgId },
    include: { period: true },
  });
  if (!run) throw new BusinessError("Payroll run not found.");
  return run;
}

export async function openCriticalCount(runId: string) {
  return db.payrollValidationIssue.count({
    where: { runId, severity: "CRITICAL", resolved: false, overridden: false },
  });
}

export async function submitForApproval(ctx: Ctx, runId: string) {
  assertCan(ctx, "payroll.run");
  const run = await getRun(ctx, runId);
  if (run.status !== "CALCULATED")
    throw new BusinessError("Only a calculated payroll can be submitted for approval.");
  await db.payrollRun.update({ where: { id: runId }, data: { status: "PENDING_APPROVAL" } });
  if (run.type === "REGULAR")
    await db.payrollPeriod.update({ where: { id: run.periodId }, data: { status: "PENDING_APPROVAL" } });
  await logAudit(ctx, { action: "PAYROLL_SUBMITTED", entity: "PayrollRun", entityId: runId });
}

/** Finance approval. Blocked while any CRITICAL issue is neither resolved nor overridden. */
export async function approveRun(ctx: Ctx, runId: string) {
  assertCan(ctx, "payroll.approve");
  const run = await getRun(ctx, runId);
  if (run.status !== "PENDING_APPROVAL")
    throw new BusinessError("Payroll must be submitted for approval first.");
  const critical = await openCriticalCount(runId);
  if (critical)
    throw new BusinessError(
      `Payroll cannot be approved: ${critical} critical validation error(s) must be resolved or overridden by Finance with a documented reason.`,
    );
  await db.$transaction(async (tx) => {
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "APPROVED" } });
    if (run.type === "REGULAR")
      await tx.payrollPeriod.update({
        where: { id: run.periodId },
        data: { status: "APPROVED", approvedBy: ctx.name, approvedAt: new Date() },
      });
    await logAudit(
      ctx,
      {
        action: "PAYROLL_APPROVAL",
        entity: "PayrollRun",
        entityId: runId,
        newValue: { period: run.period.name, net: num(run.totalNet) },
      },
      tx,
    );
  });
}

export async function returnRun(ctx: Ctx, runId: string, reason: string) {
  assertCan(ctx, "payroll.approve");
  const run = await getRun(ctx, runId);
  if (!["PENDING_APPROVAL", "APPROVED"].includes(run.status))
    throw new BusinessError("Only a payroll awaiting approval (or approved, not locked) can be returned.");
  await db.payrollRun.update({ where: { id: runId }, data: { status: "CALCULATED" } });
  if (run.type === "REGULAR")
    await db.payrollPeriod.update({
      where: { id: run.periodId },
      data: { status: "OPEN", approvedBy: null, approvedAt: null },
    });
  await logAudit(ctx, { action: "PAYROLL_RETURNED", entity: "PayrollRun", entityId: runId, reason });
}

/**
 * Lock: stops normal operational modification for the period. Inputs become PROCESSED and the
 * payroll heads are posted to the general ledger (see accounting.ts).
 */
export async function lockRun(ctx: Ctx, runId: string) {
  assertCan(ctx, "payroll.lock");
  const run = await getRun(ctx, runId);
  if (run.status !== "APPROVED") throw new BusinessError("Only an approved payroll can be locked.");
  await db.$transaction(
    async (tx) => {
      await tx.payrollRun.update({ where: { id: runId }, data: { status: "LOCKED" } });
      const empIds = (
        await tx.payrollRecord.findMany({ where: { runId }, select: { employeeId: true } })
      ).map((r) => r.employeeId);
      const w = {
        organizationId: ctx.orgId,
        periodId: run.periodId,
        status: "APPROVED" as const,
        employeeId: { in: empIds },
      };
      await tx.overtime.updateMany({ where: w, data: { status: "PROCESSED" } });
      await tx.deduction.updateMany({ where: w, data: { status: "PROCESSED" } });
      await tx.otherEarning.updateMany({ where: w, data: { status: "PROCESSED" } });
      await tx.arrears.updateMany({
        where: { organizationId: ctx.orgId, processedRunId: runId },
        data: { status: "PROCESSED" },
      });
      if (run.type === "REGULAR")
        await tx.payrollPeriod.update({
          where: { id: run.periodId },
          data: { status: "LOCKED", lockedBy: ctx.name, lockedAt: new Date() },
        });
      // Payroll heads post to their general-ledger accounts in the same transaction as the lock.
      await postRunToGl(ctx, runId, "PAYROLL_LOCK", tx);
      await logAudit(
        ctx,
        {
          action: "PAYROLL_LOCK",
          entity: "PayrollRun",
          entityId: runId,
          newValue: { period: run.period.name },
        },
        tx,
      );
    },
    { timeout: 60_000 },
  );
}

export async function overrideIssue(ctx: Ctx, issueId: string, reason: string) {
  assertCan(ctx, "payroll.override");
  if (!reason || reason.trim().length < 10)
    throw new BusinessError("A documented reason (at least 10 characters) is required to override.");
  const issue = await db.payrollValidationIssue.findFirst({
    where: { id: issueId, organizationId: ctx.orgId },
    include: { run: true },
  });
  if (!issue) throw new BusinessError("Validation issue not found.");
  if (["APPROVED", "LOCKED", "PAID"].includes(issue.run.status))
    throw new BusinessError("Payroll is already approved.");
  await db.payrollValidationIssue.update({
    where: { id: issueId },
    data: { overridden: true, overrideReason: reason, overriddenBy: ctx.name },
  });
  await logAudit(ctx, {
    action: "VALIDATION_OVERRIDE",
    entity: "PayrollValidationIssue",
    entityId: issueId,
    oldValue: { message: issue.message },
    reason,
  });
}

// ───────────────────────────── Supplementary payroll ─────────────────────────────

/**
 * Post-lock corrections. Picks up approved arrears / other earnings / deductions / overtime that
 * were not processed in the locked run, and pays ONLY those adjustments. PAYE is marginal on top
 * of what the locked run already taxed. The locked run is never edited.
 */
export async function createSupplementaryRun(ctx: Ctx, periodId: string, description: string) {
  assertCan(ctx, "payroll.run");
  const period = await db.payrollPeriod.findFirst({ where: { id: periodId, organizationId: ctx.orgId } });
  if (!period) throw new BusinessError("Payroll period not found.");
  if (!["LOCKED", "PAID", "CLOSED"].includes(period.status))
    throw new BusinessError(
      "Supplementary payroll is only for locked periods — recalculate the open payroll instead.",
    );
  const base = await currentRun(ctx, periodId);
  const a = await assemble(ctx, period, { supplementary: true });
  const rows: Array<{ emp: Assembled["employees"][number]; res: EngineResult }> = [];
  const allEmps = await db.employee.findMany({
    where: { organizationId: ctx.orgId },
    include: { category: true, department: true, deployments: true },
  });
  const locked = base ? await db.payrollRecord.findMany({ where: { runId: base.id } }) : [];
  for (const emp of allEmps) {
    const arr = a.arrears.filter((x) => x.employeeId === emp.id);
    const oth = a.others.filter((x) => x.employeeId === emp.id);
    const ded = a.deductions.filter((x) => x.employeeId === emp.id);
    const ot = a.overtime.filter((x) => x.employeeId === emp.id);
    if (!arr.length && !oth.length && !ded.length && !ot.length) continue;
    const prev = locked.find((r) => r.employeeId === emp.id);
    const basic = prev
      ? num((prev.lines as Array<{ code: string; amount: number }>).find((l) => l.code === "BASIC")?.amount)
      : 0;
    const res = calculateEmployeePayroll({
      basisDays: a.basisDays,
      days: [],
      resolveRate: () => null,
      overtime: ot.map((o) => ({
        id: o.id,
        beatId: o.beatId,
        clientId: o.clientId,
        contractId: o.contractId,
        hours: num(o.hours),
        amount: num(o.amount),
      })),
      arrears: arr.map((x) => ({
        id: x.id,
        grossImpact: num(x.grossImpact),
        pensionableImpact: num(x.pensionableImpact),
      })),
      otherEarnings: oth.map((x) => ({ id: x.id, name: x.name, amount: num(x.amount), taxable: x.taxable })),
      deductions: ded.map((x) => ({
        id: x.id,
        type: x.deductionType,
        amount: num(x.amount),
        authorityReference: x.authorityReference,
        reason: x.reason,
      })),
      pension: {
        employeeRate: a.pension.employeeRate,
        employerRate: a.pension.employerRate,
        version: a.pension.version,
      },
      taxRule: a.tax.def,
      annualRent: emp.annualRent ? num(emp.annualRent) : 0,
      adjustmentsOnly: true,
      payeBase: prev
        ? {
            regularTaxable:
              num(prev.taxableIncome) -
              num(prev.overtimeAmount) -
              num(prev.arrearsAmount) -
              num(prev.otherEarnings),
            employeePension: num(prev.employeePension),
            basic,
          }
        : { regularTaxable: 0, employeePension: 0, basic: 0 },
    });
    rows.push({ emp, res });
  }
  if (!rows.length)
    throw new BusinessError("There are no approved, unprocessed adjustments for this period.");
  const totals = summarize(rows.map((r) => r.res));
  return db.$transaction(async (tx) => {
    const last = await tx.payrollRun.findFirst({ where: { periodId }, orderBy: { runNumber: "desc" } });
    const run = await tx.payrollRun.create({
      data: {
        organizationId: ctx.orgId,
        periodId,
        runNumber: (last?.runNumber ?? 0) + 1,
        type: "SUPPLEMENTARY",
        status: "CALCULATED",
        description,
        taxRuleVersion: `${a.tax.def.code}@${a.tax.def.version}`,
        pensionRuleVersion: a.pension.version,
        ...totals,
        calculatedBy: ctx.name,
        calculatedAt: new Date(),
        calculationCount: 1,
      },
    });
    for (const { emp, res } of rows) {
      const id = randomUUID();
      await tx.payrollRecord.create({
        data: recordRow(ctx.orgId, run.id, id, emp, res, `${a.tax.def.code}@${a.tax.def.version}`),
      });
      for (const al of res.allocations)
        await tx.payrollAllocation.create({
          data: {
            organizationId: ctx.orgId,
            runId: run.id,
            recordId: id,
            employeeId: emp.id,
            clientId: al.clientId,
            contractId: al.contractId,
            beatId: al.beatId,
            days: al.days,
            grossAmount: al.grossAmount,
            overtimeAmount: al.overtimeAmount,
            employerPension: al.employerPension,
            clientBilling: al.clientBilling,
            managementShare: al.managementShare,
            netAmount: al.netAmount,
          },
        });
      const arrIds = a.arrears.filter((x) => x.employeeId === emp.id).map((x) => x.id);
      if (arrIds.length)
        await tx.arrears.updateMany({
          where: { id: { in: arrIds } },
          data: { processedRunId: run.id, processedPeriodId: periodId },
        });
    }
    await logAudit(
      ctx,
      {
        action: "SUPPLEMENTARY_PAYROLL_CREATE",
        entity: "PayrollRun",
        entityId: run.id,
        newValue: { period: period.name, employees: rows.length, net: totals.totalNet },
        reason: description,
      },
      tx,
    );
    return run;
  });
}

// ───────────────────────────── Queries ─────────────────────────────

export async function getRunDetail(ctx: Ctx, runId: string) {
  return db.payrollRun.findFirst({
    where: { id: runId, organizationId: ctx.orgId },
    include: {
      period: true,
      issues: { include: { employee: true }, orderBy: [{ severity: "asc" }, { category: "asc" }] },
    },
  });
}

export async function listRecords(ctx: Ctx, runId: string, q?: string) {
  return db.payrollRecord.findMany({
    where: {
      organizationId: ctx.orgId,
      runId,
      ...(q
        ? {
            OR: [
              { employeeNumber: { contains: q, mode: "insensitive" } },
              { employeeName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { employeeNumber: "asc" },
  });
}

export async function listRuns(ctx: Ctx) {
  return db.payrollRun.findMany({
    where: { organizationId: ctx.orgId },
    include: { period: true },
    orderBy: [{ period: { year: "desc" } }, { period: { month: "desc" } }, { runNumber: "desc" }],
  });
}

/** Payslip — employees may only view their own. */
export async function getPayslip(ctx: Ctx, recordId: string) {
  const rec = await db.payrollRecord.findFirst({
    where: {
      id: recordId,
      organizationId: ctx.orgId,
      ...(ctx.role === "EMPLOYEE" ? { employeeId: ctx.employeeId ?? "__none__" } : {}),
    },
    include: {
      run: { include: { period: true } },
      employee: { include: { category: true, department: true } },
      allocations: { include: { client: true, beat: true } },
    },
  });
  return rec;
}

export async function employeePayslips(ctx: Ctx, employeeId: string) {
  if (ctx.role === "EMPLOYEE" && ctx.employeeId !== employeeId) return [];
  return db.payrollRecord.findMany({
    where: { organizationId: ctx.orgId, employeeId, run: { status: { in: ["APPROVED", "LOCKED", "PAID"] } } },
    include: { run: { include: { period: true } } },
    orderBy: { createdAt: "desc" },
  });
}
