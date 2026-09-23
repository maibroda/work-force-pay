import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { num } from "@/lib/money";
import { validateStructure, type StructureDef } from "@/lib/payroll/structure";
import { validateFormula } from "@/lib/payroll/formula";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";

export const componentSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Code must be letters, digits or underscore")
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2),
  calcType: z.enum(["PERCENTAGE", "FIXED_AMOUNT", "FORMULA"]),
  percentage: z.coerce.number().min(0).max(100).optional().nullable(),
  fixedAmount: z.coerce.number().min(0).optional().nullable(),
  formula: z.string().trim().optional().nullable(),
  taxable: z.coerce.boolean().default(true),
  pensionable: z.coerce.boolean().default(false),
  employerCost: z.coerce.boolean().default(false),
  active: z.coerce.boolean().default(true),
});

export const structureSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .transform((s) => s.toUpperCase()),
  name: z.string().trim().min(3),
  description: z.string().trim().optional(),
  calculationMethod: z.enum(["PERCENTAGE_OF_GROSS", "MIXED"]).default("PERCENTAGE_OF_GROSS"),
  isPartial: z.coerce.boolean().default(false),
  effectiveFrom: z.string().min(10),
  effectiveTo: z.string().optional(),
  components: z.array(componentSchema).min(1, "Add at least one salary component"),
  activate: z.coerce.boolean().default(false),
});
export type StructureInput = z.input<typeof structureSchema>;

function checkFormulas(components: z.output<typeof componentSchema>[]) {
  const vars = ["GROSS", ...components.map((c) => c.code)];
  for (const c of components) {
    if (c.calcType === "FORMULA") {
      const err = validateFormula(c.formula ?? "", vars);
      if (err) throw new BusinessError(`${c.code}: ${err}`);
    }
  }
}

/** Creates a NEW salary structure. The default structure is never modified by this. */
export async function createStructure(ctx: Ctx, raw: StructureInput) {
  assertCan(ctx, "structure.manage");
  const v = structureSchema.parse(raw);
  checkFormulas(v.components);
  const errors = validateStructure({
    isPartial: v.isPartial,
    components: v.components.map((c) => ({ ...c, percentage: c.percentage ?? null })),
  });
  if (v.activate && errors.length) throw new BusinessError(errors.join(" "));
  const exists = await db.salaryStructure.findFirst({ where: { organizationId: ctx.orgId, code: v.code } });
  if (exists) throw new BusinessError(`A salary structure with code ${v.code} already exists.`);
  return db.$transaction(async (tx) => {
    const s = await tx.salaryStructure.create({
      data: {
        organizationId: ctx.orgId,
        code: v.code,
        name: v.name,
        description: v.description,
        calculationMethod: v.calculationMethod,
        isPartial: v.isPartial,
        isDefault: false,
        status: v.activate ? "ACTIVE" : "DRAFT",
        effectiveFrom: d(v.effectiveFrom),
        effectiveTo: v.effectiveTo ? d(v.effectiveTo) : null,
        components: {
          create: v.components.map((c, i) => ({
            code: c.code,
            name: c.name,
            calcType: c.calcType,
            percentage: c.calcType === "PERCENTAGE" ? (c.percentage ?? 0) : null,
            fixedAmount: c.calcType === "FIXED_AMOUNT" ? (c.fixedAmount ?? 0) : null,
            formula: c.calcType === "FORMULA" ? c.formula : null,
            taxable: c.taxable,
            pensionable: c.pensionable,
            employerCost: c.employerCost,
            active: c.active,
            sortOrder: i + 1,
          })),
        },
      },
      include: { components: true },
    });
    await logAudit(
      ctx,
      { action: "SALARY_STRUCTURE_CREATE", entity: "SalaryStructure", entityId: s.id, newValue: s },
      tx,
    );
    return s;
  });
}

/** Only DRAFT structures may be edited in place — active ones are cloned to protect history. */
export async function updateStructure(ctx: Ctx, id: string, raw: StructureInput) {
  assertCan(ctx, "structure.manage");
  const v = structureSchema.parse(raw);
  checkFormulas(v.components);
  const old = await db.salaryStructure.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { components: true },
  });
  if (!old) throw new BusinessError("Salary structure not found.");
  if (old.status !== "DRAFT")
    throw new BusinessError(
      "Only DRAFT structures can be edited. Clone the structure to create a new version.",
    );
  return db.$transaction(async (tx) => {
    await tx.salaryComponent.deleteMany({ where: { structureId: id } });
    const s = await tx.salaryStructure.update({
      where: { id },
      data: {
        name: v.name,
        description: v.description,
        calculationMethod: v.calculationMethod,
        isPartial: v.isPartial,
        effectiveFrom: d(v.effectiveFrom),
        effectiveTo: v.effectiveTo ? d(v.effectiveTo) : null,
        components: {
          create: v.components.map((c, i) => ({
            code: c.code,
            name: c.name,
            calcType: c.calcType,
            percentage: c.calcType === "PERCENTAGE" ? (c.percentage ?? 0) : null,
            fixedAmount: c.calcType === "FIXED_AMOUNT" ? (c.fixedAmount ?? 0) : null,
            formula: c.calcType === "FORMULA" ? c.formula : null,
            taxable: c.taxable,
            pensionable: c.pensionable,
            employerCost: c.employerCost,
            active: c.active,
            sortOrder: i + 1,
          })),
        },
      },
      include: { components: true },
    });
    await logAudit(
      ctx,
      {
        action: "SALARY_STRUCTURE_MODIFY",
        entity: "SalaryStructure",
        entityId: id,
        oldValue: old,
        newValue: s,
      },
      tx,
    );
    return s;
  });
}

