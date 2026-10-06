/**
 * Pure helpers for change control over an employee's bank, tax and pension details. No database here.
 */

export type ChangeKindName = "BANK" | "TAX" | "PENSION";

/** The employee fields each kind of change covers. */
export const KIND_FIELDS: Record<ChangeKindName, readonly string[]> = {
  BANK: ["bankName", "accountNumber", "accountName"],
  TAX: ["taxId", "annualRent"],
  PENSION: ["pensionPin", "pfa"],
};

export const KIND_LABELS: Record<ChangeKindName, string> = {
  BANK: "Bank details",
  TAX: "Tax details",
  PENSION: "Pension details",
};

export const FIELD_LABELS: Record<string, string> = {
  bankName: "Bank",
  accountNumber: "Account number",
  accountName: "Account name",
  taxId: "Tax ID",
  annualRent: "Declared annual rent",
  pensionPin: "Pension PIN",
  pfa: "PFA",
};

/** The audit action each kind has always been logged under. */
export const KIND_AUDIT: Record<ChangeKindName, string> = {
  BANK: "BANK_INFORMATION_CHANGE",
  TAX: "TAX_INFORMATION_CHANGE",
  PENSION: "PENSION_INFORMATION_CHANGE",
};

export type FieldValue = string | number | null;

/** Treats blanks, nulls and numbers-as-strings alike, so "no change" really means no change. */
export function normalizeValue(v: unknown): FieldValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Whether two sets of values for the same fields are the same. */
export function sameValues(a: Record<string, unknown>, b: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((f) => normalizeKey(a[f]) === normalizeKey(b[f]));
}
const normalizeKey = (v: unknown) => {
  const n = normalizeValue(v);
  return n === null ? "" : String(n).toLowerCase();
};

const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 2);

/**
 * Does an account name look like it belongs to this employee? Banks write names in any order, so this
 * checks that the employee's first and last names both appear. It's a flag for the approver, not a rule.
 */
export function nameLooksLike(accountName: string | null | undefined, e: { firstName: string; lastName: string }): boolean {
  if (!accountName) return false;
  const have = new Set(tokens(accountName));
  const want = [...new Set([...tokens(e.firstName), ...tokens(e.lastName)])];
  if (!want.length) return false;
  const first = tokens(e.firstName).some((t) => have.has(t));
  const last = tokens(e.lastName).some((t) => have.has(t));
  return first && last;
}

/** Shows only the last four digits of an account number. */
export function maskAccount(n: string | null | undefined): string {
  if (!n) return "—";
  return n.length <= 4 ? n : `${"•".repeat(n.length - 4)}${n.slice(-4)}`;
}
