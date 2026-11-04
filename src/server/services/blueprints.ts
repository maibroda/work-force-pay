/**
 * Client blueprints (step E4c of docs/plans/module-entitlements-e4.md): what was proposed to a prospect, saved with the quote it was given so that what a client was told can be
 * shown later, and linked to the bureau's own lead and proposal (the founder, 2026-11-03). A saved quote is a SNAPSHOT: a later price change never rewrites it. Nothing here sends
 * anything or makes a subscription: "sent" and "accepted" only record that someone did so (making the subscription from an accepted blueprint is E5c).
 *
 * A blueprint belongs to the selling organization: the bureau (or platform organization) of the person who made it, whichever client they happen to be working in.
 */
import type { Ctx } from "@/lib/auth/context";
import type { Answers } from "@/lib/entitlements/configure";
import { BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { assertSeller, quoteBlueprint } from "./price-book";

export const BLUEPRINT_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DROPPED"] as const;
export type BlueprintStatus = (typeof BLUEPRINT_STATUSES)[number];
/** Draft goes to sent or dropped; sent to accepted or dropped; accepted and dropped are final. */
const NEXT: Record<BlueprintStatus, BlueprintStatus[]> = { DRAFT: ["SENT", "DROPPED"], SENT: ["ACCEPTED", "DROPPED"], ACCEPTED: [], DROPPED: [] };

const sellerOrg = (ctx: Ctx) => ctx.homeOrgId ?? ctx.orgId;

export interface BlueprintInput {
  prospectName: string;
  answers: Answers;
  /** The bureau's own lead and proposal this is for; the proposal must be that lead's. */
  leadId?: string | null;
  proposalId?: string | null;
  /** The day to price on; today if left out. */
  at?: Date;
}

export async function saveBlueprint(ctx: Ctx, input: BlueprintInput) {
  await assertSeller(ctx);
  const org = sellerOrg(ctx);
  const prospectName = input.prospectName.trim();
  if (!prospectName) throw new BusinessError("Give the prospect's name.");
  const { configured, quote } = await quoteBlueprint(ctx, input.answers, input.at);
  if (!configured.ok || !configured.proposed) throw new BusinessError(configured.problems.join(" "));
  // links are to this bureau's own records only: another bureau's are "not found", with no hint that they exist
  const lead = input.leadId ? await db.lead.findFirst({ where: { id: input.leadId, organizationId: org }, select: { id: true } }) : null;
  if (input.leadId && !lead) throw new BusinessError("That lead was not found.");
  const proposal = input.proposalId ? await db.proposal.findFirst({ where: { id: input.proposalId, organizationId: org }, select: { id: true, leadId: true } }) : null;
  if (input.proposalId && !proposal) throw new BusinessError("That proposal was not found.");
  if (proposal && input.leadId && proposal.leadId !== input.leadId) throw new BusinessError("That proposal does not belong to that lead.");
  return db.$transaction(async (tx) => {
    const row = await tx.clientBlueprint.create({
      data: {
        organizationId: org,
        leadId: input.leadId ?? proposal?.leadId ?? null,
        proposalId: input.proposalId ?? null,
        prospectName,
        planKey: configured.proposed!.planKey,
        modules: configured.modules,
        answers: JSON.parse(JSON.stringify(input.answers)),
        reasons: JSON.parse(JSON.stringify(configured.reasons)),
        configured: JSON.parse(JSON.stringify(configured)),
        quote: quote ? JSON.parse(JSON.stringify(quote)) : undefined,
        createdBy: ctx.name,
      },
    });
    // ids and the plan key only: the prospect's name is not personal data of the bureau's staff, but the log carries ids, not what things are called
    await logAudit({ ...ctx, orgId: org }, { action: "BLUEPRINT_CREATED", entity: "ClientBlueprint", entityId: row.id, newValue: { planKey: row.planKey, leadId: row.leadId, proposalId: row.proposalId, quoteOk: quote?.ok ?? false } }, tx);
    return row;
  });
}

/** The bureau's own leads, to link a blueprint to one (this bureau's only). */
export async function listLeadOptions(ctx: Ctx) {
  await assertSeller(ctx);
  return db.lead.findMany({ where: { organizationId: sellerOrg(ctx) }, select: { id: true, number: true, company: true }, orderBy: { createdAt: "desc" }, take: 200 });
}

/** The whole selling organization's blueprints, newest first (not only the maker's, as with the rest of the bureau's pipeline). */
export async function listBlueprints(ctx: Ctx) {
  await assertSeller(ctx);
  return db.clientBlueprint.findMany({ where: { organizationId: sellerOrg(ctx) }, orderBy: { createdAt: "desc" } });
}

export async function getBlueprint(ctx: Ctx, id: string) {
  await assertSeller(ctx);
  const row = await db.clientBlueprint.findFirst({ where: { id, organizationId: sellerOrg(ctx) } });
  if (!row) throw new BusinessError("That blueprint was not found.");
  return row;
}

export async function setBlueprintStatus(ctx: Ctx, id: string, status: BlueprintStatus) {
  await assertSeller(ctx);
  if (!(BLUEPRINT_STATUSES as readonly string[]).includes(status)) throw new BusinessError(`There is no status called "${status}".`);
  const org = sellerOrg(ctx);
  const row = await db.clientBlueprint.findFirst({ where: { id, organizationId: org } });
  if (!row) throw new BusinessError("That blueprint was not found.");
  const from = row.status as BlueprintStatus;
  if (!NEXT[from]?.includes(status)) throw new BusinessError(`A blueprint cannot go from ${from} to ${status}.`);
  await db.$transaction(async (tx) => {
    // the status is part of the condition, so two people changing it at once cannot both succeed
    const done = await tx.clientBlueprint.updateMany({ where: { id, organizationId: org, status: from }, data: { status } });
    if (done.count !== 1) throw new BusinessError("That blueprint was changed by someone else a moment ago: look again.");
    await logAudit({ ...ctx, orgId: org }, { action: "BLUEPRINT_STATUS_CHANGED", entity: "ClientBlueprint", entityId: id, oldValue: { status: from }, newValue: { status } }, tx);
  });
}
