/**
 * The figures of the sales module's dashboards, as pure functions of plain rows: no database, no permissions, no dates read from the clock. The service
 * (src/server/services/sales/reports.ts) fetches only the rows the viewer may see, inside the date filter, and hands them here; the tests check every function against one fixed
 * synthetic dataset with hand-calculated answers. Money is added in whole kobo (never floating point); counts and shares are whole numbers; a share of nothing is a dash, not 0%.
 * Each function returns a Widget: columns, rows, and for every row the ids of the records behind it (for the drill-down and the CSV).
 */
import { koboToString, sumKobo, toKobo } from "../money-exact";
import { csvRow } from "./import";
import { forecastByCloseMonth, totalsOf } from "./forecast";
import { clockState } from "./sla";

export type ColKind = "text" | "count" | "money" | "percent" | "days";
export interface Col {
  label: string;
  kind: ColKind;
}
export interface Row {
  cells: Array<string | number>;
  /** The records behind this row's figures. */
  ids?: string[];
}
export interface Widget {
  key: string;
  title: string;
  /** What the drill-down records are: deals, cases, accounts, contracts, quotes or activities. */
  records: "deal" | "case" | "account" | "contract" | "quote" | "activity";
  columns: Col[];
  rows: Row[];
  /** Said under the figures, for example what the date filter applies to. */
  note?: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NONE = "—";

/** A share as a percent to one decimal, rounded half up; a dash when there is nothing to divide. */
export const pct = (n: number, d: number) => (d === 0 ? NONE : `${(Math.floor((2 * n * 1000 + d) / (2 * d)) / 10).toFixed(1)}%`);
/** The same for amounts in kobo, in whole numbers (no float): n / d as a percent to one decimal, rounded half up. */
function pctKobo(n: number, d: number) {
  if (d === 0) return NONE;
  const tenths = (2n * BigInt(n) * 1000n + BigInt(d)) / (2n * BigInt(d));
  return `${tenths / 10n}.${tenths % 10n}%`;
}
const avg1 = (sum: number, count: number) => (count === 0 ? NONE : (Math.floor((2 * sum * 10 + count) / (2 * count)) / 10).toFixed(1));
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const lagosMonth = (d: Date) => new Date(d.getTime() + HOUR).toISOString().slice(0, 7);

// ─────────────────────────────── rows ───────────────────────────────

export interface StageRef {
  id: string;
  name: string;
  sortOrder: number;
  stageType: "OPEN" | "WON" | "LOST";
}
export interface OpenDeal {
  id: string;
  stageId: string;
  monthlyContractValue: unknown;
  probability: number;
  expectedCloseDate: Date | null;
}
export interface ClosedDeal {
  id: string;
  outcome: "WON" | "LOST";
  /** When it was won or lost. */
  at: Date;
  createdAt: Date;
  ownerName: string;
  source: string | null;
  serviceType: string;
  lostReason: string | null;
  competitor: string | null;
  monthlyContractValue: unknown;
}
export interface HistoryRow {
  opportunityId: string;
  fromStageId: string | null;
  toStageId: string;
  daysInPreviousStage: number | null;
  /** The order the moves happened in. */
  seq: number;
}
export interface CaseRow {
  id: string;
  category: string;
  accountId: string;
  accountName: string;
  siteName: string | null;
  openedAt: Date;
  firstResponseDueAt: Date | null;
  firstResponseWarnAt: Date | null;
  firstRespondedAt: Date | null;
  resolutionDueAt: Date | null;
  resolutionWarnAt: Date | null;
  resolvedAt: Date | null;
  reopenedCount: number;
}

// ─────────────────────────────── the sales dashboard ───────────────────────────────

/** Open deals by stage, in the stage order: how many, their monthly value, and the weighted value. */
export function funnelWidget(deals: OpenDeal[], stages: StageRef[]): Widget {
  const open = stages.filter((s) => s.stageType === "OPEN").sort((a, b) => a.sortOrder - b.sortOrder);
  const known = new Set(open.map((s) => s.id));
  const rows: Row[] = open.map((s) => {
    const here = deals.filter((d) => d.stageId === s.id);
    const t = totalsOf(here);
    return { cells: [s.name, t.count, t.value, t.weighted], ids: here.map((d) => d.id) };
  });
  const all = deals.filter((d) => known.has(d.stageId));
  const t = totalsOf(all);
  rows.push({ cells: ["All open deals", t.count, t.value, t.weighted], ids: all.map((d) => d.id) });
  return { key: "pipeline", title: "Open pipeline by stage", records: "deal", columns: [{ label: "Stage", kind: "text" }, { label: "Deals", kind: "count" }, { label: "Monthly value (naira)", kind: "money" }, { label: "Weighted value (naira)", kind: "money" }], rows };
}

/** The weighted forecast by the month deals are expected to close. */
export function forecastWidget(deals: OpenDeal[]): Widget {
  const months = forecastByCloseMonth(deals);
  const idsOf = (m: string) => deals.filter((d) => (d.expectedCloseDate ? d.expectedCloseDate.toISOString().slice(0, 7) : "No close date") === m).map((d) => d.id);
  return { key: "forecast", title: "Weighted forecast by expected close month", records: "deal", columns: [{ label: "Month", kind: "text" }, { label: "Deals", kind: "count" }, { label: "Monthly value (naira)", kind: "money" }, { label: "Weighted value (naira)", kind: "money" }], rows: months.map((m) => ({ cells: [m.month, m.count, m.value, m.weighted], ids: idsOf(m.month) })) };
}

/** Won over won plus lost, overall and by month, owner, source and service. */
export function winRateWidget(closed: ClosedDeal[]): Widget {
  const group = (view: string, key: (d: ClosedDeal) => string): Row[] => {
    const groups = new Map<string, ClosedDeal[]>();
    for (const d of closed) groups.set(key(d), [...(groups.get(key(d)) ?? []), d]);
    return [...groups.entries()].sort((a, b) => byName(a[0], b[0])).map(([k, ds]) => {
      const won = ds.filter((d) => d.outcome === "WON").length;
      return { cells: [view, k, won, ds.length - won, pct(won, ds.length)], ids: ds.map((d) => d.id) };
    });
  };
  const won = closed.filter((d) => d.outcome === "WON").length;
  const rows: Row[] = [{ cells: ["Overall", "All deals", won, closed.length - won, pct(won, closed.length)], ids: closed.map((d) => d.id) }];
  if (closed.length) rows.push(...group("Month", (d) => lagosMonth(d.at)), ...group("Owner", (d) => d.ownerName), ...group("Source", (d) => d.source ?? "(none)"), ...group("Service", (d) => d.serviceType));
  return { key: "win-rate", title: "Win rate", records: "deal", columns: [{ label: "View", kind: "text" }, { label: "Group", kind: "text" }, { label: "Won", kind: "count" }, { label: "Lost", kind: "count" }, { label: "Win rate", kind: "percent" }], rows };
}

/** The whole days from a deal being made to its being won. */
export function cycleWidget(closed: ClosedDeal[]): Widget {
  const won = closed.filter((d) => d.outcome === "WON");
  const days = won.map((d) => Math.max(0, Math.floor((d.at.getTime() - d.createdAt.getTime()) / DAY)));
  const rows: Row[] = [{ cells: [won.length, avg1(days.reduce((a, b) => a + b, 0), won.length), won.length ? Math.min(...days) : NONE, won.length ? Math.max(...days) : NONE], ids: won.map((d) => d.id) }];
  return { key: "cycle", title: "Sales cycle (made to won)", records: "deal", columns: [{ label: "Won deals", kind: "count" }, { label: "Average days", kind: "days" }, { label: "Fastest (days)", kind: "days" }, { label: "Slowest (days)", kind: "days" }], rows };
}

/** How long deals stayed in each stage before leaving it. */
export function stageDaysWidget(history: HistoryRow[], stages: StageRef[]): Widget {
  const rows: Row[] = [];
  for (const s of [...stages].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const left = history.filter((h) => h.fromStageId === s.id && h.daysInPreviousStage !== null);
    if (left.length) rows.push({ cells: [s.name, left.length, avg1(left.reduce((n, h) => n + (h.daysInPreviousStage as number), 0), left.length)], ids: [...new Set(left.map((h) => h.opportunityId))] });
  }
  return { key: "stage-days", title: "Average days in each stage before leaving it", records: "deal", columns: [{ label: "Stage", kind: "text" }, { label: "Times left", kind: "count" }, { label: "Average days", kind: "days" }], rows };
}

/** Of the deals that reached a stage, how many later moved to a later open stage or to won (losing is not advancing; skipping a stage still counts). */
export function conversionWidget(history: HistoryRow[], stages: StageRef[]): Widget {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const byDeal = new Map<string, HistoryRow[]>();
  for (const h of history) byDeal.set(h.opportunityId, [...(byDeal.get(h.opportunityId) ?? []), h]);
  for (const list of byDeal.values()) list.sort((a, b) => a.seq - b.seq);
  const rows: Row[] = [];
  for (const s of stages.filter((x) => x.stageType === "OPEN").sort((a, b) => a.sortOrder - b.sortOrder)) {
    const entered: string[] = [];
    const advanced: string[] = [];
    for (const [deal, list] of byDeal) {
      const at = list.findIndex((h) => h.toStageId === s.id);
      if (at < 0) continue;
      entered.push(deal);
      if (list.slice(at + 1).some((h) => { const t = byId.get(h.toStageId); return !!t && ((t.stageType === "OPEN" && t.sortOrder > s.sortOrder) || t.stageType === "WON"); })) advanced.push(deal);
    }
    rows.push({ cells: [s.name, entered.length, advanced.length, pct(advanced.length, entered.length)], ids: entered });
  }
  return { key: "conversion", title: "Stage-to-stage conversion", records: "deal", columns: [{ label: "Stage", kind: "text" }, { label: "Deals that reached it", kind: "count" }, { label: "Later advanced", kind: "count" }, { label: "Advanced", kind: "percent" }], rows };
}

export function lostReasonsWidget(closed: ClosedDeal[]): Widget {
  const lost = closed.filter((d) => d.outcome === "LOST");
  const groups = new Map<string, string[]>();
  for (const d of lost) groups.set(d.lostReason ?? "(not given)", [...(groups.get(d.lostReason ?? "(not given)") ?? []), d.id]);
  const rows = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || byName(a[0], b[0])).map(([k, ids]) => ({ cells: [k, ids.length, pct(ids.length, lost.length)] as Array<string | number>, ids }));
  return { key: "lost-reasons", title: "Why deals were lost", records: "deal", columns: [{ label: "Reason", kind: "text" }, { label: "Deals", kind: "count" }, { label: "Share of lost", kind: "percent" }], rows };
}

