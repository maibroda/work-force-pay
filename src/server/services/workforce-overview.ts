/**
 * The Workforce overview (Analytics > Workforce overview): who works here and how, as figures. Read-only; needs `analytics.view` (as the Workforce cost page does).
 *
 * Everything is aggregated here and nothing identifies a person: the queries select only the fields they count (no name, no number, no bank detail), and the result holds
 * counts, shares and averages. Money is whole kobo, averaged and rounded half up once through the shared exact-money helpers. An average of pay is returned only for a group
 * of at least five people with a pay figure (`MIN_GROUP`, as for the welfare summary and the survey results); below that it is hidden, never shown as one person's pay.
 * Pay is the monthly contractual gross of the chosen payroll run (the latest regular run of the company by default). Nothing here changes any record.
 */
import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { koboOrZero, type Kobo } from "@/lib/money-exact";
import { MIN_GROUP } from "@/lib/welfare";
import {
  TENURE_BANDS,
  averageKobo,
  averageTenureYears,
  completedYears,
  percentDifference,
  percentTenths,
  serviceDays,
  shareOf,
  shownGroup,
  tenureBand,
} from "@/lib/workforce-overview";
import { assertCan, db } from "./_base";
import { todayUtc } from "./hr-policy";
import { resolveRun } from "./reports";

export const NOT_DEPLOYED = "Not deployed";
export const NO_CONTRACT = "NONE";

export interface WorkforceFilters {
  /** A client site's id, or "none" for people who are not deployed. */
  siteId?: string;
  categoryId?: string;
  departmentId?: string;
  contractType?: string;
  runId?: string;
}

export type PayFigure = { kobo: number | null; reason: "SHOWN" | "SMALL_GROUP" | "NO_PAYROLL" };

const CONTRACT_LABELS: Record<string, string> = {
  PERMANENT: "Permanent",
  FIXED_TERM: "Fixed term",
  PROBATION: "Probation",
  CASUAL: "Casual",
  CONSULTANT: "Consultant",
  INTERNSHIP: "Internship",
  [NO_CONTRACT]: "No active contract",
};

/** The average of a group's pay figures, or why there is none. */
function payFigure(values: Kobo[], haveRun: boolean): PayFigure {
  if (!haveRun) return { kobo: null, reason: "NO_PAYROLL" };
  if (!shownGroup(values.length)) return { kobo: null, reason: "SMALL_GROUP" };
  return { kobo: averageKobo(values), reason: "SHOWN" };
}

