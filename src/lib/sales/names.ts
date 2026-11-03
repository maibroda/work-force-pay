/**
 * A company name reduced to what identifies it, so "ABC Security Ltd" and "A.B.C. Security Limited" compare equal (used to find duplicates in Phase 2).
 * Lower case, no punctuation or spaces, and the usual company endings removed.
 */
const ENDINGS = ["limited", "ltd", "plc", "nigeria", "nig", "company", "co", "incorporated", "inc", "llc", "enterprises", "enterprise"];

export function normalizeCompanyName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && ENDINGS.includes(words[words.length - 1])) words.pop();
  return words.join("");
}
