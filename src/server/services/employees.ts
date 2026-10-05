import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";
import { seedOnboardingTasks } from "./hr";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const employeeSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  middleName: opt,
  lastName: z.string().trim().min(1, "Last name is required"),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  dateOfBirth: opt,
  phone: opt,
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  address: opt,
  employmentDate: z.string().min(10, "Employment date is required"),
  status: z
    .enum(["ACTIVE", "INACTIVE", "SUSPENDED", "ON_LEAVE", "TERMINATED", "RESIGNED", "EXITED"])
    .default("ACTIVE"),
  exitDate: opt,
  categoryId: z.string().min(1, "Category is required"),
  departmentId: opt,
  reportingManagerId: opt,
  bankName: opt,
  accountNumber: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || /^\d{10}$/.test(v), "Account number must be 10 digits (NUBAN)"),
  accountName: opt,
  taxId: opt,
  pensionPin: opt,
  pfa: opt,
  annualRent: z.coerce.number().min(0).optional(),
});
export type EmployeeInput = z.input<typeof employeeSchema>;

function toData(v: z.output<typeof employeeSchema>) {
  return {
    firstName: v.firstName,
    middleName: v.middleName ?? null,
    lastName: v.lastName,
    gender: v.gender ?? null,
    dateOfBirth: v.dateOfBirth ? d(v.dateOfBirth) : null,
    phone: v.phone ?? null,
    email: v.email ?? null,
    address: v.address ?? null,
    employmentDate: d(v.employmentDate),
    status: v.status,
    exitDate: v.exitDate ? d(v.exitDate) : null,
    categoryId: v.categoryId,
    departmentId: v.departmentId ?? null,
    reportingManagerId: v.reportingManagerId ?? null,
    bankName: v.bankName ?? null,
    accountNumber: v.accountNumber || null,
    accountName: v.accountName ?? null,
    taxId: v.taxId ?? null,
    pensionPin: v.pensionPin ?? null,
    pfa: v.pfa ?? null,
    annualRent: v.annualRent ?? null,
  };
}

async function assertOrgRefs(
  ctx: Ctx,
  categoryId: string,
  departmentId?: string | null,
  reportingManagerId?: string | null,
  selfId?: string,
) {
  const cat = await db.employeeCategory.findFirst({ where: { id: categoryId, organizationId: ctx.orgId } });
  if (!cat) throw new BusinessError("Employee category not found.");
  if (departmentId) {
    const dep = await db.department.findFirst({ where: { id: departmentId, organizationId: ctx.orgId } });
    if (!dep) throw new BusinessError("Department not found.");
  }
  if (reportingManagerId) {
    if (reportingManagerId === selfId) throw new BusinessError("An employee cannot report to themselves.");
    const mgr = await db.employee.findFirst({
      where: { id: reportingManagerId, organizationId: ctx.orgId },
    });
    if (!mgr) throw new BusinessError("Reporting manager not found.");
  }
}

/** Creates an employee. The employee number is ALWAYS system-generated from the numbering rule. */
export async function createEmployee(ctx: Ctx, raw: EmployeeInput) {
  assertCan(ctx, "employee.manage");
  const v = employeeSchema.parse(raw);
  await assertOrgRefs(ctx, v.categoryId, v.departmentId, v.reportingManagerId);
  return db.$transaction((tx) => createEmployeeInTx(ctx, tx, v));
}

/** The transactional core of createEmployee — also used when a recruitment candidate is hired. */
export async function createEmployeeInTx(ctx: Ctx, tx: Tx, v: z.output<typeof employeeSchema>) {
  const employeeNumber = await nextNumber(tx, ctx.orgId, "EMPLOYEE");
  const emp = await tx.employee.create({
    data: { organizationId: ctx.orgId, employeeNumber, ...toData(v) },
  });
  await logAudit(
    ctx,
    {
      action: "EMPLOYEE_NUMBER_GENERATED",
      entity: "Employee",
      entityId: emp.id,
      newValue: { employeeNumber },
    },
    tx,
  );
  await logAudit(ctx, { action: "EMPLOYEE_CREATE", entity: "Employee", entityId: emp.id, newValue: emp }, tx);
  await seedOnboardingTasks(ctx, emp.id, tx);
  return emp;
}

