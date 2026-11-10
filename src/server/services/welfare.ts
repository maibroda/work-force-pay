/**
 * Welfare support: the counts the HR director may see. A welfare request is a case of the always-confidential type WELFARE (relations.ts); only people with
 * welfare.manage read or work one. This page shows how many were raised in a year by kind, with no names and no ids, and hides any group of fewer than five so a
 * person cannot be identified by it. It handles no money.
 */
import type { Ctx } from "@/lib/auth/context";
import { hideSmallGroups, MIN_GROUP, WELFARE_KINDS, WELFARE_KIND_LABELS } from "@/lib/welfare";
import { assertCan, db } from "./_base";
import { todayUtc } from "./hr-policy";

export async function welfareSummary(ctx: Ctx, f: { year?: number } = {}) {
  assertCan(ctx, "welfare.manage");
  const year = f.year ?? todayUtc().getUTCFullYear();
  const groups = await db.relationsCase.groupBy({
    by: ["welfareKind"],
    where: { organizationId: ctx.orgId, type: "WELFARE", openedAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    _count: true,
  });
  const raw = Object.fromEntries(WELFARE_KINDS.map((k) => [k, groups.find((g) => g.welfareKind === k)?._count ?? 0])) as Record<string, number>;
  const shown = hideSmallGroups(raw);
  const total = Object.values(raw).reduce((s, n) => s + n, 0);
  return {
    year,
    minimumGroup: MIN_GROUP,
    byKind: WELFARE_KINDS.map((k) => ({ kind: k, label: WELFARE_KIND_LABELS[k], count: shown[k] })),
    /** Hidden too when fewer than the minimum in all, so the total cannot identify anyone. */
    total: total === 0 || total >= MIN_GROUP ? total : null,
  };
}
