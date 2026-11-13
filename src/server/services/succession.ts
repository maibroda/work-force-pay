/**
 * Succession cover: the critical roles (an employee category) the HR administrator keeps successors for, up to five per role, each with a readiness level and a
 * one-line reason. The most sensitive of the career records: read and kept ONLY by `succession.manage` (the HR administrator; the founder's decision of 2026-11-10).
 * Kept by a person: nothing is suggested or scored. It is never shown to an employee or a manager, never in the HR timeline, and never in a person's copy of
 * their data. The audit log carries ids and the readiness level only, never the reason.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { addDays } from "@/lib/dates";
import { MAX_SUCCESSORS, READINESS_LEVELS, readyNow } from "@/lib/career";
import { assertCan, BusinessError, db } from "./_base";
import { recordSensitiveAccess } from "./sensitive-access";
import { logAudit } from "./audit";
import { todayUtc } from "./hr-policy";

const EMPLOYEE_SELECT = { id: true, employeeNumber: true, firstName: true, lastName: true } as const;
const NOT_FOUND = "Succession role not found.";
const LEAVING_WINDOW_DAYS = 90;

export async function addSuccessionRole(ctx: Ctx, categoryId: string) {
  assertCan(ctx, "succession.manage");
  const cat = await db.employeeCategory.findFirst({ where: { id: categoryId, organizationId: ctx.orgId }, select: { id: true } });
  if (!cat) throw new BusinessError("Role not found.");
  if (await db.successionRole.findFirst({ where: { organizationId: ctx.orgId, categoryId }, select: { id: true } })) throw new BusinessError("This role is already a critical role.");
  const r = await db.successionRole.create({ data: { organizationId: ctx.orgId, categoryId, createdBy: ctx.name } });
  await logAudit(ctx, { action: "SUCCESSION_ROLE_ADD", entity: "SuccessionRole", entityId: r.id, newValue: { categoryId } });
  return r;
}

export async function setSuccessionRoleActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "succession.manage");
  const r = await db.successionRole.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError(NOT_FOUND);
  const u = await db.successionRole.update({ where: { id }, data: { active } });
  await logAudit(ctx, { action: "SUCCESSION_ROLE_UPDATE", entity: "SuccessionRole", entityId: id, newValue: { active } });
  return u;
}

export const successorSchema = z.object({
  roleId: z.string().min(1),
  employeeId: z.string().min(1),
  readiness: z.enum(READINESS_LEVELS),
  reason: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

/** Names someone as a successor, or changes how ready they are (one entry per person per role). At most five per role; never someone already in the role. */
export async function setSuccessor(ctx: Ctx, raw: z.input<typeof successorSchema>) {
  assertCan(ctx, "succession.manage");
  const v = successorSchema.parse(raw);
  const role = await db.successionRole.findFirst({ where: { id: v.roleId, organizationId: ctx.orgId }, include: { candidates: { select: { id: true, employeeId: true } } } });
  if (!role) throw new BusinessError(NOT_FOUND);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId }, select: { id: true, status: true, categoryId: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (emp.status !== "ACTIVE" && emp.status !== "ON_LEAVE") throw new BusinessError("This employee is no longer active, so they can't be a successor.");
  if (emp.categoryId === role.categoryId) throw new BusinessError("This person is already in this role.");
  const existing = role.candidates.find((c) => c.employeeId === emp.id);
  if (!existing && role.candidates.length >= MAX_SUCCESSORS) throw new BusinessError(`A role can have at most ${MAX_SUCCESSORS} successors.`);
  const c = existing
    ? await db.successionCandidate.update({ where: { id: existing.id }, data: { readiness: v.readiness, reason: v.reason ?? null } })
    : await db.successionCandidate.create({ data: { organizationId: ctx.orgId, roleId: role.id, employeeId: emp.id, readiness: v.readiness, reason: v.reason ?? null, createdBy: ctx.name } });
  await logAudit(ctx, { action: "SUCCESSION_SUCCESSOR_SET", entity: "SuccessionCandidate", entityId: c.id, newValue: { roleId: role.id, employeeId: emp.id, readiness: v.readiness } });
  return c;
}

export async function removeSuccessor(ctx: Ctx, id: string) {
  assertCan(ctx, "succession.manage");
  const c = await db.successionCandidate.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!c) throw new BusinessError("Successor not found.");
  await db.successionCandidate.delete({ where: { id } });
  await logAudit(ctx, { action: "SUCCESSION_SUCCESSOR_REMOVE", entity: "SuccessionCandidate", entityId: id, newValue: { roleId: c.roleId, employeeId: c.employeeId } });
  return { id };
}

/** Each critical role with its holders, how many of them are leaving soon (an exit already raised, or a contract ending within 90 days), its successors, and whether anyone is ready now. */
export async function successionOverview(ctx: Ctx) {
  assertCan(ctx, "succession.manage");
  const today = todayUtc();
  const soon = addDays(today, LEAVING_WINDOW_DAYS);
  const roles = await db.successionRole.findMany({
    where: { organizationId: ctx.orgId },
    include: { category: { select: { id: true, name: true } }, candidates: { include: { employee: { select: EMPLOYEE_SELECT } }, orderBy: { createdAt: "asc" } } },
    orderBy: { category: { name: "asc" } },
  });
  const out = [];
  for (const r of roles) {
    const holders = await db.employee.findMany({ where: { organizationId: ctx.orgId, categoryId: r.categoryId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { id: true } });
    const ids = holders.map((h) => h.id);
    const leaving = ids.length
      ? new Set([
          ...(await db.exitRecord.findMany({ where: { organizationId: ctx.orgId, employeeId: { in: ids }, status: { in: ["PENDING", "APPROVED"] }, lastWorkingDate: { gte: today } }, select: { employeeId: true } })).map((x) => x.employeeId),
          ...(await db.employmentContract.findMany({ where: { organizationId: ctx.orgId, employeeId: { in: ids }, status: "ACTIVE", endDate: { gte: today, lte: soon } }, select: { employeeId: true } })).map((x) => x.employeeId),
        ]).size
      : 0;
    out.push({
      id: r.id,
      active: r.active,
      categoryId: r.categoryId,
      role: r.category.name,
      holders: holders.length,
      leavingSoon: leaving,
      covered: readyNow(r.candidates),
      candidates: r.candidates.map((c) => ({ id: c.id, employee: c.employee, readiness: c.readiness, reason: c.reason })),
    });
  }
  // opening the list shows the named successors: recorded with how many, never who (governance step 2a)
  await recordSensitiveAccess(ctx, { kind: "SUCCESSION", ref: "succession-list", count: out.reduce((n, r) => n + r.candidates.length, 0) });
  return out;
}
