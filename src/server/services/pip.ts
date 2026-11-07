/**
 * Performance improvement plans (PIPs): a structured plan, run by HR, to bring one employee's performance up to the standard.
 *
 * HR drafts a plan (concerns, dates, an owner, objectives) and submits it; a SECOND person starts it. The plan owner records reviews at milestones; the owner (or HR)
 * proposes an outcome (Successful, Extended or Unsuccessful) and a SECOND person approves it. The employee sees the plan once it has started, acknowledges it
 * (Agree, or Disagree with a reason) and may add a comment to each review. Nothing here changes pay, status or discipline: an Unsuccessful outcome is only recorded.
 *
 * Plans are personal and sensitive: they need pip.view (HR, the company administrator, the auditor) and are never part of hr.view. The audit log carries ids and
 * field names only, never what the concerns, notes or comments say, so a person can be erased without touching the append-only log.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import {
  approverConflict,
  checkExtension,
  checkLength,
  employeeMaySee,
  isOpen,
  nextReviewDue as nextReviewDueOf,
  nextStatus,
  OPEN_STATUSES,
  planEnd,
  reviewState,
  type PipLimits,
  type PipStatus,
} from "@/lib/pip";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy } from "./hr-policy";

const text = (min: number, max: number, what: string) => z.string().trim().min(min, `${what} is needed`).max(max);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30");
const todayIso = () => iso(new Date());
const NOT_FOUND = "Plan not found.";

const limitsOf = (p: Awaited<ReturnType<typeof getHrPolicy>>): PipLimits => ({
  defaultDays: p.pipDefaultDays,
  maxDays: p.pipMaxDays,
  maxExtensions: p.pipMaxExtensions,
  maxExtensionDays: p.pipMaxExtensionDays,
  reviewIntervalDays: p.pipReviewIntervalDays,
});

const PLAN_INCLUDE = {
  employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, status: true } },
  objectives: { orderBy: { sortOrder: "asc" as const } },
  reviews: { orderBy: [{ reviewedOn: "asc" as const }, { createdAt: "asc" as const }], include: { assessments: true } },
} satisfies Prisma.PerformanceImprovementPlanInclude;

async function load(ctx: Ctx, id: string, tx: Tx = db) {
  const p = await tx.performanceImprovementPlan.findFirst({ where: { id, organizationId: ctx.orgId }, include: PLAN_INCLUDE });
  if (!p) throw new BusinessError(NOT_FOUND);
  return p;
}
type Loaded = Awaited<ReturnType<typeof load>>;

/** The owner of a plan must be an active person in this company whose role can run plans. */
async function checkOwner(ctx: Ctx, userId: string) {
  const u = await db.user.findFirst({ where: { id: userId, organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true } });
  if (!u || !can(u.role, "pip.manage")) throw new BusinessError("The plan owner must be an active person in this company who can run plans.");
  return u;
}

/** The result of each objective is its latest assessment (a review never edits an earlier one). */
function withResults(p: Loaded) {
  const latest = new Map<string, { result: string; note: string | null }>();
  for (const r of p.reviews) for (const a of r.assessments) latest.set(a.objectiveId, { result: a.result, note: a.note });
  return p.objectives.map((o) => ({ ...o, result: latest.get(o.id)?.result ?? "OPEN", resultNote: latest.get(o.id)?.note ?? null }));
}

// ───────────────────────────── Drafting ─────────────────────────────

export const planSchema = z.object({
  employeeId: z.string().min(1),
  concerns: text(10, 4000, "The concerns"),
  startDate: day,
  days: z.coerce.number().int().optional(),
  ownerUserId: z.string().min(1, "Choose the plan owner"),
  appraisalId: z.string().optional(),
});

