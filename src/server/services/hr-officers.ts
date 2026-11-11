/**
 * The Delegated HR Officer: appointed by the Company Administrator (and platform staff), who then grants one or more of four FIXED functions (src/lib/hr-functions.ts).
 *
 * Rules enforced here: only a holder of `hr.officer.manage` (the Company Administrator, never the HR administrator) appoints, grants, revokes and removes; a function
 * can be granted only to an officer of this company; the administrator who appoints someone gains nothing; a grant needs a reason and is live until revoked or past its end
 * date; an external officer needs an end date and cannot be granted a function beyond it. The grants are read on every request (`loadGrantPermissions`), so revoking takes effect
 * at once. The audit log carries ids and the function name, never a reason.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import type { Permission } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import { HR_FUNCTIONS, liveFunctions, permissionsOf, unheldFunctions, type HrFunction } from "@/lib/hr-functions";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { todayUtc } from "./hr-policy";

const todayIso = () => iso(todayUtc());
const NOT_FOUND = "User not found.";

/** The live grants of one user as permissions: what the request context carries. Revoked and expired grants do not count. */
export async function loadGrantPermissions(userId: string): Promise<Permission[]> {
  const rows = await db.userFunctionGrant.findMany({ where: { userId }, select: { function: true, endsOn: true, revokedAt: true } });
  const live = liveFunctions(
    rows.map((r) => ({ function: r.function as HrFunction, endsOn: r.endsOn ? iso(r.endsOn) : null, revokedAt: r.revokedAt ? iso(r.revokedAt) : null })),
    todayIso(),
  );
  return permissionsOf(live);
}

async function loadUser(ctx: Ctx, userId: string) {
  const u = await db.user.findFirst({ where: { id: userId, organizationId: ctx.orgId }, select: { id: true, role: true, active: true, accessEndsOn: true, external: true } });
  if (!u) throw new BusinessError(NOT_FOUND);
  return u;
}

const appointSchema = z.object({
  external: z.boolean().optional(),
  accessEndsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Makes an existing user a Delegated HR Officer. The role has no HR access until a function is granted. An external officer needs an end date. */
export async function appointOfficer(ctx: Ctx, userId: string, raw: { external?: boolean; accessEndsOn?: string }) {
  assertCan(ctx, "hr.officer.manage");
  const v = appointSchema.parse(raw ?? {});
  const u = await loadUser(ctx, userId);
  if (u.id === ctx.userId) throw new BusinessError("You cannot make yourself an HR officer.");
  // appointing must never switch a deactivated account back on
  if (!u.active) throw new BusinessError("This account is switched off. Switch it on under Users first.");
  if (["SUPER_ADMIN", "COMPANY_ADMIN", "HR_ADMIN"].includes(u.role)) throw new BusinessError("An administrator cannot be made an officer: they already hold their own role.");
  if (v.external && !v.accessEndsOn) throw new BusinessError("An external officer needs an end date: the last day they can sign in.");
  if (v.accessEndsOn && v.accessEndsOn < todayIso()) throw new BusinessError("The end date cannot be in the past.");
  const updated = await db.user.update({
    where: { id: u.id },
    // the session version is bumped so any session open under the old role ends and the new role starts clean
    data: { role: "HR_OFFICER", external: !!v.external, accessEndsOn: v.accessEndsOn ? d(v.accessEndsOn) : null, active: true, sessionVersion: { increment: 1 } },
  });
  await logAudit(ctx, { action: "HR_OFFICER_APPOINT", entity: "User", entityId: u.id, newValue: { external: !!v.external } });
  return updated;
}

/** Ends an officer's appointment: every function is revoked, the account is deactivated and its sessions end. */
export async function removeOfficer(ctx: Ctx, userId: string) {
  assertCan(ctx, "hr.officer.manage");
  const u = await loadUser(ctx, userId);
  if (u.role !== "HR_OFFICER") throw new BusinessError("That user is not a Delegated HR Officer.");
  await db.$transaction(async (tx) => {
    await tx.userFunctionGrant.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedByUserId: ctx.userId, revokedBy: ctx.name, revokeReason: "Appointment ended" } });
    await tx.user.update({ where: { id: userId }, data: { active: false, sessionVersion: { increment: 1 } } });
  });
  await logAudit(ctx, { action: "HR_OFFICER_REMOVE", entity: "User", entityId: userId });
  return { id: userId };
}

