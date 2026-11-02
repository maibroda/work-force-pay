/**
 * The privacy rules that need no database: reducing an email to a form that can be compared, masking an email or phone number for people who need not see it, the signed
 * unsubscribe token, and the keyed hash a suppression list keeps instead of the address. The secret is passed in (the app's AUTH_SECRET); with a weak one nothing is made.
 * Changing the secret breaks every unsubscribe link already sent and every stored suppression hash: it must not be rotated casually.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const MIN_SECRET = 32;
const need = (secret: string) => {
  if (!secret || secret.length < MIN_SECRET) throw new Error(`The signing secret must be set (at least ${MIN_SECRET} characters).`);
  return secret;
};
const mac = (secret: string, text: string) => createHmac("sha256", need(secret)).update(text);

/** An email as it is compared: no spaces, lower case; null when it is not an email address. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.indexOf("@");
  return at > 0 && at < e.length - 1 && !/\s/.test(e) ? e : null;
}

/** f***@lekki.test */
export function maskEmail(email: string | null | undefined): string {
  const e = normalizeEmail(email);
  return e ? `${e[0]}***${e.slice(e.indexOf("@"))}` : "";
}

/** +234*******567: the country code and the last three digits only. A number that is not a full international number shows nothing. */
export function maskPhone(phone: string | null | undefined): string {
  const p = (phone ?? "").trim();
  if (!p) return "";
  if (!/^\+\d{10,15}$/.test(p)) return "*".repeat(p.length);
  return `${p.slice(0, 4)}${"*".repeat(p.length - 7)}${p.slice(-3)}`;
}

// ─────────────────────────────── the unsubscribe token ───────────────────────────────

export interface UnsubscribeSubject {
  orgId: string;
  type: "CONTACT" | "LEAD";
  id: string;
}
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** A link token for one person: the person (organization, kind and id) and a signature over it. It carries no personal detail and never expires, so an old email still works. */
export function signUnsubscribe(secret: string, who: UnsubscribeSubject): string {
  const payload = b64(`${who.orgId}|${who.type === "CONTACT" ? "C" : "L"}|${who.id}`);
  return `${payload}.${mac(secret, `unsub:${payload}`).digest("base64url")}`;
}

/** The person a token was made for, or null if it has been changed, was made with another secret, or is not a token. */
export function verifyUnsubscribe(secret: string, token: string): UnsubscribeSubject | null {
  if (typeof token !== "string" || token.length > 400) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(mac(secret, `unsub:${parts[0]}`).digest("base64url"));
  const given = Buffer.from(parts[1]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [orgId, t, id, ...rest] = Buffer.from(parts[0], "base64url").toString("utf8").split("|");
  if (rest.length || !orgId || !id || (t !== "C" && t !== "L")) return null;
  return { orgId, type: t === "C" ? "CONTACT" : "LEAD", id };
}

/** What a marketing WhatsApp ends with: the person's own unsubscribe link. */
export const whatsappFooter = (url: string) => `\n\nTo stop these messages: ${url}`;

// ─────────────────────────────── suppression ───────────────────────────────

export type SuppressionKind = "EMAIL" | "PHONE";

/** What the suppression list keeps for an address or number: a keyed hash (per organization and kind), never the address itself. */
export function suppressionHash(secret: string, orgId: string, kind: SuppressionKind, normalizedValue: string): string {
  return mac(secret, `supp:${orgId}:${kind}:${normalizedValue}`).digest("hex");
}