export async function createPlan(ctx: Ctx, raw: z.input<typeof planSchema>) {
  assertCan(ctx, "pip.manage");
  const v = planSchema.parse(raw);
  const policy = await getHrPolicy(ctx.orgId);
  const limits = limitsOf(policy);
  const days = v.days ?? limits.defaultDays;
  const bad = checkLength(days, limits);
  if (bad) throw new BusinessError(bad);
  const owner = await checkOwner(ctx, v.ownerUserId);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId }, select: { id: true, status: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (emp.status !== "ACTIVE" && emp.status !== "ON_LEAVE") throw new BusinessError("This employee is no longer active, so a plan cannot be drafted.");
  if (v.appraisalId) {
    const a = await db.appraisal.findFirst({ where: { id: v.appraisalId, organizationId: ctx.orgId, employeeId: emp.id }, select: { id: true } });
    if (!a) throw new BusinessError("Appraisal not found.");
  }
  const end = d(planEnd(v.startDate, days));
  const plan = await db.$transaction(async (tx) => {
    // lock the employee's row so two drafts at once cannot both pass the one-open-plan check
    await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${emp.id} FOR UPDATE`;
    const open = await tx.performanceImprovementPlan.findFirst({ where: { organizationId: ctx.orgId, employeeId: emp.id, status: { in: [...OPEN_STATUSES] as never } }, select: { id: true } });
    if (open) throw new BusinessError("This employee already has an open plan: close or withdraw it before drafting another.");
    const created = await tx.performanceImprovementPlan.create({
      data: {
        organizationId: ctx.orgId,
        employeeId: emp.id,
        appraisalId: v.appraisalId ?? null,
        concerns: v.concerns,
        startDate: d(v.startDate),
        endDate: end,
        originalEndDate: end,
        ownerUserId: owner.id,
        ownerName: owner.name,
        draftedByUserId: ctx.userId,
        draftedBy: ctx.name,
      },
    });
    await logAudit(ctx, { action: "PIP_CREATE", entity: "PerformanceImprovementPlan", entityId: created.id, newValue: { employeeId: emp.id, ownerUserId: owner.id, startDate: v.startDate, endDate: iso(end), appraisalId: v.appraisalId ?? null } }, tx);
    return created;
  });
  return plan;
}

/** Starts a draft from an approved appraisal that recommended a plan: copies the improvement text. Never automatic. */
export async function planFromAppraisal(ctx: Ctx, appraisalId: string, raw: { startDate: string; days?: number; ownerUserId: string }) {
  assertCan(ctx, "pip.manage");
  const a = await db.appraisal.findFirst({ where: { id: appraisalId, organizationId: ctx.orgId } });
  if (!a) throw new BusinessError("Appraisal not found.");
  if (a.status !== "APPROVED" && a.status !== "ACKNOWLEDGED") throw new BusinessError("Only an approved appraisal can start a plan.");
  if (a.recommendation !== "PERFORMANCE_PLAN") throw new BusinessError("This appraisal did not recommend a performance improvement plan.");
  const concerns = a.improvements?.trim();
  if (!concerns) throw new BusinessError("This appraisal has no areas to improve to copy: draft the plan and describe the concerns yourself.");
  return createPlan(ctx, { employeeId: a.employeeId, concerns, startDate: raw.startDate, days: raw.days, ownerUserId: raw.ownerUserId, appraisalId });
}

export const planEditSchema = z
  .object({ concerns: text(10, 4000, "The concerns"), startDate: day, days: z.coerce.number().int(), ownerUserId: z.string().min(1) })
  .partial();

export async function updatePlan(ctx: Ctx, id: string, raw: z.input<typeof planEditSchema>) {
  assertCan(ctx, "pip.manage");
  const v = planEditSchema.parse(raw);
  const p = await load(ctx, id);
  if (p.status !== "DRAFT") throw new BusinessError("Only a draft can be edited.");
  const limits = limitsOf(await getHrPolicy(ctx.orgId));
  const data: Record<string, unknown> = {};
  if (v.concerns !== undefined) data.concerns = v.concerns;
  if (v.ownerUserId !== undefined) {
    const o = await checkOwner(ctx, v.ownerUserId);
    data.ownerUserId = o.id;
    data.ownerName = o.name;
  }
  if (v.startDate !== undefined || v.days !== undefined) {
    const start = v.startDate ?? iso(p.startDate);
    const days = v.days ?? Math.round((p.endDate.getTime() - p.startDate.getTime()) / 86_400_000);
    const bad = checkLength(days, limits);
    if (bad) throw new BusinessError(bad);
    const end = d(planEnd(start, days));
    for (const o of p.objectives) if (o.dueDate < d(start) || o.dueDate > end) throw new BusinessError("An objective's due date would fall outside the new dates: change or remove it first.");
    data.startDate = d(start);
    data.endDate = end;
    data.originalEndDate = end;
  }
  const u = await db.performanceImprovementPlan.update({ where: { id }, data });
  await logAudit(ctx, { action: "PIP_UPDATE", entity: "PerformanceImprovementPlan", entityId: id, newValue: { fields: Object.keys(data) } });
  return u;
}

export const objectiveSchema = z.object({ gap: text(3, 1000, "The gap"), target: text(3, 1000, "The target"), support: z.string().trim().max(1000).optional().transform((x) => x || undefined), dueDate: day });

export async function addObjective(ctx: Ctx, planId: string, raw: z.input<typeof objectiveSchema>) {
  assertCan(ctx, "pip.manage");
  const v = objectiveSchema.parse(raw);
  const p = await load(ctx, planId);
  if (p.status !== "DRAFT") throw new BusinessError("Objectives can only be added while the plan is a draft.");
  const due = d(v.dueDate);
  if (due < p.startDate || due > p.endDate) throw new BusinessError("The due date must be between the start and end of the plan.");
  const o = await db.pipObjective.create({ data: { organizationId: ctx.orgId, planId, sortOrder: p.objectives.length, gap: v.gap, target: v.target, support: v.support ?? null, dueDate: due } });
  await logAudit(ctx, { action: "PIP_OBJECTIVE_ADD", entity: "PipObjective", entityId: o.id, newValue: { planId } });
  return o;
}

export async function removeObjective(ctx: Ctx, objectiveId: string) {
  assertCan(ctx, "pip.manage");
  const o = await db.pipObjective.findFirst({ where: { id: objectiveId, organizationId: ctx.orgId }, include: { plan: { select: { status: true } } } });
  if (!o) throw new BusinessError("Objective not found.");
  if (o.plan.status !== "DRAFT") throw new BusinessError("Objectives can only be removed while the plan is a draft.");
  await db.pipObjective.delete({ where: { id: objectiveId } });
  await logAudit(ctx, { action: "PIP_OBJECTIVE_REMOVE", entity: "PipObjective", entityId: objectiveId, newValue: { planId: o.planId } });
}

export async function submitPlan(ctx: Ctx, id: string) {
  assertCan(ctx, "pip.manage");
  const p = await load(ctx, id);
  const next = nextStatus(p.status as PipStatus, "SUBMIT");
  if (!next) throw new BusinessError(`Only a draft can be submitted (this one is ${p.status.toLowerCase().replace(/_/g, " ")}).`);
  if (!p.objectives.length) throw new BusinessError("Add at least one objective before submitting the plan.");
  const u = await db.performanceImprovementPlan.update({ where: { id }, data: { status: next, submittedAt: new Date(), returnNote: null } });
  await logAudit(ctx, { action: "PIP_SUBMIT", entity: "PerformanceImprovementPlan", entityId: id, newValue: { employeeId: p.employeeId } });
  return u;
}

// ───────────────────────────── Starting: a second person approves ─────────────────────────────

export async function approveStart(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "pip.approve");
  const p = await load(ctx, id);
  const next = nextStatus(p.status as PipStatus, "APPROVE_START");
  if (!next) throw new BusinessError(`This plan is not awaiting approval to start (it is ${p.status.toLowerCase().replace(/_/g, " ")}).`);
  const conflict = approverConflict("APPROVE_START", { drafterId: p.draftedByUserId, ownerId: p.ownerUserId }, ctx.userId);
  if (conflict) throw new BusinessError(conflict);
  const limits = limitsOf(await getHrPolicy(ctx.orgId));
  const u = await db.performanceImprovementPlan.update({
    where: { id },
    data: { status: next, activatedAt: new Date(), activatedBy: ctx.name, activatedByUserId: ctx.userId, activationNote: note?.trim() || null, nextReviewDue: d(nextReviewDueOf(iso(p.startDate), iso(p.endDate), limits)) },
  });
  await logAudit(ctx, { action: "PIP_START", entity: "PerformanceImprovementPlan", entityId: id, newValue: { employeeId: p.employeeId, ownerUserId: p.ownerUserId } });
  return u;
}

export async function returnPlan(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "pip.approve");
  const reason = text(5, 1000, "A reason").parse(note ?? "");
  const p = await load(ctx, id);
  if (p.status !== "AWAITING_APPROVAL") throw new BusinessError("Only a plan awaiting approval to start can be returned to draft.");
  const conflict = approverConflict("RETURN_START", { drafterId: p.draftedByUserId, ownerId: p.ownerUserId }, ctx.userId);
  if (conflict) throw new BusinessError(conflict);
  const u = await db.performanceImprovementPlan.update({ where: { id }, data: { status: nextStatus("AWAITING_APPROVAL", "RETURN")!, returnNote: reason, submittedAt: null } });
  await logAudit(ctx, { action: "PIP_RETURN", entity: "PerformanceImprovementPlan", entityId: id, newValue: { employeeId: p.employeeId } });
  return u;
}

// ───────────────────────────── Reviews ─────────────────────────────

export const reviewSchema = z.object({
  reviewedOn: day,
  summary: text(5, 4000, "The summary"),
  assessments: z.array(z.object({ objectiveId: z.string().min(1), result: z.enum(["MET", "PARTLY_MET", "NOT_MET"]), note: z.string().trim().max(1000).optional().transform((x) => x || undefined) })).default([]),
});

export async function recordReview(ctx: Ctx, id: string, raw: z.input<typeof reviewSchema>) {
  assertCan(ctx, "pip.manage");
  const v = reviewSchema.parse(raw);
  const p = await load(ctx, id);
  if (p.status !== "ACTIVE") throw new BusinessError("Reviews can only be recorded on an active plan.");
  if (v.reviewedOn > todayIso()) throw new BusinessError("A review cannot be dated in the future.");
  if (d(v.reviewedOn) < p.startDate) throw new BusinessError("A review cannot be dated before the plan started.");
  const own = new Set(p.objectives.map((o) => o.id));
  const seen = new Set<string>();
  for (const a of v.assessments) {
    if (!own.has(a.objectiveId)) throw new BusinessError("That objective does not belong to this plan.");
    if (seen.has(a.objectiveId)) throw new BusinessError("An objective can be assessed only once in a review.");
    seen.add(a.objectiveId);
  }
  const limits = limitsOf(await getHrPolicy(ctx.orgId));
  return db.$transaction(async (tx) => {
    const r = await tx.pipReview.create({ data: { organizationId: ctx.orgId, planId: id, reviewedOn: d(v.reviewedOn), summary: v.summary, recordedByUserId: ctx.userId, recordedBy: ctx.name } });
    for (const a of v.assessments) await tx.pipReviewAssessment.create({ data: { organizationId: ctx.orgId, reviewId: r.id, objectiveId: a.objectiveId, result: a.result, note: a.note ?? null } });
    await tx.performanceImprovementPlan.update({ where: { id }, data: { nextReviewDue: d(nextReviewDueOf(v.reviewedOn, iso(p.endDate), limits)) } });
    await logAudit(ctx, { action: "PIP_REVIEW", entity: "PipReview", entityId: r.id, newValue: { planId: id, objectivesAssessed: v.assessments.length } }, tx);
    return r;
  });
}

// ───────────────────────────── The outcome: a second person approves ─────────────────────────────

export const outcomeSchema = z.object({ outcome: z.enum(["SUCCESSFUL", "EXTENDED", "UNSUCCESSFUL"]), note: text(5, 2000, "A note"), newEndDate: day.optional() });

export async function proposeOutcome(ctx: Ctx, id: string, raw: z.input<typeof outcomeSchema>) {
  assertCan(ctx, "pip.manage");
  const v = outcomeSchema.parse(raw);
  const p = await load(ctx, id);
  if (!nextStatus(p.status as PipStatus, "PROPOSE_OUTCOME")) throw new BusinessError("Only an active plan can be given an outcome.");
  if (!p.reviews.length) throw new BusinessError("Record at least one review before proposing an outcome.");
  let newEnd: Date | null = null;
  if (v.outcome === "EXTENDED") {
    if (!v.newEndDate) throw new BusinessError("Name the new end date for the extension.");
    const bad = checkExtension({ extensionsUsed: p.extensionsUsed, currentEnd: iso(p.endDate), newEnd: v.newEndDate }, limitsOf(await getHrPolicy(ctx.orgId)));
    if (bad) throw new BusinessError(bad);
    newEnd = d(v.newEndDate);
  }
  const u = await db.performanceImprovementPlan.update({
    where: { id },
    data: { status: "OUTCOME_PROPOSED", proposedOutcome: v.outcome, proposedEndDate: newEnd, proposedNote: v.note, proposedBy: ctx.name, proposedByUserId: ctx.userId, proposedAt: new Date() },
  });
  await logAudit(ctx, { action: "PIP_OUTCOME_PROPOSE", entity: "PerformanceImprovementPlan", entityId: id, newValue: { employeeId: p.employeeId, outcome: v.outcome } });
  return u;
}

const CLEAR_PROPOSAL = { proposedOutcome: null, proposedEndDate: null, proposedNote: null, proposedBy: null, proposedByUserId: null, proposedAt: null } as const;

export async function approveOutcome(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "pip.approve");
  const p = await load(ctx, id);
  const outcome = p.proposedOutcome;
  const next = outcome ? nextStatus(p.status as PipStatus, "APPROVE_OUTCOME", outcome) : null;
  if (!outcome || !next) throw new BusinessError("There is no outcome awaiting approval on this plan.");
  const conflict = approverConflict("APPROVE_OUTCOME", { drafterId: p.draftedByUserId, ownerId: p.ownerUserId, proposerId: p.proposedByUserId }, ctx.userId);
  if (conflict) throw new BusinessError(conflict);
  const limits = limitsOf(await getHrPolicy(ctx.orgId));
  const approvedNote = note?.trim() || null;
  const u =
    outcome === "EXTENDED"
      ? await db.performanceImprovementPlan.update({
          where: { id },
          data: { status: next, endDate: p.proposedEndDate!, extensionsUsed: { increment: 1 }, nextReviewDue: d(nextReviewDueOf(todayIso(), iso(p.proposedEndDate), limits)), ...CLEAR_PROPOSAL },
        })
      : await db.performanceImprovementPlan.update({
          where: { id },
          data: { status: next, outcome, outcomeNote: [p.proposedNote, approvedNote].filter(Boolean).join(" | ") || null, outcomeApprovedBy: ctx.name, outcomeApprovedByUserId: ctx.userId, closedAt: new Date(), nextReviewDue: null, ...CLEAR_PROPOSAL },
        });
  await logAudit(ctx, { action: "PIP_OUTCOME_APPROVE", entity: "PerformanceImprovementPlan", entityId: id, newValue: { employeeId: p.employeeId, outcome } });
  return u;
}

export async function returnOutcome(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "pip.approve");
  text(5, 1000, "A reason").parse(note ?? "");
  const p = await load(ctx, id);
  if (p.status !== "OUTCOME_PROPOSED") throw new BusinessError("There is no outcome awaiting approval on this plan.");
  const conflict = approverConflict("RETURN_OUTCOME", { drafterId: p.draftedByUserId, ownerId: p.ownerUserId, proposerId: p.proposedByUserId }, ctx.userId);
  if (conflict) throw new BusinessError(conflict);
  const u = await db.performanceImprovementPlan.update({ where: { id }, data: { status: nextStatus("OUTCOME_PROPOSED", "RETURN")!, ...CLEAR_PROPOSAL } });
  await logAudit(ctx, { action: "PIP_OUTCOME_RETURN", entity: "PerformanceImprovementPlan", entityId: id, newValue: { employeeId: p.employeeId } });
  return u;
}

export async function withdrawPlan(ctx: Ctx, id: string, reason: string) {
  const why = text(5, 1000, "A reason").parse(reason ?? "");
  const p = await load(ctx, id);
  // a draft or a plan waiting to start can be withdrawn by whoever manages plans; a plan that has started needs the approve right
  assertCan(ctx, p.status === "DRAFT" || p.status === "AWAITING_APPROVAL" ? "pip.manage" : "pip.approve");
  if (!nextStatus(p.status as PipStatus, "WITHDRAW")) throw new BusinessError(`Only an open plan can be withdrawn; this one is ${p.status.toLowerCase()}.`);
  const u = await db.performanceImprovementPlan.update({ where: { id }, data: { status: "WITHDRAWN", withdrawnAt: new Date(), withdrawnBy: ctx.name, withdrawReason: why, nextReviewDue: null, ...CLEAR_PROPOSAL } });
  await logAudit(ctx, { action: "PIP_WITHDRAW", entity: "PerformanceImprovementPlan", entityId: id, newValue: { employeeId: p.employeeId } });
  return u;
}

// ───────────────────────────── Reading (HR) ─────────────────────────────

/** What this caller may do next with a plan (the server checks again on every action). */
function actionsFor(ctx: Ctx, p: Loaded) {
  const people = { drafterId: p.draftedByUserId, ownerId: p.ownerUserId, proposerId: p.proposedByUserId };
  const manage = can(ctx.role, "pip.manage");
  const approve = can(ctx.role, "pip.approve");
  const s = p.status as PipStatus;
  return {
    edit: manage && s === "DRAFT",
    submit: manage && s === "DRAFT" && p.objectives.length > 0,
    approveStart: approve && s === "AWAITING_APPROVAL" && !approverConflict("APPROVE_START", people, ctx.userId),
    returnStart: approve && s === "AWAITING_APPROVAL" && !approverConflict("RETURN_START", people, ctx.userId),
    review: manage && s === "ACTIVE",
    proposeOutcome: manage && s === "ACTIVE" && p.reviews.length > 0,
    approveOutcome: approve && s === "OUTCOME_PROPOSED" && !approverConflict("APPROVE_OUTCOME", people, ctx.userId),
    returnOutcome: approve && s === "OUTCOME_PROPOSED" && !approverConflict("RETURN_OUTCOME", people, ctx.userId),
    withdraw: isOpen(s) && (s === "DRAFT" || s === "AWAITING_APPROVAL" ? manage : approve),
  };
}

export async function getPlan(ctx: Ctx, id: string) {
  assertCan(ctx, "pip.view");
  const p = await load(ctx, id);
  return { ...p, objectives: withResults(p), reviewState: reviewState({ status: p.status as PipStatus, nextReviewDue: p.nextReviewDue ? iso(p.nextReviewDue) : null }, todayIso()), actions: actionsFor(ctx, p) };
}

export async function listPlans(ctx: Ctx, f: { status?: PipStatus; employeeId?: string; openOnly?: boolean } = {}) {
  assertCan(ctx, "pip.view");
  const rows = await db.performanceImprovementPlan.findMany({
    where: { organizationId: ctx.orgId, ...(f.status ? { status: f.status } : {}), ...(f.employeeId ? { employeeId: f.employeeId } : {}), ...(f.openOnly ? { status: { in: [...OPEN_STATUSES] as never } } : {}) },
    include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, status: true } }, _count: { select: { objectives: true, reviews: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 500,
  });
  const today = todayIso();
  return rows.map((p) => ({ ...p, reviewState: reviewState({ status: p.status as PipStatus, nextReviewDue: p.nextReviewDue ? iso(p.nextReviewDue) : null }, today) }));
}

/** The people who can be named as a plan's owner: active users in this company whose role can run plans. */
export async function eligibleOwners(ctx: Ctx) {
  assertCan(ctx, "pip.manage");
  const users = await db.user.findMany({ where: { organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  return users.filter((u) => can(u.role, "pip.manage"));
}

// ───────────────────────────── The employee's own view ─────────────────────────────

/** The signed-in employee's own plans, once started: what they need to see, and nothing internal (no unapproved outcome, no drafts, no other person's plan). */
export async function myPlans(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const rows = await db.performanceImprovementPlan.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, status: { notIn: ["DRAFT", "AWAITING_APPROVAL"] } },
    include: PLAN_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows
    .filter((p) => employeeMaySee(p.status as PipStatus, p.activatedAt))
    .map((p) => ({
      id: p.id,
      status: p.status as PipStatus,
      concerns: p.concerns,
      startDate: p.startDate,
      endDate: p.endDate,
      ownerName: p.ownerName,
      objectives: withResults(p).map((o) => ({ id: o.id, gap: o.gap, target: o.target, support: o.support, dueDate: o.dueDate, result: o.result })),
      reviews: p.reviews.map((r) => ({ id: r.id, reviewedOn: r.reviewedOn, summary: r.summary, employeeComment: r.employeeComment, assessments: r.assessments.map((a) => ({ objectiveId: a.objectiveId, result: a.result })) })),
      outcome: p.status === "CLOSED" ? p.outcome : null,
      acknowledgedAt: p.acknowledgedAt,
      employeeAgreed: p.employeeAgreed,
      employeeResponse: p.employeeResponse,
    }));
}

/** A plan the signed-in employee may answer: their own, and started. Anything else is "not found". */
async function ownStartedPlan(ctx: Ctx, id: string) {
  const p = await db.performanceImprovementPlan.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!p || !ctx.employeeId || p.employeeId !== ctx.employeeId || !employeeMaySee(p.status as PipStatus, p.activatedAt)) throw new BusinessError(NOT_FOUND);
  return p;
}

export async function acknowledgePlan(ctx: Ctx, id: string, raw: { agree: boolean; comment?: string }) {
  const p = await ownStartedPlan(ctx, id);
  if (p.status === "WITHDRAWN") throw new BusinessError("This plan was withdrawn.");
  if (p.acknowledgedAt) throw new BusinessError("You have already responded to this plan.");
  const comment = raw.comment?.trim();
  if (!raw.agree && (!comment || comment.length < 5)) throw new BusinessError("If you disagree, say why (at least a sentence).");
  const u = await db.performanceImprovementPlan.update({ where: { id }, data: { acknowledgedAt: new Date(), employeeAgreed: raw.agree, employeeResponse: comment || null } });
  await logAudit(ctx, { action: "PIP_ACKNOWLEDGE", entity: "PerformanceImprovementPlan", entityId: id, newValue: { agreed: raw.agree } });
  return u;
}

export async function addEmployeeComment(ctx: Ctx, reviewId: string, comment: string) {
  const c = text(3, 2000, "Your comment").parse(comment ?? "");
  const r = await db.pipReview.findFirst({ where: { id: reviewId, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Review not found.");
  try {
    await ownStartedPlan(ctx, r.planId);
  } catch {
    throw new BusinessError("Review not found.");
  }
  if (r.employeeComment) throw new BusinessError("You have already commented on this review.");
  const u = await db.pipReview.update({ where: { id: reviewId }, data: { employeeComment: c, employeeCommentAt: new Date() } });
  await logAudit(ctx, { action: "PIP_EMPLOYEE_COMMENT", entity: "PipReview", entityId: reviewId, newValue: { planId: r.planId } });
  return u;
}

// ───────────────────────────── Reminders ─────────────────────────────

/** What needs attention, for the HR daily digest and overview: it reads the same data as the plan list, so the two never disagree. */
export async function planAttention(orgId: string, today: Date) {
  const include = { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, status: true } } } as const;
  const [awaitingApproval, outcomeAwaiting, reviewOverdue, reviewDue, pastEnd, leavers] = await Promise.all([
    db.performanceImprovementPlan.findMany({ where: { organizationId: orgId, status: "AWAITING_APPROVAL" }, include, orderBy: { submittedAt: "asc" } }),
    db.performanceImprovementPlan.findMany({ where: { organizationId: orgId, status: "OUTCOME_PROPOSED" }, include, orderBy: { proposedAt: "asc" } }),
    db.performanceImprovementPlan.findMany({ where: { organizationId: orgId, status: "ACTIVE", nextReviewDue: { lt: today } }, include, orderBy: { nextReviewDue: "asc" } }),
    db.performanceImprovementPlan.findMany({ where: { organizationId: orgId, status: "ACTIVE", nextReviewDue: today }, include }),
    db.performanceImprovementPlan.findMany({ where: { organizationId: orgId, status: "ACTIVE", endDate: { lt: today } }, include, orderBy: { endDate: "asc" } }),
    db.performanceImprovementPlan.findMany({ where: { organizationId: orgId, status: { in: [...OPEN_STATUSES] as never }, employee: { status: { in: ["RESIGNED", "TERMINATED", "EXITED"] } } }, include }),
  ]);
  return { awaitingApproval, outcomeAwaiting, reviewOverdue, reviewDue, pastEnd, leavers };
}
