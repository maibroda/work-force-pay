/**
 * Attrition report — who left, why, when and after how long, from approved exits. Turns the reason
 * category, exit type and rehire flag captured at exit into the numbers HR is asked for: turnover rate,
 * voluntary vs involuntary, early leavers, and the breakdowns by reason, category, department and tenure.
 */
import type { Ctx } from "@/lib/auth/context";
import { exitNature, pct, tenureBand, TENURE_BANDS, turnoverRates } from "@/lib/attrition";
import { addDays, d, iso } from "@/lib/dates";
import { assertCan, BusinessError, db } from "./_base";
import { todayUtc } from "./hr-policy";

const GONE = ["EXITED", "TERMINATED", "RESIGNED"];
const DAY = 86400000;

interface Slice {
  key: string;
  count: number;
  pct: number;
}

function slices(counts: Map<string, number>, total: number, order?: readonly string[]): Slice[] {
  const rows = [...counts.entries()].map(([key, count]) => ({ key, count, pct: pct(count, total) }));
  return order
    ? rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    : rows.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export async function attritionReport(ctx: Ctx, fromStr?: string, toStr?: string) {
  assertCan(ctx, "hr.view");
  const today = todayUtc();
  const to = toStr ? d(toStr) : today;
  const from = fromStr ? d(fromStr) : addDays(to, -364);
  if (to < from) throw new BusinessError("The end date can't be before the start date.");
  const days = Math.round((to.getTime() - from.getTime()) / DAY) + 1;

  const headcountOn = (date: Date) =>
    db.employee.count({
      where: {
        organizationId: ctx.orgId,
        employmentDate: { lte: date },
        OR: [{ exitDate: { gt: date } }, { exitDate: null, status: { notIn: GONE as never } }],
      },
    });
  const [exits, headcountStart, headcountEnd] = await Promise.all([
    db.exitRecord.findMany({
      where: { organizationId: ctx.orgId, status: "APPROVED", lastWorkingDate: { gte: from, lte: to } },
      include: { employee: { include: { category: true, department: true } } },
      orderBy: { lastWorkingDate: "asc" },
    }),
    headcountOn(addDays(from, -1)),
    headcountOn(to),
  ]);

  const total = exits.length;
  const byReason = new Map<string, number>();
  const byType = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byDepartment = new Map<string, number>();
  const byTenure = new Map<string, number>(TENURE_BANDS.map((b) => [b, 0]));
  const byMonth = new Map<string, number>();
  const nature = { VOLUNTARY: 0, INVOLUNTARY: 0, OTHER: 0 };
  let tenureDays = 0;
  let early = 0;
  let notRehire = 0;
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  // every month in the window, so a quiet month shows as zero instead of vanishing
  for (let y = from.getUTCFullYear(), m = from.getUTCMonth(); y < to.getUTCFullYear() || (y === to.getUTCFullYear() && m <= to.getUTCMonth()); m++) {
    if (m > 11) {
      m = 0;
      y++;
    }
    byMonth.set(`${y}-${String(m + 1).padStart(2, "0")}`, 0);
  }

  for (const x of exits) {
    const served = Math.round((x.lastWorkingDate.getTime() - x.employee.employmentDate.getTime()) / DAY) + 1;
    tenureDays += served;
    bump(byReason, x.reasonCategory ?? "NOT_RECORDED");
    bump(byType, x.exitType);
    bump(byCategory, x.employee.category.name);
    bump(byDepartment, x.employee.department?.name ?? "No department");
    bump(byTenure, tenureBand(served));
    bump(byMonth, iso(x.lastWorkingDate).slice(0, 7));
    nature[exitNature(x.exitType)]++;
    if (served < 365) early++;
    if (x.eligibleForRehire === false) notRehire++;
  }

  const rates = turnoverRates(total, headcountStart, headcountEnd, days);
  return {
    from: iso(from),
    to: iso(to),
    days,
    leavers: total,
    headcountStart,
    headcountEnd,
    averageHeadcount: rates.average,
    turnoverRate: rates.rate,
    annualisedRate: rates.annualised,
    voluntary: nature.VOLUNTARY,
    involuntary: nature.INVOLUNTARY,
    other: nature.OTHER,
    earlyLeavers: early,
    earlyLeaverPct: pct(early, total),
    notEligibleForRehire: notRehire,
    averageTenureYears: total ? Math.round((tenureDays / total / 365.25) * 10) / 10 : null,
    byReason: slices(byReason, total),
    byType: slices(byType, total),
    byCategory: slices(byCategory, total),
    byDepartment: slices(byDepartment, total),
    byTenure: slices(byTenure, total, TENURE_BANDS),
    byMonth: [...byMonth.entries()].map(([month, count]) => ({ month, count })),
  };
}
