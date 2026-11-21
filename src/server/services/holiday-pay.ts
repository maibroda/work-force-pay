/**
 * Hourly pay, H14 piece 3 (docs/plans/hourly-payroll-h14-build-plan.md): what the pay run needs to PAY a public holiday NOT WORKED to people paid by the hour, and the findings it raises. Read for ONE company and one pay
 * period. Nothing is paid here: this works out, for each person, the extra pay (an allowance on the site where they last worked) that the pay engine adds to their gross, divided by that site's salary structure like their hours.
 *
 * The founder's answers of 2026-11-20 and 2026-11-21 (my recommendations, which he accepted): a holiday not worked is paid at the person's average daily hours (their approved hours in the months before the holiday,
 * divided by the days they worked) times their weekday rate, when: the holiday applies to the state of the place they work (H11: the site where they last worked); it falls on one of their usual days (a day of the week they
 * worked in that period); they were employed, paid by the hour and past the service period for annual leave (as for monthly staff); and they did NOT work it (a worked holiday is already paid at the holiday rate). A day
 * of approved sickness is paid as sickness and never also as a holiday. Someone with no hours in that period is simply not owed it (no finding). A holiday is paid once: a supplementary payroll leaves out the days the
 * period's other payrolls already paid. The amount is the same pure rule as a paid sick day (`src/lib/payroll/sick-pay.ts`), worked once for each holiday.
 *
 * The history is read as totals in the database (hours, days worked, days of the week, last site), not row by row, so a payroll for thousands of people reads a few rows for each holiday, not every shift.
 */
import { iso } from "@/lib/dates";
import { addMonths, workingDatesBetween } from "@/lib/leave";
import { roundRatio } from "@/lib/money-exact";
import { grossBasis, grossBreakdown, grossDayPay, type AverageDayClass, type GrossBasis, type PricedDay } from "@/lib/payroll/hourly-average";
import type { HourlySiteInput } from "@/lib/payroll/engine";
import { compensationTypeOn, holidaysApplying, resolveHourlyRate, type CompensationRow, type HourlyRateRow } from "@/lib/payroll/hourly-rates";
import { sickPay, sickWindow } from "@/lib/payroll/sick-pay";
import type { StructureDef } from "@/lib/payroll/structure";
import type { Tx } from "./_base";
import { loadPricedHistory } from "./hourly-history";
import type { SickFinding, SickPayForPerson } from "./sick-pay";

export type HolidayPayForPerson = SickPayForPerson;
export type HolidayFinding = SickFinding;

export interface HolidayPayArgs {
  orgId: string;
  period: { name: string; startDate: Date; endDate: Date };
  /** The payroll rule's months of hours averaged (the same setting as for sick pay). */
  months: number;
  workingDaysPerWeek: number;
  /** The leave policy's months of service before leave is due (12): the same wait applies here. */
  eligibilityMonths: number;
  rates: readonly HourlyRateRow[];
  structureFor: (q: { contractId: string; categoryId: string; date: string }) => StructureDef | null;
  namesOf: (beatId: string) => { clientName: string; beatName: string };
  /** The people in the payroll: who they are, their job role, when they were employed and how they are paid. */
  people: ReadonlyMap<string, { categoryId: string; label: string; employmentDate: Date; exitDate: Date | null; comp: readonly CompensationRow[] }>;
  /** Days already paid by the period's other payrolls, by person (a supplementary payroll's guard against paying a holiday twice). */
  alreadyPaid?: ReadonlyMap<string, ReadonlySet<string>>;
  /** How a holiday not worked is valued (the payroll rule): the average daily GROSS earnings of the window (the founder's decision) or, left out, the first build's average hours times the weekday rate; and which kinds of day count. */
  average?: { basis: "HOURS_AT_WEEKDAY_RATE" | "GROSS_EARNINGS"; counted: ReadonlySet<AverageDayClass> };
}

