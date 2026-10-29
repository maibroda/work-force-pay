/**
 * An amount of naira typed or posted as text or a number, checked and returned as a string with exactly two decimals. It is never rounded for the
 * caller: more than two decimals is refused, so nobody is surprised by a changed figure. Arithmetic on it is done in whole kobo elsewhere.
 */
export function parseNairaAmount(input: string | number | null | undefined, label = "The amount"): string {
  const raw = typeof input === "number" ? (Number.isFinite(input) ? String(input) : "") : (input ?? "").toString().trim().replace(/,/g, "");
  if (raw === "") return "0.00";
  if (/^-/.test(raw)) throw new Error(`${label} cannot be negative.`);
  const m = /^(\d{1,14})(?:\.(\d+))?$/.exec(raw);
  if (!m) throw new Error(`${label} is not a number I can read.`);
  const decimals = m[2] ?? "";
  if (decimals.length > 2) throw new Error(`${label} can have at most two decimals (kobo).`);
  return `${m[1]}.${decimals.padEnd(2, "0")}`;
}
