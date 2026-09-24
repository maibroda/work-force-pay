/** Round to 2 dp (kobo/cents) using half-away-from-zero. */
export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100;
}

export function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "toNumber" in v) return (v as { toNumber(): number }).toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function sum(values: number[]): number {
  return round2(values.reduce((a, b) => a + b, 0));
}

/**
 * Currencies the app knows how to format. `symbol` overrides Intl's own currency symbol, which
 * some locale/currency combinations (notably en-NG/NGN) render as the ISO code instead of a glyph.
 * This is a display-only registry — adding a currency here does not add conversion, multi-currency
 * transactions, or per-currency business logic; it only affects how naira()/formatMoney() render.
 */
export const CURRENCIES = {
  NGN: { locale: "en-NG", symbol: "₦" },
  USD: { locale: "en-US", symbol: "$" },
  GBP: { locale: "en-GB", symbol: "£" },
  EUR: { locale: "de-DE", symbol: "€" },
  GHS: { locale: "en-GH", symbol: "GH₵" },
  KES: { locale: "en-KE", symbol: "KSh" },
  ZAR: { locale: "en-ZA", symbol: "R" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
export const DEFAULT_CURRENCY: CurrencyCode = "NGN";
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

const formatters = new Map<CurrencyCode, Intl.NumberFormat>();
function formatterFor(code: CurrencyCode): Intl.NumberFormat {
  let f = formatters.get(code);
  if (!f) {
    const { locale } = CURRENCIES[code];
    f = new Intl.NumberFormat(locale, { style: "currency", currency: code, minimumFractionDigits: 2 });
    formatters.set(code, f);
  }
  return f;
}

/** Formats an amount in the given currency (defaults to the org default, NGN, if not passed). */
export function formatMoney(v: unknown, currency: CurrencyCode = DEFAULT_CURRENCY): string {
  const { symbol } = CURRENCIES[currency];
  return formatterFor(currency).format(num(v)).replace(currency, symbol);
}

/** Compact form (1.2m, 340k, …) in the given currency (defaults to NGN). */
export function compactMoney(v: unknown, currency: CurrencyCode = DEFAULT_CURRENCY): string {
  const { symbol } = CURRENCIES[currency];
  const n = num(v);
  if (Math.abs(n) >= 1_000_000_000) return `${symbol}${(n / 1_000_000_000).toFixed(2)}bn`;
  if (Math.abs(n) >= 1_000_000) return `${symbol}${(n / 1_000_000).toFixed(2)}m`;
  if (Math.abs(n) >= 1_000) return `${symbol}${(n / 1_000).toFixed(1)}k`;
  return `${symbol}${n.toFixed(0)}`;
}

// `naira`/`compactNaira` are kept as the default-currency entry points — every existing call site
// in the app displays amounts without threading an organization's currency through yet (see the
// `currency` field on Organization for where that setting lives), so these default to NGN rather
// than requiring every caller to pass one.
export const naira = (v: unknown): string => formatMoney(v, DEFAULT_CURRENCY);
export const compactNaira = (v: unknown): string => compactMoney(v, DEFAULT_CURRENCY);
