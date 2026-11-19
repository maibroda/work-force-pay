/**
 * What the audit log may say about an employee's master data.
 *
 * Chosen by the founder on 2026-11-19: bank, tax and pension NUMBERS go in as their last four characters; the employee's own details (name, date of birth, phone, email, address, account name,
 * declared rent, gender) go in as the NAME of the changed field only, never the value. A bank change keeps the old and new last four, so the fraud trail still works. The employee record itself holds
 * every value, and erasure clears it there; the audit log is append-only and cannot be reached on erasure, so it must never hold the values (CLAUDE.md rule 5: masked in logs).
 *
 * A field this file does not list is treated as PERSONAL, so a column added to the employee later can never leak into the log by default. Pure functions, no database.
 */

/** Held as the last four characters only. */
export const NUMBER_FIELDS = ["accountNumber", "taxId", "pensionPin"] as const;

/** Safe to show as they are: ids, dates, statuses, flags, and the names of institutions (a bank, a pension administrator), none of which identifies the person on its own. */
export const PLAIN_FIELDS = [
  "employeeNumber",
  "status",
  "payingBankId",
  "nhfContributes",
  "nhfOptedInOn",
  "stateOfResidence",
  "employmentDate",
  "exitDate",
  "anonymizedAt",
  "categoryId",
  "departmentId",
  "bankName",
  "pfa",
  "currentClientId",
  "currentBeatId",
  "reportingManagerId",
  "importBatchId",
] as const;

/** Row bookkeeping that says nothing about the person and changes on every save: left out altogether. */
const BOOKKEEPING = new Set(["id", "organizationId", "createdAt", "updatedAt"]);

/** The last four characters of a number, the rest hidden; four or fewer are hidden entirely. Empty says nothing. */
export function lastFour(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length <= 4 ? "****" : `****${s.slice(-4)}`;
}

/** A value reduced to something comparable: dates by their day, decimals by their number, empty as nothing. */
function normal(v: unknown): string | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v;
  const s = typeof v === "string" ? v.trim() : String(v);
  if (!s) return null;
  return /^-?\d+\.\d+$/.test(s) ? String(Number(s)) : s;
}

const isNumberField = (k: string) => (NUMBER_FIELDS as readonly string[]).includes(k);
const isPlainField = (k: string) => (PLAIN_FIELDS as readonly string[]).includes(k);

/**
 * The audit entry for a change to employee master data: the old and new values of the fields that changed, shown only where they are safe (plain fields as they are, numbers as their last four),
 * and the names of every field that changed (including the personal ones, whose values are never shown). A new record is a change from nothing. Pass `keys` to look at some fields only.
 */
export function maskedChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys?: readonly string[],
): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> & { changedFields: string[] } } {
  const all = keys ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changedFields: string[] = [];
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const k of all) {
    if (BOOKKEEPING.has(k)) continue;
    const o = normal(before[k]);
    const n = normal(after[k]);
    if (o === n) continue;
    changedFields.push(k);
    if (isNumberField(k)) {
      const ol = lastFour(before[k]);
      const nl = lastFour(after[k]);
      if (ol !== null) oldValue[k] = ol;
      if (nl !== null) newValue[k] = nl;
    } else if (isPlainField(k)) {
      if (o !== null) oldValue[k] = o;
      if (n !== null) newValue[k] = n;
    }
  }
  return { oldValue, newValue: { ...newValue, changedFields: changedFields.sort() } };
}
