/** Attrition maths (pure, framework-free, unit-testable). */

export const TENURE_BANDS = ["Under 6 months", "6–12 months", "1–2 years", "2–5 years", "5+ years"] as const;

/** Which length-of-service band a leaver falls in, from whole days served. */
export function tenureBand(days: number): (typeof TENURE_BANDS)[number] {
  if (days < 182) return TENURE_BANDS[0];
  if (days < 365) return TENURE_BANDS[1];
  if (days < 730) return TENURE_BANDS[2];
  if (days < 1826) return TENURE_BANDS[3];
  return TENURE_BANDS[4];
}

/** Resignations are voluntary; dismissals and absconding are not; the rest are neither. */
export function exitNature(exitType: string): "VOLUNTARY" | "INVOLUNTARY" | "OTHER" {
  if (exitType === "RESIGNATION") return "VOLUNTARY";
  if (exitType === "TERMINATION" || exitType === "ABSCONDMENT") return "INVOLUNTARY";
  return "OTHER";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Leavers as a percentage of average headcount — the period rate, and that rate scaled to a year. */
export function turnoverRates(leavers: number, headcountStart: number, headcountEnd: number, days: number) {
  const average = (headcountStart + headcountEnd) / 2;
  if (average <= 0) return { average, rate: 0, annualised: 0 };
  const rate = (leavers / average) * 100;
  return { average, rate: round1(rate), annualised: round1(rate * (365 / Math.max(1, days))) };
}

export const pct = (part: number, total: number) => (total ? round1((part / total) * 100) : 0);
