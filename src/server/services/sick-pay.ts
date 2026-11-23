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
import { grossBasis, grossBreakdown, grossDayPay, type AverageDayClass, type GrossBasis, type PricedDay } from "@/lib/payroll/hourly-average";
import { paidSickDates, sickBasis, sickPay, sickWindow, type SickBasis, type WorkedSegment } from "@/lib/payroll/sick-pay";
import { loadPricedHistory } from "./hourly-history";
import { workingDatesBetween } from "@/lib/leave";
import { mulDiv, roundRatio, sumKobo, toKobo, type Kobo } from "@/lib/money-exact";
import { naira } from "@/lib/payroll/hourly-minimum";
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
  /** How a sick day is valued (the payroll rule): the average daily GROSS earnings of the window (the founder's decision) or, left out, the first build's average hours times the weekday rate; and which kinds of day count towards the gross average. */
  average?: { basis: "HOURS_AT_WEEKDAY_RATE" | "GROSS_EARNINGS"; counted: ReadonlySet<AverageDayClass> };
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
  const gross = a.average?.basis === "GROSS_EARNINGS";
  const windows = mine.map((s) => sickWindow(iso(s.startDate), a.months));
  const from = windows.map((w) => w.from).sort()[0];
  const to = windows.map((w) => w.to).sort().reverse()[0];
  const [yearSpells, segments, priced] = await Promise.all([
    tx.sickSpell.findMany({ where: { organizationId: a.orgId, status: "APPROVED", employeeId: { in: employeeIds } }, select: { employeeId: true, cycleStart: true, startDate: true, endDate: true } }),
    gross
      ? Promise.resolve([])
      : tx.timeEntrySegment.findMany({
          where: { organizationId: a.orgId, date: { gte: d(from), lt: d(to) }, entry: { status: "APPROVED", employeeId: { in: employeeIds } } },
          select: { date: true, minutes: true, entry: { select: { employeeId: true, beatId: true, contractId: true, clientId: true } } },
        }),
    // the gross-earnings basis reads the same hours valued at the rate of their own day (one read for the whole company)
    gross ? loadPricedHistory(tx, { orgId: a.orgId, employeeIds, from, to, categoryOf: (id) => a.people.get(id)?.categoryId ?? "" }) : Promise.resolve(new Map<string, PricedDay[]>()),
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
    const gb: GrossBasis | null = gross ? grossBasis(priced.get(employeeId) ?? [], win.from, win.to, a.average!.counted) : null;
    const sb: SickBasis | null = gross ? null : sickBasis(historyBy.get(employeeId) ?? [], win.from, win.to);
    const basis = gb ?? sb;
    if (!basis) {
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "SICK_NO_AVERAGE", message: `${who.label} has an approved spell of sickness from ${start} to ${end} but no approved ${gross ? "earnings (hours with an approved rate, of a kind of day that counts)" : "hours"} in the ${a.months} ${plural(a.months, "month", "months")} before it, so there is nothing to average and the sick days are not paid. Check their hours, or override this finding with a reason.` });
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
      rate = gross ? null : resolveHourlyRate(a.rates, { employeeId, contractId: basis.last.contractId, categoryId: who.categoryId, date: d(date) });
    } catch (e) {
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "HOURLY_RATE_CONFLICT", message: `${who.label}'s sick pay for ${a.period.name} could not be worked out, so it is not paid. ${e instanceof Error ? e.message : ""}` });
      continue;
    }
    if (!gross && !rate) {
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "SICK_NO_RATE", message: `${who.label} has approved sick days in ${a.period.name} but no approved hourly rate for their job role on ${date}, so they are not paid. Approve an hourly rate (Payroll > Hourly pay) and calculate again.` });
      continue;
    }
    const structure = a.structureFor({ contractId: basis.last.contractId, categoryId: who.categoryId, date });
    if (!structure) {
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "CRITICAL", code: "SICK_NO_STRUCTURE", message: `${who.label} has approved sick days in ${a.period.name} at a site with no salary structure (the contract rate's, the contract's default or the company's default), so they are not paid. Set up a structure and calculate again.` });
      continue;
    }
    if (gb && gb.unpricedMinutes > 0)
      person(employeeId).findings.push({ employeeId, category: "ATTENDANCE", severity: "WARNING", code: "SICK_AVERAGE_UNPRICED", message: `${who.label}: ${gb.unpricedMinutes} minutes of the hours in the ${a.months} ${plural(a.months, "month", "months")} before the spell from ${start} had no approved hourly rate for their day, so they are not in the average of earnings used to pay the sick days. Check the rates.` });
    const pay = gb
      ? { minutes: Number(roundRatio(BigInt(gb.minutes) * BigInt(toPay.length), BigInt(gb.daysWorked))), amountKobo: grossDayPay(gb, toPay.length) }
      : sickPay(rate!.rates.weekday, sb!, toPay.length);
    const names = a.namesOf(basis.last.beatId);
    const key = `${basis.last.beatId}|${basis.last.contractId}|${structure.id}`;
    const p = person(employeeId);
    const allowance = gb
      ? { kind: "SICK_DAY" as const, amountKobo: pay.amountKobo, minutes: pay.minutes, dates: toPay, breakdown: grossBreakdown(gb, toPay.length, a.average!.counted) }
      : { kind: "SICK_DAY" as const, amountKobo: pay.amountKobo, minutes: pay.minutes, rate: rate!.rates.weekday, dates: toPay };
    const site = p.sites.find((s) => s.key === key);
    if (site) site.allowances = [...(site.allowances ?? []), allowance];
    else p.sites.push({ key, clientId: basis.last.clientId, clientName: names.clientName, contractId: basis.last.contractId, beatId: basis.last.beatId, beatName: names.beatName, structure, from: date, to: date, dates: [], lines: [], allowances: [allowance] });
  }
  return out;
}

