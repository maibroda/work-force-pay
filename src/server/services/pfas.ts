import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { DEFAULT_PFAS, PFA_NAME_MAX, PFA_PENCOM_MAX, pfaKey } from "@/lib/pfas";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

/**
 * The company's list of pension fund administrators (docs/plans/employee-records-review.md, recommendation A). The company administrator and the HR manager keep it (`hr.configure`);
 * the people who run payroll and HR can read it (`employee.view`). Every query is for the caller's company only. Audit entries carry ids, the PFA's name (it is a company, not a person)
 * and the names of the fields changed.
 */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const nameSchema = z
  .string({ required_error: "The PFA's name is required." })
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1, "The PFA's name is required.").max(PFA_NAME_MAX, `The name can be at most ${PFA_NAME_MAX} characters.`));
const penComSchema = z.preprocess(
  blank,
  z
    .string()
    .trim()
    .max(PFA_PENCOM_MAX, `The PenCom number can be at most ${PFA_PENCOM_MAX} characters.`)
    .optional(),
);
const createSchema = z.object({ name: nameSchema, penComNumber: penComSchema });
const updateSchema = z.object({ name: nameSchema.optional(), penComNumber: z.preprocess((v) => (v === null ? "" : v), penComSchema).optional() });

export type PfaInput = z.input<typeof createSchema>;

const firstMessage = (e: z.ZodError) => e.issues[0]?.message ?? "That is not valid.";
function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.output<T> {
  const r = schema.safeParse(raw);
  if (!r.success) throw new BusinessError(firstMessage(r.error));
  return r.data;
}

async function findOwn(ctx: Ctx, id: string, tx: Tx = db) {
  const row = await tx.pensionFundAdministrator.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!row) throw new BusinessError("Pension fund administrator not found.");
  return row;
}

async function assertNotDuplicate(ctx: Ctx, name: string, exceptId: string | null, tx: Tx) {
  const key = pfaKey(name);
  const all = await tx.pensionFundAdministrator.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true } });
  if (all.some((p) => p.id !== exceptId && pfaKey(p.name) === key)) throw new BusinessError(`${name} is already on the list.`);
}

