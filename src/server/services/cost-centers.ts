import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const costCenterSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .transform((s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_")),
  name: z.string().trim().min(2, "Name is required"),
  description: opt,
});

export async function createCostCenter(ctx: Ctx, raw: z.input<typeof costCenterSchema>) {
  assertCan(ctx, "settings.manage");
  const v = costCenterSchema.parse(raw);
  const exists = await db.costCenter.findFirst({ where: { organizationId: ctx.orgId, code: v.code } });
  if (exists) throw new BusinessError("A cost center with this code already exists.");
  const cc = await db.costCenter.create({
    data: { organizationId: ctx.orgId, code: v.code, name: v.name, description: v.description ?? null },
  });
  await logAudit(ctx, { action: "COST_CENTER_CREATE", entity: "CostCenter", entityId: cc.id, newValue: cc });
  return cc;
}

export async function setCostCenterActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "settings.manage");
  const cc = await db.costCenter.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!cc) throw new BusinessError("Cost center not found.");
  await db.costCenter.update({ where: { id }, data: { active } });
  await logAudit(ctx, {
    action: active ? "COST_CENTER_ACTIVATE" : "COST_CENTER_DEACTIVATE",
    entity: "CostCenter",
    entityId: id,
  });
}

export async function listCostCenters(ctx: Ctx) {
  return db.costCenter.findMany({
    where: { organizationId: ctx.orgId },
    include: { _count: { select: { departments: true, contracts: true, beats: true } } },
    orderBy: { name: "asc" },
  });
}

// ─────────────────────────────── Assignment ───────────────────────────────

export async function assignCostCenter(
  ctx: Ctx,
  ownerType: "DEPARTMENT" | "CONTRACT" | "BEAT",
  ownerId: string,
  costCenterId: string | null,
) {
  assertCan(ctx, "settings.manage");
  if (costCenterId) {
    const cc = await db.costCenter.findFirst({ where: { id: costCenterId, organizationId: ctx.orgId } });
    if (!cc) throw new BusinessError("Cost center not found.");
  }
  const where = { id: ownerId, organizationId: ctx.orgId };
  if (ownerType === "DEPARTMENT") {
    const owner = await db.department.findFirst({ where });
    if (!owner) throw new BusinessError("Department not found.");
    await db.department.update({ where: { id: ownerId }, data: { costCenterId } });
  } else if (ownerType === "CONTRACT") {
    const owner = await db.contract.findFirst({ where });
    if (!owner) throw new BusinessError("Contract not found.");
    await db.contract.update({ where: { id: ownerId }, data: { costCenterId } });
  } else {
    const owner = await db.beat.findFirst({ where });
    if (!owner) throw new BusinessError("Beat not found.");
    await db.beat.update({ where: { id: ownerId }, data: { costCenterId } });
  }
  await logAudit(ctx, {
    action: "COST_CENTER_ASSIGN",
    entity: ownerType === "DEPARTMENT" ? "Department" : ownerType === "CONTRACT" ? "Contract" : "Beat",
    entityId: ownerId,
    newValue: { costCenterId },
  });
}

// ─────────────────────────────── Budgets ───────────────────────────────

export const costCenterBudgetSchema = z.object({
  costCenterId: z.string().min(1),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  budgetedAmount: z.coerce.number().min(0),
  notes: opt,
});

export async function setCostCenterBudget(ctx: Ctx, raw: z.input<typeof costCenterBudgetSchema>) {
  assertCan(ctx, "settings.manage");
  const v = costCenterBudgetSchema.parse(raw);
  const cc = await db.costCenter.findFirst({ where: { id: v.costCenterId, organizationId: ctx.orgId } });
  if (!cc) throw new BusinessError("Cost center not found.");
  const budget = await db.costCenterBudget.upsert({
    where: { costCenterId_year_month: { costCenterId: v.costCenterId, year: v.year, month: v.month } },
    create: {
      organizationId: ctx.orgId,
      costCenterId: v.costCenterId,
      year: v.year,
      month: v.month,
      budgetedAmount: v.budgetedAmount,
      notes: v.notes ?? null,
      createdBy: ctx.name,
    },
    update: { budgetedAmount: v.budgetedAmount, notes: v.notes ?? null },
  });
  await logAudit(ctx, {
    action: "COST_CENTER_BUDGET_SET",
    entity: "CostCenterBudget",
    entityId: budget.id,
    newValue: budget,
  });
  return budget;
}

export async function listCostCenterBudgets(ctx: Ctx, year: number) {
  return db.costCenterBudget.findMany({
    where: { organizationId: ctx.orgId, year },
    include: { costCenter: true },
    orderBy: [{ costCenter: { name: "asc" } }, { month: "asc" }],
  });
}

// ─────────────────────────────── Actual vs budget ───────────────────────────────

/**
 * Actual cost per cost center for a payroll run. Each allocation resolves to exactly ONE cost
 * center — beat's own assignment first, then its contract's, then the employee's department's —
 * so an allocation is never counted against more than one cost center. Allocations that resolve
 * to none are grouped under "Unassigned" so nothing silently disappears from the total.
 */
export async function costCenterActuals(ctx: Ctx, runId: string) {
  const [centers, allocations, beats, contracts, employees] = await Promise.all([
    db.costCenter.findMany({ where: { organizationId: ctx.orgId } }),
    db.payrollAllocation.findMany({ where: { organizationId: ctx.orgId, runId } }),
    db.beat.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, costCenterId: true } }),
    db.contract.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, costCenterId: true } }),
    db.employee.findMany({
      where: { organizationId: ctx.orgId },
      select: { id: true, department: { select: { costCenterId: true } } },
    }),
  ]);
  const beatCC = new Map(beats.map((b) => [b.id, b.costCenterId]));
  const contractCC = new Map(contracts.map((c) => [c.id, c.costCenterId]));
  const employeeCC = new Map(employees.map((e) => [e.id, e.department?.costCenterId ?? null]));

  const resolve = (a: (typeof allocations)[number]): string | null =>
    (a.beatId && beatCC.get(a.beatId)) ||
    (a.contractId && contractCC.get(a.contractId)) ||
    employeeCC.get(a.employeeId) ||
    null;

  const groups = new Map<string, typeof allocations>();
  for (const a of allocations) {
    const key = resolve(a) ?? "UNASSIGNED";
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  const summarize = (id: string, code: string, name: string, active: boolean, rows: typeof allocations) => {
    const sum = (f: (a: (typeof allocations)[number]) => number) =>
      Math.round(rows.reduce((acc, a) => acc + f(a), 0) * 100) / 100;
    const cost = sum(
      (a) =>
        Number(a.grossAmount) +
        Number(a.overtimeAmount) +
        Number(a.employerPension) +
        Number(a.businessCosts),
    );
    const revenue = sum((a) => Number(a.clientBilling));
    return {
      costCenterId: id,
      code,
      name,
      active,
      headcount: new Set(rows.map((a) => a.employeeId)).size,
      revenue,
      cost,
      margin: Math.round((revenue - cost) * 100) / 100,
    };
  };

  const rows = centers.map((cc) => summarize(cc.id, cc.code, cc.name, cc.active, groups.get(cc.id) ?? []));
  const unassigned = groups.get("UNASSIGNED");
  if (unassigned?.length)
    rows.push(summarize("UNASSIGNED", "—", "Unassigned (no cost center configured)", true, unassigned));
  return rows;
}
