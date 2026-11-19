import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { koboToNumber, subKobo, type Kobo } from "@/lib/money-exact";
import { isIsoDate } from "@/lib/pay-rate";
import { groupLines, hoursOf, priceLines, rollup, type Line, type Rollup } from "@/lib/payroll/hourly-report";
import { parseWatLocal } from "@/lib/payroll/time-entry";
import { fullName } from "@/lib/utils";
import type { Col, Report } from "@/server/report-registry";
import { assertCan, db } from "./_base";
import { hourlyPayEnabled, loadApprovedHourlyRates } from "./hourly-pay";
import { loadApprovedSegments } from "./time-entries";

/**
 * Hourly pay, phase 5 (docs/plans/hourly-payroll-assessment.md): the hourly reports. They read APPROVED time entries (phase 3) and APPROVED hourly rates (phase 2), and nothing else; a draft, a submitted, a rejected,
 * a withdrawn or a superseded entry never counts towards hours or cost. The cost is INDICATIVE (approved hours x approved rates), not payroll: the pay run does not read hours yet (phase 4). Every report is a roll-up
 * of the same priced lines (src/lib/payroll/hourly-report.ts), so no two reports add up differently, and hours with no approved rate are shown apart, never priced as zero.
 *
 * Who may open them: the three cost reports need the payroll right (they show pay), the status report (hours only, no money) needs the reports right (src/lib/report-access.ts). Everything is for the caller's
 * company only. Not built: budget against actual, because there is no budget in the application to compare with (where a budget would come from is for the founder to decide).
 */
export type HourlyReportType = "hourly-summary" | "hourly-by-client" | "hourly-monthly" | "hourly-status";
type Params = Record<string, string | undefined>;
type Row = Record<string, unknown>;

const HOURS = (key: string, label: string): Col => ({ key, label, num: true });
const MONEY = (key: string, label: string): Col => ({ key, label, money: true });

/** The dates asked for, or this month so far. */
function range(p: Params) {
  const now = new Date();
  const from = p.from && isIsoDate(p.from) ? p.from : iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const to = p.to && isIsoDate(p.to) ? p.to : iso(now);
  return { from, to: to < from ? from : to };
}

async function people(ctx: Ctx, ids: string[]) {
  const rows = await db.employee.findMany({
    where: { organizationId: ctx.orgId, id: { in: ids } },
    select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, categoryId: true, category: { select: { name: true } } },
  });
  return new Map(rows.map((e) => [e.id, e]));
}

/** The priced lines of approved hours in a date range, for one company, narrowed to a client or an employee if asked. */
async function pricedLines(ctx: Ctx, from: string, to: string, p: Params) {
  const all = await loadApprovedSegments(db, ctx.orgId, d(from), d(to));
  const pieces = all.filter((s) => (!p.clientId || s.clientId === p.clientId) && (!p.employeeId || s.employeeId === p.employeeId));
  const [rates, emps] = await Promise.all([loadApprovedHourlyRates(db, ctx.orgId, d(from), d(to)), people(ctx, [...new Set(pieces.map((s) => s.employeeId))])]);
  const lines = priceLines(pieces, rates, (id) => emps.get(id)?.categoryId ?? "");
  return { lines, emps };
}

const hoursCols = (r: Rollup) => ({
  weekdayHours: hoursOf(r.minutes.WEEKDAY),
  weekendHours: hoursOf(r.minutes.WEEKEND),
  holidayHours: hoursOf(r.minutes.HOLIDAY),
  totalHours: hoursOf(r.totalMinutes),
  weekdayAmount: koboToNumber(r.kobo.WEEKDAY as Kobo),
  weekendAmount: koboToNumber(r.kobo.WEEKEND as Kobo),
  holidayAmount: koboToNumber(r.kobo.HOLIDAY as Kobo),
  totalAmount: koboToNumber(r.totalKobo as Kobo),
  unpricedHours: hoursOf(r.unpricedMinutes),
});

const CLASS_COLS: Col[] = [
  HOURS("weekdayHours", "Weekday hours"),
  HOURS("weekendHours", "Weekend hours"),
  HOURS("holidayHours", "Public holiday hours"),
  HOURS("totalHours", "Total hours"),
  MONEY("weekdayAmount", "Weekday cost"),
  MONEY("weekendAmount", "Weekend cost"),
  MONEY("holidayAmount", "Public holiday cost"),
  MONEY("totalAmount", "Total cost"),
  HOURS("unpricedHours", "Hours with no approved rate"),
];

const INDICATIVE = "The cost is indicative: approved hours at the approved hourly rates, not payroll (the pay run does not read hours yet). Only approved shifts count. Hours with no approved rate are shown apart and are not in the cost.";

const off = (title: string, columns: Col[], filters: Report["filters"]): Report => ({ title, description: "Hourly pay is not switched on for this company.", usesRun: false, filters, columns, rows: [] });