/** The list, alphabetically, each with how many of the company's employees have it. `activeOnly` is what an employee can be given. */
export async function listPfas(ctx: Ctx, opts: { activeOnly?: boolean } = {}) {
  assertCan(ctx, "employee.view");
  const rows = await db.pensionFundAdministrator.findMany({ where: { organizationId: ctx.orgId, ...(opts.activeOnly ? { active: true } : {}) } });
  const counts = await db.employee.groupBy({ by: ["pfa"], where: { organizationId: ctx.orgId, pfa: { not: null } }, _count: { _all: true } });
  const byKey = new Map<string, number>();
  for (const c of counts) if (c.pfa) byKey.set(pfaKey(c.pfa), (byKey.get(pfaKey(c.pfa)) ?? 0) + c._count._all);
  return rows.map((r) => ({ ...r, employeeCount: byKey.get(pfaKey(r.name)) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createPfa(ctx: Ctx, raw: PfaInput) {
  assertCan(ctx, "hr.configure");
  const v = parse(createSchema, raw);
  return db.$transaction(async (tx) => {
    await assertNotDuplicate(ctx, v.name, null, tx);
    const row = await tx.pensionFundAdministrator.create({ data: { organizationId: ctx.orgId, name: v.name, penComNumber: v.penComNumber ?? null, createdBy: ctx.name } });
    await logAudit(ctx, { action: "PFA_CREATED", entity: "PensionFundAdministrator", entityId: row.id, newValue: { name: row.name, fields: ["name", ...(row.penComNumber ? ["penComNumber"] : [])] } }, tx);
    return row;
  });
}

/**
 * Changes the name and/or the PenCom number. A new spelling of the name is carried to this company's employees who have the old one (in the same step, so the list and the records never
 * disagree); a payroll already calculated keeps the spelling it was calculated with. Returns how many employees were renamed.
 */
export async function updatePfa(ctx: Ctx, id: string, raw: { name?: string; penComNumber?: string | null }) {
  assertCan(ctx, "hr.configure");
  const v = parse(updateSchema, raw);
  return db.$transaction(async (tx) => {
    const old = await findOwn(ctx, id, tx);
    const data: { name?: string; penComNumber?: string | null } = {};
    const fields: string[] = [];
    if (v.name !== undefined && v.name !== old.name) {
      await assertNotDuplicate(ctx, v.name, id, tx);
      data.name = v.name;
      fields.push("name");
    }
    if (v.penComNumber !== undefined && (v.penComNumber ?? null) !== old.penComNumber) {
      data.penComNumber = v.penComNumber ?? null;
      fields.push("penComNumber");
    }
    let employeesRenamed = 0;
    if (fields.length === 0) return { ...old, employeesRenamed };
    const row = await tx.pensionFundAdministrator.update({ where: { id }, data });
    if (data.name !== undefined) {
      const holders = await tx.employee.findMany({ where: { organizationId: ctx.orgId, pfa: { not: null } }, select: { id: true, pfa: true } });
      const ids = holders.filter((h) => h.pfa && pfaKey(h.pfa) === pfaKey(old.name)).map((h) => h.id);
      if (ids.length) employeesRenamed = (await tx.employee.updateMany({ where: { id: { in: ids }, organizationId: ctx.orgId }, data: { pfa: data.name } })).count;
    }
    await logAudit(ctx, { action: "PFA_UPDATED", entity: "PensionFundAdministrator", entityId: id, newValue: { fields, employeesRenamed } }, tx);
    return { ...row, employeesRenamed };
  });
}

/** Switches one off (it can no longer be chosen; whoever has it keeps it) or on again. */
export async function setPfaActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "hr.configure");
  return db.$transaction(async (tx) => {
    const old = await findOwn(ctx, id, tx);
    if (old.active === active) return old;
    const row = await tx.pensionFundAdministrator.update({ where: { id }, data: { active } });
    await logAudit(ctx, { action: active ? "PFA_SWITCHED_ON" : "PFA_SWITCHED_OFF", entity: "PensionFundAdministrator", entityId: id, newValue: { fields: ["active"] } }, tx);
    return row;
  });
}

/** Removes one from the list, only if no employee has it (otherwise switch it off). */
export async function deletePfa(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.configure");
  await db.$transaction(async (tx) => {
    const old = await findOwn(ctx, id, tx);
    const holders = await tx.employee.findMany({ where: { organizationId: ctx.orgId, pfa: { not: null } }, select: { pfa: true } });
    const n = holders.filter((h) => h.pfa && pfaKey(h.pfa) === pfaKey(old.name)).length;
    if (n > 0) throw new BusinessError(`${old.name} cannot be removed: ${n} employee${n === 1 ? " has" : "s have"} it. Switch it off instead, or move them to another PFA first.`);
    await tx.pensionFundAdministrator.delete({ where: { id } });
    await logAudit(ctx, { action: "PFA_DELETED", entity: "PensionFundAdministrator", entityId: id, newValue: { name: old.name } }, tx);
  });
}

/** Gives a company the starting list, if it has none. Safe to repeat. */
export async function ensureDefaultPfas(tx: Tx, orgId: string) {
  if ((await tx.pensionFundAdministrator.count({ where: { organizationId: orgId } })) > 0) return;
  await tx.pensionFundAdministrator.createMany({ data: DEFAULT_PFAS.map((name) => ({ organizationId: orgId, name, createdBy: "System" })), skipDuplicates: true });
}

/**
 * What to store as an employee's PFA. Blank is none. While the company has no list, whatever was typed is kept (as before the list existed). Once it has one, the PFA must be on it
 * (matched whatever the capitals; stored as the list spells it) and switched on, except that the PFA the employee already has is always accepted unchanged.
 */
export async function resolvePfa(tx: Tx, orgId: string, value: string | null | undefined, current?: string | null): Promise<string | null> {
  const typed = (value ?? "").trim().replace(/\s+/g, " ");
  if (!typed) return null;
  const list = await tx.pensionFundAdministrator.findMany({ where: { organizationId: orgId }, select: { name: true, active: true } });
  if (list.length === 0) return typed;
  const hit = list.find((p) => pfaKey(p.name) === pfaKey(typed));
  const unchanged = current != null && pfaKey(current) === pfaKey(typed);
  if (!hit) {
    if (unchanged) return current as string;
    throw new BusinessError(`“${typed}” is not on your list of pension fund administrators. Add it first under Settings → Pension fund administrators.`);
  }
  if (!hit.active && !unchanged) throw new BusinessError(`${hit.name} is switched off on your list of pension fund administrators, so it cannot be given to an employee. Switch it on under Settings → Pension fund administrators, or choose another.`);
  return hit.name;
}

/** The names an employee can be given, for the pick-lists on forms (any signed-in user of the company, including an employee asking to change their own pension details). */
export async function activePfaNames(orgId: string): Promise<string[]> {
  const rows = await db.pensionFundAdministrator.findMany({ where: { organizationId: orgId, active: true }, select: { name: true } });
  return rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
}
