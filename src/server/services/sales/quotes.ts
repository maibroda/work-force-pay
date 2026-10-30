/**
 * Quotes for a deal: pricing each line against what the guards really cost, the margin, the minimum-margin approval, versions, sending and the client's
 * decision. It only READS payroll rules (through the same lookups payroll uses, at the quote date) and runs the payroll engine in a calculator mode: nothing
 * in payroll changes. Each line saves its cost AND the rule versions it used, so a later rule change never alters a quote. A quote is a DRAFT until it is sent;
 * after that its lines cannot change (the database refuses), and a change is a new version. What the client is shown (quoteDocument) has no cost or margin.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can, type Role } from "@/lib/auth/permissions";
import { estimateHeadCost, type BusinessLine, type HeadCost } from "@/lib/sales/cost-estimator";
import { parseNairaAmount } from "@/lib/sales/money";
import { quotePdf } from "@/lib/sales/quote-pdf";
import { belowMinimum, bpsToPercent, checkHeadcount, checkPersonnel, clientView, marginBps, lineTotals, percentToBps, quoteTotals } from "@/lib/sales/quote";
import { assertCan, BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { nextNumber } from "../numbering";
import { employerCostRuleFor, pensionRuleFor } from "../statutory";
import { toStructureDef } from "../structures";
import { ownerFilter, requireSales, seesAll } from "./access";
import { fireEvent } from "./automation";
import { createHandoverInTx } from "./handover";

/** The share of the bill rate paid to the guard as gross, when a line does not say (the 70:30 split). */
export const DEFAULT_OPERATIVE_SHARE = 70;
const today = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const bad = <T>(f: () => T): T => {
  try {
    return f();
  } catch (e) {
    throw new BusinessError((e as Error).message);
  }
};

// ─────────────────────────────── the minimum margin ───────────────────────────────

export async function getMinimumMargin(ctx: Ctx) {
  await requireSales(ctx, "sales.view");
  const s = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { minMarginBps: true } });
  const bps = s?.minMarginBps ?? 0;
  return { bps, percent: bpsToPercent(bps) };
}

