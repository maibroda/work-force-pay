import { db } from "@/lib/db";
import { twoFactorState, type TwoFactorState } from "@/lib/two-factor-policy";
import { ForbiddenError } from "./permissions";

/** Raised for an action by someone whose role must use two-factor sign-in and hasn't set it up yet. */
export class TwoFactorRequiredError extends ForbiddenError {
  constructor() {
    super("two-factor");
    this.message = "Your role must sign in with two-factor authentication. Turn it on under My security first.";
  }
}

const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

/**
 * Where this person stands against the company's two-factor requirement. One cheap lookup of the policy; the
 * user is only read when their role is actually covered.
 */
export async function twoFactorStateFor(who: { userId: string; orgId: string; role: string }): Promise<{ state: TwoFactorState; enforceFrom: Date | null }> {
  const p = await db.hrPolicy.findUnique({ where: { organizationId: who.orgId }, select: { twoFactorRoles: true, twoFactorEnforceFrom: true } });
  const roles: string[] = p?.twoFactorRoles ?? [];
  const enforceFrom = p?.twoFactorEnforceFrom ?? null;
  if (!enforceFrom || !roles.includes(who.role)) return { state: "NOT_REQUIRED", enforceFrom };
  const u = await db.user.findUnique({ where: { id: who.userId }, select: { totpEnabled: true } });
  return { state: twoFactorState({ roles, enforceFrom, role: who.role, enrolled: !!u?.totpEnabled, today: todayUtc() }), enforceFrom };
}
