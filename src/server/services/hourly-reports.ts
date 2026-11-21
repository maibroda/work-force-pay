import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { addKobo, koboToNumber, subKobo, toKobo, type Kobo } from "@/lib/money-exact";
import { isIsoDate } from "@/lib/pay-rate";
import { groupAllowances, rollupAllowances, type AllowanceRollup, type AllowanceRow } from "@/lib/payroll/hourly-allowance-report";
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

/**
 * The three extra pays (leave pay, sick pay, holiday pay not worked) as payroll calculated them, read from the stored payroll lines (the plan's option A): for each WHOLE payroll month the dates touch, from every payroll run of
 * the month that is not superseded (a supplementary run's lines count too; a recalculation replaced the lines of its run, so nothing is counted twice). Also the payroll's state for each month, so a month with no calculated payroll is plain.
 */
const STATE_ORDER = ["DRAFT", "CALCULATED", "PENDING_APPROVAL", "APPROVED", "LOCKED", "PAID"];
const STATE_LABEL: Record<string, string> = { DRAFT: "Calculated", CALCULATED: "Calculated", PENDING_APPROVAL: "Waiting for approval", APPROVED: "Approved", LOCKED: "Locked", PAID: "Paid" };
const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

async function allowanceLines(ctx: Ctx, from: string, to: string, p: Params): Promise<{ rows: AllowanceRow[]; states: Map<string, string> }> {
  const months = monthsBetween(from, to);
  const runs = await db.payrollRun.findMany({
    where: { organizationId: ctx.orgId, status: { not: "SUPERSEDED" }, period: { OR: months.map((m) => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) })) } },
    select: { id: true, status: true, period: { select: { year: true, month: true } } },
  });
  const monthOf = new Map(runs.map((r) => [r.id, monthKey(r.period.year, r.period.month)]));
  const rank = new Map<string, number>();
  const states = new Map<string, string>();
  for (const r of runs) {
    const m = monthOf.get(r.id)!;
    const k = STATE_ORDER.indexOf(r.status);
    if (k >= (rank.get(m) ?? -1)) {
      rank.set(m, k);
      states.set(m, STATE_LABEL[r.status] ?? r.status);
    }
  }
  const found = runs.length
    ? await db.hourlyAllowanceLine.findMany({
        where: { organizationId: ctx.orgId, runId: { in: runs.map((r) => r.id) }, ...(p.clientId ? { clientId: p.clientId } : {}), ...(p.employeeId ? { employeeId: p.employeeId } : {}) },
        select: { runId: true, employeeId: true, contractId: true, clientId: true, kind: true, amount: true },
      })
    : [];
  const rows: AllowanceRow[] = found.map((l) => ({ employeeId: l.employeeId, contractId: l.contractId, clientId: l.clientId, month: monthOf.get(l.runId)!, kind: l.kind, amountKobo: toKobo(l.amount) }));
  return { rows, states };
}

/** The extra-pay columns of one row: each extra pay, and the hours cost plus all three. */
const extraCols = (hours: Rollup, extra: AllowanceRollup) => ({
  leavePay: koboToNumber(extra.leaveKobo as Kobo),
  sickPay: koboToNumber(extra.sickKobo as Kobo),
  holidayPay: koboToNumber(extra.holidayKobo as Kobo),
  totalWithExtra: koboToNumber(addKobo(hours.totalKobo as Kobo, extra.totalKobo as Kobo)),
});

const EXTRA_NOTE = "Leave pay, sick pay and holiday pay are the amounts payroll calculated (the stored payroll lines), for each whole payroll month the dates touch; a month with no calculated payroll shows 0 for them. Total with extra pay = the indicative hours cost plus those three.";

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
  MONEY("leavePay", "Leave pay (payroll)"),
  MONEY("sickPay", "Sick pay (payroll)"),
  MONEY("holidayPay", "Holiday pay not worked (payroll)"),
  MONEY("totalWithExtra", "Total with extra pay"),
];

const INDICATIVE = "The cost is indicative: approved hours at the approved hourly rates, not payroll. Only approved shifts count. Hours with no approved rate are shown apart and are not in the cost.";

const off = (title: string, columns: Col[], filters: Report["filters"]): Report => ({ title, description: "Hourly pay is not switched on for this company.", usesRun: false, filters, columns, rows: [] });

