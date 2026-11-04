/**
 * What a blueprint costs per month, from a price book (step E4b of docs/plans/module-entitlements-e4.md). Pure: no database, no clock. Exact: whole kobo through
 * src/lib/money-exact.ts, rounded half up once. A price in kobo times a whole number of employees or users is already exact, so only the VAT line can need rounding.
 * **No amount is in this file or anywhere in code**: every price is the founder's, entered in the price book, and a module with no price set shows "no price set" and the
 * quote shows no total, rather than a total that quietly leaves it out.
 */
import { MODULES, MODULE_KEYS, type ChargedPer, type ModuleKey } from "./catalogue";
import { koboToString, mulDiv, mulPct, pctToRate, sumKobo, toKobo, type Kobo } from "../money-exact";

export type PriceBasis = Exclude<ChargedPer, "included">;

export interface PriceBookLine {
  moduleKey: ModuleKey;
  /** How this price is charged, as the module was charged when the price was set. */
  basis: PriceBasis;
  /** Naira and kobo as text ("1500.00"): per employee per month, per CRM user per month, or flat per month, by the basis. */
  amount: string;
}

export interface PriceBookData {
  currency: string;
  /** The day this version starts (YYYY-MM-DD). */
  effectiveFrom: string;
  /** The least the whole monthly quote can be; "0.00" for none. */
  minimumMonthly: string;
  lines: PriceBookLine[];
}

export interface PriceInput {
  /** The blueprint's modules; the core is always included and never priced. */
  modules: readonly ModuleKey[];
  employees: number;
  crmUsers: number | null;
  book: PriceBookData | null;
  /** The VAT rate in percent ("7.5"), or null when none is known. */
  vatRatePct: string | number | null;
}

export interface QuoteLine {
  moduleKey: ModuleKey;
  name: string;
  basis: PriceBasis;
  /** Employees or CRM users priced; null for a flat price. */
  quantity: number | null;
  unitPrice: string;
  monthly: string;
}

export interface Quote {
  /** True only when every module is priced and the numbers needed are given; otherwise there is no total. */
  ok: boolean;
  reasons: string[];
  currency: string | null;
  /** The start day of the price book version used, saved with a quote so a later price change never rewrites it. */
  priceBookFrom: string | null;
  lines: QuoteLine[];
  /** Modules that have no price in the book, in the catalogue's order. */
  unpriced: ModuleKey[];
  subtotal: string | null;
  minimumMonthly: string | null;
  minimumApplied: boolean;
  monthly: string | null;
  vatRatePct: string | null;
  vat: string | null;
  monthlyWithVat: string | null;
}

const BASIS_WORDS: Record<PriceBasis, string> = { active_employee: "per employee", crm_user: "per user", flat: "flat" };
const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1;

const empty = (over: Partial<Quote>): Quote => ({
  ok: false,
  reasons: [],
  currency: null,
  priceBookFrom: null,
  lines: [],
  unpriced: [],
  subtotal: null,
  minimumMonthly: null,
  minimumApplied: false,
  monthly: null,
  vatRatePct: null,
  vat: null,
  monthlyWithVat: null,
  ...over,
});

export function priceBlueprint(input: PriceInput): Quote {
  const { book } = input;
  if (!book) return empty({ reasons: ["No price book is in force for this date."] });
  const reasons: string[] = [];
  if (!isCount(input.employees)) reasons.push("The number of employees must be a whole number of 1 or more.");
  const wanted = MODULE_KEYS.filter((k) => k !== "core" && input.modules.includes(k));
  const byModule = new Map(book.lines.map((l) => [l.moduleKey, l]));
  const lines: QuoteLine[] = [];
  const unpriced: ModuleKey[] = [];
  for (const k of wanted) {
    const line = byModule.get(k);
    if (!line) {
      unpriced.push(k);
      continue;
    }
    const now = MODULES[k].chargedPer;
    if (line.basis !== now) {
      reasons.push(`${MODULES[k].name} is priced ${BASIS_WORDS[line.basis]} in the price book but is now charged ${BASIS_WORDS[now as PriceBasis] ?? now}: the price book must be updated.`);
      continue;
    }
    const unit = toKobo(line.amount);
    if (line.basis === "flat") lines.push({ moduleKey: k, name: MODULES[k].name, basis: "flat", quantity: null, unitPrice: koboToString(unit), monthly: koboToString(unit) });
    else {
      const quantity = line.basis === "crm_user" ? input.crmUsers : input.employees;
      if (!isCount(quantity)) {
        if (line.basis === "crm_user") reasons.push(`${MODULES[k].name} is priced per user: say how many sales users there will be.`);
        continue;
      }
      lines.push({ moduleKey: k, name: MODULES[k].name, basis: line.basis, quantity, unitPrice: koboToString(unit), monthly: koboToString(mulDiv(unit, quantity, 1)) });
    }
  }
  if (unpriced.length) reasons.push(`No price is set for: ${unpriced.map((k) => MODULES[k].name).join(", ")}.`);
  const base = { currency: book.currency, priceBookFrom: book.effectiveFrom, lines, unpriced, minimumMonthly: koboToString(toKobo(book.minimumMonthly)) };
  if (reasons.length) return empty({ ...base, reasons });

  const subtotal: Kobo = sumKobo(lines.map((l) => toKobo(l.monthly)));
  const minimum = toKobo(book.minimumMonthly);
  const minimumApplied = minimum > subtotal;
  const monthly: Kobo = minimumApplied ? minimum : subtotal;
  let vat: Kobo | null = null;
  let vatRatePct: string | null = null;
  if (input.vatRatePct !== null && input.vatRatePct !== undefined) {
    vat = mulPct(monthly, pctToRate(input.vatRatePct));
    vatRatePct = String(input.vatRatePct);
  }
  return {
    ok: true,
    reasons: [],
    ...base,
    subtotal: koboToString(subtotal),
    minimumApplied,
    monthly: koboToString(monthly),
    vatRatePct,
    vat: vat === null ? null : koboToString(vat),
    monthlyWithVat: vat === null ? null : koboToString(sumKobo([monthly, vat])),
  };
}
