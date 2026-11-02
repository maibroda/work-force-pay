/**
 * Working a deal through its pipeline: moving it between stages (with the stage's requirements, a next step every time, and a reason when it is lost),
 * editing its details, the board of columns and cards, and the forecast. Every move writes a permanent stage-history row and an audit entry carrying ids and
 * stage names only. Won and lost are final: a closed deal is not moved or edited. A sales person works their own deals; a manager works everyone's.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { checkProbability, forecastByCloseMonth, totalsOf, weightedValueKobo } from "@/lib/sales/forecast";
import { missingForStage } from "@/lib/sales/gates";
import { parseNairaAmount } from "@/lib/sales/money";
import { koboToString, toKobo } from "@/lib/money-exact";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { ownerFilter, requireSales } from "./access";
import { visibleContact } from "./loaders";

/** A card on an open stage is flagged when the deal has had no activity for this many days (a stage may set its own). */
export const DEFAULT_ROTTING_DAYS = 14;
const DAY = 86_400_000;
export const LOST_REASONS = ["PRICE", "QUALITY", "RELATIONSHIP", "INCUMBENT_RETAINED", "NO_DECISION", "BUDGET", "OTHER"] as const;

const probability = (p: number) => {
  try {
    return checkProbability(p);
  } catch (e) {
    throw new BusinessError((e as Error).message);
  }
};
const dateOf = (s: string | undefined | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

async function loadDeal(ctx: Ctx, tx: Tx | typeof db, id: string) {
  const o = await tx.crmOpportunity.findFirst({ where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) }, include: { stage: true } });
  if (!o) throw new BusinessError("Deal not found.");
  return o;
}
const assertOpen = (o: { stage: { stageType: string; name: string } }) => {
  if (o.stage.stageType !== "OPEN") throw new BusinessError(`This deal is closed (${o.stage.stageType === "WON" ? "won" : "lost"}) and can no longer be changed or moved.`);
};

export const moveSchema = z.object({
  stageId: z.string().min(1),
  /** What happens next: required on every move, so no deal moves without a plan. */
  nextStep: z.string().trim().min(3, "Say what the next step is (required every time a deal moves)").max(300),
  /** The owner may set the probability for an open stage; won is always 100 and lost 0. */
  probability: z.number().optional(),
  lostReason: z.enum(LOST_REASONS).optional(),
  lostReasonDetail: z.string().trim().max(400).optional(),
  competitor: z.string().trim().max(200).optional(),
});

export async function moveOpportunity(ctx: Ctx, id: string, raw: z.input<typeof moveSchema>) {
  await requireSales(ctx, "sales.manage");
  const parsed = moveSchema.safeParse(raw);
  if (!parsed.success) throw new BusinessError(parsed.error.issues[0].message);
  const v = parsed.data;
  const override = v.probability === undefined ? undefined : probability(v.probability);

  return db.$transaction(async (tx: Tx) => {
    const deal = await loadDeal(ctx, tx, id);
    assertOpen(deal);
    const stage = await tx.crmStage.findFirst({ where: { id: v.stageId, active: true, pipelineId: deal.pipelineId, pipeline: { organizationId: ctx.orgId } } });
    if (!stage) throw new BusinessError("Stage not found in this deal's pipeline.");
    if (stage.id === deal.stageId) throw new BusinessError(`The deal is already in "${stage.name}".`);
    const accountContactCount = await tx.crmContact.count({ where: { organizationId: ctx.orgId, accountId: deal.accountId, status: "ACTIVE" } });
    const required = Array.isArray(stage.requiredFields) ? (stage.requiredFields as string[]) : [];
    const missing = missingForStage(required, {
      monthlyContractValue: deal.monthlyContractValue,
      expectedStartDate: deal.expectedStartDate,
      contractTermMonths: deal.contractTermMonths,
      primaryContactId: deal.primaryContactId,
      accountContactCount,
      lostReason: v.lostReason ?? deal.lostReason,
      // a quote counts once it has been sent to the client (a draft does not), or accepted
      hasQuote: (await tx.crmQuote.count({ where: { opportunityId: id, organizationId: ctx.orgId, status: { in: ["SENT", "ACCEPTED"] } } })) > 0,
    });
    if (missing.length) throw new BusinessError(`To move this deal to "${stage.name}" you still need: ${missing.join("; ")}.`);

    const now = new Date();
    const closing = stage.stageType !== "OPEN";
    const lastMove = await tx.crmStageHistory.findFirst({ where: { opportunityId: id }, orderBy: [{ changedAt: "desc" }, { id: "desc" }], select: { changedAt: true } });
    const days = Math.max(0, Math.floor((now.getTime() - (lastMove?.changedAt ?? deal.createdAt).getTime()) / DAY));
    const moved = await tx.crmOpportunity.update({
      where: { id },
      data: {
        stageId: stage.id,
        stageEnteredAt: now,
        lastActivityAt: now,
        nextStep: v.nextStep,
        probability: stage.stageType === "WON" ? 100 : stage.stageType === "LOST" ? 0 : (override ?? stage.defaultProbability),
        ...(stage.stageType === "WON" ? { wonAt: now } : {}),
        ...(stage.stageType === "LOST" ? { lostAt: now, lostReason: v.lostReason, lostReasonDetail: v.lostReasonDetail ?? null } : {}),
        ...(v.competitor ? { competitor: v.competitor } : {}),
      },
    });
    await tx.crmStageHistory.create({ data: { organizationId: ctx.orgId, opportunityId: id, fromStageId: deal.stageId, toStageId: stage.id, changedBy: ctx.name, changedByUserId: ctx.userId, daysInPreviousStage: days } });
    await logAudit(ctx, { action: "SALES_OPPORTUNITY_MOVE", entity: "CrmOpportunity", entityId: id, newValue: { from: deal.stage.name, to: stage.name, closed: closing } }, tx);
    return moved;
  });
}

