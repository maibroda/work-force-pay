/**
 * Phone numbers in the sales module are stored in one international form (E.164, +234...), so the same person is found whether their number
 * was typed as 0803 123 4567, 2348031234567 or +234 803 123 4567. Only Nigerian numbers are accepted, and a number that cannot be read is
 * refused with a reason; no digit is ever guessed or added.
 */
export type PhoneResult = { ok: true; e164: string } | { ok: false; reason: string };

const MOBILE = /^[789]\d{9}$/; // 803 123 4567: ten digits after the country code
const LANDLINE = /^[1-6]\d{7,8}$/; // 1 234 5678: an area code then the number

export function normalizeNgPhone(input: string | null | undefined): PhoneResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, reason: "Enter a phone number." };
  if (/[^\d\s()+\-.]/.test(raw)) return { ok: false, reason: `"${raw}" has characters other than digits, spaces, brackets, dashes and a leading +.` };
  const digits = raw.replace(/\D/g, "");
  let national: string;
  if (raw.startsWith("+") || digits.startsWith("234")) {
    if (!digits.startsWith("234")) return { ok: false, reason: `"${raw}" is not a Nigerian number (+234); only Nigerian numbers are accepted here.` };
    national = digits.slice(3);
    if (national.startsWith("0")) national = national.slice(1); // +234 (0)803 ...
  } else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;
  if (MOBILE.test(national) || LANDLINE.test(national)) return { ok: true, e164: `+234${national}` };
  return { ok: false, reason: `"${raw}" is not a Nigerian phone number I can read (a mobile has 10 digits after the 0, for example 0803 123 4567).` };
}
