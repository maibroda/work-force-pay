/**
 * Pure rules for KPIs on an appraisal: how an actual result becomes a score from 1 to 5, and how the KPI
 * score and the criteria score make one overall score. No database here.
 *
 * Whole-number arithmetic only (no floating point): a figure is read as an exact decimal with at most four
 * places, achievement is in basis points (10,000 = 100%), scores are in hundredths, and every division
 * rounds half up, once, at the line where it is calculated. The bands that turn a percentage into a score
 * are DATA (the HR policy), never fixed here; DEFAULT_KPI_BANDS is only what a company starts with.
 */

export type KpiDirection = "HIGHER_IS_BETTER" | "LOWER_IS_BETTER";
export const KPI_DIRECTIONS: KpiDirection[] = ["HIGHER_IS_BETTER", "LOWER_IS_BETTER"];
export const KPI_DIRECTION_LABELS: Record<KpiDirection, string> = {
  HIGHER_IS_BETTER: "Higher is better",
  LOWER_IS_BETTER: "Lower is better",
};

export type KpiUnit = "PERCENT" | "COUNT" | "NAIRA" | "RATING";
export const KPI_UNITS: KpiUnit[] = ["PERCENT", "COUNT", "NAIRA", "RATING"];
export const KPI_UNIT_LABELS: Record<KpiUnit, string> = { PERCENT: "Percentage", COUNT: "Count", NAIRA: "Naira", RATING: "Rating" };

/** One step of the scale: from this achievement (basis points) upwards, the score is `score`. */
export interface KpiBand {
  fromBp: number;
  score: number;
}

/** What a company starts with; it can replace them in the HR policy. 10,000 basis points = 100%. */
export const DEFAULT_KPI_BANDS: KpiBand[] = [
  { fromBp: 0, score: 1 },
  { fromBp: 5000, score: 2 },
  { fromBp: 7500, score: 3 },
  { fromBp: 10000, score: 4 },
  { fromBp: 12000, score: 5 },
];

/** No single figure can count for more than ten times its target. */
export const ACHIEVEMENT_CAP_BP = 1_000_000;

const SCALE = 10000n; // four decimal places

/** Integer division of non-negative numbers, rounded half up. */
function divHalfUp(num: bigint, den: bigint): bigint {
  return (2n * num + den) / (2n * den);
}

/** Reads a typed figure exactly: digits with at most four decimals, never negative. Returns it times 10,000. */
export function parseKpiNumber(text: string): bigint {
  const t = String(text ?? "").trim();
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(t);
  if (!m) throw new Error(`"${t}" is not a valid figure: use digits, with up to four decimal places and no commas or signs.`);
  return BigInt(m[1]) * SCALE + BigInt((m[2] ?? "").padEnd(4, "0") || "0");
}

/** The actual as a share of the target (basis points), rounded half up and capped. Lower-is-better turns it round. */
export function achievementBp(actual: string, target: string, direction: KpiDirection): number {
  const a = parseKpiNumber(actual);
  const t = parseKpiNumber(target);
  if (t <= 0n) throw new Error("The target must be above zero.");
  let bp: bigint;
  if (direction === "HIGHER_IS_BETTER") bp = divHalfUp(a * SCALE, t);
  else if (a === 0n) return ACHIEVEMENT_CAP_BP; // nothing went wrong: the top of the scale, not a division by zero
  else bp = divHalfUp(t * SCALE, a);
  return bp > BigInt(ACHIEVEMENT_CAP_BP) ? ACHIEVEMENT_CAP_BP : Number(bp);
}

/** Problems with a set of bands (empty when it is good): starts at 0, rises, whole scores 1 to 5 that never fall. */
export function validateBands(bands: KpiBand[]): string[] {
  const problems: string[] = [];
  if (!bands.length) return ["There must be at least one band."];
  if (bands[0].fromBp !== 0) problems.push("The first band must start at 0%.");
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (!Number.isInteger(b.fromBp) || b.fromBp < 0) problems.push(`Band ${i + 1}: the starting percentage must be a whole number of basis points from 0.`);
    if (!Number.isInteger(b.score) || b.score < 1 || b.score > 5) problems.push(`Band ${i + 1}: the score must be a whole number from 1 to 5.`);
    if (i > 0 && b.fromBp <= bands[i - 1].fromBp) problems.push(`Band ${i + 1}: must start above the band before it.`);
    if (i > 0 && b.score < bands[i - 1].score) problems.push(`Band ${i + 1}: a higher achievement cannot score lower than the band before it.`);
  }
  return problems;
}

/** The score of the highest band whose start the achievement has reached. */
export function scoreFromBands(bp: number, bands: KpiBand[]): number {
  let score = bands[0]?.score ?? 1;
  for (const b of [...bands].sort((x, y) => x.fromBp - y.fromBp)) if (bp >= b.fromBp) score = b.score;
  return score;
}

/** The weighted average of the KPI scores, in hundredths (340 = 3.40), rounded half up. Null when no KPI has a score. */
export function kpiScore(rows: Array<{ score: number | null | undefined; weight: number }>): number | null {
  const scored = rows.filter((r): r is { score: number; weight: number } => typeof r.score === "number" && r.weight > 0);
  if (!scored.length) return null;
  const totalWeight = BigInt(scored.reduce((a, r) => a + r.weight, 0));
  const sum = BigInt(scored.reduce((a, r) => a + r.score * r.weight, 0));
  return Number(divHalfUp(sum * 100n, totalWeight));
}

/**
 * One overall score (1 to 5, two decimals) from the criteria score and the KPI score (hundredths), by the cycle's
 * KPI share (a whole percentage, 0 to 100). A share of 0 returns the criteria score untouched, exactly as appraisals
 * scored before KPIs existed. With a share above 0 and no KPI result yet there is no overall score.
 */
export function blendOverall(criteriaScore: number, kpiHundredths: number | null, sharePct: number): number | null {
  if (!Number.isInteger(sharePct) || sharePct < 0 || sharePct > 100) throw new Error("The KPI share must be a whole percentage from 0 to 100.");
  if (sharePct === 0) return criteriaScore;
  if (kpiHundredths === null) return null;
  const c = BigInt(Math.round(criteriaScore * 100));
  const k = BigInt(kpiHundredths);
  const share = BigInt(sharePct);
  return Number(divHalfUp(c * (100n - share) + k * share, 100n)) / 100;
}

/** Reads bands typed one per line ("75 = 3": from 75%, score 3). A percentage has at most two decimals, so basis points stay whole. */
export function parseBandLines(text: string): KpiBand[] {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("Enter at least one band, one per line, like 75 = 3.");
  return lines.map((line) => {
    const m = /^(\d+)(?:\.(\d+))?\s*%?\s*[=:]\s*(\d+)$/.exec(line);
    if (!m) throw new Error(`"${line}" is not a band: write the percentage it starts at, then the score, like 75 = 3.`);
    if ((m[2] ?? "").length > 2) throw new Error(`"${line}": a percentage can have at most two decimal places.`);
    return { fromBp: Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0"), score: Number(m[3]) };
  });
}

/** The bands as one line each, the way parseBandLines reads them. */
export function formatBandLines(bands: KpiBand[]): string {
  return bands
    .map((b) => {
      const whole = Math.trunc(b.fromBp / 100);
      const frac = String(b.fromBp % 100).padStart(2, "0").replace(/0+$/, "");
      return `${whole}${frac ? `.${frac}` : ""} = ${b.score}`;
    })
    .join("\n");
}
