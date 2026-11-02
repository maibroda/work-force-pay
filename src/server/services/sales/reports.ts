/**
 * The dashboards of the sales module. Each widget fetches only the rows the viewer may see (their own, or everyone's for a manager or Operations; never another
 * organization's), inside the date filter, and hands them to the pure functions in src/lib/sales/reports.ts, so the figures are the ones the tests check. Reading only: nothing is
 * written except an audit entry when a CSV is downloaded. The drill-down turns a figure's record ids into names and links, for the records the viewer may see.
 */
import type { Ctx } from "@/lib/auth/context";
import {
  activityWidget, breachesWidget, casesWidget, competitorsWidget, concentrationWidget, conversionWidget, cycleWidget, forecastWidget, funnelWidget, healthWidget, lostReasonsWidget, marginWidget, renewalsWidget, reopenWidget,
  slaWidget, sourceRevenueWidget, stageDaysWidget, widgetCsv, winRateWidget, type CaseRow, type ClosedDeal, type HistoryRow, type OpenDeal, type StageRef, type Widget,
} from "@/lib/sales/reports";
import { csvRow } from "@/lib/sales/import";
import { koboToString, sumKobo, toKobo } from "@/lib/money-exact";
import { BusinessError, db } from "../_base";
import { logAudit } from "../audit";
import { ownerFilter, requireSales, seesAll } from "./access";
import { listHealth } from "./health";

const DAY = 86_400_000;
const DRILL_CAP = 200;
const CSV_RECORD_CAP = 5000;

export interface Period {
  /** Lagos dates, YYYY-MM-DD, both included. */
  from?: string;
  to?: string;
}
export const DASHBOARDS = {
  sales: ["pipeline", "forecast", "win-rate", "cycle", "stage-days", "conversion", "lost-reasons", "competitors", "activity", "source-revenue", "margins"],
  accounts: ["health", "renewals", "rate-reviews", "concentration"],
  service: ["cases", "sla", "breaches", "reopen"],
} as const;
export type View = keyof typeof DASHBOARDS;
export const WIDGET_KEYS = Object.values(DASHBOARDS).flat() as string[];

/** What the date filter applies to, for each widget, said under it. */
const APPLIES: Record<string, string> = {
  pipeline: "The date filter applies to when the deal was made.",
  forecast: "The date filter applies to the expected close date.",
  "win-rate": "The date filter applies to when the deal was won or lost.",
  cycle: "The date filter applies to when the deal was won.",
  "stage-days": "The date filter applies to when the deal left the stage.",
  conversion: "The date filter applies to when the deal was made.",
  "lost-reasons": "The date filter applies to when the deal was lost.",
  competitors: "The date filter applies to when the deal was won or lost.",
  activity: "The date filter applies to when the activity happened (weeks run Monday to Sunday, Lagos time).",
  "source-revenue": "The date filter applies to when the deal was won.",
  margins: "The date filter applies to when the quote was made. Only quotes that were sent are counted.",
  health: "A snapshot of today: the date filter does not apply. Scores are recalculated every night.",
  renewals: "Looks forward from today: the date filter does not apply.",
  concentration: "Won new-business deals; the date filter applies to when the deal was won. Renewal deals are left out so a client is not counted twice.",
  cases: "The date filter applies to when the case was opened (opened) or resolved (closed).",
  sla: "The date filter applies to when the case was opened.",
  breaches: "The date filter applies to when the case was opened.",
  reopen: "The date filter applies to when the case was opened.",
};

function span(p: Period) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if ((p.from && !re.test(p.from)) || (p.to && !re.test(p.to))) throw new BusinessError("Use dates like 2026-10-31.");
  const gte = p.from ? new Date(`${p.from}T00:00:00+01:00`) : undefined;
  const lt = p.to ? new Date(new Date(`${p.to}T00:00:00+01:00`).getTime() + DAY) : undefined;
  if (gte && lt && lt <= gte) throw new BusinessError("The end date cannot be before the start date.");
  return { gte, lt, filter: gte || lt ? { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } : undefined };
}
const within = (d: Date, s: ReturnType<typeof span>) => (!s.gte || d >= s.gte) && (!s.lt || d < s.lt);

async function stageRefs(orgId: string): Promise<StageRef[]> {
  const rows = await db.crmStage.findMany({ where: { pipeline: { organizationId: orgId } }, include: { pipeline: { select: { name: true, sortOrder: true } } }, orderBy: [{ pipeline: { sortOrder: "asc" } }, { sortOrder: "asc" }] });
  // the pipeline's name comes first, so the stages of two pipelines with the same stage name are told apart
  return rows.map((s, i) => ({ id: s.id, name: `${s.pipeline.name}: ${s.name}`, sortOrder: i + 1, stageType: s.stageType }));
}

