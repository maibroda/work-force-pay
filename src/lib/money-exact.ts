/**
 * Exact money arithmetic. The ONE place money is rounded. Pure: no database, no framework.
 *
 * Why it exists: ordinary computer numbers (floating point) cannot hold most amounts exactly, so a calculation that should land on half a kobo
 * can land a hair below it and round the wrong way. Here money is a whole number of KOBO (₦1 = 100 kobo), rates are read from text as whole units,
 * and every multiplication and division is done in whole-number arithmetic, so there is nothing to drift.
 *
 * The rule: round HALF UP to the nearest kobo, applied once, at the line where the amount is calculated. Half up is applied to the size of the
 * amount, so a negative amount rounds half away from zero (−2.345 becomes −2.35) and a reversal exactly mirrors the original.
 *
 * What goes in is checked. An amount with more than two decimal places, text that is not a number, a floating-point artefact such as
 * 0.30000000000000004, or a result too large to hold exactly is REFUSED with a plain-language error, never quietly rounded.
 *
 * This file is new and not yet used by the payroll engine (see docs/plans/exact-money.md); the engine moves onto it stage by stage.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

declare const koboBrand: unique symbol;
declare const rateBrand: unique symbol;
/** An amount as a whole number of kobo. The brand stops a plain number (naira, or anything else) being passed in by mistake. */
export type Kobo = number & { readonly [koboBrand]: true };
/** A percentage as a whole number of ten-thousandths of a percent: 7.5% is 75,000; 12.3456% is 123,456. */
export type Rate = number & { readonly [rateBrand]: true };

const MAX = Number.MAX_SAFE_INTEGER;
const MAX_BIG = BigInt(MAX);
/** Dividing a rate in ten-thousandths of a percent by this gives a plain multiplier: 100 (for %) × 10,000 (units per percent). */
export const RATE_SCALE = 1_000_000n;

const tooLarge = () => new MoneyError("That amount is too large to hold exactly.");

/** The plain text of a value, or an error. A stored Decimal is read through its own text, never through a floating-point number. */
function textOf(v: unknown, what: string): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new MoneyError(`That isn't ${what}.`);
    return String(v);
  }
  if (v !== null && typeof v === "object" && typeof (v as { toFixed?: unknown }).toFixed === "function") return (v as { toFixed(): string }).toFixed();
  throw new MoneyError(`That isn't ${what}.`);
}

const fit = (n: bigint): number => {
  if (n > MAX_BIG || n < -MAX_BIG) throw tooLarge();
  return Number(n);
};

// ─────────────────────────────── Reading and writing amounts ───────────────────────────────

/** Whole kobo from an amount in naira (text, a stored Decimal, or a number that is exactly an amount). Refuses more than two decimal places. */
export function toKobo(value: unknown): Kobo {
  const text = textOf(value, "an amount in naira");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) throw new MoneyError(`"${text}" isn't an amount in naira and kobo (whole kobo only: at most two decimal places).`);
  const abs = BigInt(m[2]) * 100n + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
  return fit(m[1] === "-" ? -abs : abs) as Kobo;
}

/**
 * TEMPORARY BRIDGE for code that still passes naira as a plain number. Earlier floating-point arithmetic can leave dust (0.1 + 0.2 is
 * 0.30000000000000004), so a number within a thousandth of a kobo of a whole kobo is taken to be that kobo. Anything further away is a real
 * part-kobo amount and is REFUSED, not rounded. It goes when the services pass kobo (stage 4 of docs/plans/exact-money.md).
 */
export function koboFromNaira(naira: number, what = "That amount"): Kobo {
  if (!Number.isFinite(naira)) throw new MoneyError(`${what} is not a number.`);
  const scaled = naira * 100;
  const wholeKobo = Math.round(scaled);
  if (Math.abs(scaled - wholeKobo) > 0.001) throw new MoneyError(`${what} (${naira}) is not a whole number of kobo.`);
  if (!Number.isSafeInteger(wholeKobo)) throw tooLarge();
  return (wholeKobo === 0 ? 0 : wholeKobo) as Kobo;
}

/** A missing value (an empty optional amount in the database) as zero kobo; anything present must still be a clean amount. */
export function koboOrZero(value: unknown): Kobo {
  return value === null || value === undefined ? (0 as Kobo) : toKobo(value);
}

/** A whole number of kobo, checked. */
export function asKobo(n: number): Kobo {
  if (!Number.isSafeInteger(n)) throw new MoneyError(Number.isInteger(n) ? "That amount is too large to hold exactly." : "An amount must be a whole number of kobo.");
  return (n === 0 ? 0 : n) as Kobo;
}