export async function workforceOverview(ctx: Ctx, f: WorkforceFilters = {}) {
  assertCan(ctx, "analytics.view");
  const today = iso(todayUtc());

  const [sites, roles, departments, rows, managerRows, run] = await Promise.all([
    db.client.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.employeeCategory.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.department.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.employee.findMany({
      where: { organizationId: ctx.orgId, status: { in: ["ACTIVE", "ON_LEAVE"] } },
      select: {
        id: true,
        employmentDate: true,
        categoryId: true,
        category: { select: { name: true } },
        departmentId: true,
        currentClientId: true,
        currentClient: { select: { name: true } },
        employmentContracts: { where: { status: "ACTIVE" }, select: { type: true }, take: 1 },
      },
    }),
    db.employee.findMany({ where: { organizationId: ctx.orgId, status: { in: ["ACTIVE", "ON_LEAVE"] }, reportingManagerId: { not: null } }, select: { reportingManagerId: true } }),
    resolveRun(ctx, f.runId),
  ]);

  const managers = new Set(managerRows.map((r) => r.reportingManagerId!));
  const people = rows
    .map((e) => ({
      id: e.id,
      siteId: e.currentClientId ?? "none",
      siteName: e.currentClient?.name ?? NOT_DEPLOYED,
      categoryId: e.categoryId,
      categoryName: e.category.name,
      departmentId: e.departmentId,
      contractType: e.employmentContracts[0]?.type ?? NO_CONTRACT,
      days: serviceDays(iso(e.employmentDate), today),
      years: completedYears(iso(e.employmentDate), today),
      isManager: managers.has(e.id),
    }))
    .filter(
      (p) =>
        (!f.siteId || p.siteId === f.siteId) &&
        (!f.categoryId || p.categoryId === f.categoryId) &&
        (!f.departmentId || p.departmentId === f.departmentId) &&
        (!f.contractType || p.contractType === f.contractType),
    );

  // pay: the monthly gross of each person in the chosen run (only for the people in view); nothing individual is returned
  const pay = new Map<string, Kobo>();
  if (run && people.length) {
    const recs = await db.payrollRecord.findMany({ where: { runId: run.id, organizationId: ctx.orgId, employeeId: { in: people.map((p) => p.id) } }, select: { employeeId: true, monthlyGross: true } });
    for (const r of recs) pay.set(r.employeeId, koboOrZero(r.monthlyGross));
  }
  const haveRun = !!run;
  const valuesOf = (ids: string[]) => ids.flatMap((id) => (pay.has(id) ? [pay.get(id)!] : []));

  const total = people.length;
  const companyPay = payFigure(valuesOf(people.map((p) => p.id)), haveRun);

  const group = <K extends string>(keyOf: (p: (typeof people)[number]) => K, nameOf: (p: (typeof people)[number]) => string) => {
    const m = new Map<K, { key: K; name: string; ids: string[]; days: number[] }>();
    for (const p of people) {
      const g = m.get(keyOf(p)) ?? { key: keyOf(p), name: nameOf(p), ids: [], days: [] };
      g.ids.push(p.id);
      g.days.push(p.days);
      m.set(keyOf(p), g);
    }
    return [...m.values()].sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
  };

  const bySiteGroups = group((p) => p.siteId, (p) => p.siteName);
  const byRoleGroups = group((p) => p.categoryId, (p) => p.categoryName);

  const bySite = bySiteGroups.map((g) => ({ key: g.key, name: g.name, count: g.ids.length, share: shareOf(g.ids.length, total) }));
  const byRole = byRoleGroups.map((g) => ({ key: g.key, name: g.name, count: g.ids.length, share: shareOf(g.ids.length, total), averageGross: payFigure(valuesOf(g.ids), haveRun) }));
  const siteTable = bySiteGroups.map((g) => {
    const averageGross = payFigure(valuesOf(g.ids), haveRun);
    const vsCompany = averageGross.kobo !== null && companyPay.kobo !== null ? percentDifference(averageGross.kobo as Kobo, companyPay.kobo as Kobo) : null;
    return { key: g.key, name: g.name, count: g.ids.length, averageGross, vsCompany, averageTenureYears: averageTenureYears(g.days) };
  });

  const bandCounts = new Map<string, number>(TENURE_BANDS.map((b) => [b, 0]));
  for (const p of people) bandCounts.set(tenureBand(p.years), (bandCounts.get(tenureBand(p.years)) ?? 0) + 1);
  const tenure = TENURE_BANDS.map((band) => ({ band, count: bandCounts.get(band) ?? 0, share: shareOf(bandCounts.get(band) ?? 0, total) }));

  const typeCounts = new Map<string, number>();
  for (const p of people) typeCounts.set(p.contractType, (typeCounts.get(p.contractType) ?? 0) + 1);
  const contractTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({ type, label: CONTRACT_LABELS[type] ?? type, count, share: shareOf(count, total) }));

  const managerCount = people.filter((p) => p.isManager).length;
  const presentTypes = new Set(rows.map((e) => e.employmentContracts[0]?.type ?? NO_CONTRACT));

  return {
    headcount: total,
    minimumGroup: MIN_GROUP,
    payRun: run ? { id: run.id, label: `${run.period.name}${run.runNumber > 1 ? ` (run ${run.runNumber})` : ""}` } : null,
    averageGross: companyPay,
    averageTenureYears: averageTenureYears(people.map((p) => p.days)),
    peopleManagers: { count: managerCount, percent: percentTenths(managerCount, total) },
    bySite,
    byRole,
    tenure,
    contractTypes,
    siteTable,
    options: {
      sites: [{ id: "none", name: NOT_DEPLOYED }, ...sites.map((s) => ({ id: s.id, name: s.name }))],
      roles: roles.map((r) => ({ id: r.id, name: r.name })),
      departments: departments.map((x) => ({ id: x.id, name: x.name })),
      contractTypes: [...presentTypes].sort().map((t) => ({ id: t, name: CONTRACT_LABELS[t] ?? t })),
    },
  };
}
