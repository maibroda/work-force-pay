/**
 * Who else could sign off (governance step 2b): how many OTHER people in the company hold the right needed, so the second-person rule (src/lib/second-person.ts) knows whether a
 * single holder may sign off their own work. A holder is an ACTIVE user of this company, other than the actor, whose role holds the right, or who is a Delegated HR Officer with a
 * live grant of the function that opens it, and whose access (if outsourced) has not ended. Another company's people never count.
 */
import type { Ctx } from "@/lib/auth/context";
import type { Permission, Role } from "@/lib/auth/permissions";
import { iso } from "@/lib/dates";
import { accessEnded, canCtx, liveFunctions, permissionsOf, type HrFunction } from "@/lib/hr-functions";
import { db } from "./_base";
import { todayUtc } from "./hr-policy";

/** The number of other holders of ALL of the permissions given (for example a sanction is approved by someone with both `hr.approve` and `discipline.manage`). */
export async function otherHolders(ctx: Ctx, required: Permission | Permission[]): Promise<number> {
  const needed = Array.isArray(required) ? required : [required];
  const today = iso(todayUtc());
  const users = await db.user.findMany({
    where: { organizationId: ctx.orgId, active: true, id: { not: ctx.userId } },
    select: { role: true, accessEndsOn: true, functionGrants: { select: { function: true, endsOn: true, revokedAt: true } } },
  });
  return users.filter((u) => {
    if (accessEnded(u.accessEndsOn ? iso(u.accessEndsOn) : null, today)) return false;
    const grants =
      u.role === "HR_OFFICER"
        ? permissionsOf(liveFunctions(u.functionGrants.map((g) => ({ function: g.function as HrFunction, endsOn: g.endsOn ? iso(g.endsOn) : null, revokedAt: g.revokedAt ? iso(g.revokedAt) : null })), today))
        : undefined;
    return needed.every((p) => canCtx({ role: u.role as Role, grants }, p));
  }).length;
}