const SENSITIVE_BANK = ["bankName", "accountNumber", "accountName"] as const;
const SENSITIVE_PENSION = ["pensionPin", "pfa"] as const;
const SENSITIVE_TAX = ["taxId", "annualRent"] as const;

/** Updates employee master data. Employee number is immutable and never changes on transfer. */
export async function updateEmployee(ctx: Ctx, id: string, raw: EmployeeInput, reason?: string) {
  assertCan(ctx, "employee.manage");
  const v = employeeSchema.parse(raw);
  await assertOrgRefs(ctx, v.categoryId, v.departmentId, v.reportingManagerId, id);
  return db.$transaction(async (tx) => {
    const old = await tx.employee.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!old) throw new BusinessError("Employee not found.");
    const data = toData(v);
    const emp = await tx.employee.update({ where: { id }, data });
    await logAudit(
      ctx,
      { action: "EMPLOYEE_UPDATE", entity: "Employee", entityId: id, oldValue: old, newValue: emp, reason },
      tx,
    );
    const changed = (keys: readonly string[]) =>
      keys.some(
        (k) =>
          String((old as Record<string, unknown>)[k] ?? "") !==
          String((emp as Record<string, unknown>)[k] ?? ""),
      );
    if (changed(SENSITIVE_BANK))
      await logAudit(
        ctx,
        {
          action: "BANK_INFORMATION_CHANGE",
          entity: "Employee",
          entityId: id,
          oldValue: pick(old, SENSITIVE_BANK),
          newValue: pick(emp, SENSITIVE_BANK),
          reason,
        },
        tx,
      );
    if (changed(SENSITIVE_PENSION))
      await logAudit(
        ctx,
        {
          action: "PENSION_INFORMATION_CHANGE",
          entity: "Employee",
          entityId: id,
          oldValue: pick(old, SENSITIVE_PENSION),
          newValue: pick(emp, SENSITIVE_PENSION),
          reason,
        },
        tx,
      );
    if (changed(SENSITIVE_TAX))
      await logAudit(
        ctx,
        {
          action: "TAX_INFORMATION_CHANGE",
          entity: "Employee",
          entityId: id,
          oldValue: pick(old, SENSITIVE_TAX),
          newValue: pick(emp, SENSITIVE_TAX),
          reason,
        },
        tx,
      );
    return emp;
  });
}