export function competitorsWidget(closed: ClosedDeal[]): Widget {
  const groups = new Map<string, ClosedDeal[]>();
  for (const d of closed) if (d.competitor) groups.set(d.competitor, [...(groups.get(d.competitor) ?? []), d]);
  const rows = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || byName(a[0], b[0]))
    .map(([k, ds]) => {
      const won = ds.filter((d) => d.outcome === "WON").length;
      return { cells: [k, won, ds.length - won, pct(won, ds.length)] as Array<string | number>, ids: ds.map((d) => d.id) };
    });
  return { key: "competitors", title: "Wins and losses against each competitor", records: "deal", columns: [{ label: "Competitor", kind: "text" }, { label: "Won against", kind: "count" }, { label: "Lost against", kind: "count" }, { label: "Win rate", kind: "percent" }], rows };
}

/** The Monday (Lagos date) of the Lagos week that contains the moment. */
export function weekOf(when: Date): string {
  const dayStart = Math.floor((when.getTime() + HOUR) / DAY) * DAY; // Lagos midnight, as if it were UTC
  const dow = new Date(dayStart).getUTCDay(); // 0 = Sunday
  return new Date(dayStart - ((dow + 6) % 7) * DAY).toISOString().slice(0, 10);
}

/** Calls, meetings and site surveys for each person in each Lagos week. */
export function activityWidget(acts: Array<{ id: string; userName: string; kind: string; at: Date }>): Widget {
  const groups = new Map<string, Array<{ id: string; kind: string }>>();
  for (const a of acts) {
    if (a.kind !== "CALL" && a.kind !== "MEETING" && a.kind !== "SITE_SURVEY") continue;
    const k = `${weekOf(a.at)}\u0000${a.userName}`;
    groups.set(k, [...(groups.get(k) ?? []), { id: a.id, kind: a.kind }]);
  }
  const rows = [...groups.entries()]
    .sort((a, b) => byName(a[0], b[0]))
    .map(([k, list]) => {
      const [week, who] = k.split("\u0000");
      const n = (kind: string) => list.filter((x) => x.kind === kind).length;
      return { cells: [week, who, n("CALL"), n("MEETING"), n("SITE_SURVEY")] as Array<string | number>, ids: list.map((x) => x.id) };
    });
  return { key: "activity", title: "Activity by person and week", records: "activity", columns: [{ label: "Week starting (Monday)", kind: "text" }, { label: "Person", kind: "text" }, { label: "Calls", kind: "count" }, { label: "Meetings", kind: "count" }, { label: "Site surveys", kind: "count" }], rows };
}