/** The lowest margin a quote may have before a manager must approve it. 0 means none. */
export async function setMinimumMargin(ctx: Ctx, percent: number) {
  assertCan(ctx, "sales.configure");
  const bps = bad(() => percentToBps(percent));
  const before = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { minMarginBps: true } });
  await db.crmSetting.upsert({ where: { organizationId: ctx.orgId }, create: { organizationId: ctx.orgId, minMarginBps: bps, updatedBy: ctx.name }, update: { minMarginBps: bps, updatedBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_MINIMUM_MARGIN", entity: "CrmSetting", entityId: ctx.orgId, oldValue: { bps: before?.minMarginBps ?? 0 }, newValue: { bps } });
  return { bps, percent: bpsToPercent(bps) };
}

// ─────────────────────────────── estimating a line ───────────────────────────────

export const estimateSchema = z.object({
  salaryStructureId: z.string().min(1),
  billRatePerHead: z.union([z.string(), z.number()]),
  operativeSharePct: z.number().min(1, "The share paid to the guard is between 1 and 100 percent").max(100, "The share paid to the guard is between 1 and 100 percent").optional(),
  businessLine: z.enum(["GUARDING", "OUTSOURCING"]).optional(),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type Cache = { structures: Map<string, Awaited<ReturnType<typeof db.salaryStructure.findFirst>>>; rules: Map<string, { pension: Awaited<ReturnType<typeof pensionRuleFor>>; employer: Awaited<ReturnType<typeof employerCostRuleFor>> }> };
const newCache = (): Cache => ({ structures: new Map(), rules: new Map() });

async function estimateIn(ctx: Ctx, tx: Tx | typeof db, raw: z.input<typeof estimateSchema>, cache: Cache = newCache()) {
  const parsed = estimateSchema.safeParse(raw);
  if (!parsed.success) throw new BusinessError(parsed.error.issues[0].message);
  const v = parsed.data;
  let structure = cache.structures.get(v.salaryStructureId);
  if (structure === undefined) {
    structure = await tx.salaryStructure.findFirst({ where: { id: v.salaryStructureId, organizationId: ctx.orgId, status: "ACTIVE" }, include: { components: true } });
    cache.structures.set(v.salaryStructureId, structure);
  }
  if (!structure) throw new BusinessError("Salary structure not found (or not active).");
  const date = v.onDate ? new Date(`${v.onDate}T00:00:00Z`) : today();
  const key = date.toISOString().slice(0, 10);
  let rules = cache.rules.get(key);
  if (!rules) {
    const pension = await pensionRuleFor(tx as Tx, ctx.orgId, date); // in this order, so the first missing rule is the one reported
    const employer = await employerCostRuleFor(tx as Tx, ctx.orgId, date);
    rules = { pension, employer };
    cache.rules.set(key, rules);
  }
  const { pension, employer } = rules;
  const bill = bad(() => parseNairaAmount(v.billRatePerHead, "The bill rate"));
  const share = v.operativeSharePct ?? DEFAULT_OPERATIVE_SHARE;
  const businessLine: BusinessLine = v.businessLine ?? "GUARDING";
  const cost = bad(() =>
    estimateHeadCost({
      structure: toStructureDef(structure as never),
      billRatePerHead: bill,
      operativeSharePct: share,
      businessLine,
      pension: { employeeRate: pension.employeeRate, employerRate: pension.employerRate, version: pension.version },
      employerCostRule: { itfPct: employer.itfPct, nsitfPct: employer.nsitfPct, nhfMedicalPct: employer.nhfMedicalPct, insurancePct: employer.insurancePct, uniformKitsPct: employer.uniformKitsPct, recruitmentTrainingPct: employer.recruitmentTrainingPct, leaveRelieverPct: employer.leaveRelieverPct, outsourcingLeaveAllowancePct: employer.outsourcingLeaveAllowancePct },
    }),
  );
  return { cost, share, businessLine, structureName: structure.name, date, versions: { pension: pension.version, employerCost: employer.version } };
}

/** What one guard of this post costs the company a month, and the margin at this bill rate, from the rules in force on the date. Saves nothing. */
export async function estimateLine(
  ctx: Ctx,
  raw: z.input<typeof estimateSchema> & { headcount?: number; requiredPersonnel?: number },
): Promise<{ cost: HeadCost; versions: { pension: string; employerCost: string }; line: { bill: string; cost: string; margin: string; marginBps: number } | null }> {
  await requireSales(ctx, "sales.view");
  const e = await estimateIn(ctx, db, raw);
  // with the numbers of guards given, the whole line: revenue on the billed guards, cost on the personnel the shifts need
  const line = raw.headcount ? bad(() => lineTotals({ headcount: raw.headcount!, requiredPersonnel: raw.requiredPersonnel, billPerHead: e.cost.billPerHead, costPerHead: e.cost.costPerHead })) : null;
  return { cost: e.cost, versions: e.versions, line: line && { ...line, marginBps: marginBps(line.margin, line.bill) } };
}

// ─────────────────────────────── making and changing a quote ───────────────────────────────

export const lineSchema = z.object({
  siteName: z.string().trim().min(2, "Name the site").max(200),
  siteAddress: z.string().trim().max(400).optional(),
  postLabel: z.string().trim().max(100).optional(),
  shiftPattern: z.string().trim().max(60).optional(),
  salaryStructureId: z.string().min(1),
  /** The guards the client is billed for. */
  headcount: z.number(),
  /** The people needed to cover the agreed shifts (cost follows this); not given means the same as the billed headcount. */
  requiredPersonnel: z.number().optional(),
  billRatePerHead: z.union([z.string(), z.number()]),
  operativeSharePct: z.number().optional(),
  businessLine: z.enum(["GUARDING", "OUTSOURCING"]).optional(),
});
export const quoteSchema = z.object({
  opportunityId: z.string().min(1),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31").optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(lineSchema),
});
export type QuoteInput = z.input<typeof quoteSchema>;

async function visibleDeal(ctx: Ctx, tx: Tx | typeof db, id: string) {
  const o = await tx.crmOpportunity.findFirst({ where: { id, organizationId: ctx.orgId, ...ownerFilter(ctx) }, include: { stage: { select: { stageType: true } } } });
  if (!o) throw new BusinessError("Deal not found.");
  return o;
}

async function loadQuote(ctx: Ctx, tx: Tx | typeof db, id: string) {
  const q = await tx.crmQuote.findFirst({ where: { id, organizationId: ctx.orgId, opportunity: { ...ownerFilter(ctx) } } });
  if (!q) throw new BusinessError("Quote not found.");
  return q;
}

/** Prices every line now and returns the rows to save with the totals. */
async function priceLines(ctx: Ctx, tx: Tx | typeof db, lines: z.output<typeof quoteSchema>["lines"]) {
  if (!lines.length) throw new BusinessError("A quote needs at least one line.");
  const cache = newCache();
  const rows = [];
  let i = 0;
  for (const l of lines) {
    const headcount = bad(() => checkHeadcount(l.headcount));
    const requiredPersonnel = bad(() => checkPersonnel(l.requiredPersonnel ?? headcount));
    const share = l.operativeSharePct ?? DEFAULT_OPERATIVE_SHARE;
    if (!(share >= 1 && share <= 100)) throw new BusinessError("The share paid to the guard is between 1 and 100 percent.");
    const e = await estimateIn(ctx, tx, { salaryStructureId: l.salaryStructureId, billRatePerHead: l.billRatePerHead, operativeSharePct: share, businessLine: l.businessLine }, cache);
    const t = bad(() => lineTotals({ headcount, requiredPersonnel, billPerHead: e.cost.billPerHead, costPerHead: e.cost.costPerHead }));
    rows.push({
      sortOrder: ++i,
      siteName: l.siteName,
      siteAddress: l.siteAddress ?? null,
      postLabel: l.postLabel ?? null,
      shiftPattern: l.shiftPattern ?? null,
      salaryStructureId: l.salaryStructureId,
      structureName: e.structureName,
      businessLine: e.businessLine,
      headcount,
      requiredPersonnel,
      billPerHead: e.cost.billPerHead,
      operativeSharePct: share,
      grossPerHead: e.cost.gross,
      employerCostPerHead: e.cost.employerCosts,
      costPerHead: e.cost.costPerHead,
      lineBill: t.bill,
      lineCost: t.cost,
      lineMargin: t.margin,
      costBreakdown: { employerPension: e.cost.employerPension, pensionBase: e.cost.pensionBase, managementShare: e.cost.managementShare, ...e.cost.addOns },
      ruleVersions: e.versions,
      estimatedOn: e.date,
    });
  }
  const totals = quoteTotals(rows.map((r) => ({ headcount: r.headcount, requiredPersonnel: r.requiredPersonnel, billPerHead: r.billPerHead, costPerHead: r.costPerHead })));
  return { rows, totals };
}

async function minBps(tx: Tx | typeof db, orgId: string) {
  return (await tx.crmSetting.findUnique({ where: { organizationId: orgId }, select: { minMarginBps: true } }))?.minMarginBps ?? 0;
}

export async function createQuote(ctx: Ctx, raw: QuoteInput) {
  await requireSales(ctx, "sales.manage");
  const parsed = quoteSchema.safeParse(raw);
  if (!parsed.success) throw new BusinessError(parsed.error.issues[0].message);
  const v = parsed.data;
  // the pricing only reads, so it is done before the transaction opens (a transaction is cut off after five seconds); the transaction then only writes
  const deal0 = await visibleDeal(ctx, db, v.opportunityId);
  if (deal0.stage.stageType !== "OPEN") throw new BusinessError("A closed deal cannot be quoted.");
  const { rows, totals } = await priceLines(ctx, db, v.lines);
  const min = await minBps(db, ctx.orgId);
  return db.$transaction(async (tx: Tx) => {
    const deal = await visibleDeal(ctx, tx, v.opportunityId);
    if (deal.stage.stageType !== "OPEN") throw new BusinessError("A closed deal cannot be quoted.");
    const number = await nextNumber(tx, ctx.orgId, "SALES_QUOTE");
    const q = await tx.crmQuote.create({
      data: {
        organizationId: ctx.orgId,
        opportunityId: deal.id,
        number,
        versionNo: 1,
        validUntil: v.validUntil ? new Date(`${v.validUntil}T00:00:00Z`) : null,
        notes: v.notes ?? null,
        monthlyBill: totals.monthlyBill,
        monthlyCost: totals.monthlyCost,
        monthlyMargin: totals.monthlyMargin,
        marginBps: totals.marginBps,
        minMarginBpsAtQuote: min,
        belowMinimum: belowMinimum(totals.marginBps, min),
        createdBy: ctx.name,
        createdByUserId: ctx.userId,
        lines: { create: rows },
      },
    });
    await logAudit(ctx, { action: "SALES_QUOTE_CREATE", entity: "CrmQuote", entityId: q.id, newValue: { version: 1, lines: rows.length, belowMinimum: q.belowMinimum } }, tx);
    return q;
  });
}

/** Changes a DRAFT quote (its lines are priced again on today's rules). A sent quote is changed by making a new version. */
export async function saveQuote(ctx: Ctx, id: string, raw: { validUntil?: string; notes?: string; lines?: QuoteInput["lines"] }) {
  await requireSales(ctx, "sales.manage");
  const before = await loadQuote(ctx, db, id);
  if (before.status !== "DRAFT") throw new BusinessError("Only a draft quote can be changed. Make a new version to change a sent one.");
  let priced: Awaited<ReturnType<typeof priceLines>> | null = null;
  let min = 0;
  if (raw.lines) {
    const parsed = z.array(lineSchema).safeParse(raw.lines);
    if (!parsed.success) throw new BusinessError(parsed.error.issues[0].message);
    priced = await priceLines(ctx, db, parsed.data); // reads only, so before the transaction
    min = await minBps(db, ctx.orgId);
  }
  return db.$transaction(async (tx: Tx) => {
    const q = await loadQuote(ctx, tx, id);
    if (q.status !== "DRAFT") throw new BusinessError("Only a draft quote can be changed. Make a new version to change a sent one.");
    const data: Record<string, unknown> = {};
    if (raw.validUntil !== undefined) data.validUntil = raw.validUntil ? new Date(`${raw.validUntil}T00:00:00Z`) : null;
    if (raw.notes !== undefined) data.notes = raw.notes || null;
    if (priced) {
      const { rows, totals } = priced;
      await tx.crmQuoteLine.deleteMany({ where: { quoteId: id } });
      await tx.crmQuoteLine.createMany({ data: rows.map((r) => ({ ...r, quoteId: id })) });
      Object.assign(data, { monthlyBill: totals.monthlyBill, monthlyCost: totals.monthlyCost, monthlyMargin: totals.monthlyMargin, marginBps: totals.marginBps, minMarginBpsAtQuote: min, belowMinimum: belowMinimum(totals.marginBps, min), belowMarginApproved: false, approvedBy: null, approvedByUserId: null, approvedAt: null, approvalNote: null });
    }
    const saved = await tx.crmQuote.update({ where: { id }, data });
    await logAudit(ctx, { action: "SALES_QUOTE_UPDATE", entity: "CrmQuote", entityId: id, newValue: { fields: Object.keys(raw).filter((k) => (raw as Record<string, unknown>)[k] !== undefined).sort() } }, tx);
    return saved;
  });
}

/**
 * A formally DESIGNATED approver, other than the quote's maker, agrees (with a reason) that a quote below the minimum margin may go out. It is checked against
 * the minimum in force NOW, and it is recorded against that minimum, so raising the minimum later means the quote needs approving again.
 */
export async function approveBelowMargin(ctx: Ctx, id: string, note: string) {
  await requireSales(ctx, "sales.manage");
  if (!note.trim()) throw new BusinessError("Give the reason for approving a quote below the minimum margin.");
  return db.$transaction(async (tx: Tx) => {
    const mine = await tx.crmQuoteApprover.findFirst({ where: { organizationId: ctx.orgId, userId: ctx.userId, active: true } });
    if (!mine) {
      const any = await tx.crmQuoteApprover.count({ where: { organizationId: ctx.orgId, active: true } });
      throw new BusinessError(
        any
          ? "Only a designated approver may approve a quote below the minimum margin. The company administrator designates approvers under Sales Settings."
          : "No designated approver has been set up yet, so nobody can approve a quote below the minimum margin. The company administrator designates approvers under Sales Settings.",
      );
    }
    if (!seesAll(ctx)) throw new BusinessError("A designated approver must still be a sales manager; ask the company administrator to review the designation.");
    const q = await loadQuote(ctx, tx, id);
    if (q.status !== "DRAFT") throw new BusinessError("Only a draft quote needs this approval.");
    if (q.createdByUserId === ctx.userId) throw new BusinessError("Someone else must approve a quote you made: you cannot approve your own.");
    const minNow = await minBps(tx, ctx.orgId);
    if (!belowMinimum(q.marginBps, minNow)) throw new BusinessError("This quote is not below the minimum margin, so it needs no approval.");
    const u = await tx.crmQuote.update({ where: { id }, data: { belowMinimum: true, minMarginBpsAtQuote: minNow, belowMarginApproved: true, approvedBy: ctx.name, approvedByUserId: ctx.userId, approvedAt: new Date(), approvalNote: note.trim() } });
    await logAudit(ctx, { action: "SALES_QUOTE_APPROVE_BELOW_MARGIN", entity: "CrmQuote", entityId: id, newValue: { marginBps: q.marginBps, minimumBps: minNow }, reason: note.trim() }, tx);
    return u;
  });
}

// ─────────────────────────────── the designated approvers ───────────────────────────────

export async function listApprovers(ctx: Ctx) {
  await requireSales(ctx, "sales.view");
  return db.crmQuoteApprover.findMany({ where: { organizationId: ctx.orgId, active: true }, orderBy: { userName: "asc" } });
}

/** Names a person as an approver for quotes below the minimum margin. Only the company administrator (who configures sales) does this, and only for an active sales manager. */
export async function designateApprover(ctx: Ctx, userId: string) {
  await requireSales(ctx, "sales.configure");
  const user = await db.user.findFirst({ where: { id: userId, organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true } });
  if (!user) throw new BusinessError("That person is not an active user of this organization.");
  if (!(can(user.role as Role, "sales.manage") && can(user.role as Role, "sales.view.all"))) throw new BusinessError(`${user.name} is not a sales manager (someone who can see and change everyone's sales records), so cannot be a designated approver.`);
  const existing = await db.crmQuoteApprover.findUnique({ where: { organizationId_userId: { organizationId: ctx.orgId, userId } } });
  if (existing?.active) return existing;
  const rec = existing
    ? await db.crmQuoteApprover.update({ where: { id: existing.id }, data: { active: true, userName: user.name, designatedBy: ctx.name, designatedAt: new Date(), removedBy: null, removedAt: null } })
    : await db.crmQuoteApprover.create({ data: { organizationId: ctx.orgId, userId, userName: user.name, designatedBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_QUOTE_APPROVER_DESIGNATE", entity: "CrmQuoteApprover", entityId: rec.id, newValue: { userId } });
  return rec;
}

export async function removeApprover(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.configure");
  const rec = await db.crmQuoteApprover.findFirst({ where: { id, organizationId: ctx.orgId, active: true } });
  if (!rec) throw new BusinessError("Approver not found.");
  await db.crmQuoteApprover.update({ where: { id }, data: { active: false, removedBy: ctx.name, removedAt: new Date() } });
  await logAudit(ctx, { action: "SALES_QUOTE_APPROVER_REMOVE", entity: "CrmQuoteApprover", entityId: id, oldValue: { userId: rec.userId } });
}

export async function sendQuote(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.manage");
  return db.$transaction(async (tx: Tx) => {
    const q = await loadQuote(ctx, tx, id);
    if (q.status !== "DRAFT") throw new BusinessError("Only a draft quote can be sent.");
    if (!(await tx.crmQuoteLine.count({ where: { quoteId: id } }))) throw new BusinessError("A quote needs at least one line.");
    // checked against the minimum in force now: an approval counts only if it was given against this same minimum
    const minNow = await minBps(tx, ctx.orgId);
    const below = belowMinimum(q.marginBps, minNow);
    if (below && !(q.belowMarginApproved && q.minMarginBpsAtQuote === minNow)) throw new BusinessError(`This quote's margin (${bpsToPercent(q.marginBps)}%) is below the minimum (${bpsToPercent(minNow)}%): it needs approval from a designated approver before it can be sent.`);
    const sent = await tx.crmQuote.update({ where: { id }, data: { status: "SENT", sentAt: new Date(), sentBy: ctx.name, minMarginBpsAtQuote: minNow, belowMinimum: below } });
    await tx.crmOpportunity.update({ where: { id: q.opportunityId }, data: { lastActivityAt: new Date() } });
    await logAudit(ctx, { action: "SALES_QUOTE_SEND", entity: "CrmQuote", entityId: id, newValue: { version: q.versionNo } }, tx);
    return sent;
  });
}

/** A new draft version of a sent, accepted or rejected quote (the live one), priced again on today's rules; the earlier version is marked superseded. */
export async function reviseQuote(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.manage");
  const q0 = await loadQuote(ctx, db, id);
  if (!["SENT", "REJECTED", "ACCEPTED"].includes(q0.status)) throw new BusinessError("Only the latest sent, accepted or rejected version can be revised.");
  if (await db.crmHandover.count({ where: { opportunityId: q0.opportunityId } })) throw new BusinessError("A handover to Operations has been started from this deal's accepted quote, so the quote can no longer be revised.");
  const old = await db.crmQuoteLine.findMany({ where: { quoteId: id }, orderBy: { sortOrder: "asc" } });
  const input = old.map((l) => ({ siteName: l.siteName, siteAddress: l.siteAddress ?? undefined, postLabel: l.postLabel ?? undefined, shiftPattern: l.shiftPattern ?? undefined, salaryStructureId: l.salaryStructureId, headcount: l.headcount, requiredPersonnel: l.requiredPersonnel, billRatePerHead: l.billPerHead.toString(), operativeSharePct: Number(l.operativeSharePct), businessLine: l.businessLine as "GUARDING" | "OUTSOURCING" }));
  const { rows, totals } = await priceLines(ctx, db, input); // reads only, so before the transaction
  const min = await minBps(db, ctx.orgId);
  return db.$transaction(async (tx: Tx) => {
    const q = await loadQuote(ctx, tx, id);
    if (!["SENT", "REJECTED", "ACCEPTED"].includes(q.status)) throw new BusinessError("Only the latest sent, accepted or rejected version can be revised.");
    await tx.crmQuote.update({ where: { id }, data: { status: "SUPERSEDED" } });
    const v2 = await tx.crmQuote.create({
      data: {
        organizationId: ctx.orgId, opportunityId: q.opportunityId, number: q.number, versionNo: q.versionNo + 1, validUntil: q.validUntil, notes: q.notes,
        monthlyBill: totals.monthlyBill, monthlyCost: totals.monthlyCost, monthlyMargin: totals.monthlyMargin, marginBps: totals.marginBps, minMarginBpsAtQuote: min, belowMinimum: belowMinimum(totals.marginBps, min),
        createdBy: ctx.name, createdByUserId: ctx.userId, lines: { create: rows },
      },
    });
    await logAudit(ctx, { action: "SALES_QUOTE_REVISE", entity: "CrmQuote", entityId: v2.id, newValue: { fromVersion: q.versionNo, version: v2.versionNo } }, tx);
    return v2;
  });
}

/** The client's answer to a sent quote. Accepting copies its monthly total into the deal's value; only one quote of a deal can be accepted. */
export async function decideQuote(ctx: Ctx, id: string, decision: "ACCEPTED" | "REJECTED", note?: string) {
  await requireSales(ctx, "sales.manage");
  const result = await db.$transaction(async (tx: Tx) => {
    const q = await loadQuote(ctx, tx, id);
    if (q.status !== "SENT") throw new BusinessError("Only a sent quote can be accepted or rejected.");
    if (decision === "ACCEPTED" && (await tx.crmQuote.count({ where: { opportunityId: q.opportunityId, status: "ACCEPTED" } })))
      throw new BusinessError("Another quote for this deal has already been accepted.");
    const u = await tx.crmQuote.update({ where: { id }, data: { status: decision, decidedAt: new Date(), decidedBy: ctx.name, decisionNote: note?.trim() || null } });
    if (decision === "ACCEPTED") {
      await tx.crmOpportunity.update({ where: { id: q.opportunityId }, data: { monthlyContractValue: q.monthlyBill, lastActivityAt: new Date() } });
      await createHandoverInTx(ctx, tx, u); // the client's acceptance starts the handover to Operations (a draft: nothing exists in Operations until it is accepted there)
    }
    await logAudit(ctx, { action: "SALES_QUOTE_DECIDE", entity: "CrmQuote", entityId: id, newValue: { decision } }, tx);
    return u;
  }, { timeout: 20_000, maxWait: 10_000 }); // accepting also starts the handover (a site and its posts for each site on the quote), which is more than five seconds of work on a busy server
  if (decision === "ACCEPTED") await fireEvent(ctx.orgId, "QUOTE_ACCEPTED", result.opportunityId, result.id); // rules for this event run after the acceptance is saved; never throws
  return result;
}

export async function getQuote(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.view");
  const q = await loadQuote(ctx, db, id);
  const lines = await db.crmQuoteLine.findMany({ where: { quoteId: id }, orderBy: { sortOrder: "asc" } });
  return { ...q, lines };
}

export async function listQuotes(ctx: Ctx, opportunityId: string) {
  await requireSales(ctx, "sales.view");
  await visibleDeal(ctx, db, opportunityId);
  return db.crmQuote.findMany({ where: { organizationId: ctx.orgId, opportunityId }, orderBy: [{ versionNo: "desc" }, { createdAt: "desc" }] });
}

/** Everything the CLIENT may be shown of a quote: sites, posts, guards, bill rates, totals, validity and notes. No cost, no margin, no rules. */
export async function quoteDocument(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.view");
  const q = await loadQuote(ctx, db, id);
  const [lines, deal] = await Promise.all([
    db.crmQuoteLine.findMany({ where: { quoteId: id }, orderBy: { sortOrder: "asc" }, select: { siteName: true, siteAddress: true, postLabel: true, shiftPattern: true, headcount: true, billPerHead: true } }),
    db.crmOpportunity.findUniqueOrThrow({ where: { id: q.opportunityId }, select: { account: { select: { name: true } } } }),
  ]);
  const view = clientView(lines.map((l) => ({ ...l, billPerHead: l.billPerHead.toString() })));
  return { number: q.number, versionNo: q.versionNo, accountName: deal.account.name, rows: view.rows, total: view.total, validUntil: q.validUntil ? q.validUntil.toISOString().slice(0, 10) : null, notes: q.notes, draft: q.status === "DRAFT" };
}

/** The client's quote as a PDF, with its file name. Every download is audited (ids only). */
export async function quotePdfFile(ctx: Ctx, id: string) {
  const doc = await quoteDocument(ctx, id);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const bytes = await quotePdf({ ...doc, companyName: org.name, issuedOn: new Date().toISOString().slice(0, 10) });
  await logAudit(ctx, { action: "SALES_QUOTE_DOWNLOAD", entity: "CrmQuote", entityId: id, newValue: { version: doc.versionNo } });
  return { bytes, fileName: `quote-${doc.number}${doc.versionNo > 1 ? `-v${doc.versionNo}` : ""}.pdf` };
}