/** The exact text of an amount, two decimals, with its sign: "-1234.56". Use this to save an amount. */
export function koboToString(k: Kobo): string {
  const abs = Math.abs(k);
  return `${k < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A plain number of naira. FOR DISPLAY ONLY: never feed it back into a calculation. */
export function koboToNumber(k: Kobo): number {
  return k / 100;
}

// ─────────────────────────────── Rates ───────────────────────────────

/** A percentage read from text (or a stored Decimal) as an exact whole number of units. At most four decimal places, never negative. */
export function pctToRate(value: unknown): Rate {
  const text = textOf(value, "a percentage");
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) throw new MoneyError(`"${text}" isn't a percentage (at most four decimal places, and not negative).`);
  return fit(BigInt(m[1]) * 10_000n + BigInt((m[2] ?? "").padEnd(4, "0") || "0")) as Rate;
}

// ─────────────────────────────── The one rounding rule ───────────────────────────────

/** numerator ÷ denominator, rounded half up on the size of the result (so half away from zero for a negative one). The denominator is positive. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const size = negative ? -numerator : numerator;
  const q = (size * 2n + denominator) / (denominator * 2n);
  return negative ? -q : q;
}

/** A percentage of an amount, rounded half up to the kobo. 70% of ₦50,002.45 is ₦35,001.715, which rounds to ₦35,001.72. */
export function mulPct(amount: Kobo, rate: Rate): Kobo {
  return fit(roundDiv(BigInt(amount) * BigInt(rate), RATE_SCALE)) as Kobo;
}

/**
 * For a calculation that adds many exact parts before it rounds (the slices of PAYE): a ratio of two big whole numbers, rounded half up to the kobo,
 * once. The same rule as every other line, so there is still only one place money is rounded. The denominator must be above zero.
 */
export function roundRatio(numerator: bigint, denominator: bigint): Kobo {
  if (denominator <= 0n) throw new MoneyError("The number to divide by must be a whole number above zero.");
  return fit(roundDiv(numerator, denominator)) as Kobo;
}

/** An amount times a whole number over another whole number, rounded half up to the kobo: days paid over days in the month. */
export function mulDiv(amount: Kobo, top: number, bottom: number): Kobo {
  if (!Number.isSafeInteger(top)) throw new MoneyError("The number to multiply by must be a whole number.");
  if (!Number.isSafeInteger(bottom) || bottom <= 0) throw new MoneyError("The number to divide by must be a whole number above zero.");
  return fit(roundDiv(BigInt(amount) * BigInt(top), BigInt(bottom))) as Kobo;
}

// ─────────────────────────────── Adding ───────────────────────────────

/** The exact total. No rounding is needed or done, so a thousand lines never drift. */
export function sumKobo(values: readonly Kobo[]): Kobo {
  let total = 0;
  for (const v of values) {
    total += v;
    if (!Number.isSafeInteger(total)) throw tooLarge();
  }
  return (total === 0 ? 0 : total) as Kobo;
}

export const addKobo = (a: Kobo, b: Kobo): Kobo => sumKobo([a, b]);
export const subKobo = (a: Kobo, b: Kobo): Kobo => sumKobo([a, negKobo(b)]);
export const negKobo = (a: Kobo): Kobo => (a === 0 ? 0 : -a) as Kobo;

// ─────────────────────────────── Numbers that are not money ───────────────────────────────

/**
 * A plain number that is NOT money (a percentage, an hour count, a score) rounded half up to some decimal places, once, by the same shared rule
 * (half away from zero for a negative). The number is read as the decimal it was written as, so 1.005 to two places is 1.01 (floating point gives 1.00).
 * This is the one place such a number is rounded; money has its own functions above.
 */
export function roundPlaces(value: number, places: number): number {
  if (!Number.isInteger(places) || places < 0 || places > 12) throw new MoneyError("The number of decimal places must be a whole number from 0 to 12.");
  if (!Number.isFinite(value)) throw new MoneyError("That isn't a number.");
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!m) throw new MoneyError("That isn't a number.");
  const fraction = m[3] ?? "";
  const shift = fraction.length - Number(m[4] ?? 0); // how many decimal places the digits have
  const digits = BigInt(`${m[2]}${fraction}`);
  const numerator = (m[1] === "-" ? -digits : digits) * 10n ** BigInt(places);
  const scaled = shift >= 0 ? roundDiv(numerator, 10n ** BigInt(shift)) : numerator * 10n ** BigInt(-shift);
  return fit(scaled) / 10 ** places;
}