/** The monthly value won, by lead source. */
export function sourceRevenueWidget(closed: ClosedDeal[]): Widget {
  const won = closed.filter((d) => d.outcome === "WON");
  const groups = new Map<string, ClosedDeal[]>();
  for (const d of won) groups.set(d.source ?? "(none)", [...(groups.get(d.source ?? "(none)") ?? []), d]);
  const total = (ds: ClosedDeal[]) => sumKobo(ds.map((d) => toKobo(d.monthlyContractValue)));
  const rows: Row[] = [...groups.entries()]
    .sort((a, b) => total(b[1]) - total(a[1]) || byName(a[0], b[0]))
    .map(([k, ds]) => ({ cells: [k, ds.length, koboToString(total(ds))], ids: ds.map((d) => d.id) }));
  rows.push({ cells: ["All sources", won.length, koboToString(total(won))], ids: won.map((d) => d.id) });
  return { key: "source-revenue", title: "Source to revenue (monthly value won)", records: "deal", columns: [{ label: "Source", kind: "text" }, { label: "Deals won", kind: "count" }, { label: "Monthly value won (naira)", kind: "money" }], rows };
}

const BANDS: Array<[string, number, number]> = [["Below 0%", -Infinity, 0], ["0% to under 5%", 0, 500], ["5% to under 10%", 500, 1000], ["10% to under 15%", 1000, 1500], ["15% to under 20%", 1500, 2000], ["20% and over", 2000, Infinity]];

