import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { num } from "@/lib/money";
import { validateStructure, type StructureDef } from "@/lib/payroll/structure";
import { validateFormula } from "@/lib/payroll/formula";
import { assertCan, BusinessError, db, type Tx } from "./_base";
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
  /** The client that owns the structure (blank: company-wide). */
  clientId: z.string().trim().optional().transform((v) => v || undefined),
  /** The client structure this one sits under, as a role structure. */
  parentId: z.string().trim().optional().transform((v) => v || undefined),
  /** The employee category (job role) a role structure is for. */
  categoryId: z.string().trim().optional().transform((v) => v || undefined),
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

/**
 * Where a structure sits (docs/plans/client-salary-structures.md): company-wide, owned by one client, or a role structure under a client's structure for a job category. Two levels only; a
 * role structure belongs to its parent's client; a category belongs only to a role structure. Everything is looked up in the caller's company, so another company's rows are "not found".
 */
async function resolvePlacement(tx: Tx, orgId: string, v: { clientId?: string; parentId?: string; categoryId?: string }) {
  if (v.parentId) {
    const parent = await tx.salaryStructure.findFirst({ where: { id: v.parentId, organizationId: orgId } });
    if (!parent) throw new BusinessError("The parent salary structure was not found.");
    if (!parent.clientId) throw new BusinessError("The parent must be a structure owned by a client (a company-wide structure has no role structures).");
    if (parent.parentId) throw new BusinessError("Role structures go two levels only: a client's structure, then its role structures.");
    if (!v.categoryId) throw new BusinessError("Choose the job category this role structure is for.");
    const category = await tx.employeeCategory.findFirst({ where: { id: v.categoryId, organizationId: orgId } });
    if (!category) throw new BusinessError("Job category not found.");
    if (v.clientId && v.clientId !== parent.clientId) throw new BusinessError("A role structure belongs to the same client as its parent.");
    return { clientId: parent.clientId, parentId: parent.id, categoryId: category.id };
  }
  if (v.categoryId) throw new BusinessError("A job category can only be given to a role structure under a client's structure.");
  if (v.clientId) {
    const client = await tx.client.findFirst({ where: { id: v.clientId, organizationId: orgId }, select: { id: true } });
    if (!client) throw new BusinessError("Client not found.");
    return { clientId: client.id, parentId: null, categoryId: null };
  }
  return { clientId: null, parentId: null, categoryId: null };
}

