import { db } from "@/lib/db";
import { combineTwoFactor, twoFactorState, type TwoFactorState } from "@/lib/two-factor-policy";
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

export const CLIENT_ROLES: readonly string[] = ["CLIENT_APPROVER", "CLIENT_HR"];

/**
 * Where this person stands against the two-factor requirements that apply to them: their organization's policy by role, the bureau's rule for
 * all its staff, or the portal's rule for a client's own people.
 */

export async function twoFactorStateFor(who: { userId: string; orgId: string; role: string }): Promise<{ state: TwoFactorState; enforceFrom: Date | null }> {
  // a client's own people always sign in with a second factor: no grace period, no policy to switch off
  if (CLIENT_ROLES.includes(who.role)) {
    const u = await db.user.findUnique({ where: { id: who.userId }, select: { totpEnabled: true } });
    return { state: u?.totpEnabled ? "ENROLLED" : "BLOCKED", enforceFrom: null };
  }
  const [p, u] = await Promise.all([
    db.hrPolicy.findUnique({ where: { organizationId: who.orgId }, select: { twoFactorRoles: true, twoFactorEnforceFrom: true } }),
    db.user.findUnique({ where: { id: who.userId }, select: { totpEnabled: true, organization: { select: { isBureau: true, staffTwoFactorFrom: true } } } }),
  ]);
  const roles: string[] = p?.twoFactorRoles ?? [];
  const enforceFrom = p?.twoFactorEnforceFrom ?? null;
  const enrolled = !!u?.totpEnabled;
  const today = todayUtc();
  const own = { state: twoFactorState({ roles, enforceFrom, role: who.role, enrolled, today }), enforceFrom };
  // everyone who works for a bureau is covered, in the bureau itself and while working inside a client, from the bureau's start day
  if (u?.organization.isBureau && u.organization.staffTwoFactorFrom) {
    const from = u.organization.staffTwoFactorFrom;
    return combineTwoFactor(own, { state: twoFactorState({ roles: [who.role], enforceFrom: from, role: who.role, enrolled, today }), enforceFrom: from });
  }
  return own;
}
