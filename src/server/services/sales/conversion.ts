/**
 * Converting a qualified lead into an account, a contact and (by default) a deal, in one all-or-nothing step.
 * New records copy the lead's fields (its source and source detail travel with them). An EXISTING account or contact is only filled where it is empty:
 * nothing it already holds is overwritten and its owner never changes. Consent follows the person: a withdrawal on the lead always reaches the contact,
 * but a grant reaches a contact only if they have no consent record of their own for that purpose, so an old grant can never undo a withdrawal.
 * A converted lead is read-only afterwards. The audit log gets ids and what was created, never the lead's details.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { normalizeCompanyName } from "@/lib/sales/names";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { ownerFilter, requireSales, resolveOwner } from "./access";
import { visibleAccount, visibleContact } from "./loaders";
import { insertOpportunity } from "./pipelines";

const target = z.union([z.object({ id: z.string() }), z.object({ create: z.literal(true) })]);

export const convertSchema = z.object({
  account: target,
  contact: target,
  /** false: no deal. Omitted or an object: a deal is created (the object may name its pipeline, name and value). */
  opportunity: z.union([z.literal(false), z.object({ pipelineId: z.string().optional(), name: z.string().trim().min(2).max(200).optional(), monthlyContractValue: z.union([z.string(), z.number()]).optional() })]).optional(),
  ownerUserId: z.string().optional(),
});

const blank = (v: unknown) => v === null || v === undefined || v === "";
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const monthYear = () => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date());

/** The values of `from` that `into` lacks (only those): what filling an existing record may change. */
function fillEmpty(into: Record<string, unknown>, from: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(from).filter(([k, v]) => !blank(v) && blank(into[k])));
}

export async function convertLead(ctx: Ctx, leadId: string, raw: z.input<typeof convertSchema>) {
  await requireSales(ctx, "sales.manage");
  const v = convertSchema.parse(raw);
  const owner = v.ownerUserId ? await resolveOwner(ctx, v.ownerUserId) : null;
  const setting = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { mode: true } });
  if (setting?.mode === "SIMPLE") throw new BusinessError("In simple mode there are no leads to convert: enquiries go straight to deals.");

  return db.$transaction(async (tx: Tx) => {
    const lead = await tx.crmLead.findFirst({ where: { id: leadId, organizationId: ctx.orgId, ...ownerFilter(ctx) } });
    if (!lead) throw new BusinessError("Lead not found.");
    if (lead.status === "CONVERTED") throw new BusinessError("This lead has already been converted.");
    if (lead.status === "VOID") throw new BusinessError("A voided lead cannot be converted.");
    if ("create" in v.contact && !lead.contactName?.trim()) throw new BusinessError("The lead has no contact person to turn into a contact: add one to the lead, or choose an existing contact.");
    const own = owner ?? { ownerUserId: lead.ownerUserId, ownerName: lead.ownerName };

    // the account
    let account;
    if ("id" in v.account) {
      const existing = await visibleAccount(ctx, tx, v.account.id);
      const fill = fillEmpty(existing, { industry: lead.industry, state: lead.state, lga: lead.lga, address: lead.address, source: lead.source, sourceDetail: lead.sourceDetail });
      account = Object.keys(fill).length ? await tx.crmAccount.update({ where: { id: existing.id }, data: fill }) : existing;
    } else {
      account = await tx.crmAccount.create({
        data: { organizationId: ctx.orgId, name: lead.companyName, normalizedName: normalizeCompanyName(lead.companyName), industry: lead.industry, accountType: "PROSPECT", ...own, source: lead.source, sourceDetail: lead.sourceDetail, state: lead.state, lga: lead.lga, address: lead.address, createdBy: ctx.name },
      });
    }

    // the contact
    let contact;
    if ("id" in v.contact) {
      const existing = await visibleContact(ctx, tx, v.contact.id);
      if (existing.accountId && existing.accountId !== account.id) throw new BusinessError("That contact belongs to a different account.");
      const fill = fillEmpty(existing, { jobTitle: lead.jobTitle, phoneE164: lead.phoneE164, email: lead.email, accountId: account.id });
      contact = Object.keys(fill).length ? await tx.crmContact.update({ where: { id: existing.id }, data: fill }) : existing;
    } else {
      const parts = lead.contactName!.trim().split(/\s+/);
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || "(surname not given)";
      contact = await tx.crmContact.create({
        data: { organizationId: ctx.orgId, accountId: account.id, firstName, lastName, jobTitle: lead.jobTitle, phoneE164: lead.phoneE164, email: lead.email, isPrimary: true, ...own, createdBy: ctx.name },
      });
    }

    // consent follows the person, and never loosens
    for (const purpose of ["MARKETING", "SERVICE"] as const) {
      const [fromLead, onContact] = await Promise.all([
        tx.crmConsent.findFirst({ where: { organizationId: ctx.orgId, leadId: lead.id, purpose }, orderBy: { seq: "desc" } }),
        tx.crmConsent.findFirst({ where: { organizationId: ctx.orgId, contactId: contact.id, purpose }, orderBy: { seq: "desc" } }),
      ]);
      if (!fromLead) continue;
      const carry = fromLead.status === "WITHDRAWN" ? onContact?.status !== "WITHDRAWN" : !onContact;
      if (carry)
        await tx.crmConsent.create({
          data: { organizationId: ctx.orgId, contactId: contact.id, purpose, status: fromLead.status, channel: fromLead.channel, source: `Carried from lead ${lead.number}: ${fromLead.source}`, evidenceRef: fromLead.evidenceRef, recordedBy: ctx.name, recordedByUserId: ctx.userId },
        });
    }

    // the deal
    let opportunityId: string | null = null;
    if (v.opportunity !== false) {
      const o = v.opportunity ?? {};
      const opp = await insertOpportunity(
        ctx,
        tx,
        {
          accountId: account.id,
          primaryContactId: contact.id,
          name: o.name ?? `${account.name} - ${label(lead.serviceInterest)} - ${monthYear()}`,
          serviceType: lead.serviceInterest,
          monthlyContractValue: o.monthlyContractValue,
          pipelineId: o.pipelineId,
          source: lead.source,
          sourceDetail: lead.sourceDetail ?? undefined,
          ...own,
          fromLeadId: lead.id,
        },
      );
      opportunityId = opp.id;
    }

    await tx.crmLead.update({ where: { id: lead.id }, data: { status: "CONVERTED", convertedAccountId: account.id, convertedContactId: contact.id, convertedOpportunityId: opportunityId, convertedAt: new Date(), convertedBy: ctx.name } });
    await logAudit(ctx, { action: "SALES_LEAD_CONVERT", entity: "CrmLead", entityId: lead.id, newValue: { accountId: account.id, contactId: contact.id, opportunityId, accountCreated: "create" in v.account, contactCreated: "create" in v.contact } }, tx);
    return { accountId: account.id, contactId: contact.id, opportunityId };
  });
}
