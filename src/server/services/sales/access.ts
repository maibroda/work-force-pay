/**
 * Who may touch the sales module, checked on the server for every call: the organization's switch (off by default), then the permission, then
 * which records the person may see. A sales person sees the records they own; a sales manager their own and their teams'; a role with sales.view.all everything in the organization.
 */
import type { Ctx } from "@/lib/auth/context";
import { can, type Permission } from "@/lib/auth/permissions";
import { isSalesManagerRole } from "@/lib/sales/roles";
import { assertCan, BusinessError, db } from "../_base";

export const SWITCHED_OFF = "The sales module is switched off for this organization. A company administrator can switch it on under Sales settings.";

export async function requireSales(ctx: Ctx, permission: Permission, opts: { allowWhenOff?: boolean } = {}) {
  assertCan(ctx, permission);
  await resolveScope(ctx); // whose records this person may see, worked out fresh at the start of every call
  if (opts.allowWhenOff) return;
  const setting = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { enabled: true } });
  if (!setting?.enabled) throw new BusinessError(SWITCHED_OFF);
}

export const seesAll = (ctx: Ctx) => can(ctx.role, "sales.view.all");

type Scope = "all" | string[];
const scopes = new WeakMap<Ctx, Scope>();

/**
 * Whose records a person may see: everyone's (a role that sees all), or a list of people. A sales manager's list is themselves and the members of the teams they manage that are
 * still open; anyone else's is themselves. It is worked out again at the start of every service call (requireSales), so a change to a team is felt at once; until it has been
 * worked out for a call, the narrowest answer (only themselves) is used.
 */
export async function resolveScope(ctx: Ctx): Promise<Scope> {
  let scope: Scope;
  if (can(ctx.role, "sales.view.all")) scope = "all";
  else if (ctx.role === "SALES_MANAGER") {
    const teams = await db.crmTeam.findMany({ where: { organizationId: ctx.orgId, managerUserId: ctx.userId, active: true }, select: { members: { select: { userId: true } } } });
    scope = [...new Set([ctx.userId, ...teams.flatMap((t) => t.members.map((m) => m.userId))])];
  } else scope = [ctx.userId];
  scopes.set(ctx, scope);
  return scope;
}
export const scopeOf = (ctx: Ctx): Scope => scopes.get(ctx) ?? (can(ctx.role, "sales.view.all") ? "all" : [ctx.userId]);

/** Is this person a sales manager (sees everything, or manages a team)? */
export const isManager = (ctx: Ctx) => isSalesManagerRole(ctx.role);
/** May this person see and change records owned by that user? */
export const canSeeOwner = (ctx: Ctx, ownerUserId: string) => {
  const s = scopeOf(ctx);
  return s === "all" || s.includes(ownerUserId);
};

const within = (ids: string[]) => (ids.length === 1 ? ids[0] : { in: ids });
/** The extra filter that keeps a sales person to their own records, and a team manager to their own and their teams'. */
export const ownerFilter = (ctx: Ctx): { ownerUserId?: string | { in: string[] } } => {
  const s = scopeOf(ctx);
  return s === "all" ? {} : { ownerUserId: within(s) };
};
/** The same for things a person logged rather than owns (activities). */
export const actorFilter = (ctx: Ctx): { createdByUserId?: string | { in: string[] } } => {
  const s = scopeOf(ctx);
  return s === "all" ? {} : { createdByUserId: within(s) };
};

/** Who a record is assigned to: the person themselves, or (for a manager only) another user of the same organization who may work in sales. */
export async function resolveOwner(ctx: Ctx, wanted: string | undefined): Promise<{ ownerUserId: string; ownerName: string }> {
  if (!wanted || wanted === ctx.userId) return { ownerUserId: ctx.userId, ownerName: ctx.name };
  if (!isManager(ctx) || !can(ctx.role, "sales.manage")) throw new BusinessError("Only a sales manager may reassign an owner.");
  if (!canSeeOwner(ctx, wanted)) throw new BusinessError("You can only give a record to someone on your team.");
  const user = await db.user.findFirst({ where: { id: wanted, organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true } });
  if (!user) throw new BusinessError("That person is not an active user of this organization.");
  if (!can(user.role, "sales.view")) throw new BusinessError(`${user.name} does not have access to the sales module.`);
  return { ownerUserId: user.id, ownerName: user.name };
}
