/**
 * Nigerian banks and the codes a bulk payment upload asks for. No database here.
 *
 * The starting list uses the 3-digit CBN bank codes. It is only a starting point: it is stored per organization and can be corrected or extended
 * (microfinance banks and payment service banks use longer codes), and the codes should be confirmed against the upload guide of the bank the client pays
 * from before the first file is sent. Employees' bank names are free text, so a name is matched to an entry ignoring case, spacing, punctuation and common
 * suffixes ("Bank", "Plc", "Nigeria"), and through the entry's alternative names.
 */

export type BankEntry = { name: string; code: string; aliases: string[] };

export const DEFAULT_BANKS: BankEntry[] = [
  { name: "Access Bank", code: "044", aliases: ["Access", "Access Bank Plc"] },
  { name: "Access Bank (Diamond)", code: "063", aliases: ["Diamond Bank", "Diamond"] },
  { name: "Citibank", code: "023", aliases: ["Citi Bank", "Citibank Nigeria"] },
  { name: "Ecobank", code: "050", aliases: ["Ecobank Nigeria", "Eco Bank"] },
  { name: "Fidelity Bank", code: "070", aliases: ["Fidelity"] },
  { name: "First Bank", code: "011", aliases: ["First Bank of Nigeria", "FirstBank", "FBN", "First Bank Nigeria"] },
  { name: "FCMB", code: "214", aliases: ["First City Monument Bank"] },
  { name: "Globus Bank", code: "103", aliases: ["Globus"] },
  { name: "GTBank", code: "058", aliases: ["GTB", "GT Bank", "Guaranty Trust Bank", "Guaranty Trust", "GTCO"] },
  { name: "Heritage Bank", code: "030", aliases: ["Heritage"] },
  { name: "Jaiz Bank", code: "301", aliases: ["Jaiz"] },
  { name: "Keystone Bank", code: "082", aliases: ["Keystone"] },
  { name: "Polaris Bank", code: "076", aliases: ["Polaris", "Skye Bank", "Skye"] },
  { name: "Providus Bank", code: "101", aliases: ["Providus"] },
  { name: "Stanbic IBTC", code: "221", aliases: ["Stanbic", "Stanbic IBTC Bank", "Stanbic Bank"] },
  { name: "Standard Chartered", code: "068", aliases: ["Standard Chartered Bank", "StanChart"] },
  { name: "Sterling Bank", code: "232", aliases: ["Sterling"] },
  { name: "SunTrust Bank", code: "100", aliases: ["SunTrust", "Sun Trust"] },
  { name: "Union Bank", code: "032", aliases: ["Union"] },
  { name: "UBA", code: "033", aliases: ["United Bank for Africa", "United Bank For Africa Plc"] },
  { name: "Unity Bank", code: "215", aliases: ["Unity"] },
  { name: "Wema Bank", code: "035", aliases: ["Wema", "ALAT"] },
  { name: "Zenith Bank", code: "057", aliases: ["Zenith"] },
];

/** A bank name reduced to what identifies it: lower case, letters and digits only, without the words every bank shares. */
export function normalizeBankName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, (m) => m.replace(/[()]/g, " "))
    .replace(/\b(plc|ltd|limited|nigeria|nig|of)\b/g, " ")
    .replace(/\bbank\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

/** The entry a free-text bank name stands for, or null. A name matching two different codes is ambiguous and matches nothing. */
export function resolveBank<T extends BankEntry>(name: string | null | undefined, banks: T[]): T | null {
  const key = normalizeBankName(name ?? "");
  if (!key) return null;
  const hits = banks.filter((b) => [b.name, ...b.aliases].some((n) => normalizeBankName(n) === key));
  const codes = new Set(hits.map((h) => h.code));
  return codes.size === 1 ? hits[0] : null;
}