/** Quotes by margin band, and how many were below the minimum and how many of those a designated approver approved. */
export function marginWidget(quotes: Array<{ id: string; marginBps: number; belowMinimum: boolean; belowMarginApproved: boolean }>): Widget {
  const rows: Row[] = BANDS.map(([label, lo, hi]) => {
    const here = quotes.filter((q) => q.marginBps >= lo && q.marginBps < hi);
    return { cells: [label, here.length], ids: here.map((q) => q.id) };
  });
  const below = quotes.filter((q) => q.belowMinimum);
  const approved = below.filter((q) => q.belowMarginApproved);
  rows.push({ cells: ["Below the minimum margin", below.length], ids: below.map((q) => q.id) }, { cells: ["of which approved by a designated approver", approved.length], ids: approved.map((q) => q.id) });
  return { key: "margins", title: "Quote margins", records: "quote", columns: [{ label: "Margin band", kind: "text" }, { label: "Quotes", kind: "count" }], rows };
}

// ─────────────────────────────── the accounts dashboard ───────────────────────────────

const BAND_LABEL = { HEALTHY: "Healthy", WATCH: "Watch", AT_RISK: "At risk" } as const;

/** Accounts by health band, and the at-risk ones, weakest first, with the weakest measure as the main reason. */
export function healthWidget(rows: Array<{ accountId: string; name: string; score: number; band: keyof typeof BAND_LABEL; components: Array<{ subScore: number | null; detail: string }> }>): Widget {
  const out: Row[] = (Object.keys(BAND_LABEL) as Array<keyof typeof BAND_LABEL>).map((b) => {
    const here = rows.filter((r) => r.band === b);
    return { cells: [BAND_LABEL[b], here.length, ""], ids: here.map((r) => r.accountId) };
  });
  for (const r of rows.filter((x) => x.band === "AT_RISK").sort((a, b) => a.score - b.score || byName(a.name, b.name))) {
    const present = r.components.filter((c) => c.subScore !== null);
    const worst = present.length ? present.reduce((w, c) => ((c.subScore as number) < (w.subScore as number) ? c : w)) : null; // the first of equals
    out.push({ cells: [`${r.name} (${r.score})`, 1, worst?.detail ?? ""], ids: [r.accountId] });
  }
  return { key: "health", title: "Accounts by health", records: "account", columns: [{ label: "Band, or at-risk account (score)", kind: "text" }, { label: "Accounts", kind: "count" }, { label: "Main reason", kind: "text" }], rows: out };
}

