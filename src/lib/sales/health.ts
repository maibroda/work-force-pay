/**
 * The account health score, with no database: how each of six measures becomes a 0 to 100 sub-score, how they are weighted into one score, and the bands. A measure with no
 * data is left out and the other weights fill its place. The service (src/server/services/sales/health.ts) gathers the facts and uses this and nothing else to score.
 * The weights and the sub-score formulas are starting choices (docs/crm/07b-phase-7b-plan.md); only the weights are editable.
 */

export const COMPONENTS = ["SLA_BREACHES", "OPEN_SEVERE_CASES", "GUARD_ABSENCE", "INVOICES_OVERDUE", "CONTRACT_END", "CLIENT_CONTACT"] as const;
export type ComponentKey = (typeof COMPONENTS)[number];
export type Weights = Record<ComponentKey, number>;
export type Band = "HEALTHY" | "WATCH" | "AT_RISK";

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  SLA_BREACHES: "SLA breaches in the last 90 days",
  OPEN_SEVERE_CASES: "Open critical and high cases",
  GUARD_ABSENCE: "Guard absence on the client's sites",
  INVOICES_OVERDUE: "Invoices overdue",
  CONTRACT_END: "Contract end with no renewal in progress",
  CLIENT_CONTACT: "Time since client-facing contact",
};

export const DEFAULT_WEIGHTS: Weights = { SLA_BREACHES: 20, OPEN_SEVERE_CASES: 15, GUARD_ABSENCE: 20, INVOICES_OVERDUE: 20, CONTRACT_END: 10, CLIENT_CONTACT: 15 };

/** A sentence about what is wrong with the weights, or null. They are whole numbers, none negative, for all six, adding up to 100. */
export function validateWeights(w: Partial<Record<string, number>>): string | null {
  if (!COMPONENTS.every((k) => k in w)) return "Give a weight for all six measures.";
  if (!COMPONENTS.every((k) => Number.isInteger(w[k]) && (w[k] as number) >= 0)) return "Each weight is a whole number, zero or more.";
  if (COMPONENTS.reduce((n, k) => n + (w[k] as number), 0) !== 100) return "The weights must add up to 100.";
  return null;
}

/** 70 to 100 healthy, 40 to 69 watch, 0 to 39 at risk. */
export const bandOf = (score: number): Band => (score >= 70 ? "HEALTHY" : score >= 40 ? "WATCH" : "AT_RISK");

export interface HealthInputs {
  /** Missed first-response or resolution deadlines in the last 90 days. */
  slaBreaches90: number;
  openCritical: number;
  openHigh: number;
  /** Absent days as a percent of days a guard was expected, last 30 days; null when there are no attendance records. */
  absencePct: number | null;
  /** Days past due of the oldest unpaid invoice (zero or less when none is overdue). */
  maxDaysOverdue: number;
  /** Days to the end of the next active contract ending within 90 days; null when none does. */
  daysToContractEnd: number | null;
  renewalInProgress: boolean;
  daysSinceClientContact: number;
}

export interface Component {
  key: ComponentKey;
  label: string;
  weight: number;
  /** 0 to 100, 100 best; null when there is no data. */
  subScore: number | null;
  detail: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** The score of an account (0 to 100, rounded half up), its band, and what each measure found. */
export function scoreAccount(i: HealthInputs, weights: Weights = DEFAULT_WEIGHTS): { score: number; band: Band; components: Component[] } {
  const c = (key: ComponentKey, subScore: number | null, detail: string): Component => ({ key, label: COMPONENT_LABELS[key], weight: weights[key], subScore, detail });
  const components: Component[] = [
    c("SLA_BREACHES", clamp(100 - 25 * i.slaBreaches90), `${i.slaBreaches90} missed deadline(s) in the last 90 days`),
    c("OPEN_SEVERE_CASES", clamp(100 - 40 * i.openCritical - 25 * i.openHigh), `${i.openCritical} critical and ${i.openHigh} high case(s) open`),
    i.absencePct === null
      ? c("GUARD_ABSENCE", null, "No attendance records for this client in the last 30 days, so this is left out")
      : c("GUARD_ABSENCE", clamp(100 - 5 * i.absencePct), `${i.absencePct}% of expected guard days were absences in the last 30 days`),
    c("INVOICES_OVERDUE", i.maxDaysOverdue <= 0 ? 100 : clamp(100 - (i.maxDaysOverdue * 100) / 60), i.maxDaysOverdue > 0 ? `The oldest unpaid invoice is ${i.maxDaysOverdue} day(s) past due` : "No unpaid invoice is past due"),
    i.daysToContractEnd === null
      ? c("CONTRACT_END", 100, "No contract ends in the next 90 days")
      : c("CONTRACT_END", i.renewalInProgress ? 100 : clamp((100 * Math.min(90, Math.max(0, i.daysToContractEnd))) / 90), `A contract ends in ${i.daysToContractEnd} day(s); a renewal is ${i.renewalInProgress ? "in progress" : "not in progress"}`),
    c("CLIENT_CONTACT", i.daysSinceClientContact <= 30 ? 100 : clamp(100 - ((i.daysSinceClientContact - 30) * 100) / 90), `${i.daysSinceClientContact} day(s) since the last call, meeting, visit or message`),
  ];
  const present = components.filter((x) => x.subScore !== null);
  const den = present.reduce((n, x) => n + x.weight, 0);
  const num = present.reduce((n, x) => n + x.weight * (x.subScore as number), 0);
  const score = den === 0 ? 100 : Math.floor((2 * num + den) / (2 * den)); // the weighted average, rounded half up, in whole numbers
  return { score, band: bandOf(score), components };
}
