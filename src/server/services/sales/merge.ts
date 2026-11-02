/**
 * Merging two accounts or two contacts into one. Only a manager (someone who sees all sales records and may change them) can do it, because it
 * moves other people's records. The survivor keeps its own values; where the survivor is empty the other's value fills it, and for a field the
 * manager names, the other's value wins. Everything that pointed at the merged-away record is re-pointed at the survivor, and the merged-away
 * record is voided with a pointer to the survivor (nothing is deleted). Consent rows cannot be edited, so a contact's consent is read from the
 * survivor and everything merged into it (see consent.ts), which means a withdrawal is never lost. The audit log gets ids only.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { requireSales, seesAll } from "./access";

async function requireManager(ctx: Ctx) {
  await requireSales(ctx, "sales.manage");
  if (!seesAll(ctx)) throw new BusinessError("Only a sales manager may merge records.");
}

const ACCOUNT_FIELDS = ["industry", "state", "lga", "address", "rcNumber", "emailDomain", "source", "sourceDetail", "accountType"] as const;
const CONTACT_FIELDS = ["jobTitle", "roleInDecision", "phoneE164", "whatsappE164", "email", "accountId"] as const;

const blank = (v: unknown) => v === null || v === undefined || v === "";

/** The values the survivor ends up with: its own, filled from the other where empty, or the other's where the manager said so. */
function chosen<F extends string>(fields: readonly F[], survivor: Record<string, unknown>, loser: Record<string, unknown>, take: Partial<Record<F, "LOSER">> | undefined) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const useLoser = (take?.[f] === "LOSER" && !blank(loser[f])) || (blank(survivor[f]) && !blank(loser[f]));
    if (useLoser) out[f] = loser[f];
  }
  return out;
}

export const mergeAccountsSchema = z.object({ survivorId: z.string(), loserId: z.string(), take: z.record(z.enum(ACCOUNT_FIELDS), z.literal("LOSER")).optional() });

export async function mergeAccounts(ctx: Ctx, raw: z.input<typeof mergeAccountsSchema>) {
  await requireManager(ctx);
  const v = mergeAccountsSchema.parse(raw);
  if (v.survivorId === v.loserId) throw new BusinessError("A record cannot be merged with itself.");
  return db.$transaction(async (tx: Tx) => {
    const [survivor, loser] = await Promise.all(
      [v.survivorId, v.loserId].map(async (id) => {
        const a = await tx.crmAccount.findFirst({ where: { id, organizationId: ctx.orgId } });
        if (!a) throw new BusinessError("Account not found.");
        if (a.status === "VOID") throw new BusinessError("A voided account cannot be merged.");
        return a;
      }),
    );
    const take = chosen(ACCOUNT_FIELDS, survivor as never, loser as never, v.take as never);
    await tx.crmContact.updateMany({ where: { organizationId: ctx.orgId, accountId: loser.id }, data: { accountId: survivor.id } });
    await tx.crmOpportunity.updateMany({ where: { organizationId: ctx.orgId, accountId: loser.id }, data: { accountId: survivor.id } });
    await tx.crmAccount.updateMany({ where: { organizationId: ctx.orgId, parentAccountId: loser.id }, data: { parentAccountId: survivor.id } });
    await tx.crmLead.updateMany({ where: { organizationId: ctx.orgId, convertedAccountId: loser.id }, data: { convertedAccountId: survivor.id } });
    await tx.crmAccount.update({ where: { id: loser.id }, data: { status: "VOID", voidedAt: new Date(), voidedBy: ctx.name, voidReason: `Merged into ${survivor.name}`, mergedIntoId: survivor.id } });
    const merged = await tx.crmAccount.update({ where: { id: survivor.id }, data: take });
    await logAudit(ctx, { action: "SALES_ACCOUNT_MERGE", entity: "CrmAccount", entityId: survivor.id, newValue: { mergedIn: loser.id, fields: Object.keys(take).sort() } }, tx);
    return merged;
  });
}

export const mergeContactsSchema = z.object({ survivorId: z.string(), loserId: z.string(), take: z.record(z.enum(CONTACT_FIELDS), z.literal("LOSER")).optional() });

export async function mergeContacts(ctx: Ctx, raw: z.input<typeof mergeContactsSchema>) {
  await requireManager(ctx);
  const v = mergeContactsSchema.parse(raw);
  if (v.survivorId === v.loserId) throw new BusinessError("A record cannot be merged with itself.");
  return db.$transaction(async (tx: Tx) => {
    const [survivor, loser] = await Promise.all(
      [v.survivorId, v.loserId].map(async (id) => {
        const c = await tx.crmContact.findFirst({ where: { id, organizationId: ctx.orgId } });
        if (!c) throw new BusinessError("Contact not found.");
        if (c.status === "VOID") throw new BusinessError("A voided contact cannot be merged.");
        return c;
      }),
    );
    const take = chosen(CONTACT_FIELDS, survivor as never, loser as never, v.take as never);
    await tx.crmOpportunity.updateMany({ where: { organizationId: ctx.orgId, primaryContactId: loser.id }, data: { primaryContactId: survivor.id } });
    await tx.crmLead.updateMany({ where: { organizationId: ctx.orgId, convertedContactId: loser.id }, data: { convertedContactId: survivor.id } });
    // anything already merged into the loser now points at the survivor, so consent history stays reachable
    await tx.crmContact.updateMany({ where: { organizationId: ctx.orgId, mergedIntoId: loser.id }, data: { mergedIntoId: survivor.id } });
    await tx.crmContact.update({ where: { id: loser.id }, data: { status: "VOID", voidedAt: new Date(), voidedBy: ctx.name, voidReason: `Merged into ${survivor.firstName} ${survivor.lastName}`, mergedIntoId: survivor.id } });
    const merged = await tx.crmContact.update({ where: { id: survivor.id }, data: take });
    await logAudit(ctx, { action: "SALES_CONTACT_MERGE", entity: "CrmContact", entityId: survivor.id, newValue: { mergedIn: loser.id, fields: Object.keys(take).sort() } }, tx);
    return merged;
  });
}
