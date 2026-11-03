/**
 * What an account page and a contact page show: the record and everything related to it (its contacts, deals, consent history). A record the caller
 * may not see, or another organization's, is "not found". Read-only; the changes go through the other services.
 */
import type { Ctx } from "@/lib/auth/context";
import { BusinessError, db } from "../_base";
import { ownerFilter, requireSales } from "./access";

export async function accountView(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.view");
  const account = await db.crmAccount.findFirst({ where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) }, include: { parent: { select: { id: true, name: true } }, mergedInto: { select: { id: true, name: true } } } });
  if (!account) throw new BusinessError("Account not found.");
  const [contacts, opportunities, children] = await Promise.all([
    db.crmContact.findMany({ where: { organizationId: ctx.orgId, accountId: id, status: "ACTIVE", ...ownerFilter(ctx) }, orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }] }),
    db.crmOpportunity.findMany({ where: { organizationId: ctx.orgId, accountId: id, status: "ACTIVE", ...ownerFilter(ctx) }, orderBy: { createdAt: "desc" }, include: { stage: { select: { name: true } } } }),
    db.crmAccount.findMany({ where: { organizationId: ctx.orgId, parentAccountId: id, status: "ACTIVE", ...ownerFilter(ctx) }, select: { id: true, name: true } }),
  ]);
  return { account, contacts, opportunities, children };
}

export async function contactView(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.view");
  const contact = await db.crmContact.findFirst({ where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) }, include: { account: { select: { id: true, name: true } }, mergedInto: { select: { id: true, firstName: true, lastName: true } } } });
  if (!contact) throw new BusinessError("Contact not found.");
  // a contact's consent history includes that of every record merged into it
  const mergedIds = (await db.crmContact.findMany({ where: { organizationId: ctx.orgId, mergedIntoId: id }, select: { id: true } })).map((c) => c.id);
  const [opportunities, consents] = await Promise.all([
    db.crmOpportunity.findMany({ where: { organizationId: ctx.orgId, primaryContactId: id, status: "ACTIVE" }, orderBy: { createdAt: "desc" }, include: { stage: { select: { name: true } } } }),
    db.crmConsent.findMany({ where: { organizationId: ctx.orgId, contactId: { in: [id, ...mergedIds] } }, orderBy: { seq: "desc" }, take: 50 }),
  ]);
  const latest = (purpose: "MARKETING" | "SERVICE") => consents.find((c) => c.purpose === purpose)?.status ?? "UNKNOWN";
  return { contact, opportunities, consents, marketing: latest("MARKETING") as "GRANTED" | "WITHDRAWN" | "UNKNOWN", service: latest("SERVICE") as "GRANTED" | "WITHDRAWN" | "UNKNOWN" };
}