export async function activateStructure(ctx: Ctx, id: string) {
  assertCan(ctx, "structure.manage");
  const s = await db.salaryStructure.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { components: true },
  });
  if (!s) throw new BusinessError("Salary structure not found.");
  const errors = validateStructure({
    isPartial: s.isPartial,
    components: s.components.map((c) => ({
      ...c,
      percentage: c.percentage === null ? null : num(c.percentage),
      fixedAmount: c.fixedAmount === null ? null : num(c.fixedAmount),
    })),
  });
  if (errors.length) throw new BusinessError(errors.join(" "));
  const updated = await db.salaryStructure.update({ where: { id }, data: { status: "ACTIVE" } });
  await logAudit(ctx, {
    action: "SALARY_STRUCTURE_ACTIVATE",
    entity: "SalaryStructure",
    entityId: id,
    oldValue: { status: s.status },
    newValue: { status: "ACTIVE" },
  });
  return updated;
}

export async function deactivateStructure(ctx: Ctx, id: string) {
  assertCan(ctx, "structure.manage");
  const s = await db.salaryStructure.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!s) throw new BusinessError("Salary structure not found.");
  if (s.isDefault) throw new BusinessError("The default structure cannot be deactivated.");
  const updated = await db.salaryStructure.update({ where: { id }, data: { status: "INACTIVE" } });
  await logAudit(ctx, {
    action: "SALARY_STRUCTURE_DEACTIVATE",
    entity: "SalaryStructure",
    entityId: id,
    oldValue: { status: s.status },
    newValue: { status: "INACTIVE" },
  });
  return updated;
}

export async function cloneStructure(ctx: Ctx, id: string, newCode: string, newName: string) {
  const s = await db.salaryStructure.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { components: { orderBy: { sortOrder: "asc" } } },
  });
  if (!s) throw new BusinessError("Salary structure not found.");
  return createStructure(ctx, {
    code: newCode,
    name: newName,
    description: `Cloned from ${s.name}`,
    calculationMethod: s.calculationMethod,
    isPartial: s.isPartial,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    components: s.components.map((c) => ({
      code: c.code,
      name: c.name,
      calcType: c.calcType,
      percentage: c.percentage === null ? null : num(c.percentage),
      fixedAmount: c.fixedAmount === null ? null : num(c.fixedAmount),
      formula: c.formula,
      taxable: c.taxable,
      pensionable: c.pensionable,
      employerCost: c.employerCost,
      active: c.active,
    })),
    activate: false,
  });
}

export async function listStructures(ctx: Ctx) {
  return db.salaryStructure.findMany({
    where: { organizationId: ctx.orgId },
    include: {
      components: { orderBy: { sortOrder: "asc" } },
      _count: { select: { contractRates: true, contracts: true } },
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function getStructure(ctx: Ctx, id: string) {
  return db.salaryStructure.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      components: { orderBy: { sortOrder: "asc" } },
      contractRates: { include: { contract: { include: { client: true } }, category: true } },
    },
  });
}

type DbStructure =
  | NonNullable<Awaited<ReturnType<typeof getStructure>>>
  | {
      id: string;
      code: string;
      name: string;
      isPartial: boolean;
      calculationMethod: "PERCENTAGE_OF_GROSS" | "MIXED";
      components: Array<{
        code: string;
        name: string;
        calcType: "PERCENTAGE" | "FIXED_AMOUNT" | "FORMULA";
        percentage: unknown;
        fixedAmount: unknown;
        formula: string | null;
        taxable: boolean;
        pensionable: boolean;
        employerCost: boolean;
        active: boolean;
        sortOrder: number;
      }>;
    };

export function toStructureDef(s: DbStructure): StructureDef {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    isPartial: s.isPartial,
    calculationMethod: s.calculationMethod,
    components: s.components.map((c) => ({
      code: c.code,
      name: c.name,
      calcType: c.calcType,
      percentage: c.percentage === null ? null : num(c.percentage),
      fixedAmount: c.fixedAmount === null ? null : num(c.fixedAmount),
      formula: c.formula,
      taxable: c.taxable,
      pensionable: c.pensionable,
      employerCost: c.employerCost,
      active: c.active,
      sortOrder: c.sortOrder,
    })),
  };
}
