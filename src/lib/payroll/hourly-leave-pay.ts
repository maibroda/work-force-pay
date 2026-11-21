/**
 * Hourly pay, H14 piece 1 (docs/plans/hourly-payroll-h14-build-plan.md): the leave pay for a person paid by the hour. Pure: no database, no framework.
 *
 * The founder's answers of 2026-11-20: annual leave for staff paid by the hour is a PERCENTAGE ADDED TO EVERY HOUR WORKED, a figure the company (or its adviser) enters in the payroll rules, with none built in; it is due only
 * from the day the person completes the company's service period for annual leave (as for monthly staff), and "your choices" of 2026-11-21: it is a percentage of the pay for all hours worked (weekday, weekend and holiday).
 * The caller marks, on each pay line, how many of its minutes were worked on or after that day (`eligibleMinutes`); this works the percentage out per site, in whole kobo.
 *
 * Each line's eligible pay is its eligible minutes at the line's rate, rounded half up to the kobo once (the same rule as a pay line); the percentage of the site's total is then rounded half up once. A site with no eligible
 * pay, or a percentage of 0 (off), gets nothing. The sites it is given are never changed: new ones are returned.
 */
import { MoneyError, koboFromNaira, mulDiv, mulPct, pctToRate, sumKobo } from "../money-exact";
import type { HourlySiteInput } from "./engine";

/** One percentage for every site, or (the contract rate may set its own, H14) a function that gives each site its own. */
export type LeavePct = number | ((site: HourlySiteInput) => number);

function checked(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new MoneyError("The leave percentage must be from 0 to 100.");
  return pct;
}

export function addLeavePay(sites: readonly HourlySiteInput[], pctOf: LeavePct): HourlySiteInput[] {
  if (typeof pctOf === "number" && checked(pctOf) === 0) return [...sites];
  return sites.map((site) => {
    const pct = checked(typeof pctOf === "number" ? pctOf : pctOf(site));
    if (pct === 0) return site;
    const rate = pctToRate(String(pct));
    const base = sumKobo(site.lines.map((l) => mulDiv(koboFromNaira(l.rate, "An hourly rate"), l.eligibleMinutes ?? 0, 60)));
    const amount = mulPct(base, rate);
    if (amount <= 0) return site;
    return { ...site, allowances: [...(site.allowances ?? []), { kind: "LEAVE_PERCENT" as const, baseKobo: base, pct, amountKobo: amount }] };
  });
}