/** Active contracts ending in the next 30, 60 and 90 days, and where each renewal stands. */
export function renewalsWidget(contracts: Array<{ id: string; name: string; accountName: string; endDate: Date; renewal: string | null }>, today: Date): Widget {
  const start = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  const days = (c: { endDate: Date }) => Math.floor((c.endDate.getTime() - start) / DAY);
  const windows: Array<[string, number, number]> = [["Within 30 days", 0, 30], ["31 to 60 days", 31, 60], ["61 to 90 days", 61, 90]];
  const rows: Row[] = windows.map(([label, lo, hi]) => {
    const here = contracts.filter((c) => days(c) >= lo && days(c) <= hi).sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
    const n = (f: (r: string | null) => boolean) => here.filter((c) => f(c.renewal)).length;
    return { cells: [label, here.length, n((r) => r === null), n((r) => !!r && r.startsWith("In progress")), n((r) => r === "Renewed"), n((r) => !!r && r.startsWith("Not renewed"))], ids: here.map((c) => c.id) };
  });
  return { key: "renewals", title: "Renewals due", records: "contract", columns: [{ label: "Contract ends", kind: "text" }, { label: "Contracts", kind: "count" }, { label: "No renewal opened", kind: "count" }, { label: "In progress", kind: "count" }, { label: "Renewed", kind: "count" }, { label: "Not renewed", kind: "count" }], rows };
}

/** The share of the total won monthly value held by the top 5 and top 10 clients. */
export function concentrationWidget(rows: Array<{ accountId: string; name: string; monthlyContractValue: unknown }>): Widget {
  const sorted = rows.map((r) => ({ ...r, kobo: toKobo(r.monthlyContractValue) })).sort((a, b) => b.kobo - a.kobo || byName(a.name, b.name));
  const total = sumKobo(sorted.map((r) => r.kobo));
  const top = (n: number) => sorted.slice(0, n);
  const line = (label: string, list: typeof sorted): Row => {
    const t = sumKobo(list.map((r) => r.kobo));
    return { cells: [label, list.length, koboToString(t), pctKobo(t, total)], ids: list.map((r) => r.accountId) };
  };
  const out: Row[] = [line("Top 5 clients", top(5)), line("Top 10 clients", top(10)), line("All clients", sorted)];
  top(10).forEach((r, i) => out.push({ cells: [`${i + 1}. ${r.name}`, 1, koboToString(r.kobo), pctKobo(r.kobo, total)], ids: [r.accountId] }));
  return { key: "concentration", title: "Revenue concentration", records: "account", columns: [{ label: "Clients", kind: "text" }, { label: "Count", kind: "count" }, { label: "Monthly value (naira)", kind: "money" }, { label: "Share of total", kind: "percent" }], rows: out };
}

// ─────────────────────────────── the service dashboard ───────────────────────────────