const grantSchema = z.object({
  userId: z.string().min(1),
  function: z.enum(HR_FUNCTIONS),
  reason: z.string().trim().min(5, "Give the reason (at least five characters)").max(300),
  endsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Grants one of the four functions to an officer of this company. The administrator who grants it gains nothing. */
export async function grantFunction(ctx: Ctx, raw: z.input<typeof grantSchema>) {
  assertCan(ctx, "hr.officer.manage");
  const v = grantSchema.parse(raw);
  const u = await loadUser(ctx, v.userId);
  if (u.role !== "HR_OFFICER") throw new BusinessError("Only a Delegated HR Officer can be given an HR function.");
  if (!u.active) throw new BusinessError("This officer's appointment has ended.");
  if (v.endsOn && v.endsOn < todayIso()) throw new BusinessError("The end date cannot be in the past.");
  if (v.endsOn && u.accessEndsOn && v.endsOn > iso(u.accessEndsOn)) throw new BusinessError("The grant cannot run past the day this person's access ends.");
  const live = await loadGrantPermissions(u.id);
  if (permissionsOf([v.function]).every((p) => live.includes(p))) throw new BusinessError("This officer already holds that function.");
  const g = await db.userFunctionGrant.create({
    data: { organizationId: ctx.orgId, userId: u.id, function: v.function, reason: v.reason, grantedByUserId: ctx.userId, grantedBy: ctx.name, endsOn: v.endsOn ? d(v.endsOn) : null },
  });
  await logAudit(ctx, { action: "HR_OFFICER_FUNCTION_GRANT", entity: "UserFunctionGrant", entityId: g.id, newValue: { userId: u.id, function: v.function } });
  return g;
}

export async function revokeFunction(ctx: Ctx, grantId: string, reason: string) {
  assertCan(ctx, "hr.officer.manage");
  const why = z.string().trim().min(5, "Give the reason (at least five characters)").max(300).parse(reason ?? "");
  const g = await db.userFunctionGrant.findFirst({ where: { id: grantId, organizationId: ctx.orgId }, select: { id: true, userId: true, function: true, revokedAt: true } });
  if (!g) throw new BusinessError("Grant not found.");
  if (g.revokedAt) throw new BusinessError("This grant is already revoked.");
  const u = await db.userFunctionGrant.update({ where: { id: grantId }, data: { revokedAt: new Date(), revokedByUserId: ctx.userId, revokedBy: ctx.name, revokeReason: why } });
  await logAudit(ctx, { action: "HR_OFFICER_FUNCTION_REVOKE", entity: "UserFunctionGrant", entityId: grantId, newValue: { userId: g.userId, function: g.function } });
  return u;
}

/** The officers of this company with their live functions, for the Company Administrator. */
export async function listOfficers(ctx: Ctx) {
  assertCan(ctx, "hr.officer.manage");
  const officers = await db.user.findMany({
    where: { organizationId: ctx.orgId, role: "HR_OFFICER" },
    select: { id: true, name: true, email: true, active: true, external: true, accessEndsOn: true, employeeId: true, functionGrants: { select: { id: true, function: true, reason: true, grantedBy: true, grantedAt: true, endsOn: true, revokedAt: true } } },
    orderBy: { name: "asc" },
  });
  const today = todayIso();
  return officers.map((o) => ({
    id: o.id,
    name: o.name,
    email: o.email,
    active: o.active,
    external: o.external,
    accessEndsOn: o.accessEndsOn,
    functions: liveFunctions(o.functionGrants.map((g) => ({ function: g.function as HrFunction, endsOn: g.endsOn ? iso(g.endsOn) : null, revokedAt: g.revokedAt ? iso(g.revokedAt) : null })), today),
    grants: o.functionGrants.filter((g) => !g.revokedAt).map((g) => ({ id: g.id, function: g.function as HrFunction, reason: g.reason, grantedBy: g.grantedBy, grantedAt: g.grantedAt, endsOn: g.endsOn })),
  }));
}

/** The functions nobody in the company holds (no active HR administrator, no active officer with a live grant), for the notice to the Company Administrator. */
export async function unheldFunctionsFor(ctx: Ctx): Promise<HrFunction[]> {
  assertCan(ctx, "hr.officer.manage");
  const people = await db.user.findMany({
    where: { organizationId: ctx.orgId, active: true, role: { in: ["HR_ADMIN", "HR_OFFICER"] } },
    select: { role: true, accessEndsOn: true, functionGrants: { select: { function: true, endsOn: true, revokedAt: true } } },
  });
  const today = todayIso();
  return unheldFunctions(
    people
      .filter((p) => !p.accessEndsOn || iso(p.accessEndsOn) >= today)
      .map((p) => ({ role: p.role, functions: liveFunctions(p.functionGrants.map((g) => ({ function: g.function as HrFunction, endsOn: g.endsOn ? iso(g.endsOn) : null, revokedAt: g.revokedAt ? iso(g.revokedAt) : null })), today) })),
  );
}
