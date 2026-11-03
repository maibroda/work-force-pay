import { koboFromNaira, koboToNumber, sumKobo, type Kobo } from "./money-exact";

/**
 * The 36 states and the Federal Capital Territory: the places a worker's PAYE can be due to. Pure, no database.
 * PAYE goes to the tax authority of the worker's STATE OF RESIDENCE (CLAUDE.md), so each worker carries one, and each payroll record keeps a copy.
 */
export const NIGERIA_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT",
  "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
] as const;
export type NigeriaState = (typeof NIGERIA_STATES)[number];

/** The line PAYE goes on when a worker has no recognised state, so no PAYE is ever left out of a schedule. */
export const STATE_NOT_RECORDED = "State not recorded";

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const BY_KEY = new Map<string, NigeriaState>(NIGERIA_STATES.map((s) => [squash(s), s]));
/** Other usual spellings, mapped to the proper name. */
const ALIASES: Record<string, NigeriaState> = {
  nassarawa: "Nasarawa",
  abuja: "FCT",
  federalcapitalterritory: "FCT",
  fctabuja: "FCT",
  abujafct: "FCT",
  federalcapitalterritoryabuja: "FCT",
};

/** The proper name of a typed state, or null when it is blank or not recognised. */
export function normaliseState(text: string | null | undefined): NigeriaState | null {
  if (text === null || text === undefined) return null;
  const key = squash(text);
  if (!key) return null;
  return BY_KEY.get(key) ?? ALIASES[key] ?? null;
}

export interface PayeByStateLine {
  state: string;
  paye: number;
  headcount: number;
}

/**
 * PAYE grouped by state: one line per state in alphabetical order (those with PAYE to pay), then "State not recorded" last for anyone with no
 * recognised state. Amounts are added in whole kobo, so the lines add up to the total exactly.
 */
export function groupPayeByState(records: ReadonlyArray<{ payeState: string | null; paye: number }>): PayeByStateLine[] {
  const groups = new Map<string, Kobo[]>();
  for (const r of records) {
    const paye = koboFromNaira(r.paye, "A PAYE amount");
    if (paye <= 0) continue;
    const state = normaliseState(r.payeState) ?? STATE_NOT_RECORDED;
    const list = groups.get(state) ?? [];
    list.push(paye);
    groups.set(state, list);
  }
  return [...groups.entries()]
    .map(([state, amounts]) => ({ state, paye: koboToNumber(sumKobo(amounts)), headcount: amounts.length }))
    .sort((a, b) => (a.state === STATE_NOT_RECORDED ? 1 : b.state === STATE_NOT_RECORDED ? -1 : a.state.localeCompare(b.state)));
}

/**
 * What a worker with PAYE and no recognised state does to a payroll. A setting on the payroll rule, not a fixed rule: as shipped it is a warning (the PAYE goes
 * on the "State not recorded" line and nothing is stopped); switched on, it is a critical finding that blocks approval until the state is set or Finance
 * overrides it with a documented reason.
 */
export const missingStateSeverity = (requirePayeState: boolean): "WARNING" | "CRITICAL" => (requirePayeState ? "CRITICAL" : "WARNING");
