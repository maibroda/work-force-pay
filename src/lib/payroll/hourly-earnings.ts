/**
 * Hourly pay, phase 4 (docs/plans/hourly-payroll-phase4-plan.md): the pure step that turns a person's APPROVED pieces of shifts into pay lines per site, in whole kobo, for the pay engine to take
 * (`EngineInput.hourly`, src/lib/payroll/engine.ts). No database, no framework. Nothing in the pay run calls this yet: the pay run reads the pieces, the rates and the structures in a later piece.
 *
 * The founder's answers: H1 the rate is the employee's own, then the contract and job role, then the job role, approved and in force on the day each piece was worked; H8 each site's hours follow the
 * established salary structure for that site (the caller says which, per contract, job role and day; a different structure on a different day makes a different piece of pay); only APPROVED pieces are
 * ever given to this step (H9, H21). A piece with no approved rate, or at a site with no salary structure, is NOT paid and NOT priced as zero: it is reported, so the pay run can stop and say so.
 *
 * A line is one class of day at one rate within one site's piece of pay; its amount is minutes x rate / 60, rounded half up to the kobo ONCE (the project's money rule, money-exact.ts), so a line never gains
 * or loses a kobo to the number of pieces it was cut into. (The phase 5 reports round at the coarser grain of person, contract and month, so a payroll can differ from a report by a kobo when a person
 * works more than one site on a contract.)
 */
import { koboFromNaira, mulDiv, type Kobo } from "../money-exact";
import type { HourlyRates, DayClass } from "./hourly";
import { resolveHourlyRate, type HourlyRateRow } from "./hourly-rates";
import type { HourlySiteInput } from "./engine";
import type { StructureDef } from "./structure";

export interface ApprovedPiece {
  employeeId: string;
  beatId: string;
  contractId: string;
  clientId: string;
  /** The Nigerian calendar day (YYYY-MM-DD) the piece was worked. */
  date: string;
  dayClass: DayClass;
  minutes: number;
  /** The approved time entry the piece belongs to, so a pay line can be traced to its shifts. */
  entryId?: string;
  /** The approved piece itself (a time entry segment), so the pay run can mark it as paid. */
  segmentId?: string;
  /** For a piece made from several (the late hours of a supplementary payroll): all of them. These take the place of the single ids above. */
  entryIds?: string[];
  segmentIds?: string[];
}

export interface HourlyEarningsOptions {
  /** The person's job role. */
  categoryOf: (employeeId: string) => string;
  /** The established salary structure for a contract and job role on a day (the contract rate's, then the contract's default, then the company's); null when there is none. */
  structureFor: (q: { contractId: string; categoryId: string; date: string }) => StructureDef | null;
  namesOf: (beatId: string) => { clientName: string; beatName: string };
}

export interface UnresolvedPiece {
  reason: "NO_RATE" | "NO_STRUCTURE";
  beatId: string;
  contractId: string;
  date: string;
  dayClass: DayClass;
  minutes: number;
}

export interface HourlyEarnings {
  sites: HourlySiteInput[];
  /** Pieces that were not paid, and why. */
  unresolved: UnresolvedPiece[];
  /** Every minute of the person's pieces. */
  totalMinutes: number;
  /** The minutes that are in `sites` (paid). The rest are in `unresolved`. */
  pricedMinutes: number;
}

const RATE_FIELD: Record<DayClass, keyof HourlyRates> = { WEEKDAY: "weekday", WEEKEND: "weekend", HOLIDAY: "holiday" };