/** The days of sick pay already paid by the period's payrolls that have not been replaced (a supplementary payroll must not pay them again), by person. Read for ONE company. */
export function sickDaysAlreadyPaid(tx: Tx, orgId: string, periodId: string): Promise<Map<string, Set<string>>> {
  return allowanceDaysAlreadyPaid(tx, orgId, periodId, "SICK_DAY");
}

/** The days of a kind of day-based extra pay (sick pay, holiday pay) already paid by the period's payrolls that have not been replaced, by person. Read for ONE company. */
export async function allowanceDaysAlreadyPaid(tx: Tx, orgId: string, periodId: string, kind: "SICK_DAY" | "HOLIDAY_NOT_WORKED"): Promise<Map<string, Set<string>>> {
  const runs = await tx.payrollRun.findMany({ where: { organizationId: orgId, periodId, status: { not: "SUPERSEDED" } }, select: { id: true } });
  const out = new Map<string, Set<string>>();
  if (!runs.length) return out;
  const lines = await tx.hourlyAllowanceLine.findMany({ where: { organizationId: orgId, runId: { in: runs.map((r) => r.id) }, kind }, select: { employeeId: true, dates: true } });
  for (const l of lines) {
    const set = out.get(l.employeeId) ?? new Set<string>();
    for (const x of l.dates) set.add(x);
    out.set(l.employeeId, set);
  }
  return out;
}


/** The payroll periods whose payrolls are final: a calculation of theirs can no longer be replaced, so what they paid stays paid. */
const FROZEN_PERIOD = ["APPROVED", "LOCKED", "PAID", "CLOSED"] as const;

export interface WithdrawnSickFinding extends SickFinding {
  /** The cancelled spell the finding is about: the pay run marks it once its payroll is saved, so no later payroll repeats the finding. */
  spellId: string;
}

/**
 * Sick days PAID by a final payroll on a spell of sickness that HR has since CANCELLED (docs/plans/hourly-sick-spell-correction-plan.md). No negative pay is ever made (the rule the hourly pay already follows for hours
 * corrected after payment): this raises ONE critical finding, in the first payroll calculated after the cancellation, naming the person, the days and the amount that was paid (from the stored sick pay line, never recalculated),
 * for Payroll to enter a deduction if it is to be recovered. A day covered by an approved spell (a replacement) was not overpaid; a day is reported once even if more than one cancelled spell covers it; a payroll that was
 * replaced (superseded) paid nothing. `currentRunId` is the payroll being calculated again (it keeps its own finding); a spell already reported by another live payroll is not reported again. Read for ONE company.
 */
