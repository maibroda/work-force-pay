/**
 * Marketing consent (the Nigeria Data Protection Act 2023 gives people the right to object to direct marketing at any time). Every consent or
 * withdrawal is a new row; rows are never changed (the database refuses it). The latest row for a person and purpose decides. No row means
 * UNKNOWN, and only a latest "granted" for MARKETING allows marketing. A service message about an active contract is a separate purpose and
 * never opens marketing. The audit log records that a consent was recorded and its channel, not the evidence or the person.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { BusinessError, db } from "../_base";
import { logAudit } from "../audit";
import { can } from "@/lib/auth/permissions";
import { ownerFilter, requireSales } from "./access";
import { addSuppression, identifiersFor, isSuppressed, liftSuppression } from "./suppression";

export const CHANNELS = ["EMAIL", "WHATSAPP", "SMS", "PHONE", "IN_PERSON", "WEB_FORM", "OTHER"] as const;

export const consentSchema = z.object({
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  purpose: z.enum(["MARKETING", "SERVICE"]),
  status: z.enum(["GRANTED", "WITHDRAWN"]),
  channel: z.enum(CHANNELS),
  source: z.string().trim().min(3, "Say where the consent came from (source), for example the form, call or message."),
  evidenceRef: z.string().trim().max(200).optional(),
});

export type ConsentTarget = { contactId?: string; leadId?: string };

/** The person the consent is about, if the caller may see them. */
async function checkTarget(ctx: Ctx, t: ConsentTarget) {
  if (!!t.contactId === !!t.leadId) throw new BusinessError("Give a contact or a lead (one of them).");
  if (t.contactId) {
    const c = await db.crmContact.findFirst({ where: { id: t.contactId, organizationId: ctx.orgId, ...ownerFilter(ctx) }, select: { id: true } });
    if (!c) throw new BusinessError("Contact not found.");
  } else {
    const l = await db.crmLead.findFirst({ where: { id: t.leadId, organizationId: ctx.orgId, ...ownerFilter(ctx) }, select: { id: true } });
    if (!l) throw new BusinessError("Lead not found.");
  }
}

export async function recordConsent(ctx: Ctx, raw: z.input<typeof consentSchema>) {
  await requireSales(ctx, "sales.manage");
  if (!!raw.contactId === !!raw.leadId) throw new BusinessError("Give a contact or a lead (one of them).");
  const v = consentSchema.parse(raw);
  await checkTarget(ctx, v);
  const row = await db.crmConsent.create({
    data: { organizationId: ctx.orgId, contactId: v.contactId ?? null, leadId: v.leadId ?? null, purpose: v.purpose, status: v.status, channel: v.channel, source: v.source, evidenceRef: v.evidenceRef ?? null, recordedBy: ctx.name, recordedByUserId: ctx.userId },
  });
  let stillSuppressed = false;
  let liftedUnsubscribe = false;
  if (v.purpose === "MARKETING") {
    // a withdrawal also suppresses the person's addresses everywhere; a fresh consent lifts the suppression of their own
    const ids = await identifiersFor(ctx.orgId, v);
    if (v.status === "WITHDRAWN") await addSuppression(db, ctx.orgId, ids, "WITHDRAWN", v.channel);
    else {
      // someone who used the unsubscribe link is brought back only by the administrator, and only with evidence (a salesperson's word is not enough); a recorded consent is kept either way
      const mayLiftUnsubscribe = can(ctx.role, "sales.privacy.manage") && !!v.evidenceRef;
      const before = await db.crmSuppression.count({ where: { organizationId: ctx.orgId, reason: "UNSUBSCRIBED" } });
      await liftSuppression(db, ctx.orgId, ids, { includeUnsubscribed: mayLiftUnsubscribe });
      liftedUnsubscribe = mayLiftUnsubscribe && before > (await db.crmSuppression.count({ where: { organizationId: ctx.orgId, reason: "UNSUBSCRIBED" } }));
      stillSuppressed = await isSuppressed(ctx.orgId, ids);
    }
  }
  await logAudit(ctx, { action: "SALES_CONSENT_RECORD", entity: "CrmConsent", entityId: row.id, newValue: { purpose: v.purpose, status: v.status, channel: v.channel, ...(liftedUnsubscribe ? { liftedUnsubscribe: true } : {}) } });
  return { ...row, stillSuppressed };
}

export async function consentStatus(ctx: Ctx, t: ConsentTarget & { purpose: "MARKETING" | "SERVICE" }): Promise<"GRANTED" | "WITHDRAWN" | "UNKNOWN"> {
  await requireSales(ctx, "sales.view");
  await checkTarget(ctx, t);
  // a contact's consent includes that of every record merged into it (consent rows cannot be edited, so they stay where they were written)
  const ids = t.contactId ? [t.contactId, ...(await db.crmContact.findMany({ where: { organizationId: ctx.orgId, mergedIntoId: t.contactId }, select: { id: true } })).map((c) => c.id)] : [];
  const last = await db.crmConsent.findFirst({
    where: { organizationId: ctx.orgId, purpose: t.purpose, ...(t.contactId ? { contactId: { in: ids } } : { leadId: t.leadId }) },
    orderBy: { seq: "desc" },
    select: { status: true },
  });
  return last?.status ?? "UNKNOWN";
}

/**
 * The single yes/no every marketing send must ask first: the latest marketing consent is "granted" AND none of the person's email addresses or phone numbers is on the suppression
 * list (so a withdrawal on one record blocks the same address on every other record, and an erased person stays blocked).
 */
export async function canSendMarketing(ctx: Ctx, t: ConsentTarget): Promise<boolean> {
  if ((await consentStatus(ctx, { ...t, purpose: "MARKETING" })) !== "GRANTED") return false;
  return !(await isSuppressed(ctx.orgId, await identifiersFor(ctx.orgId, t)));
}