/** Cases opened and cases closed (resolved) by category. */
export function casesWidget(opened: CaseRow[], closed: CaseRow[]): Widget {
  const cats = [...new Set([...opened, ...closed].map((c) => c.category))].sort(byName);
  const rows: Row[] = cats.map((k) => ({ cells: [k, opened.filter((c) => c.category === k).length, closed.filter((c) => c.category === k).length], ids: [...new Set([...opened, ...closed].filter((c) => c.category === k).map((c) => c.id))] }));
  rows.push({ cells: ["All", opened.length, closed.length], ids: [...new Set([...opened, ...closed].map((c) => c.id))] });
  return { key: "cases", title: "Cases opened and closed by category", records: "case", columns: [{ label: "Category", kind: "text" }, { label: "Opened", kind: "count" }, { label: "Closed", kind: "count" }], rows };
}

const firstClock = (c: CaseRow, now: Date) => clockState({ dueAt: c.firstResponseDueAt, warnAt: c.firstResponseWarnAt, doneAt: c.firstRespondedAt }, now);
const resolutionClock = (c: CaseRow, now: Date) => clockState({ dueAt: c.resolutionDueAt, warnAt: c.resolutionWarnAt, doneAt: c.resolvedAt }, now);
const decided = (s: string) => s === "MET" || s === "LATE" || s === "BREACHED";

/** Of the deadlines that have been met or have fallen due, the share met. A case still inside its window, or with no policy, is not counted. */
export function slaWidget(cases: CaseRow[], now: Date): Widget {
  const line = (label: string, state: (c: CaseRow) => string): Row => {
    const counted = cases.filter((c) => decided(state(c)));
    const met = counted.filter((c) => state(c) === "MET").length;
    return { cells: [label, counted.length, met, pct(met, counted.length)], ids: counted.map((c) => c.id) };
  };
  return { key: "sla", title: "SLA compliance", records: "case", columns: [{ label: "Deadline", kind: "text" }, { label: "Counted", kind: "count" }, { label: "Met in time", kind: "count" }, { label: "Compliance", kind: "percent" }], rows: [line("First response", (c) => firstClock(c, now)), line("Resolution", (c) => resolutionClock(c, now))] };
}

/** Cases that missed a deadline (counted once each), by account and by site. */
export function breachesWidget(cases: CaseRow[], now: Date): Widget {
  const breached = cases.filter((c) => ["LATE", "BREACHED"].includes(firstClock(c, now)) || ["LATE", "BREACHED"].includes(resolutionClock(c, now)));
  const group = (view: string, key: (c: CaseRow) => string): Row[] => {
    const g = new Map<string, string[]>();
    for (const c of breached) g.set(key(c), [...(g.get(key(c)) ?? []), c.id]);
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length || byName(a[0], b[0])).map(([k, ids]) => ({ cells: [view, k, ids.length] as Array<string | number>, ids }));
  };
  return { key: "breaches", title: "Missed deadlines by account and site", records: "case", columns: [{ label: "View", kind: "text" }, { label: "Name", kind: "text" }, { label: "Cases with a missed deadline", kind: "count" }], rows: [...group("Account", (c) => c.accountName), ...group("Site", (c) => c.siteName ?? "No site named")] };
}

/** Cases reopened at least once over cases ever resolved. */
export function reopenWidget(cases: CaseRow[]): Widget {
  const everResolved = cases.filter((c) => c.resolvedAt !== null || c.reopenedCount > 0);
  const reopened = everResolved.filter((c) => c.reopenedCount > 0);
  return { key: "reopen", title: "Reopen rate", records: "case", columns: [{ label: "Cases ever resolved", kind: "count" }, { label: "Reopened", kind: "count" }, { label: "Reopen rate", kind: "percent" }], rows: [{ cells: [everResolved.length, reopened.length, pct(reopened.length, everResolved.length)], ids: reopened.map((c) => c.id) }] };
}

// ─────────────────────────────── export ───────────────────────────────

/** The widget as CSV: the column labels, then each row. A cell that could run as a spreadsheet formula is neutralised (by csvRow). */
export function widgetCsv(w: Widget): string {
  return [csvRow(w.columns.map((c) => c.label)), ...w.rows.map((r) => csvRow(r.cells))].join("\r\n");
}
