import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const recurringDeductionSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .transform((s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_")),
  scope: z.enum(["GLOBAL", "LOCATION", "INDIVIDUAL"]),
  beatId: opt,
  employeeId: opt,
  calcType: z.enum(["PERCENTAGE_OF_GROSS", "FIXED_AMOUNT"]),
  percentage: z.coerce.number().min(0).max(100).optional(),
  fixedAmount: z.coerce.number().min(0).optional(),
  effectiveFrom: z.string().min(10, "Effective date is required"),
  effectiveTo: opt,
  reason: z.string().trim().min(5, "A reason/justification is required"),
});

/** Every business rule for a recurring deduction rule — shared by create and update. */
async function validateRule(ctx: Ctx, v: z.output<typeof recurringDeductionSchema>) {
  if (v.scope === "LOCATION" && !v.beatId)
    throw new BusinessError("Select a beat for a location-wide deduction.");
  if (v.scope === "INDIVIDUAL" && !v.employeeId)
    throw new BusinessError("Select an employee for an individual deduction.");
  if (v.scope !== "LOCATION" && v.beatId)
    throw new BusinessError("A beat only applies to a location-wide deduction.");
  if (v.scope !== "INDIVIDUAL" && v.employeeId)
    throw new BusinessError("An employee only applies to an individual deduction.");
  if (v.calcType === "PERCENTAGE_OF_GROSS" && v.percentage === undefined)
    throw new BusinessError("Percentage is required.");
  if (v.calcType === "FIXED_AMOUNT" && v.fixedAmount === undefined)
    throw new BusinessError("Fixed amount is required.");
  if (v.beatId) {
    const beat = await db.beat.findFirst({ where: { id: v.beatId, organizationId: ctx.orgId } });
    if (!beat) throw new BusinessError("Beat not found.");
  }
  if (v.employeeId) {
    const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId } });
    if (!emp) throw new BusinessError("Employee not found.");
  }
}

/** Recurring deductions are org-wide config — same permission as Employer Cost Rules / Payroll Rules. */
export async function createRecurringDeductionRule(ctx: Ctx, raw: z.input<typeof recurringDeductionSchema>) {
  assertCan(ctx, "settings.manage");
  const v = recurringDeductionSchema.parse(raw);
  await validateRule(ctx, v);
  const exists = await db.recurringDeductionRule.findFirst({
    where: { organizationId: ctx.orgId, code: v.code },
  });
  if (exists) throw new BusinessError("A rule with this code already exists.");
  const rule = await db.recurringDeductionRule.create({
    data: {
      organizationId: ctx.orgId,
      name: v.name,
      code: v.code,
      scope: v.scope,
      beatId: v.beatId ?? null,
      employeeId: v.employeeId ?? null,
      calcType: v.calcType,
      percentage: v.percentage ?? null,
      fixedAmount: v.fixedAmount ?? null,
      effectiveFrom: d(v.effectiveFrom),
      effectiveTo: v.effectiveTo ? d(v.effectiveTo) : null,
      reason: v.reason,
      createdBy: ctx.name,
    },
  });
  await logAudit(ctx, {
    action: "RECURRING_DEDUCTION_RULE_CREATE",
    entity: "RecurringDeductionRule",
    entityId: rule.id,
    newValue: rule,
    reason: v.reason,
  });
  return rule;
}

export async function setRecurringDeductionRuleActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "settings.manage");
  const rule = await db.recurringDeductionRule.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!rule) throw new BusinessError("Rule not found.");
  await db.recurringDeductionRule.update({ where: { id }, data: { active } });
  await logAudit(ctx, {
    action: active ? "RECURRING_DEDUCTION_RULE_ACTIVATE" : "RECURRING_DEDUCTION_RULE_DEACTIVATE",
    entity: "RecurringDeductionRule",
    entityId: id,
  });
}

export async function listRecurringDeductionRules(ctx: Ctx) {
  return db.recurringDeductionRule.findMany({
    where: { organizationId: ctx.orgId },
    include: { beat: { include: { client: true } }, employee: true },
    orderBy: [{ scope: "asc" }, { name: "asc" }],
  });
}

/** Rules active and effective as of a given date — used by the payroll engine integration. */
export async function activeRecurringDeductionRules(orgId: string, asOf: Date) {
  return db.recurringDeductionRule.findMany({
    where: {
      organizationId: orgId,
      active: true,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
    },
  });
}