export async function loadHolidayPay(tx: Tx, a: HolidayPayArgs): Promise<Map<string, HolidayPayForPerson>> {
  const out = new Map<string, HolidayPayForPerson>();
  const holidays = await tx.publicHoliday.findMany({
    where: { organizationId: a.orgId, date: { gte: a.period.startDate, lte: a.period.endDate } },
    include: { states: { select: { state: true } } },
    orderBy: { date: "asc" },
  });
  if (holidays.length === 0 || a.people.size === 0) return out;
  // the gross-earnings basis reads the hours of the months before every holiday of the period once, valued at the rate of their own day
  const gross = a.average?.basis === "GROSS_EARNINGS";
  const priced = gross
    ? await loadPricedHistory(tx, { orgId: a.orgId, employeeIds: [...a.people.keys()], from: sickWindow(iso(holidays[0].date), a.months).from, to: iso(holidays[holidays.length - 1].date), categoryOf: (id) => a.people.get(id)?.categoryId ?? "" })
    : new Map<string, PricedDay[]>();
  const person = (id: string): HolidayPayForPerson => {
    let p = out.get(id);
    if (!p) {
      p = { sites: [], findings: [] };
      out.set(id, p);
    }
    return p;
  };

  for (const holiday of holidays) {
    const date = iso(holiday.date);
    const when = holiday.date;
    // who could be owed it: employed on the day, paid by the hour that day, past the service period, and not paid for this holiday already
    const candidates = [...a.people].filter(([id, p]) => p.employmentDate <= when && (!p.exitDate || p.exitDate >= when) && compensationTypeOn(p.comp, when) === "HOURLY" && addMonths(p.employmentDate, a.eligibilityMonths) <= when && !a.alreadyPaid?.get(id)?.has(date));
    if (candidates.length === 0) continue;
    const ids = candidates.map(([id]) => id);
    const win = sickWindow(date, a.months);

    const [totals, lastSites, worked, spells] = await Promise.all([
      gross ? Promise.resolve([] as Array<{ employeeId: string; total: number; days: number; dows: number[] }>) : tx.$queryRaw<Array<{ employeeId: string; total: number; days: number; dows: number[] }>>`
        SELECT e."employeeId" AS "employeeId", SUM(s."minutes")::int AS "total", COUNT(DISTINCT s."date")::int AS "days", ARRAY_AGG(DISTINCT EXTRACT(DOW FROM s."date")::int) AS "dows"
        FROM "TimeEntrySegment" s JOIN "TimeEntry" e ON e."id" = s."entryId"
        WHERE s."organizationId" = ${a.orgId} AND e."status" = 'APPROVED' AND s."date" >= ${win.from}::date AND s."date" < ${win.to}::date AND e."employeeId" = ANY(${ids}::text[])
        GROUP BY e."employeeId"`,
      gross ? Promise.resolve([] as Array<{ employeeId: string; beatId: string; contractId: string; clientId: string }>) : tx.$queryRaw<Array<{ employeeId: string; beatId: string; contractId: string; clientId: string }>>`
        SELECT DISTINCT ON (e."employeeId") e."employeeId" AS "employeeId", e."beatId" AS "beatId", e."contractId" AS "contractId", e."clientId" AS "clientId"
        FROM "TimeEntrySegment" s JOIN "TimeEntry" e ON e."id" = s."entryId"
        WHERE s."organizationId" = ${a.orgId} AND e."status" = 'APPROVED' AND s."date" >= ${win.from}::date AND s."date" < ${win.to}::date AND e."employeeId" = ANY(${ids}::text[])
        ORDER BY e."employeeId", s."date" DESC, s."minutes" DESC, e."beatId" ASC`,
      tx.$queryRaw<Array<{ employeeId: string }>>`
        SELECT DISTINCT e."employeeId" AS "employeeId"
        FROM "TimeEntrySegment" s JOIN "TimeEntry" e ON e."id" = s."entryId"
        WHERE s."organizationId" = ${a.orgId} AND e."status" = 'APPROVED' AND s."date" = ${date}::date AND e."employeeId" = ANY(${ids}::text[])`,
      tx.sickSpell.findMany({ where: { organizationId: a.orgId, status: "APPROVED", employeeId: { in: ids }, startDate: { lte: when }, endDate: { gte: when } }, select: { employeeId: true, startDate: true, endDate: true } }),
    ]);
    const grossBy = new Map<string, GrossBasis>();
    if (gross)
      for (const id of ids) {
        const g = grossBasis(priced.get(id) ?? [], win.from, win.to, a.average!.counted);
        if (g) grossBy.set(id, g);
      }
    const totalsAll = gross ? [...grossBy].map(([employeeId, g]) => ({ employeeId, total: g.minutes, days: g.daysWorked, dows: [...g.weekdays] })) : totals;
    const lastAll = gross ? [...grossBy].map(([employeeId, g]) => ({ employeeId, ...g.last })) : lastSites;
    if (totalsAll.length === 0) continue; // no one has earnings in the months before: no one is owed it
    const workedIds = new Set(worked.map((w) => w.employeeId));
    const onSick = new Set(spells.filter((s) => workingDatesBetween(s.startDate, s.endDate, a.workingDaysPerWeek).some((x) => iso(x) === date)).map((s) => s.employeeId));
    const lastBy = new Map(lastAll.map((l) => [l.employeeId, l]));
    const beats = await tx.beat.findMany({ where: { organizationId: a.orgId, id: { in: [...new Set(lastAll.map((l) => l.beatId))] } }, select: { id: true, state: true } });
    const stateOf = new Map(beats.map((b) => [b.id, b.state]));
    const states = holiday.states.map((s) => s.state);

    for (const t of totalsAll) {
      const employeeId = t.employeeId;
      const who = a.people.get(employeeId)!;
      const last = lastBy.get(employeeId);
      if (!last || workedIds.has(employeeId) || onSick.has(employeeId)) continue; // worked it (paid with the hours) or is on sick leave that day (paid as sickness)
      if (!holidaysApplying([{ date, states }], stateOf.get(last.beatId) ?? null).has(date)) continue; // not a holiday at the place they work
      if (!(t.dows ?? []).includes(new Date(`${date}T00:00:00Z`).getUTCDay())) continue; // not one of their usual days
      let rate;
      try {
        rate = gross ? null : resolveHourlyRate(a.rates, { employeeId, contractId: last.contractId, categoryId: who.categoryId, date: when });
      } catch (e) {
        person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "HOURLY_RATE_CONFLICT", message: `${who.label}'s holiday pay for ${date} could not be worked out, so it is not paid. ${e instanceof Error ? e.message : ""}` });
        continue;
      }
      if (!gross && !rate) {
        person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "HOLIDAY_NO_RATE", message: `${who.label} is owed pay for the public holiday on ${date} (not worked) but has no approved hourly rate for their job role that day, so it is not paid. Approve an hourly rate (Payroll > Hourly pay) and calculate again.` });
        continue;
      }
      const structure = a.structureFor({ contractId: last.contractId, categoryId: who.categoryId, date });
      if (!structure) {
        person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "HOLIDAY_NO_STRUCTURE", message: `${who.label} is owed pay for the public holiday on ${date} (not worked) at a site with no salary structure (the contract rate's, the contract's default or the company's default), so it is not paid. Set up a structure and calculate again.` });
        continue;
      }
      const gb = grossBy.get(employeeId);
      if (gb && gb.unpricedMinutes > 0)
        person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "WARNING", code: "HOLIDAY_AVERAGE_UNPRICED", message: `${who.label}: ${gb.unpricedMinutes} minutes of the hours in the ${a.months} months before the holiday on ${date} had no approved hourly rate for their day, so they are not in the average of earnings used to pay it. Check the rates.` });
      const pay = gb ? { minutes: Number(roundRatio(BigInt(gb.minutes), BigInt(gb.daysWorked))), amountKobo: grossDayPay(gb, 1) } : sickPay(rate!.rates.weekday, { totalMinutes: t.total, daysWorked: t.days }, 1);
      const names = a.namesOf(last.beatId);
      const key = `${last.beatId}|${last.contractId}|${structure.id}`;
      const p = person(employeeId);
      const allowance = gb
        ? { kind: "HOLIDAY_NOT_WORKED" as const, amountKobo: pay.amountKobo, minutes: pay.minutes, dates: [date], breakdown: grossBreakdown(gb, 1, a.average!.counted) }
        : { kind: "HOLIDAY_NOT_WORKED" as const, amountKobo: pay.amountKobo, minutes: pay.minutes, rate: rate!.rates.weekday, dates: [date] };
      const site: HourlySiteInput | undefined = p.sites.find((s) => s.key === key);
      if (site) site.allowances = [...(site.allowances ?? []), allowance];
      else p.sites.push({ key, clientId: last.clientId, clientName: names.clientName, contractId: last.contractId, beatId: last.beatId, beatName: names.beatName, structure, from: date, to: date, dates: [], lines: [], allowances: [allowance] });
    }
  }
  return out;
}

