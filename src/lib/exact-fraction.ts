/**
 * An exact fraction, for amounts that are not yet rounded.
 *
 * Some pay is worked out in steps where rounding in the middle would be wrong: a salary component is a percentage of the gross, times the days
 * paid, over the days in the month, and the pieces from different sites are added before the payslip line is rounded. Ordinary computer numbers
 * cannot hold such a value exactly. An `Exact` is a whole number over a whole number, so nothing is ever lost, and it is rounded ONCE, to the
 * kobo, by `round()`, which uses the same half-up rule as every other line (see money-exact.ts).
 *
 * An `Exact` is a plain quantity with no unit: the caller decides whether it counts naira or kobo. `round()` assumes KOBO.
 */
import { MoneyError, roundRatio, type Kobo } from "./money-exact";

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

function whole(v: bigint | number, what: string): bigint {
  if (typeof v === "bigint") return v;
  if (!Number.isSafeInteger(v)) throw new MoneyError(`The ${what} of a fraction must be a whole number.`);
  return BigInt(v);
}

const DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

export class Exact {
  /** The top and the bottom, in lowest terms; the bottom is always above zero. */
  readonly n: bigint;
  readonly d: bigint;

  private constructor(n: bigint, d: bigint) {
    this.n = n;
    this.d = d;
  }

  static ratio(top: bigint | number, bottom: bigint | number = 1): Exact {
    let n = whole(top, "top");
    let d = whole(bottom, "bottom");
    if (d === 0n) throw new MoneyError("Cannot divide by zero.");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    if (n === 0n) return new Exact(0n, 1n);
    const g = gcd(n, d);
    return new Exact(n / g, d / g);
  }

  static int(n: bigint | number): Exact {
    return Exact.ratio(n, 1);
  }

  /** Exact decimal text: "2.5" is 5/2, "0.125" is 1/8, "1e-3" is 1/1000. */
  static decimal(text: string): Exact {
    const m = DECIMAL.exec(text.trim());
    if (!m) throw new MoneyError(`"${text}" isn't a number.`);
    const digits = `${m[2] ?? ""}${m[3] ?? m[4] ?? ""}`;
    const exponent = m[5] === undefined ? 0 : Number(m[5]);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) throw new MoneyError(`"${text}" isn't a number this size can be held for.`);
    const places = (m[3] ?? m[4] ?? "").length - exponent;
    const n = BigInt(digits === "" ? "0" : digits) * (m[1] === "-" ? -1n : 1n);
    return places >= 0 ? Exact.ratio(n, 10n ** BigInt(places)) : Exact.ratio(n * 10n ** BigInt(-places), 1n);
  }

  /** A plain number, read through its shortest decimal text, so 0.1 is exactly one tenth. */
  static fromNumber(v: number): Exact {
    if (!Number.isFinite(v)) throw new MoneyError("That isn't a number.");
    return Exact.decimal(String(v));
  }

  add(o: Exact): Exact {
    return Exact.ratio(this.n * o.d + o.n * this.d, this.d * o.d);
  }

  sub(o: Exact): Exact {
    return Exact.ratio(this.n * o.d - o.n * this.d, this.d * o.d);
  }

  mul(o: Exact): Exact {
    return Exact.ratio(this.n * o.n, this.d * o.d);
  }

  div(o: Exact): Exact {
    if (o.n === 0n) throw new MoneyError("Cannot divide by zero.");
    return Exact.ratio(this.n * o.d, this.d * o.n);
  }

  neg(): Exact {
    return new Exact(-this.n, this.d);
  }

  isZero(): boolean {
    return this.n === 0n;
  }

  cmp(o: Exact): -1 | 0 | 1 {
    const a = this.n * o.d;
    const b = o.n * this.d;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  static min(...values: Exact[]): Exact {
    if (values.length === 0) throw new MoneyError("There is nothing to compare.");
    return values.reduce((a, b) => (b.cmp(a) < 0 ? b : a));
  }

  static max(...values: Exact[]): Exact {
    if (values.length === 0) throw new MoneyError("There is nothing to compare.");
    return values.reduce((a, b) => (b.cmp(a) > 0 ? b : a));
  }

  /** This value, counted in KOBO, as a whole number of kobo: rounded half up, once (money-exact.ts). */
  round(): Kobo {
    return roundRatio(this.n, this.d);
  }

  /**
   * The nearest plain number. FOR DISPLAY AND FOR CALLERS NOT YET MOVED TO EXACT VALUES: never feed it back into a calculation.
   */
  toNumber(): number {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const size = this.n < 0n ? -this.n : this.n;
    if (size <= max && this.d <= max) return Number(this.n) / Number(this.d);
    const scale = 10n ** 25n;
    return Number((this.n * scale) / this.d) / Number(scale);
  }

  toString(): string {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`;
  }
}