export const updateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  monthlyContractValue: z.union([z.string(), z.number()]).optional(),
  probability: z.number().optional(),
  expectedCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31").optional(),
  expectedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31").optional(),
  contractTermMonths: z.number().int().min(1).max(240).optional(),
  competitor: z.string().trim().max(200).optional(),
  nextStep: z.string().trim().max(300).optional(),
  primaryContactId: z.string().optional(),
});

export async function updateOpportunity(ctx: Ctx, id: string, raw: z.input<typeof updateSchema>) {
  await requireSales(ctx, "sales.manage");
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) throw new BusinessError(parsed.error.issues[0].message);
  const v = parsed.data;
  return db.$transaction(async (tx: Tx) => {
    const deal = await loadDeal(ctx, tx, id);
    assertOpen(deal);
    let value: string | undefined;
    if (v.monthlyContractValue !== undefined) {
      try {
        value = parseNairaAmount(v.monthlyContractValue, "A deal's value");
      } catch (e) {
        throw new BusinessError((e as Error).message);
      }
    }
    if (v.primaryContactId) await visibleContact(ctx, tx, v.primaryContactId);
    const u = await tx.crmOpportunity.update({
      where: { id },
      data: {
        ...(v.name ? { name: v.name } : {}),
        ...(value !== undefined ? { monthlyContractValue: value } : {}),
        ...(v.probability !== undefined ? { probability: probability(v.probability) } : {}),
        ...(v.expectedCloseDate ? { expectedCloseDate: dateOf(v.expectedCloseDate) } : {}),
        ...(v.expectedStartDate ? { expectedStartDate: dateOf(v.expectedStartDate) } : {}),
        ...(v.contractTermMonths ? { contractTermMonths: v.contractTermMonths } : {}),
        ...(v.competitor !== undefined ? { competitor: v.competitor || null } : {}),
        ...(v.nextStep !== undefined ? { nextStep: v.nextStep || null } : {}),
        ...(v.primaryContactId ? { primaryContactId: v.primaryContactId } : {}),
        lastActivityAt: new Date(), // any change to a deal is activity on it
      },
    });
    await logAudit(ctx, { action: "SALES_OPPORTUNITY_UPDATE", entity: "CrmOpportunity", entityId: id, newValue: { fields: Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort() } }, tx);
    return u;
  });
}

export async function getOpportunity(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.view");
  const o = await db.crmOpportunity.findFirst({
    where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) },
    include: { stage: true, account: { select: { id: true, name: true } }, primaryContact: { select: { id: true, firstName: true, lastName: true } }, pipeline: { include: { stages: { where: { active: true }, orderBy: { sortOrder: "asc" } } } } },
  });
  if (!o) throw new BusinessError("Deal not found.");
  const history = await db.crmStageHistory.findMany({ where: { opportunityId: id }, orderBy: [{ changedAt: "asc" }, { id: "asc" }] });
  const { pipeline, ...opportunity } = o;
  return { opportunity, stages: pipeline.stages, history };
}

/** The board of one pipeline: a column per stage with its cards, exact totals per column, and the forecast of open deals by expected close month. */
export async function board(ctx: Ctx, pipelineId?: string) {
  await requireSales(ctx, "sales.view");
  const pipeline = await db.crmPipeline.findFirst({
    where: { organizationId: ctx.orgId, active: true, ...(pipelineId ? { id: pipelineId } : { kind: "NEW_BUSINESS" }) },
    orderBy: { isDefault: "desc" },
    include: { stages: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!pipeline) throw new BusinessError("Pipeline not found.");
  const deals = await db.crmOpportunity.findMany({ where: { organizationId: ctx.orgId, pipelineId: pipeline.id, status: "ACTIVE", ...ownerFilter(ctx) }, include: { account: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  const now = Date.now();
  const columns = pipeline.stages.map((stage) => {
    const here = deals.filter((d) => d.stageId === stage.id);
    return {
      stage: { id: stage.id, name: stage.name, stageType: stage.stageType, defaultProbability: stage.defaultProbability },
      totals: totalsOf(here),
      deals: here.map((d) => ({
        id: d.id,
        name: d.name,
        accountName: d.account.name,
        ownerName: d.ownerName,
        monthlyContractValue: koboToString(toKobo(d.monthlyContractValue)),
        probability: d.probability,
        weighted: koboToString(weightedValueKobo(d.monthlyContractValue, d.probability)),
        expectedCloseDate: d.expectedCloseDate,
        nextStep: d.nextStep,
        daysInStage: Math.max(0, Math.floor((now - d.stageEnteredAt.getTime()) / DAY)),
        rotting: stage.stageType === "OPEN" && now - d.lastActivityAt.getTime() > (stage.rottingDays ?? DEFAULT_ROTTING_DAYS) * DAY,
      })),
    };
  });
  const open = deals.filter((d) => pipeline.stages.find((s) => s.id === d.stageId)?.stageType === "OPEN");
  return { pipeline: { id: pipeline.id, name: pipeline.name }, columns, forecast: forecastByCloseMonth(open.map((d) => ({ monthlyContractValue: d.monthlyContractValue, probability: d.probability, expectedCloseDate: d.expectedCloseDate }))) };
}