export async function buildHourlyReport(ctx: Ctx, type: HourlyReportType, p: Params): Promise<Report> {
  assertCan(ctx, type === "hourly-status" ? "reports.view" : "payroll.view");
  const enabled = await hourlyPayEnabled(ctx.orgId);
  const { from, to } = range(p);
  switch (type) {
    case "hourly-summary": {
      const columns: Col[] = [{ key: "employeeNumber", label: "Emp. No." }, { key: "employeeName", label: "Name" }, { key: "category", label: "Job role" }, ...CLASS_COLS];
      if (!enabled) return off("Hourly pay: by employee", columns, ["dateRange", "client", "employee"]);
      const { lines } = await pricedLines(ctx, from, to, p);
      const extra = await allowanceLines(ctx, from, to, p);
      const hoursBy = groupLines(lines, (l) => l.employeeId);
      const extraBy = groupAllowances(extra.rows, (r) => r.employeeId);
      const ids = [...new Set([...hoursBy.keys(), ...extraBy.keys()])];
      const emps = await people(ctx, ids);
      const rows: Row[] = ids
        .map((id) => ({ e: emps.get(id), id }))
        .filter((x) => x.e)
        .sort((a, b) => a.e!.employeeNumber.localeCompare(b.e!.employeeNumber))
        .map(({ e, id }) => {
          const hours = rollup(hoursBy.get(id) ?? []);
          return { employeeNumber: e!.employeeNumber, employeeName: fullName(e!), category: e!.category.name, ...hoursCols(hours), ...extraCols(hours, rollupAllowances(extraBy.get(id) ?? [])) };
        });
      return { title: "Hourly pay: by employee", description: `Approved hours and the indicative cost for each person paid by the hour, from ${from} to ${to}. ${INDICATIVE} ${EXTRA_NOTE}`, usesRun: false, filters: ["dateRange", "client", "employee"], columns, rows, totals: { ...hoursCols(rollup(lines)), ...extraCols(rollup(lines), rollupAllowances(extra.rows)) } };
    }
    case "hourly-by-client": {
      const columns: Col[] = [{ key: "client", label: "Client" }, { key: "contract", label: "Contract" }, HOURS("people", "People"), ...CLASS_COLS];
      if (!enabled) return off("Hourly pay: by client and contract", columns, ["dateRange", "client"]);
      const { lines } = await pricedLines(ctx, from, to, p);
      const extra = await allowanceLines(ctx, from, to, p);
      const hoursBy = groupLines(lines, (l) => l.contractId);
      const extraBy = groupAllowances(extra.rows, (r) => r.contractId ?? "");
      const contractIds = [...new Set([...hoursBy.keys(), ...extraBy.keys()])].filter(Boolean);
      const contracts = await db.contract.findMany({ where: { organizationId: ctx.orgId, id: { in: contractIds } }, select: { id: true, contractNumber: true, name: true, client: { select: { name: true } } } });
      const byId = new Map(contracts.map((c) => [c.id, c]));
      const rows: Row[] = contractIds
        .map((id) => ({ c: byId.get(id), id }))
        .filter((x) => x.c)
        .sort((a, b) => a.c!.client.name.localeCompare(b.c!.client.name) || a.c!.contractNumber.localeCompare(b.c!.contractNumber))
        .map(({ c, id }) => {
          const group = hoursBy.get(id) ?? [];
          const ex = extraBy.get(id) ?? [];
          const hours = rollup(group);
          return { client: c!.client.name, contract: `${c!.contractNumber} — ${c!.name}`, people: new Set([...group.map((l) => l.employeeId), ...ex.map((r) => r.employeeId)]).size, ...hoursCols(hours), ...extraCols(hours, rollupAllowances(ex)) };
        });
      // extra pay with no contract recorded (not expected) is kept in a row of its own, so the total is never short of the by-employee total
      const orphan = extraBy.get("") ?? [];
      if (orphan.length) rows.push({ client: "—", contract: "No contract recorded", people: new Set(orphan.map((r) => r.employeeId)).size, ...hoursCols(rollup([])), ...extraCols(rollup([]), rollupAllowances(orphan)) });
      const totals = { people: new Set([...lines.map((l) => l.employeeId), ...extra.rows.map((r) => r.employeeId)]).size, ...hoursCols(rollup(lines)), ...extraCols(rollup(lines), rollupAllowances(extra.rows)) };
      return { title: "Hourly pay: by client and contract", description: `Approved hours and the indicative cost for each client and contract, from ${from} to ${to}. The total is the same as the by-employee report. ${INDICATIVE} ${EXTRA_NOTE}`, usesRun: false, filters: ["dateRange", "client"], columns, rows, totals };
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
        MONEY("leavePay", "Leave pay (payroll)"),
        MONEY("sickPay", "Sick pay (payroll)"),
        MONEY("holidayPay", "Holiday pay not worked (payroll)"),
        MONEY("totalWithExtra", "Total with extra pay"),
        { key: "payrollState", label: "Payroll" },
        HOURS("hoursChange", "Hours change on the month before"),
        MONEY("amountChange", "Cost change on the month before"),
      ];
      if (!enabled) return off("Hourly pay: month by month", columns, ["dateRange", "client"]);
      // with no dates given, the six months up to the end date
      const end = p.to && isIsoDate(p.to) ? p.to : to;
      const start = p.from && isIsoDate(p.from) ? p.from : monthsBefore(end, 5);
      const { lines } = await pricedLines(ctx, start, end, p);
      const byMonth = groupLines(lines, (l) => l.month);
      const extra = await allowanceLines(ctx, start, end, p);
      const extraByMonth = groupAllowances(extra.rows, (r) => r.month);
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
          ...extraCols(r, rollupAllowances(extraByMonth.get(month) ?? [])),
          payrollState: extra.states.get(month) ?? "Not calculated",
          hoursChange: prev ? signedHours(r.totalMinutes - prev.totalMinutes) : null,
          amountChange: prev ? koboToNumber(subKobo(r.totalKobo as Kobo, prev.totalKobo as Kobo)) : null,
        });
        prev = r;
      }
      const all = hoursCols(rollup(lines));
      const allExtra = extraCols(rollup(lines), rollupAllowances(extra.rows));
      const notCalculated = [...byMonth.entries()].filter(([m, g]) => g.length && !extra.states.has(m)).map(([m]) => m).sort();
      return {
        title: "Hourly pay: month by month",
        description: `Approved hours and the indicative cost for each month from ${start} to ${end}, with the change on the month before. A shift over a month end is split between the two months. ${INDICATIVE} ${EXTRA_NOTE}${notCalculated.length ? ` Not yet calculated (no payroll for the month): ${notCalculated.join(", ")}.` : ""}`,
        usesRun: false,
        filters: ["dateRange", "client"],
        columns,
        rows,
        totals: { totalHours: all.totalHours, totalAmount: all.totalAmount, unpricedHours: all.unpricedHours, weekdayHours: all.weekdayHours, weekendHours: all.weekendHours, holidayHours: all.holidayHours, ...allExtra },
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
