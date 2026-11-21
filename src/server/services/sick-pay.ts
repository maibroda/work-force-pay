/**
 * Hourly pay, H14 piece 2, step 2b (docs/plans/hourly-payroll-h14-build-plan.md): what the pay run needs to PAY the approved sick days of people paid by the hour, and the findings it raises. Read for ONE company and one pay
 * period. Nothing is paid here: this works out, for each person, the extra pay (an allowance on the site where they last worked) that the pay engine adds to their gross, divided by that site's salary structure like their hours.
 *
 * The founder's answers of 2026-11-20 and 2026-11-21: a paid sick day is paid at the person's average daily hours times their weekday rate; the average is the approved hours of the months before the spell (the payroll rule's
 * `hourlyAverageMonths`) divided by the days they worked; only a usual day (a day of the week they worked in that period) is paid; only the first days of the leave year, up to the entitlement, in date order; a spell waiting
 * for approval, or with no hours to average, no rate or no site structure, is NOT paid and a blocking finding says so. The pure rules are in `src/lib/payroll/sick-pay.ts`.
 *
 * A supplementary payroll passes the days already paid by the period's other payrolls (kept on their stored lines), so a day is never paid twice.
 */
import { d, iso } from "@/lib/dates";
import type { HourlySiteInput } from "@/lib/payroll/engine";
import { resolveHourlyRate, type HourlyRateRow } from "@/lib/payroll/hourly-rates";
import { paidSickDates, sickBasis, sickPay, sickWindow, type WorkedSegment } from "@/lib/payroll/sick-pay";
import { workingDatesBetween } from "@/lib/leave";
import type { StructureDef } from "@/lib/payroll/structure";
import type { Tx } from "./_base";

export interface SickFinding {
  employeeId: string;
  category: string;
  severity: "CRITICAL" | "WARNING";
  code: string;
  message: string;
}

export interface SickPayForPerson {
  /** One zero-hours site per site the sick pay is paid at, carrying the allowance; the pay run merges it into the person's hourly sites. */
  sites: HourlySiteInput[];
  findings: SickFinding[];
}

