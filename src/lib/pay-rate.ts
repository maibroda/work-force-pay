/**
 * What a personal pay rate (a monthly gross entered by hand) may be, checked the same way wherever it is entered: the employee's record, adding an employee, and the bulk import.
 * The amount is the MONTHLY gross in naira (the founder, 2026-11-05: not an annual package), held as exact text with at most two decimals (kobo), never as a float.
 */
export const MONTHLY_GROSS_MESSAGE = "The monthly gross must be a positive amount in naira with at most two decimals (kobo), for example 250000 or 250000.50.";

/** The amount as exact text (for the database's decimal), or null if it is not a positive naira amount with at most two decimals. A number is accepted if its text is exact. */
export function parseMonthlyGross(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const text = String(value).trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const normal = `${whole.replace(/^0+(?=\d)/, "")}${frac ? "." + frac : ""}`;
  return /^0(\.0+)?$/.test(normal) ? null : normal;
}

/** A calendar date as YYYY-MM-DD that exists (not 2026-02-30). */
export function isIsoDate(text: unknown): text is string {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const t = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === text;
}