function pick(o: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

export async function listEmployees(
  ctx: Ctx,
  f: {
    q?: string;
    status?: string;
    categoryId?: string;
    clientId?: string;
    beatId?: string;
    unassigned?: boolean;
    take?: number;
    skip?: number;
  } = {},
) {
  const where: Prisma.EmployeeWhereInput = {
    organizationId: ctx.orgId,
    ...(f.status ? { status: f.status as Prisma.EnumEmployeeStatusFilter["equals"] } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.clientId ? { currentClientId: f.clientId } : {}),
    ...(f.beatId ? { currentBeatId: f.beatId } : {}),
    ...(f.unassigned ? { currentBeatId: null, status: "ACTIVE" } : {}),
    ...(f.q
      ? {
          OR: [
            { employeeNumber: { contains: f.q, mode: "insensitive" } },
            { firstName: { contains: f.q, mode: "insensitive" } },
            { lastName: { contains: f.q, mode: "insensitive" } },
            { phone: { contains: f.q } },
            { accountNumber: { contains: f.q } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.employee.findMany({
      where,
      include: { category: true, department: true, currentBeat: true, currentClient: true },
      orderBy: { employeeNumber: "asc" },
      take: f.take ?? 50,
      skip: f.skip ?? 0,
    }),
    db.employee.count({ where }),
  ]);
  return { rows, total };
}

/** Tenancy-safe single fetch: returns null for another organization's employee. */
export async function getEmployee(ctx: Ctx, id: string) {
  return db.employee.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      category: true,
      department: true,
      currentBeat: true,
      currentClient: true,
      reportingManager: true,
      directReports: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
      deployments: {
        include: { beat: true, client: true, contract: true, category: true },
        orderBy: { startDate: "desc" },
      },
      movements: {
        include: { fromBeat: true, toBeat: true, fromClient: true, toClient: true },
        orderBy: { effectiveDate: "desc" },
      },
      salaryOverrides: { orderBy: { effectiveFrom: "desc" } },
      payRates: { orderBy: { effectiveFrom: "desc" } },
      documents: { orderBy: { createdAt: "desc" } },
      trainings: { orderBy: { createdAt: "desc" } },
      disciplinaryRecords: { orderBy: { createdAt: "desc" } },
      onboardingTasks: { orderBy: { sortOrder: "asc" } },
      exitRecords: {
        include: { tasks: { orderBy: { sortOrder: "asc" } }, settlement: true },
        orderBy: { createdAt: "desc" },
      },
      employmentContracts: { orderBy: { startDate: "desc" } },
    },
  });
}

export async function getEmployeeByNumber(ctx: Ctx, employeeNumber: string) {
  return db.employee.findFirst({ where: { organizationId: ctx.orgId, employeeNumber } });
}

// ─────────────────────────── Duplicate personnel ───────────────────────────

export interface DuplicateFlag {
  type: "BANK_ACCOUNT" | "TAX_ID" | "PENSION_PIN" | "NAME_DOB" | "NAME_SIMILAR" | "PHONE";
  value: string;
  employees: Array<{ id: string; employeeNumber: string; name: string }>;
}

function normName(s: string) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

/** Levenshtein distance — used for fuzzy name similarity. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[m][n];
}

/** Flags suspected duplicates for review. Never deletes anything. */
export async function findDuplicates(ctx: Ctx, onlyEmployeeIds?: string[]): Promise<DuplicateFlag[]> {
  const emps = await db.employee.findMany({
    where: { organizationId: ctx.orgId, status: { notIn: ["EXITED", "TERMINATED", "RESIGNED"] } },
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      middleName: true,
      lastName: true,
      accountNumber: true,
      bankName: true,
      taxId: true,
      pensionPin: true,
      dateOfBirth: true,
      phone: true,
    },
  });
  const flags: DuplicateFlag[] = [];
  const group = (type: DuplicateFlag["type"], keyFn: (e: (typeof emps)[number]) => string | null) => {
    const map = new Map<string, typeof emps>();
    for (const e of emps) {
      const k = keyFn(e);
      if (!k) continue;
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    for (const [value, list] of map)
      if (list.length > 1)
        flags.push({
          type,
          value,
          employees: list.map((e) => ({ id: e.id, employeeNumber: e.employeeNumber, name: fullName(e) })),
        });
  };
  group("BANK_ACCOUNT", (e) => (e.accountNumber ? `${e.accountNumber}` : null));
  group("TAX_ID", (e) => e.taxId);
  group("PENSION_PIN", (e) => e.pensionPin);
  group("PHONE", (e) => e.phone);
  group("NAME_DOB", (e) =>
    e.dateOfBirth
      ? `${normName(e.firstName + e.lastName)}|${e.dateOfBirth.toISOString().slice(0, 10)}`
      : null,
  );
  // Fuzzy: same last name and first names within edit distance 1 (e.g. "Ibrahim" vs "Ibraheem" → 2 is excluded)
  const byLast = new Map<string, typeof emps>();
  for (const e of emps) byLast.set(normName(e.lastName), [...(byLast.get(normName(e.lastName)) ?? []), e]);
  for (const list of byLast.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = normName(list[i].firstName);
        const b = normName(list[j].firstName);
        if (a !== b && levenshtein(a, b) <= 1 && a.length > 3) {
          flags.push({
            type: "NAME_SIMILAR",
            value: `${fullName(list[i])} ~ ${fullName(list[j])}`,
            employees: [list[i], list[j]].map((e) => ({
              id: e.id,
              employeeNumber: e.employeeNumber,
              name: fullName(e),
            })),
          });
        }
      }
  }
  if (!onlyEmployeeIds) return flags;
  const set = new Set(onlyEmployeeIds);
  return flags.filter((f) => f.employees.some((e) => set.has(e.id)));
}

// ─────────────────────── Salary overrides & pay rates ───────────────────────

export const overrideSchema = z.object({
  employeeId: z.string().min(1),
  componentCode: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.toUpperCase()),
  calcType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
  percentage: z.coerce.number().min(0).max(100).optional(),
  fixedAmount: z.coerce.number().min(0).optional(),
  reason: z.string().trim().min(5, "A reason is required"),
  effectiveFrom: z.string().min(10, "Effective date is required"),
  effectiveTo: z.string().optional(),
  approvedBy: z.string().trim().min(2, "Approved By is required"),
});