const dealWhere = (ctx: Ctx) => ({ organizationId: ctx.orgId, status: "ACTIVE" as const, ...ownerFilter(ctx) });

async function closedDeals(ctx: Ctx, s: ReturnType<typeof span>, newBusinessOnly = false): Promise<ClosedDeal[]> {
  const rows = await db.crmOpportunity.findMany({ where: { ...dealWhere(ctx), stage: { stageType: { in: ["WON", "LOST"] } }, ...(newBusinessOnly ? { pipeline: { kind: "NEW_BUSINESS" } } : {}) }, include: { stage: { select: { stageType: true } } }, take: 20000 });
  return rows
    .map((o) => ({ id: o.id, outcome: o.stage.stageType as "WON" | "LOST", at: (o.stage.stageType === "WON" ? o.wonAt : o.lostAt) ?? o.stageEnteredAt, createdAt: o.createdAt, ownerName: o.ownerName, source: o.source, serviceType: o.serviceType, lostReason: o.lostReason, competitor: o.competitor, monthlyContractValue: o.monthlyContractValue, accountId: o.accountId }))
    .filter((d) => within(d.at, s));
}

async function caseRows(ctx: Ctx, where: object): Promise<CaseRow[]> {
  const rows = await db.crmCase.findMany({ where: { organizationId: ctx.orgId, account: { ...ownerFilter(ctx) }, ...where }, include: { account: { select: { name: true } } }, take: 20000 });
  const beats = await db.beat.findMany({ where: { organizationId: ctx.orgId, id: { in: [...new Set(rows.map((r) => r.beatId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const site = new Map(beats.map((b) => [b.id, b.name]));
  return rows.map((c) => ({
    id: c.id, category: c.category, accountId: c.accountId, accountName: c.account.name, siteName: c.beatId ? (site.get(c.beatId) ?? null) : null, openedAt: c.openedAt,
    firstResponseDueAt: c.firstResponseDueAt, firstResponseWarnAt: c.firstResponseWarnAt, firstRespondedAt: c.firstRespondedAt, resolutionDueAt: c.resolutionDueAt, resolutionWarnAt: c.resolutionWarnAt, resolvedAt: c.resolvedAt, reopenedCount: c.reopenedCount,
  }));
}

/** One widget, for the viewer, inside the date filter. */
export async function widget(ctx: Ctx, key: string, period: Period = {}, now = new Date()): Promise<Widget> {
  await requireSales(ctx, "sales.view");
  if (!WIDGET_KEYS.includes(key)) throw new BusinessError("That report does not exist.");
  const s = span(period);
  const w = await build(ctx, key, s, now);
  return { ...w, note: APPLIES[key] ?? w.note };
}

async function build(ctx: Ctx, key: string, s: ReturnType<typeof span>, now: Date): Promise<Widget> {
  switch (key) {
    case "pipeline":
    case "forecast": {
      const rows = await db.crmOpportunity.findMany({ where: { ...dealWhere(ctx), stage: { stageType: "OPEN" }, ...(key === "pipeline" && s.filter ? { createdAt: s.filter } : {}), ...(key === "forecast" && s.filter ? { expectedCloseDate: s.filter } : {}) }, take: 20000 });
      const deals: OpenDeal[] = rows.map((o) => ({ id: o.id, stageId: o.stageId, monthlyContractValue: o.monthlyContractValue, probability: o.probability, expectedCloseDate: o.expectedCloseDate }));
      return key === "pipeline" ? funnelWidget(deals, await stageRefs(ctx.orgId)) : forecastWidget(deals);
    }
    case "win-rate": return winRateWidget(await closedDeals(ctx, s));
    case "cycle": return cycleWidget(await closedDeals(ctx, s));
    case "lost-reasons": return lostReasonsWidget(await closedDeals(ctx, s));
    case "competitors": return competitorsWidget(await closedDeals(ctx, s));
    case "source-revenue": return sourceRevenueWidget(await closedDeals(ctx, s));
    case "stage-days":
    case "conversion": {
      const rows = await db.crmStageHistory.findMany({ where: { organizationId: ctx.orgId, opportunity: { ...dealWhere(ctx), ...(key === "conversion" && s.filter ? { createdAt: s.filter } : {}) } }, orderBy: [{ changedAt: "asc" }, { id: "asc" }], take: 100000 });
      const history: HistoryRow[] = rows.filter((h) => key === "conversion" || within(h.changedAt, s)).map((h, i) => ({ opportunityId: h.opportunityId, fromStageId: h.fromStageId, toStageId: h.toStageId, daysInPreviousStage: h.daysInPreviousStage, seq: i }));
      return key === "stage-days" ? stageDaysWidget(history, await stageRefs(ctx.orgId)) : conversionWidget(history, await stageRefs(ctx.orgId));
    }
    case "activity": {
      const rows = await db.crmActivity.findMany({ where: { organizationId: ctx.orgId, kind: { in: ["CALL", "MEETING", "SITE_SURVEY"] }, voidedAt: null, ...(s.filter ? { occurredAt: s.filter } : {}), ...(seesAll(ctx) ? {} : { createdByUserId: ctx.userId }) }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 50000 });
      return activityWidget(rows.map((a) => ({ id: a.id, userName: a.createdBy, kind: a.kind, at: a.occurredAt })));
    }
    case "margins": {
      const rows = await db.crmQuote.findMany({ where: { organizationId: ctx.orgId, status: { in: ["SENT", "ACCEPTED", "REJECTED"] }, opportunity: { ...ownerFilter(ctx) }, ...(s.filter ? { createdAt: s.filter } : {}) }, select: { id: true, marginBps: true, belowMinimum: true, belowMarginApproved: true }, take: 20000 });
      return marginWidget(rows);
    }
    case "health": {
      const rows = await listHealth(ctx);
      return healthWidget(rows.map((r) => ({ accountId: r.accountId, name: r.account.name, score: r.score, band: r.band, components: r.components as unknown as Array<{ subScore: number | null; detail: string }> })));
    }
    case "renewals": {
      const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
      const accounts = await db.crmAccount.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", clientId: { not: null }, ...ownerFilter(ctx) }, select: { clientId: true, name: true } });
      const byClient = new Map(accounts.map((a) => [a.clientId as string, a.name]));
      const contracts = await db.contract.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", clientId: { in: [...byClient.keys()] }, endDate: { gte: today, lte: new Date(today.getTime() + 90 * DAY) } }, take: 5000 });
      const links = await db.crmRenewalLink.findMany({ where: { organizationId: ctx.orgId, contractId: { in: contracts.map((c) => c.id) } } });
      const opps = await db.crmOpportunity.findMany({ where: { id: { in: links.map((l) => l.opportunityId) } }, select: { id: true, status: true, stage: { select: { name: true, stageType: true } } } });
      const state = (contractId: string) => {
        const l = links.find((x) => x.contractId === contractId);
        const o = l && opps.find((x) => x.id === l.opportunityId);
        return !o ? null : o.stage.stageType === "WON" ? "Renewed" : o.stage.stageType === "LOST" ? "Not renewed (lost)" : `In progress: ${o.stage.name}`;
      };
      return renewalsWidget(contracts.map((c) => ({ id: c.id, name: c.name, accountName: byClient.get(c.clientId) ?? "", endDate: c.endDate as Date, renewal: state(c.id) })), today);
    }
    case "rate-reviews":
      return { key: "rate-reviews", title: "Rate reviews open and margin at stake", records: "deal", columns: [], rows: [], note: "Not available yet: rate reviews are not built. They wait for a business decision on how the guard's pay relates to the bill rate (docs/crm/07b-phase-7b-plan.md)." };
    case "concentration": {
      const won = (await closedDeals(ctx, s, true)).filter((d) => d.outcome === "WON") as Array<ClosedDeal & { accountId: string }>;
      const accounts = await db.crmAccount.findMany({ where: { organizationId: ctx.orgId, id: { in: [...new Set(won.map((d) => d.accountId))] } }, select: { id: true, name: true } });
      const name = new Map(accounts.map((a) => [a.id, a.name]));
      const perAccount = new Map<string, unknown[]>();
      for (const d of won) perAccount.set(d.accountId, [...(perAccount.get(d.accountId) ?? []), d.monthlyContractValue]);
      return concentrationWidget([...perAccount.entries()].map(([accountId, values]) => ({ accountId, name: name.get(accountId) ?? "", monthlyContractValue: koboToString(sumKobo(values.map((v) => toKobo(v)))) }))); // added in whole kobo
    }
    case "cases": return casesWidget(await caseRows(ctx, s.filter ? { openedAt: s.filter } : {}), await caseRows(ctx, { resolvedAt: s.filter ?? { not: null } }));
    default: {
      const rows = await caseRows(ctx, s.filter ? { openedAt: s.filter } : {});
      return key === "sla" ? slaWidget(rows, now) : key === "breaches" ? breachesWidget(rows, now) : reopenWidget(rows);
    }
  }
}

export async function dashboard(ctx: Ctx, view: View, period: Period = {}, now = new Date()) {
  await requireSales(ctx, "sales.view");
  if (!(view in DASHBOARDS)) throw new BusinessError("That dashboard does not exist.");
  return Promise.all(DASHBOARDS[view].map((k) => widget(ctx, k, period, now)));
}

// ─────────────────────────────── the records behind a figure ───────────────────────────────

export interface DrillRecord {
  id: string;
  label: string;
  href?: string;
}

/** Names and links for the records behind a figure, only those the viewer may see (up to 200). */
export async function drillRecords(ctx: Ctx, kind: Widget["records"], ids: string[], cap = DRILL_CAP): Promise<DrillRecord[]> {
  await requireSales(ctx, "sales.view");
  const take = [...new Set(ids)].slice(0, cap);
  if (!take.length) return [];
  const org = ctx.orgId;
  const f = ownerFilter(ctx);
  const order = new Map(take.map((id, i) => [id, i]));
  const sort = (rs: DrillRecord[]) => rs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (kind === "deal") return sort((await db.crmOpportunity.findMany({ where: { id: { in: take }, organizationId: org, ...f }, select: { id: true, name: true, account: { select: { name: true } } } })).map((o) => ({ id: o.id, label: `${o.account.name}: ${o.name}`, href: `/sales/opportunities/${o.id}` })));
  if (kind === "case") return sort((await db.crmCase.findMany({ where: { id: { in: take }, organizationId: org, account: { ...f } }, select: { id: true, number: true, subject: true } })).map((c) => ({ id: c.id, label: `${c.number}: ${c.subject}`, href: `/sales/cases/${c.id}` })));
  if (kind === "account") return sort((await db.crmAccount.findMany({ where: { id: { in: take }, organizationId: org, ...f }, select: { id: true, name: true } })).map((a) => ({ id: a.id, label: a.name, href: `/sales/accounts/${a.id}` })));
  if (kind === "quote") return sort((await db.crmQuote.findMany({ where: { id: { in: take }, organizationId: org, opportunity: { ...f } }, select: { id: true, number: true, versionNo: true, marginBps: true } })).map((q) => ({ id: q.id, label: `${q.number} version ${q.versionNo} (margin ${(q.marginBps / 100).toFixed(2)}%)`, href: `/sales/quotes/${q.id}` })));
  if (kind === "contract") {
    const mine = (await db.crmAccount.findMany({ where: { organizationId: org, clientId: { not: null }, ...f }, select: { clientId: true } })).map((a) => a.clientId as string);
    return sort((await db.contract.findMany({ where: { id: { in: take }, organizationId: org, clientId: { in: mine } }, select: { id: true, name: true, endDate: true } })).map((c) => ({ id: c.id, label: `${c.name}, ends ${c.endDate?.toISOString().slice(0, 10) ?? ""}` })));
  }
  const acts = await db.crmActivity.findMany({ where: { id: { in: take }, organizationId: org, ...(seesAll(ctx) ? {} : { createdByUserId: ctx.userId }) }, select: { id: true, kind: true, occurredAt: true, createdBy: true, subject: true } });
  return sort(acts.map((a) => ({ id: a.id, label: `${a.occurredAt.toISOString().slice(0, 10)} ${a.kind.toLowerCase().replace("_", " ")} by ${a.createdBy}${a.subject ? `: ${a.subject}` : ""}` })));
}

/** The CSV of a widget (and, with `records`, of the records behind each of its rows). Every download is audited with the report and the period only. */
export async function reportCsv(ctx: Ctx, key: string, period: Period = {}, opts: { records?: boolean } = {}, now = new Date()) {
  const w = await widget(ctx, key, period, now);
  let csv = widgetCsv(w);
  if (opts.records) {
    const lines: string[] = [csvRow(["Row", "Record", "Link"])];
    let total = 0;
    for (const r of w.rows) {
      if (total >= CSV_RECORD_CAP || !r.ids?.length) continue;
      const recs = await drillRecords(ctx, w.records, r.ids, Math.min(r.ids.length, CSV_RECORD_CAP - total));
      total += recs.length;
      for (const rec of recs) lines.push(csvRow([String(r.cells[0]) + (w.columns.length > 1 && typeof r.cells[1] === "string" ? ` / ${r.cells[1]}` : ""), rec.label, rec.href ?? ""]));
    }
    csv += `\r\n\r\n${lines.join("\r\n")}`;
  }
  await logAudit(ctx, { action: "SALES_REPORT_EXPORT", entity: "CrmReport", entityId: key, newValue: { report: key, from: period.from ?? null, to: period.to ?? null, records: !!opts.records } });
  return { csv, fileName: `sales-report-${key}${period.from ? `-${period.from}` : ""}${period.to ? `-to-${period.to}` : ""}.csv` };
}
