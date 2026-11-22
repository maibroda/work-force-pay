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
import { Exact } from "../exact-fraction";
import { MoneyError, koboFromNaira, mulDiv, mulPct, pctToRate, sumKobo, type Kobo } from "../money-exact";
import type { HourlySiteInput } from "./engine";
import { computeComponentsExact } from "./structure";

/** One percentage for every site, or (the contract rate may set its own, H14) a function that gives each site its own. */
export type LeavePct = number | ((site: HourlySiteInput) => number);

/**
 * What the percentage is taken of (a payroll rule setting). BASIC (the founder's decision: leave pay is a percentage of the Basic salary): the Basic part of the eligible pay, as the site's salary structure splits it.
 * ALL_PAY: the whole eligible pay (the first build; kept for a rule version made before that decision, so no past or open payroll changes).
 */
export type LeaveBasis = "ALL_PAY" | "BASIC";

function checked(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new MoneyError("The leave percentage must be from 0 to 100.");
  return pct;
}

/** The eligible pay of a site: each line's eligible minutes at the line's rate, rounded half up to the kobo once per line. */
const eligiblePay = (site: HourlySiteInput): Kobo => sumKobo(site.lines.map((l) => mulDiv(koboFromNaira(l.rate, "An hourly rate"), l.eligibleMinutes ?? 0, 60)));

/** The Basic part of an amount of pay, as the site's salary structure splits it (rounded half up to the kobo); null when the structure has no active Basic component. */
const hasBasic = (site: HourlySiteInput): boolean => site.structure.components.some((c) => c.active && c.code.toUpperCase() === "BASIC");
function basicPart(site: HourlySiteInput, pay: Kobo): Kobo | null {
  if (!hasBasic(site)) return null;
  const basic = computeComponentsExact(site.structure, pay, Exact.int(1)).find((c) => c.code.toUpperCase() === "BASIC");
  return basic ? basic.amount.round() : null;
}

export function addLeavePay(sites: readonly HourlySiteInput[], pctOf: LeavePct, basis: LeaveBasis = "ALL_PAY"): HourlySiteInput[] {
  if (typeof pctOf === "number" && checked(pctOf) === 0) return [...sites];
  return sites.map((site) => {
    const pct = checked(typeof pctOf === "number" ? pctOf : pctOf(site));
    if (pct === 0) return site;
    const rate = pctToRate(String(pct));
    const pay = eligiblePay(site);
    const base = basis === "BASIC" ? basicPart(site, pay) : pay;
    if (base === null) return site; // a structure with no Basic component: nothing can be worked out (the pay run raises a finding)
    const amount = mulPct(base, rate);
    if (amount <= 0) return site;
    return { ...site, allowances: [...(site.allowances ?? []), { kind: "LEAVE_PERCENT" as const, baseKobo: base, pct, amountKobo: amount, ...(basis === "BASIC" ? { basis: "BASIC" as const } : {}) }] };
  });
}

/** The sites whose leave pay could not be worked out because their structure has no Basic component (BASIC basis, a percentage above 0 and eligible pay only): the pay run raises a finding for each. */
export function leaveWithoutBasic(sites: readonly HourlySiteInput[], pctOf: LeavePct, basis: LeaveBasis): HourlySiteInput[] {
  if (basis !== "BASIC") return [];
  return sites.filter((site) => {
    const pct = checked(typeof pctOf === "number" ? pctOf : pctOf(site));
    return pct > 0 && !hasBasic(site) && eligiblePay(site) > 0;
  });
}