/** Employee Salary Override — never silently overwrites the base structure. */
export async function createSalaryOverride(ctx: Ctx, raw: z.input<typeof overrideSchema>) {
  assertCan(ctx, "override.manage");
  const v = overrideSchema.parse(raw);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (v.calcType === "PERCENTAGE" && v.percentage === undefined)
    throw new BusinessError("Percentage is required.");
  if (v.calcType === "FIXED_AMOUNT" && v.fixedAmount === undefined)
    throw new BusinessError("Fixed amount is required.");
  return db.$transaction(async (tx) => {
    const o = await tx.employeeSalaryOverride.create({
      data: {
        organizationId: ctx.orgId,
        employeeId: v.employeeId,
        componentCode: v.componentCode,
        calcType: v.calcType,
        percentage: v.percentage ?? null,
        fixedAmount: v.fixedAmount ?? null,
        reason: v.reason,
        effectiveFrom: d(v.effectiveFrom),
        effectiveTo: v.effectiveTo ? d(v.effectiveTo) : null,
        approvedBy: v.approvedBy,
        status: "APPROVED",
      },
    });
    await logAudit(
      ctx,
      {
        action: "EMPLOYEE_SALARY_OVERRIDE",
        entity: "Employee",
        entityId: v.employeeId,
        newValue: o,
        reason: v.reason,
      },
      tx,
    );
    return o;
  });
}

export const payRateSchema = z.object({
  employeeId: z.string().min(1),
  monthlyGross: z.coerce.number().positive(),
  structureCode: z.string().optional(),
  reason: z.string().trim().min(3),
  approvedBy: z.string().trim().min(2),
  effectiveFrom: z.string().min(10),
});

/** Effective-dated employee gross. Closes the previous open rate the day before. History is never overwritten. */
export async function createPayRate(ctx: Ctx, raw: z.input<typeof payRateSchema>) {
  assertCan(ctx, "override.manage");
  const v = payRateSchema.parse(raw);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  const from = d(v.effectiveFrom);
  return db.$transaction(async (tx) => {
    const open = await tx.employeePayRate.findMany({
      where: { employeeId: v.employeeId, organizationId: ctx.orgId, effectiveTo: null },
    });
    for (const r of open) {
      if (r.effectiveFrom >= from)
        throw new BusinessError("A pay rate already starts on or after this date.");
      await tx.employeePayRate.update({
        where: { id: r.id },
        data: { effectiveTo: new Date(from.getTime() - 86400000) },
      });
    }
    const rate = await tx.employeePayRate.create({
      data: {
        organizationId: ctx.orgId,
        employeeId: v.employeeId,
        monthlyGross: v.monthlyGross,
        structureCode: v.structureCode || null,
        reason: v.reason,
        approvedBy: v.approvedBy,
        effectiveFrom: from,
      },
    });
    await logAudit(
      ctx,
      {
        action: "EMPLOYEE_PAY_RATE_CHANGE",
        entity: "Employee",
        entityId: v.employeeId,
        newValue: rate,
        reason: v.reason,
      },
      tx,
    );
    return rate;
  });
}

// ──────────────────────── Categories / departments ────────────────────────

export async function listCategories(ctx: Ctx) {
  return db.employeeCategory.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { name: "asc" },
    include: { _count: { select: { employees: true } } },
  });
}
export async function listDepartments(ctx: Ctx) {
  return db.department.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { name: "asc" },
    include: { _count: { select: { employees: true } } },
  });
}
export async function createCategory(ctx: Ctx, v: { code: string; name: string; description?: string }) {
  assertCan(ctx, "employee.manage");
  const c = await db.employeeCategory.create({
    data: { organizationId: ctx.orgId, code: v.code.toUpperCase(), name: v.name, description: v.description },
  });
  await logAudit(ctx, { action: "CATEGORY_CREATE", entity: "EmployeeCategory", entityId: c.id, newValue: c });
  return c;
}
export async function createDepartment(ctx: Ctx, v: { code: string; name: string }) {
  assertCan(ctx, "employee.manage");
  const c = await db.department.create({
    data: { organizationId: ctx.orgId, code: v.code.toUpperCase(), name: v.name },
  });
  await logAudit(ctx, { action: "DEPARTMENT_CREATE", entity: "Department", entityId: c.id, newValue: c });
  return c;
}
