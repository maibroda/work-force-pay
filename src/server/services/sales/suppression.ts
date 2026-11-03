/**
 * The suppression list: email addresses and phone numbers that must receive no marketing, kept as keyed hashes (never the address), per organization. A withdrawal of marketing
 * consent adds the person's addresses, so the same address on another contact or lead, or on a record imported again later, is blocked too. A fresh consent recorded for a person lifts
 * the suppression of that person's own addresses, but never one made because the person was erased. Every marketing send asks canSendMarketing (consent.ts), which asks this.
 */
import { normalizeEmail, suppressionHash, type SuppressionKind } from "@/lib/sales/privacy";
import { BusinessError, db, type Tx } from "../_base";

export interface Identifier {
  kind: SuppressionKind;
  /** Normalized: lower-case email, or an E.164 phone number. */
  value: string;
}

/** The signing secret (AUTH_SECRET). */
export function signingSecret(): string {
  const s = process.env.AUTH_SECRET ?? "";
  if (s.length < 32) throw new BusinessError("The app's signing secret is not set, so unsubscribe links and the suppression list cannot be used.");
  return s;
}

export function identifiersOf(p: { email?: string | null; phoneE164?: string | null; whatsappE164?: string | null }): Identifier[] {
  const out: Identifier[] = [];
  const email = normalizeEmail(p.email);
  if (email) out.push({ kind: "EMAIL", value: email });
  for (const phone of new Set([p.phoneE164, p.whatsappE164])) if (phone && /^\+\d{8,15}$/.test(phone)) out.push({ kind: "PHONE", value: phone });
  return out;
}

/** The addresses and numbers a contact or lead holds now. */
export async function identifiersFor(orgId: string, t: { contactId?: string | null; leadId?: string | null }, tx: Tx | typeof db = db): Promise<Identifier[]> {
  if (t.contactId) {
    const c = await tx.crmContact.findFirst({ where: { id: t.contactId, organizationId: orgId }, select: { email: true, phoneE164: true, whatsappE164: true } });
    return c ? identifiersOf(c) : [];
  }
  if (t.leadId) {
    const l = await tx.crmLead.findFirst({ where: { id: t.leadId, organizationId: orgId }, select: { email: true, phoneE164: true } });
    return l ? identifiersOf(l) : [];
  }
  return [];
}

const hashes = (orgId: string, ids: Identifier[]) => ids.map((i) => ({ kind: i.kind, valueHash: suppressionHash(signingSecret(), orgId, i.kind, i.value) }));

/** Adds the addresses to the list (one row each; an address already there keeps its first reason). */
export async function addSuppression(tx: Tx | typeof db, orgId: string, ids: Identifier[], reason: "UNSUBSCRIBED" | "WITHDRAWN" | "ERASED", source: string) {
  if (!ids.length) return;
  await tx.crmSuppression.createMany({ data: hashes(orgId, ids).map((h) => ({ organizationId: orgId, ...h, reason, source })), skipDuplicates: true });
}

/**
 * Takes the addresses off the list. An erased person is never lifted; a person who used the unsubscribe link is lifted only when `includeUnsubscribed` says so (the caller
 * decides who may do that); a withdrawal that someone recorded for the person is lifted by a fresh consent.
 */
export async function liftSuppression(tx: Tx | typeof db, orgId: string, ids: Identifier[], opts: { includeUnsubscribed?: boolean } = {}) {
  if (!ids.length) return;
  const keep = opts.includeUnsubscribed ? ["ERASED"] : ["ERASED", "UNSUBSCRIBED"];
  await tx.crmSuppression.deleteMany({ where: { organizationId: orgId, reason: { notIn: keep }, OR: hashes(orgId, ids).map((h) => ({ kind: h.kind, valueHash: h.valueHash })) } });
}

export async function isSuppressed(orgId: string, ids: Identifier[], tx: Tx | typeof db = db): Promise<boolean> {
  if (!ids.length) return false;
  return (await tx.crmSuppression.count({ where: { organizationId: orgId, OR: hashes(orgId, ids).map((h) => ({ kind: h.kind, valueHash: h.valueHash })) } })) > 0;
}