export async function buildHourlyReport(ctx: Ctx, type: HourlyReportType, p: Params): Promise<Report> {
  assertCan(ctx, type === "hourly-status" ? "reports.view" : "payroll.view");
  const enabled = await hourlyPayEnabled(ctx.orgId);
  const { from, to } = range(p);
  switch (type) {
    case "hourly-summary": {
      const columns: Col[] = [{ key: "employeeNumber", label: "Emp. No." }, { key: "employeeName", label: "Name" }, { key: "category", label: "Job role" }, ...CLASS_COLS];
      if (!enabled) return off("Hourly pay: by employee", columns, ["dateRange", "client", "employee"]);
      const { lines, emps } = await pricedLines(ctx, from, to, p);
      const rows: Row[] = [...groupLines(lines, (l) => l.employeeId).entries()]
        .map(([id, group]) => ({ e: emps.get(id), group }))
        .filter((x) => x.e)
        .sort((a, b) => a.e!.employeeNumber.localeCompare(b.e!.employeeNumber))
        .map(({ e, group }) => ({ employeeNumber: e!.employeeNumber, employeeName: fullName(e!), category: e!.category.name, ...hoursCols(rollup(group)) }));
      return { title: "Hourly pay: by employee", description: `Approved hours and the indicative cost for each person paid by the hour, from ${from} to ${to}. ${INDICATIVE}`, usesRun: false, filters: ["dateRange", "client", "employee"], columns, rows, totals: hoursCols(rollup(lines)) };
    }
    case "hourly-by-client": {
      const columns: Col[] = [{ key: "client", label: "Client" }, { key: "contract", label: "Contract" }, HOURS("people", "People"), ...CLASS_COLS];
      if (!enabled) return off("Hourly pay: by client and contract", columns, ["dateRange", "client"]);
      const { lines } = await pricedLines(ctx, from, to, p);
      const contracts = await db.contract.findMany({ where: { organizationId: ctx.orgId, id: { in: [...new Set(lines.map((l) => l.contractId))] } }, select: { id: true, contractNumber: true, name: true, client: { select: { name: true } } } });
      const byId = new Map(contracts.map((c) => [c.id, c]));
      const rows: Row[] = [...groupLines(lines, (l) => l.contractId).entries()]
        .map(([id, group]) => ({ c: byId.get(id), group }))
        .filter((x) => x.c)
        .sort((a, b) => a.c!.client.name.localeCompare(b.c!.client.name) || a.c!.contractNumber.localeCompare(b.c!.contractNumber))
        .map(({ c, group }) => ({ client: c!.client.name, contract: `${c!.contractNumber} — ${c!.name}`, people: new Set(group.map((l) => l.employeeId)).size, ...hoursCols(rollup(group)) }));
      const totals = { people: new Set(lines.map((l) => l.employeeId)).size, ...hoursCols(rollup(lines)) };
      return { title: "Hourly pay: by client and contract", description: `Approved hours and the indicative cost for each client and contract, from ${from} to ${to}. The total is the same as the by-employee report. ${INDICATIVE}`, usesRun: false, filters: ["dateRange", "client"], columns, rows, totals };
    }
    case "hourly-monthly": {
      const columns: Col[] = [
        { key: "month", label: "Month" },
        HOURS("people", "People"),
        HOURS("weekdayHours", "Weekday hours"),
        HOURS("weekendHours", "Weekend hours"),
        HOURS("holidayHours", "Public holiday hours"),
        HOURS("totalHours", "Total hours"),
        MONEY("totalAmount", "Total cost"),
        HOURS("unpricedHours", "Hours with no approved rate"),
        HOURS("hoursChange", "Hours change on the month before"),
        MONEY("amountChange", "Cost change on the month before"),
      ];
      if (!enabled) return off("Hourly pay: month by month", columns, ["dateRange", "client"]);
      // with no dates given, the six months up to the end date
      const end = p.to && isIsoDate(p.to) ? p.to : to;
      const start = p.from && isIsoDate(p.from) ? p.from : monthsBefore(end, 5);
      const { lines } = await pricedLines(ctx, start, end, p);
      const byMonth = groupLines(lines, (l) => l.month);
      const rows: Row[] = [];
      let prev: Rollup | null = null;
      for (const month of monthsBetween(start, end)) {
        const group: Line[] = byMonth.get(month) ?? [];
        const r = rollup(group);
        const h = hoursCols(r);
        rows.push({
          month,
          people: new Set(group.map((l) => l.employeeId)).size,
          weekdayHours: h.weekdayHours,
          weekendHours: h.weekendHours,
          holidayHours: h.holidayHours,
          totalHours: h.totalHours,
          totalAmount: h.totalAmount,
          unpricedHours: h.unpricedHours,
          hoursChange: prev ? signedHours(r.totalMinutes - prev.totalMinutes) : null,
          amountChange: prev ? koboToNumber(subKobo(r.totalKobo as Kobo, prev.totalKobo as Kobo)) : null,
        });
        prev = r;
      }
      const all = hoursCols(rollup(lines));
      return {
        title: "Hourly pay: month by month",
        description: `Approved hours and the indicative cost for each month from ${start} to ${end}, with the change on the month before. A shift over a month end is split between the two months. ${INDICATIVE}`,
        usesRun: false,
        filters: ["dateRange", "client"],
        columns,
        rows,
        totals: { totalHours: all.totalHours, totalAmount: all.totalAmount, unpricedHours: all.unpricedHours, weekdayHours: all.weekdayHours, weekendHours: all.weekendHours, holidayHours: all.holidayHours },
      };
    }
    case "hourly-status": {
      const columns: Col[] = [
        { key: "employeeNumber", label: "Emp. No." },
        { key: "employeeName", label: "Name" },
        HOURS("approvedHours", "Approved hours (paid)"),
        HOURS("waitingHours", "Waiting for approval"),
        HOURS("draftHours", "Drafts, not submitted"),
        HOURS("noClockOut", "Shifts with no clock-out"),
        HOURS("rejectedHours", "Rejected or withdrawn"),
      ];
      if (!enabled) return off("Hourly shifts: approved and waiting", columns, ["dateRange", "client", "employee"]);
      const entries = await db.timeEntry.findMany({
        where: {
          organizationId: ctx.orgId,
          status: { in: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "WITHDRAWN"] },
          clockIn: { gte: parseWatLocal(`${from}T00:00`), lt: new Date(parseWatLocal(`${to}T00:00`).getTime() + 86_400_000) },
          ...(p.clientId ? { clientId: p.clientId } : {}),
          ...(p.employeeId ? { employeeId: p.employeeId } : {}),
        },
        select: { employeeId: true, status: true, clockIn: true, clockOut: true, payableMinutes: true },
      });
      const emps = await people(ctx, [...new Set(entries.map((e) => e.employeeId))]);
      const gross = (e: (typeof entries)[number]) => (e.clockOut ? (e.clockOut.getTime() - e.clockIn.getTime()) / 60_000 : 0);
      const acc = new Map<string, { approved: number; waiting: number; drafts: number; none: number; rejected: number }>();
      for (const e of entries) {
        const a = acc.get(e.employeeId) ?? { approved: 0, waiting: 0, drafts: 0, none: 0, rejected: 0 };
        if (e.status === "APPROVED") a.approved += e.payableMinutes ?? 0;
        else if (e.status === "SUBMITTED") a.waiting += gross(e);
        else if (e.status === "DRAFT") {
          if (e.clockOut) a.drafts += gross(e);
          else a.none += 1;
        } else a.rejected += gross(e);
        acc.set(e.employeeId, a);
      }
      const row = (a: { approved: number; waiting: number; drafts: number; none: number; rejected: number }) => ({ approvedHours: hoursOf(a.approved), waitingHours: hoursOf(a.waiting), draftHours: hoursOf(a.drafts), noClockOut: a.none, rejectedHours: hoursOf(a.rejected) });
      const rows: Row[] = [...acc.entries()]
        .filter(([id]) => emps.has(id))
        .sort((x, y) => emps.get(x[0])!.employeeNumber.localeCompare(emps.get(y[0])!.employeeNumber))
        .map(([id, a]) => ({ employeeNumber: emps.get(id)!.employeeNumber, employeeName: fullName(emps.get(id)!), ...row(a) }));
      const sum = [...acc.values()].reduce((t, a) => ({ approved: t.approved + a.approved, waiting: t.waiting + a.waiting, drafts: t.drafts + a.drafts, none: t.none + a.none, rejected: t.rejected + a.rejected }), { approved: 0, waiting: 0, drafts: 0, none: 0, rejected: 0 });
      return {
        title: "Hourly shifts: approved and waiting",
        description: `For each person paid by the hour, the hours that are approved (and so will be paid) against the hours still waiting, from ${from} to ${to}, by the day each shift started. Hours not yet approved are the whole shift (breaks are recorded at approval). A shift with no clock-out is counted, not given hours, and is never paid until it is completed. No money is shown here.`,
        usesRun: false,
        filters: ["dateRange", "client", "employee"],
        columns,
        rows,
        totals: row(sum),
      };
    }
  }
}

const signedHours = (minutes: number) => (minutes < 0 ? -hoursOf(-minutes) : hoursOf(minutes));

/** YYYY-MM for each month from the month of `from` to the month of `to`. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ey, em] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The first day of the month that is `n` months before the month of `date`. */
function monthsBefore(date: string, n: number): string {
  const total = Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}