/** At most one ACTIVE role structure per client structure and category, so the rate card can pick it without guessing (switch the old one off first). */
async function assertOneActiveRole(tx: Tx, orgId: string, parentId: string | null, categoryId: string | null, exceptId?: string) {
  if (!parentId || !categoryId) return;
  const other = await tx.salaryStructure.findFirst({
    where: { organizationId: orgId, parentId, categoryId, status: "ACTIVE", ...(exceptId ? { id: { not: exceptId } } : {}) },
    include: { category: { select: { name: true } } },
  });
  if (other) throw new BusinessError(`There is already an active role structure (${other.code}) for ${other.category?.name ?? "this category"} under this client's structure: switch it off first.`);
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
    const place = await resolvePlacement(tx, ctx.orgId, v);
    if (v.activate) await assertOneActiveRole(tx, ctx.orgId, place.parentId, place.categoryId);
    const s = await tx.salaryStructure.create({
      data: {
        organizationId: ctx.orgId,
        clientId: place.clientId,
        parentId: place.parentId,
        categoryId: place.categoryId,
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
  await assertOneActiveRole(db, ctx.orgId, s.parentId, s.categoryId, s.id);
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
    clientId: s.clientId ?? undefined,
    parentId: s.parentId ?? undefined,
    categoryId: s.categoryId ?? undefined,
  });
}

const copyOf = (components: Array<{ code: string; name: string; calcType: "PERCENTAGE" | "FIXED_AMOUNT" | "FORMULA"; percentage: unknown; fixedAmount: unknown; formula: string | null; taxable: boolean; pensionable: boolean; employerCost: boolean; active: boolean }>) =>
  components.map((c) => ({
    code: c.code,
    name: c.name,
    calcType: c.calcType,
    percentage: c.percentage === null ? null : num(c.percentage as never),
    fixedAmount: c.fixedAmount === null ? null : num(c.fixedAmount as never),
    formula: c.formula,
    taxable: c.taxable,
    pensionable: c.pensionable,
    employerCost: c.employerCost,
    active: c.active,
  }));

/** A salary structure for a CLIENT (for example "ABC Bank salary structure"): a copy of an existing structure (the company's default if none is named), owned by the client, starting as a draft. */
export async function createClientStructure(ctx: Ctx, raw: { clientId: string; code: string; name?: string; copyFromId?: string; effectiveFrom?: string }) {
  assertCan(ctx, "structure.manage");
  const client = await db.client.findFirst({ where: { id: raw.clientId, organizationId: ctx.orgId } });
  if (!client) throw new BusinessError("Client not found.");
  const from = raw.copyFromId
    ? await db.salaryStructure.findFirst({ where: { id: raw.copyFromId, organizationId: ctx.orgId }, include: { components: { orderBy: { sortOrder: "asc" } } } })
    : await db.salaryStructure.findFirst({ where: { organizationId: ctx.orgId, isDefault: true }, include: { components: { orderBy: { sortOrder: "asc" } } } });
  if (!from) throw new BusinessError(raw.copyFromId ? "The structure to copy was not found." : "There is no default structure to start from: choose a structure to copy.");
  return createStructure(ctx, {
    code: raw.code,
    name: raw.name?.trim() || `${client.name} salary structure`,
    description: `For ${client.name}, copied from ${from.name}`,
    calculationMethod: from.calculationMethod,
    isPartial: from.isPartial,
    effectiveFrom: raw.effectiveFrom || new Date().toISOString().slice(0, 10),
    components: copyOf(from.components),
    activate: false,
    clientId: client.id,
  });
}

/** A ROLE structure under a client's structure, for one job category (guard, supervisor, driver, cleaner): a complete copy of the parent, which can then be edited. It starts as a draft. */
export async function createRoleStructure(ctx: Ctx, raw: { parentId: string; categoryId: string; code: string; name?: string; effectiveFrom?: string }) {
  assertCan(ctx, "structure.manage");
  const parent = await db.salaryStructure.findFirst({ where: { id: raw.parentId, organizationId: ctx.orgId }, include: { components: { orderBy: { sortOrder: "asc" } }, client: true } });
  if (!parent) throw new BusinessError("The parent salary structure was not found.");
  const category = await db.employeeCategory.findFirst({ where: { id: raw.categoryId, organizationId: ctx.orgId } });
  return createStructure(ctx, {
    code: raw.code,
    name: raw.name?.trim() || `${parent.client?.name ?? parent.name} — ${category?.name ?? "role"}`,
    description: `Role structure for ${category?.name ?? "a job category"}, copied from ${parent.name}`,
    calculationMethod: parent.calculationMethod,
    isPartial: parent.isPartial,
    effectiveFrom: raw.effectiveFrom || new Date().toISOString().slice(0, 10),
    components: copyOf(parent.components),
    activate: false,
    parentId: parent.id,
    categoryId: raw.categoryId,
  });
}

/**
 * Gives an EXISTING company-wide structure to a client. A client's structure can be used only on that client's contracts, so it is refused if the structure is already used on ANOTHER
 * client's contract rate or as another client's contract default, or by employees' personal pay rates or proposals (those are not tied to a client). The default structure can never be
 * given an owner, and a structure that already belongs to a client (or is a role structure) is not moved. Nothing but the owner changes.
 */
export async function assignStructureToClient(ctx: Ctx, id: string, clientId: string) {
  assertCan(ctx, "structure.manage");
  return db.$transaction(async (tx) => {
    const s = await tx.salaryStructure.findFirst({ where: { id, organizationId: ctx.orgId }, include: { client: { select: { name: true } } } });
    if (!s) throw new BusinessError("Salary structure not found.");
    if (s.isDefault) throw new BusinessError("The default structure can never be given to a client.");
    if (s.clientId || s.parentId) throw new BusinessError(`This structure already belongs to ${s.client?.name ?? "a client"}.`);
    const client = await tx.client.findFirst({ where: { id: clientId, organizationId: ctx.orgId } });
    if (!client) throw new BusinessError("Client not found.");
    const onRates = await tx.contractRate.findMany({ where: { organizationId: ctx.orgId, salaryStructureId: id, contract: { clientId: { not: clientId } } }, select: { contract: { select: { client: { select: { name: true } } } } } });
    const asDefault = await tx.contract.findMany({ where: { organizationId: ctx.orgId, defaultStructureId: id, clientId: { not: clientId } }, select: { client: { select: { name: true } } } });
    const others = [...new Set([...onRates.map((r) => r.contract.client.name), ...asDefault.map((c) => c.client.name)])];
    if (others.length) throw new BusinessError(`This structure is used on ${others.join(" and ")} contracts, so it cannot be given to ${client.name}: a client's structure can be used only on that client's contracts.`);
    const pay = (await tx.employeePayRate.count({ where: { organizationId: ctx.orgId, structureCode: s.code } })) + (await tx.payRateProposal.count({ where: { organizationId: ctx.orgId, structureCode: s.code } }));
    if (pay > 0) throw new BusinessError(`${pay} personal pay rate${pay === 1 ? " uses" : "s use"} this structure, and those are not tied to a client, so it cannot be given to ${client.name}.`);
    const done = await tx.salaryStructure.update({ where: { id }, data: { clientId: client.id } });
    await logAudit(ctx, { action: "SALARY_STRUCTURE_ASSIGN_CLIENT", entity: "SalaryStructure", entityId: id, oldValue: { clientId: null }, newValue: { clientId: client.id } }, tx);
    return done;
  });
}

export async function listStructures(ctx: Ctx) {
  return db.salaryStructure.findMany({
    where: { organizationId: ctx.orgId },
    include: {
      components: { orderBy: { sortOrder: "asc" } },
      client: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
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
      client: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      parent: { select: { id: true, name: true } },
      roles: { include: { category: { select: { name: true } } }, orderBy: { code: "asc" } },
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
