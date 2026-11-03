import { normalizeCompanyName as normalize } from "./names";

/**
 * Finding the same company or person twice. Pure rules; never merges anything, only says which records look like the same one and why.
 * Companies match on the reduced name (see names.ts), the RC number, or the company's own email domain (free-mail domains are ignored: many
 * unrelated people share them). People match on the same phone (E.164) or the same email, in any case.
 */
export const FREE_MAIL_DOMAINS = ["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "zoho.com", "mail.com"];

/** The domain of a business email address, or null for a free-mail address or something that is not an email. */
export function businessEmailDomain(email: string | null | undefined): string | null {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec((email ?? "").trim().toLowerCase());
  if (!m) return null;
  return FREE_MAIL_DOMAINS.includes(m[1]) ? null : m[1];
}

export type Match = { id: string; reason: string };

/** "Same company name, same RC number": the first reason capitalised, the rest in lower case. */
const joinReasons = (reasons: string[]) => reasons.map((r, i) => (i ? r.charAt(0).toLowerCase() + r.slice(1) : r)).join(", ");

export interface AccountFacts {
  id: string;
  name: string;
  normalizedName: string;
  rcNumber?: string | null;
  emailDomain?: string | null;
}

/** Existing companies that look like the candidate, each once, with every reason joined. `normalizedCandidate` is the candidate's reduced name. */
export function accountMatches(candidate: { name: string; normalizedName?: string; rcNumber?: string | null; emailDomain?: string | null }, existing: readonly AccountFacts[]): Match[] {
  const norm = candidate.normalizedName ?? normalize(candidate.name);
  const rc = (candidate.rcNumber ?? "").trim().toLowerCase();
  const domain = (candidate.emailDomain ?? "").trim().toLowerCase();
  const out: Match[] = [];
  for (const e of existing) {
    const reasons: string[] = [];
    if (norm && e.normalizedName === norm) reasons.push("Same company name");
    if (rc && (e.rcNumber ?? "").trim().toLowerCase() === rc) reasons.push("Same RC number");
    const d = (e.emailDomain ?? "").trim().toLowerCase();
    if (domain && d === domain && !FREE_MAIL_DOMAINS.includes(domain)) reasons.push(`Same email domain (${domain})`);
    if (reasons.length) out.push({ id: e.id, reason: joinReasons(reasons) });
  }
  return out;
}

export interface PersonFacts {
  id: string;
  phoneE164?: string | null;
  email?: string | null;
}

export function personMatches(candidate: { phoneE164?: string | null; email?: string | null }, existing: readonly PersonFacts[]): Match[] {
  const phone = candidate.phoneE164 ?? "";
  const email = (candidate.email ?? "").trim().toLowerCase();
  const out: Match[] = [];
  for (const e of existing) {
    const reasons: string[] = [];
    if (phone && e.phoneE164 === phone) reasons.push("Same phone number");
    if (email && (e.email ?? "").trim().toLowerCase() === email) reasons.push("Same email address");
    if (reasons.length) out.push({ id: e.id, reason: joinReasons(reasons) });
  }
  return out;
}