/** One person's approved pieces for a pay period as pay lines per site. Pieces of other people are ignored. */
export function buildHourlyEarnings(employeeId: string, pieces: readonly ApprovedPiece[], rates: readonly HourlyRateRow[], opts: HourlyEarningsOptions): HourlyEarnings {
  const sites = new Map<string, HourlySiteInput & { lineMap: Map<string, HourlySiteInput["lines"][number]> }>();
  const unresolved: UnresolvedPiece[] = [];
  let total = 0;
  let priced = 0;
  const categoryId = opts.categoryOf(employeeId);
  for (const p of pieces) {
    if (p.employeeId !== employeeId) continue;
    total += p.minutes;
    const found = resolveHourlyRate(rates, { employeeId, contractId: p.contractId, categoryId, date: new Date(`${p.date}T00:00:00Z`) });
    if (!found) {
      unresolved.push({ reason: "NO_RATE", beatId: p.beatId, contractId: p.contractId, date: p.date, dayClass: p.dayClass, minutes: p.minutes });
      continue;
    }
    const structure = opts.structureFor({ contractId: p.contractId, categoryId, date: p.date });
    if (!structure) {
      unresolved.push({ reason: "NO_STRUCTURE", beatId: p.beatId, contractId: p.contractId, date: p.date, dayClass: p.dayClass, minutes: p.minutes });
      continue;
    }
    priced += p.minutes;
    const key = `${p.beatId}|${p.contractId}|${structure.id}`;
    let site = sites.get(key);
    if (!site) {
      const names = opts.namesOf(p.beatId);
      site = { key, clientId: p.clientId, clientName: names.clientName, contractId: p.contractId, beatId: p.beatId, beatName: names.beatName, structure, from: p.date, to: p.date, dates: [], lines: [], lineMap: new Map() };
      sites.set(key, site);
    }
    if (!site.dates.includes(p.date)) site.dates.push(p.date);
    if (p.date < site.from) site.from = p.date;
    if (p.date > site.to) site.to = p.date;
    const lineKey = `${p.dayClass}|${found.rateId}`;
    const line = site.lineMap.get(lineKey);
    const entries = p.entryIds ?? (p.entryId ? [p.entryId] : []);
    const segments = p.segmentIds ?? (p.segmentId ? [p.segmentId] : []);
    if (line) {
      line.minutes += p.minutes;
      const e = entries.filter((id) => !line.entryIds?.includes(id));
      if (e.length) line.entryIds = [...(line.entryIds ?? []), ...e];
      const s = segments.filter((id) => !line.segmentIds?.includes(id));
      if (s.length) line.segmentIds = [...(line.segmentIds ?? []), ...s];
    } else {
      const l: HourlySiteInput["lines"][number] = { dayClass: p.dayClass, minutes: p.minutes, rateId: found.rateId, rate: found.rates[RATE_FIELD[p.dayClass]], amountKobo: 0 };
      if (entries.length) l.entryIds = [...entries];
      if (segments.length) l.segmentIds = [...segments];
      site.lineMap.set(lineKey, l);
      site.lines.push(l);
    }
  }
  const out: HourlySiteInput[] = [];
  for (const s of sites.values()) {
    for (const l of s.lines) l.amountKobo = mulDiv(koboFromNaira(l.rate, "An hourly rate"), l.minutes, 60);
    s.dates.sort();
    const { lineMap, ...site } = s;
    void lineMap;
    out.push(site);
  }
  return { sites: out, unresolved, totalMinutes: total, pricedMinutes: priced };
}

/**
 * What some minutes are worth at the approved rate in force on a day, for that kind of day, in whole kobo (rounded half up once, like a pay line). Null, never zero, when no approved rate applies: the caller says so
 * instead of showing a made-up amount. Used to put a naira figure on an overpayment found after a correction (the founder's answer of 2026-11-20); it prices nothing that is paid.
 */
export function valueOfMinutes(rates: readonly HourlyRateRow[], q: { employeeId: string; contractId: string; categoryId: string; date: Date; dayClass: DayClass }, minutes: number): Kobo | null {
  const found = resolveHourlyRate(rates, { employeeId: q.employeeId, contractId: q.contractId, categoryId: q.categoryId, date: q.date });
  if (!found) return null;
  return mulDiv(koboFromNaira(found.rates[RATE_FIELD[q.dayClass]], "An hourly rate"), minutes, 60);
}
