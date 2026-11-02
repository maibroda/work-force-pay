/**
 * Pipelines, their stages, and deals (opportunities). The "New business" pipeline is created the first time the module is switched on. A deal starts
 * in its pipeline's first open stage, takes that stage's probability, and gets a stage-history row (history is append-only). Stage gates and the
 * board come in a later phase; the stages already store which fields they will require.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { parseNairaAmount } from "@/lib/sales/money";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { ownerFilter, requireSales, resolveOwner } from "./access";
import { visibleAccount, visibleContact } from "./loaders";

type Client = Tx | typeof db;

const NEW_BUSINESS_STAGES: Array<{ name: string; probability: number; type: "OPEN" | "WON" | "LOST"; required: string[] }> = [
  { name: "Lead in", probability: 10, type: "OPEN", required: [] },
  { name: "Qualified", probability: 20, type: "OPEN", required: [] },
  { name: "Site survey", probability: 35, type: "OPEN", required: ["expectedStartDate", "contact"] },
  { name: "Proposal sent", probability: 50, type: "OPEN", required: ["quote"] },
  { name: "Negotiation", probability: 70, type: "OPEN", required: [] },
  { name: "Contract signing", probability: 85, type: "OPEN", required: [] },
  { name: "Won", probability: 100, type: "WON", required: ["monthlyContractValue", "contractTermMonths", "expectedStartDate"] },
  { name: "Lost", probability: 0, type: "LOST", required: ["lostReason"] },
];

/** Creates the organization's default "New business" pipeline if it has none. Safe to call again. The probabilities are starting values the organization can edit. */
export async function ensureDefaultPipelines(orgId: string, tx: Client = db) {
  const have = await tx.crmPipeline.findFirst({ where: { organizationId: orgId, kind: "NEW_BUSINESS" }, select: { id: true } });
  if (have) return have.id;
  const p = await tx.crmPipeline.create({
    data: {
      organizationId: orgId,
      name: "New business",
      kind: "NEW_BUSINESS",
      isDefault: true,
      stages: { create: NEW_BUSINESS_STAGES.map((s, i) => ({ name: s.name, sortOrder: i + 1, stageType: s.type, defaultProbability: s.probability, requiredFields: s.required })) },
    },
  });
  return p.id;
}

export async function listPipelines(ctx: Ctx) {
  await requireSales(ctx, "sales.view");
  return db.crmPipeline.findMany({ where: { organizationId: ctx.orgId, active: true }, orderBy: { sortOrder: "asc" }, include: { stages: { where: { active: true }, orderBy: { sortOrder: "asc" } } } });
}

export const opportunitySchema = z.object({
  accountId: z.string().min(1, "Choose the account"),
  primaryContactId: z.string().optional(),
  name: z.string().trim().min(2, "Give the deal a name").max(200),
  serviceType: z.enum(["GUARDING", "CLEANING", "FACILITY", "STAFFING", "OTHER"]).optional(),
  monthlyContractValue: z.union([z.string(), z.number()]).optional(),
  pipelineId: z.string().optional(),
  expectedCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31").optional(),
  source: z.enum(["REFERRAL", "WALK_IN", "PHONE", "WEBSITE", "WHATSAPP", "TENDER", "EVENT", "EXISTING_CLIENT", "OTHER"]).optional(),
  sourceDetail: z.string().trim().max(200).optional(),
  ownerUserId: z.string().optional(),
});

/** Creates a deal inside a transaction the caller controls (lead conversion uses this too). Ownership is decided by the caller. */
export async function insertOpportunity(
  ctx: Ctx,
  tx: Client,
  v: Omit<z.output<typeof opportunitySchema>, "ownerUserId"> & { ownerUserId: string; ownerName: string; fromLeadId?: string },
) {
  let value: string;
  try {
    value = parseNairaAmount(v.monthlyContractValue, "A deal's value");
  } catch (e) {
    throw new BusinessError((e as Error).message);
  }
  // an organization that switched the module on before pipelines existed gets the starting pipeline with its first deal
  if (!v.pipelineId) await ensureDefaultPipelines(ctx.orgId, tx);
  const pipeline = v.pipelineId
    ? await tx.crmPipeline.findFirst({ where: { id: v.pipelineId, organizationId: ctx.orgId, active: true }, include: { stages: { where: { active: true, stageType: "OPEN" }, orderBy: { sortOrder: "asc" }, take: 1 } } })
    : await tx.crmPipeline.findFirst({ where: { organizationId: ctx.orgId, kind: "NEW_BUSINESS", active: true }, orderBy: { isDefault: "desc" }, include: { stages: { where: { active: true, stageType: "OPEN" }, orderBy: { sortOrder: "asc" }, take: 1 } } });
  if (!pipeline) throw new BusinessError("Pipeline not found.");
  const stage = pipeline.stages[0];
  if (!stage) throw new BusinessError("That pipeline has no open stage to start a deal in.");
  const o = await tx.crmOpportunity.create({
    data: {
      organizationId: ctx.orgId,
      accountId: v.accountId,
      primaryContactId: v.primaryContactId ?? null,
      pipelineId: pipeline.id,
      stageId: stage.id,
      name: v.name,
      serviceType: v.serviceType ?? "OTHER",
      monthlyContractValue: value,
      probability: stage.defaultProbability,
      expectedCloseDate: v.expectedCloseDate ? new Date(`${v.expectedCloseDate}T00:00:00Z`) : null,
      source: v.source ?? null,
      sourceDetail: v.sourceDetail ?? null,
      ownerUserId: v.ownerUserId,
      ownerName: v.ownerName,
      fromLeadId: v.fromLeadId ?? null,
      createdBy: ctx.name,
    },
  });
  await tx.crmStageHistory.create({ data: { organizationId: ctx.orgId, opportunityId: o.id, fromStageId: null, toStageId: stage.id, changedBy: ctx.name, changedByUserId: ctx.userId } });
  await logAudit(ctx, { action: "SALES_OPPORTUNITY_CREATE", entity: "CrmOpportunity", entityId: o.id, newValue: { stage: stage.name, fromLead: !!v.fromLeadId } }, tx);
  return o;
}

export async function createOpportunity(ctx: Ctx, raw: z.input<typeof opportunitySchema>) {
  await requireSales(ctx, "sales.manage");
  const v = opportunitySchema.parse(raw);
  const owner = await resolveOwner(ctx, v.ownerUserId);
  return db.$transaction(async (tx) => {
    await visibleAccount(ctx, tx, v.accountId);
    if (v.primaryContactId) await visibleContact(ctx, tx, v.primaryContactId);
    return insertOpportunity(ctx, tx, { ...v, ...owner });
  });
}

export async function listOpportunities(ctx: Ctx, f: { accountId?: string } = {}) {
  await requireSales(ctx, "sales.view");
  return db.crmOpportunity.findMany({
    where: { organizationId: ctx.orgId, status: "ACTIVE", ...ownerFilter(ctx), ...(f.accountId ? { accountId: f.accountId } : {}) },
    orderBy: { createdAt: "desc" },
    include: { stage: { select: { name: true, stageType: true } }, account: { select: { name: true } } },
    take: 500,
  });
}