export interface SickPayArgs {
  orgId: string;
  period: { name: string; startDate: Date; endDate: Date };
  /** The payroll rule's months of hours averaged. */
  months: number;
  /** Paid sick days a year (the leave policy) and the company's leave week. */
  sickDaysPerYear: number;
  workingDaysPerWeek: number;
  rates: readonly HourlyRateRow[];
  structureFor: (q: { contractId: string; categoryId: string; date: string }) => StructureDef | null;
  namesOf: (beatId: string) => { clientName: string; beatName: string };
  /** The people in the payroll, with their job role and the name to show in findings. */
  people: ReadonlyMap<string, { categoryId: string; label: string }>;
  /** Days already paid by the period's other payrolls, by person (a supplementary payroll's guard against paying a day twice). */
  alreadyPaid?: ReadonlyMap<string, ReadonlySet<string>>;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const list = (dates: readonly string[]) => dates.join(", ");

export async function loadSickPay(tx: Tx, a: SickPayArgs): Promise<Map<string, SickPayForPerson>> {
  const out = new Map<string, SickPayForPerson>();
  if (a.sickDaysPerYear <= 0) return out; // paid sick leave is not set up: nothing to pay
  const person = (id: string): SickPayForPerson => {
    let p = out.get(id);
    if (!p) {
      p = { sites: [], findings: [] };
      out.set(id, p);
    }
    return p;
  };
  const overlap = { startDate: { lte: a.period.endDate }, endDate: { gte: a.period.startDate } };
  const [spells, waiting] = await Promise.all([
    tx.sickSpell.findMany({ where: { organizationId: a.orgId, status: "APPROVED", ...overlap }, orderBy: [{ startDate: "asc" }, { id: "asc" }] }),
    tx.sickSpell.findMany({ where: { organizationId: a.orgId, status: "PENDING", ...overlap }, select: { employeeId: true } }),
  ]);
  // spells waiting for approval are not paid, and say so (as hours waiting for approval do)
  const waitingBy = new Map<string, number>();
  for (const w of waiting) if (a.people.has(w.employeeId)) waitingBy.set(w.employeeId, (waitingBy.get(w.employeeId) ?? 0) + 1);
  for (const [employeeId, n] of waitingBy)
    person(employeeId).findings.push({
      employeeId,
      category: "ATTENDANCE",
      severity: "CRITICAL",
      code: "SICK_NOT_APPROVED",
      message: `${a.people.get(employeeId)!.label} has ${n} ${plural(n, "spell", "spells")} of sickness in ${a.period.name} waiting for approval, so ${plural(n, "it is", "they are")} not paid. Get ${plural(n, "it", "them")} approved and calculate again, or approve the payroll knowing that pay is left out (an override needs a reason).`,
    });
  const mine = spells.filter((s) => a.people.has(s.employeeId));
  if (mine.length === 0) return out;

  const employeeIds = [...new Set(mine.map((s) => s.employeeId))];
  const [yearSpells, segments] = await Promise.all([
    tx.sickSpell.findMany({ where: { organizationId: a.orgId, status: "APPROVED", employeeId: { in: employeeIds } }, select: { employeeId: true, cycleStart: true, startDate: true, endDate: true } }),
    (async () => {
      const windows = mine.map((s) => sickWindow(iso(s.startDate), a.months));
      const from = windows.map((w) => w.from).sort()[0];
      const to = windows.map((w) => w.to).sort().reverse()[0];
      return tx.timeEntrySegment.findMany({
        where: { organizationId: a.orgId, date: { gte: d(from), lt: d(to) }, entry: { status: "APPROVED", employeeId: { in: employeeIds } } },
        select: { date: true, minutes: true, entry: { select: { employeeId: true, beatId: true, contractId: true, clientId: true } } },
      });
    })(),
  ]);
  const historyBy = new Map<string, WorkedSegment[]>();
  for (const s of segments) {
    const list2 = historyBy.get(s.entry.employeeId) ?? [];
    list2.push({ date: iso(s.date), minutes: s.minutes, beatId: s.entry.beatId, contractId: s.entry.contractId, clientId: s.entry.clientId });
    historyBy.set(s.entry.employeeId, list2);
  }
  const lastDay = iso(a.period.endDate);
  const firstDay = iso(a.period.startDate);

  for (const spell of mine) {
    const employeeId = spell.employeeId;
    const who = a.people.get(employeeId)!;
    const start = iso(spell.startDate);
    const end = iso(spell.endDate);
    // the days of the spell that fall in this pay period, and every approved sick day of the same leave year (to count the entitlement in date order)
    const dates = workingDatesBetween(spell.startDate, spell.endDate, a.workingDaysPerWeek).map(iso).filter((x) => x >= firstDay && x <= lastDay);
    if (dates.length === 0) continue;
    const yearDates = yearSpells.filter((y) => y.employeeId === employeeId && y.cycleStart.getTime() === spell.cycleStart.getTime()).flatMap((y) => workingDatesBetween(y.startDate, y.endDate, a.workingDaysPerWeek).map(iso));
    const win = sickWindow(start, a.months);
    const basis = sickBasis(historyBy.get(employeeId) ?? [], win.from, win.to);
    if (!basis) {
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "SICK_NO_AVERAGE", message: `${who.label} has an approved spell of sickness from ${start} to ${end} but no approved hours in the ${a.months} ${plural(a.months, "month", "months")} before it, so there is nothing to average and the sick days are not paid. Check their hours, or override this finding with a reason.` });
      continue;
    }
    const split = paidSickDates({ yearDates, entitled: a.sickDaysPerYear, dates, weekdays: basis.weekdays });
    if (split.beyondEntitlement.length)
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "WARNING", code: "SICK_BEYOND_ENTITLEMENT", message: `${who.label}: ${split.beyondEntitlement.length} ${plural(split.beyondEntitlement.length, "day", "days")} of sickness (${list(split.beyondEntitlement)}) ${plural(split.beyondEntitlement.length, "is", "are")} beyond the ${a.sickDaysPerYear} paid sick days of the leave year, so ${plural(split.beyondEntitlement.length, "it is", "they are")} not paid.` });
    if (split.notUsual.length)
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "WARNING", code: "SICK_NOT_USUAL_DAY", message: `${who.label}: ${split.notUsual.length} ${plural(split.notUsual.length, "day", "days")} of sickness (${list(split.notUsual)}) ${plural(split.notUsual.length, "is not a day", "are not days")} of the week they usually work (from their hours in the ${a.months} ${plural(a.months, "month", "months")} before), so ${plural(split.notUsual.length, "it is", "they are")} not paid.` });
    const already = a.alreadyPaid?.get(employeeId);
    const toPay = split.paid.filter((x) => !already?.has(x));
    if (toPay.length === 0) continue;
    const date = toPay[0];
    let rate;
    try {
      rate = resolveHourlyRate(a.rates, { employeeId, contractId: basis.last.contractId, categoryId: who.categoryId, date: d(date) });
    } catch (e) {
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "HOURLY_RATE_CONFLICT", message: `${who.label}'s sick pay for ${a.period.name} could not be worked out, so it is not paid. ${e instanceof Error ? e.message : ""}` });
      continue;
    }
    if (!rate) {
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "SICK_NO_RATE", message: `${who.label} has approved sick days in ${a.period.name} but no approved hourly rate for their job role on ${date}, so they are not paid. Approve an hourly rate (Payroll > Hourly pay) and calculate again.` });
      continue;
    }
    const structure = a.structureFor({ contractId: basis.last.contractId, categoryId: who.categoryId, date });
    if (!structure) {
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "SICK_NO_STRUCTURE", message: `${who.label} has approved sick days in ${a.period.name} at a site with no salary structure (the contract rate's, the contract's default or the company's default), so they are not paid. Set up a structure and calculate again.` });
      continue;
    }
    const pay = sickPay(rate.rates.weekday, basis, toPay.length);
    const names = a.namesOf(basis.last.beatId);
    const key = `${basis.last.beatId}|${basis.last.contractId}|${structure.id}`;
    const p = person(employeeId);
    const allowance = { kind: "SICK_DAY" as const, amountKobo: pay.amountKobo, minutes: pay.minutes, rate: rate.rates.weekday, dates: toPay };
    const site = p.sites.find((s) => s.key === key);
    if (site) site.allowances = [...(site.allowances ?? []), allowance];
    else p.sites.push({ key, clientId: basis.last.clientId, clientName: names.clientName, contractId: basis.last.contractId, beatId: basis.last.beatId, beatName: names.beatName, structure, from: date, to: date, dates: [], lines: [], allowances: [allowance] });
  }
  return out;
}

/** The days of sick pay already paid by the period's payrolls that have not been replaced (a supplementary payroll must not pay them again), by person. Read for ONE company. */
export async function sickDaysAlreadyPaid(tx: Tx, orgId: string, periodId: string): Promise<Map<string, Set<string>>> {
  const runs = await tx.payrollRun.findMany({ where: { organizationId: orgId, periodId, status: { not: "SUPERSEDED" } }, select: { id: true } });
  const out = new Map<string, Set<string>>();
  if (!runs.length) return out;
  const lines = await tx.hourlyAllowanceLine.findMany({ where: { organizationId: orgId, runId: { in: runs.map((r) => r.id) }, kind: "SICK_DAY" }, select: { employeeId: true, dates: true } });
  for (const l of lines) {
    const set = out.get(l.employeeId) ?? new Set<string>();
    for (const x of l.dates) set.add(x);
    out.set(l.employeeId, set);
  }
  return out;
}

