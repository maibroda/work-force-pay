/**
 * Who may touch the sales module, checked on the server for every call: the organization's switch (off by default), then the permission, then
 * which records the person may see. A sales person sees the records they own; a manager (sales.view.all) sees everything in the organization.
 */
import type { Ctx } from "@/lib/auth/context";
import { can, type Permission } from "@/lib/auth/permissions";
import { assertCan, BusinessError, db } from "../_base";

export const SWITCHED_OFF = "The sales module is switched off for this organization. A company administrator can switch it on under Sales settings.";

export async function requireSales(ctx: Ctx, permission: Permission, opts: { allowWhenOff?: boolean } = {}) {
  assertCan(ctx, permission);
  if (opts.allowWhenOff) return;
  const setting = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { enabled: true } });
  if (!setting?.enabled) throw new BusinessError(SWITCHED_OFF);
}

export const seesAll = (ctx: Ctx) => can(ctx.role, "sales.view.all");

/** The extra filter that keeps a sales person to their own records. */
export const ownerFilter = (ctx: Ctx): { ownerUserId?: string } => (seesAll(ctx) ? {} : { ownerUserId: ctx.userId });

/** Who a record is assigned to: the person themselves, or (for a manager only) another user of the same organization who may work in sales. */
export async function resolveOwner(ctx: Ctx, wanted: string | undefined): Promise<{ ownerUserId: string; ownerName: string }> {
  if (!wanted || wanted === ctx.userId) return { ownerUserId: ctx.userId, ownerName: ctx.name };
  if (!seesAll(ctx) || !can(ctx.role, "sales.manage")) throw new BusinessError("Only a sales manager may reassign an owner.");
  const user = await db.user.findFirst({ where: { id: wanted, organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true } });
  if (!user) throw new BusinessError("That person is not an active user of this organization.");
  if (!can(user.role, "sales.view")) throw new BusinessError(`${user.name} does not have access to the sales module.`);
  return { ownerUserId: user.id, ownerName: user.name };
}