export async function loadWithdrawnSickPay(tx: Tx, a: { orgId: string; currentRunId?: string | null }): Promise<WithdrawnSickFinding[]> {
  const spells = await tx.sickSpell.findMany({ where: { organizationId: a.orgId, status: "CANCELLED", cancelledAt: { not: null } }, orderBy: [{ cancelledAt: "asc" }, { id: "asc" }] });
  if (!spells.length) return [];
  const employeeIds = [...new Set(spells.map((s) => s.employeeId))];
  const runs = await tx.payrollRun.findMany({ where: { organizationId: a.orgId, status: { not: "SUPERSEDED" }, period: { status: { in: [...FROZEN_PERIOD] } } }, select: { id: true } });
  if (!runs.length) return [];
  const [lines, approved, noters, people] = await Promise.all([
    tx.hourlyAllowanceLine.findMany({ where: { organizationId: a.orgId, kind: "SICK_DAY", runId: { in: runs.map((r) => r.id) }, employeeId: { in: employeeIds } }, select: { employeeId: true, dates: true, amount: true } }),
    tx.sickSpell.findMany({ where: { organizationId: a.orgId, status: "APPROVED", employeeId: { in: employeeIds } }, select: { employeeId: true, startDate: true, endDate: true } }),
    tx.payrollRun.findMany({ where: { organizationId: a.orgId, id: { in: spells.map((s) => s.overpaymentRunId).filter((x): x is string => Boolean(x)) }, status: { not: "SUPERSEDED" } }, select: { id: true } }),
    tx.employee.findMany({ where: { organizationId: a.orgId, id: { in: employeeIds } }, select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true } }),
  ]);
  if (!lines.length) return [];
  const liveNoters = new Set(noters.map((r) => r.id));
  const label = new Map(people.map((p) => [p.id, `${p.employeeNumber} ${[p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ")}`]));
  const claimed = new Map<string, Set<string>>(); // the days already reported, by person
  const out: WithdrawnSickFinding[] = [];
  for (const s of spells) {
    const from = iso(s.startDate);
    const to = iso(s.endDate);
    const mine = claimed.get(s.employeeId) ?? new Set<string>();
    claimed.set(s.employeeId, mine);
    const covered = (date: string) => approved.some((p) => p.employeeId === s.employeeId && date >= iso(p.startDate) && date <= iso(p.endDate));
    const days: string[] = [];
    const paid: Kobo[] = [];
    for (const l of lines) {
      if (l.employeeId !== s.employeeId) continue;
      const over = l.dates.filter((x) => x >= from && x <= to && !covered(x) && !mine.has(x));
      if (!over.length) continue;
      days.push(...over);
      paid.push(mulDiv(toKobo(l.amount), over.length, l.dates.length));
    }
    if (!days.length) continue;
    for (const x of days) mine.add(x);
    // a spell already reported by another live payroll is not reported again (its days stay claimed so another cancelled spell does not report them twice)
    const noted = s.overpaymentRunId && liveNoters.has(s.overpaymentRunId) && s.overpaymentRunId !== a.currentRunId;
    if (noted) continue;
    const list = [...new Set(days)].sort();
    out.push({
      spellId: s.id,
      employeeId: s.employeeId,
      category: "ATTENDANCE",
      severity: "CRITICAL",
      code: "SICK_PAY_WITHDRAWN",
      message: `${label.get(s.employeeId) ?? "A person"} was paid sick pay for ${list.length} ${list.length === 1 ? "day" : "days"} (${list.join(", ")}) on a spell of sickness that HR has since cancelled. That is about NGN ${naira(sumKobo(paid))} already paid. No negative pay is made: enter a deduction for the overpayment if it is to be recovered.`,
    });
  }
  return out;
}
