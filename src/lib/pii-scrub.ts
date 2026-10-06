/**
 * Removes personal details from text before it leaves the process (error reports, breadcrumbs). Errors tend to
 * carry whatever was being handled when they happened — an email address in a "user not found" message, an
 * account number in a failed bank-file line — so anything that looks like personal data is replaced.
 *
 * It errs on the side of removing too much: an error report with "[number]" in it is still useful, one with a
 * bank account number in it is a breach.
 */

const RULES: Array<[RegExp, string]> = [
  // Authorization values and the tokens inside URLs are secrets, not just personal data
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [token]"],
  [/\b(token|secret|password|passwd|key|code)=([^&\s"']+)/gi, "$1=[removed]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[token]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, "[email]"],
  // Nigerian and international phone numbers, with or without spaces/dashes: +234 803 123 4567, 0803-123-4567
  [/(?<![\d.])(?:\+?234|0)[\s-]?[789][01]\d[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g, "[phone]"],
  [/(?<![\w.])\+\d{1,3}[\s-]?\d[\d\s-]{7,14}\d(?!\d)/g, "[phone]"],
  // Account numbers (10 digits), NIN / BVN (11), card numbers and longer runs
  [/(?<![\d.])\d{9,19}(?![\d])/g, "[number]"],
  // Long opaque strings that look like keys or secrets
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[token]"],
];

export function scrubText(text: string): string {
  return RULES.reduce((s, [re, to]) => s.replace(re, to), text);
}

/** Scrubs every string inside a value, however deeply nested; other types pass through. */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === "string") return scrubText(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubDeep(v, depth + 1)])) as T;
  }
  return value;
}
