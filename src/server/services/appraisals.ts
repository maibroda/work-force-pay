/**
 * Performance appraisals.
 *
 * A cycle (annual, probation or ad hoc) creates one appraisal per eligible employee, snapshotting the
 * criteria and weights in force at launch. The employee may rate themselves first; the assigned
 * reviewer then rates every criterion and submits; someone *other than the reviewer* signs it off;
 * finally the employee acknowledges the result or records that they disagree.
 *
 * Until it is signed off the employee never sees the reviewer's ratings or comments, and nobody can
 * review, approve or return their own appraisal.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { addDays, d, iso } from "@/lib/dates";
import { bandFor, commentRequired, DEFAULT_CRITERIA, RECOMMENDATIONS, selfGap, STATUS_PHRASES, weightedScore } from "@/lib/appraisal";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy } from "./hr-policy";
import { num } from "@/lib/money";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const GONE = ["EXITED", "TERMINATED", "RESIGNED"];

// ───────────────────────────── Criteria ─────────────────────────────

/** A new organization starts with a sensible set; HR edits it in Settings. */
async function ensureCriteria(orgId: string) {
  if (await db.appraisalCriterion.count({ where: { organizationId: orgId } })) return;
  await db.appraisalCriterion.createMany({
    data: DEFAULT_CRITERIA.map((c, i) => ({ organizationId: orgId, name: c.name, description: c.description, weight: c.weight, sortOrder: i })),
    skipDuplicates: true,
  });
}

export async function listCriteria(ctx: Ctx) {
  assertCan(ctx, "appraisal.view");
  await ensureCriteria(ctx.orgId);
  return db.appraisalCriterion.findMany({ where: { organizationId: ctx.orgId }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }] });
}

export const criterionSchema = z.object({
  name: z.string().trim().min(3, "Name the criterion"),
  description: opt,
  weight: z.coerce.number().int().min(1, "Weight is at least 1").max(100),
});

export async function addCriterion(ctx: Ctx, raw: z.input<typeof criterionSchema>) {
  assertCan(ctx, "appraisal.manage");
  await ensureCriteria(ctx.orgId);
  const v = criterionSchema.parse(raw);
  if (await db.appraisalCriterion.findFirst({ where: { organizationId: ctx.orgId, name: { equals: v.name, mode: "insensitive" } } }))
    throw new BusinessError(`There is already a criterion called "${v.name}".`);
  const max = await db.appraisalCriterion.aggregate({ where: { organizationId: ctx.orgId }, _max: { sortOrder: true } });
  const c = await db.appraisalCriterion.create({ data: { organizationId: ctx.orgId, name: v.name, description: v.description ?? null, weight: v.weight, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  await logAudit(ctx, { action: "APPRAISAL_CRITERION_ADD", entity: "AppraisalCriterion", entityId: c.id, newValue: c });
  return c;
}

export async function updateCriterion(ctx: Ctx, id: string, raw: Partial<z.input<typeof criterionSchema>> & { active?: boolean }) {
  assertCan(ctx, "appraisal.manage");
  const old = await db.appraisalCriterion.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Criterion not found.");
  const v = criterionSchema.partial().parse(raw);
  if (v.name && v.name.toLowerCase() !== old.name.toLowerCase() && (await db.appraisalCriterion.findFirst({ where: { organizationId: ctx.orgId, name: { equals: v.name, mode: "insensitive" }, id: { not: id } } })))
    throw new BusinessError(`There is already a criterion called "${v.name}".`);
  if (raw.active === false && old.active && (await db.appraisalCriterion.count({ where: { organizationId: ctx.orgId, active: true } })) <= 1)
    throw new BusinessError("At least one criterion has to stay switched on.");
  const c = await db.appraisalCriterion.update({ where: { id }, data: { ...v, ...(raw.active !== undefined ? { active: raw.active } : {}) } });
  await logAudit(ctx, { action: "APPRAISAL_CRITERION_UPDATE", entity: "AppraisalCriterion", entityId: id, oldValue: old, newValue: c });
  return c;
}

// ───────────────────────────── Cycles ─────────────────────────────

export const cycleSchema = z.object({
  name: z.string().trim().min(3, "Name the cycle (e.g. 2026 annual review)"),
  kind: z.enum(["ANNUAL", "PROBATION", "AD_HOC"]).default("ANNUAL"),
  periodStart: z.string().min(10, "Period start is required"),
  periodEnd: z.string().min(10, "Period end is required"),
  dueDate: z.string().min(10, "A due date is required"),
  /** Limit to these categories (blank = everyone). */
  categoryIds: z.array(z.string()).optional(),
  /** Or to these specific employees (for probation / ad-hoc reviews). */
  employeeIds: z.array(z.string()).optional(),
});

/** The user who should review an employee: their reporting manager's login, if that person can review. */
async function reviewerFor(orgId: string, managerId: string | null) {
  if (!managerId) return null;
  const u = await db.user.findFirst({ where: { organizationId: orgId, employeeId: managerId, active: true }, select: { id: true, name: true, role: true } });
  return u && can(u.role, "appraisal.review") ? u : null;
}

export async function launchCycle(ctx: Ctx, raw: z.input<typeof cycleSchema>) {
  assertCan(ctx, "appraisal.manage");
  const v = cycleSchema.parse(raw);
  const start = d(v.periodStart);
  const end = d(v.periodEnd);
  const due = d(v.dueDate);
  if ([start, end, due].some((x) => Number.isNaN(x.getTime()))) throw new BusinessError("One of the dates isn't valid.");
  if (end < start) throw new BusinessError("The period can't end before it starts.");
  if (due < start) throw new BusinessError("The due date can't be before the period starts.");
  if (await db.appraisalCycle.findFirst({ where: { organizationId: ctx.orgId, name: { equals: v.name, mode: "insensitive" } } }))
    throw new BusinessError(`There is already a cycle called "${v.name}".`);
  await ensureCriteria(ctx.orgId);
  const criteria = await db.appraisalCriterion.findMany({ where: { organizationId: ctx.orgId, active: true }, orderBy: { sortOrder: "asc" } });
  if (!criteria.length) throw new BusinessError("Switch on at least one criterion first.");
  const policy = await getHrPolicy(ctx.orgId);

  const emps = await db.employee.findMany({
    where: {
      organizationId: ctx.orgId,
      status: { in: ["ACTIVE", "ON_LEAVE"] },
      ...(v.categoryIds?.length ? { categoryId: { in: v.categoryIds } } : {}),
      ...(v.employeeIds?.length ? { id: { in: v.employeeIds } } : {}),
    },
    orderBy: { employeeNumber: "asc" },
  });
  const cutoff = addDays(end, -policy.appraisalMinServiceDays);
  const skipped: Array<{ employee: string; reason: string }> = [];
  const eligible: typeof emps = [];
  for (const e of emps) {
    if (e.employmentDate > cutoff && !v.employeeIds?.length) skipped.push({ employee: `${e.employeeNumber} ${e.firstName} ${e.lastName}`, reason: `under ${policy.appraisalMinServiceDays} days' service at the period end` });
    else eligible.push(e);
  }
  if (!eligible.length) throw new BusinessError("No employee is eligible for this cycle — check the categories, the period and the minimum service in the HR policy.");

  const reviewers = new Map<string, { id: string; name: string } | null>();
  for (const e of eligible) if (e.reportingManagerId && !reviewers.has(e.reportingManagerId)) reviewers.set(e.reportingManagerId, await reviewerFor(ctx.orgId, e.reportingManagerId));

  return db.$transaction(async (tx) => {
    const cycle = await tx.appraisalCycle.create({ data: { organizationId: ctx.orgId, name: v.name, kind: v.kind, periodStart: start, periodEnd: end, dueDate: due, createdBy: ctx.name } });
    let unassigned = 0;
    for (const e of eligible) {
      const r = e.reportingManagerId ? reviewers.get(e.reportingManagerId) : null;
      // nobody reviews themselves, even when their own login is their manager's
      const reviewer = r && r.id !== ctx.userId && !(await tx.user.findFirst({ where: { id: r.id, employeeId: e.id } })) ? r : null;
      if (!reviewer) unassigned += 1;
      await tx.appraisal.create({
        data: {
          organizationId: ctx.orgId,
          cycleId: cycle.id,
          employeeId: e.id,
          reviewerUserId: reviewer?.id ?? null,
          reviewerName: reviewer?.name ?? null,
          ratings: { create: criteria.map((c) => ({ organizationId: ctx.orgId, criterionId: c.id, criterionName: c.name, weight: c.weight, sortOrder: c.sortOrder })) },
        },
      });
    }
    await logAudit(ctx, { action: "APPRAISAL_CYCLE_LAUNCH", entity: "AppraisalCycle", entityId: cycle.id, newValue: { name: cycle.name, kind: cycle.kind, appraisals: eligible.length, skipped: skipped.length } }, tx);
    return { cycle, created: eligible.length, unassigned, skipped };
  });
}

export async function closeCycle(ctx: Ctx, id: string) {
  assertCan(ctx, "appraisal.manage");
  const c = await db.appraisalCycle.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!c) throw new BusinessError("Cycle not found.");
  if (c.status === "CLOSED") throw new BusinessError("This cycle is already closed.");
  const open = await db.appraisal.count({ where: { cycleId: id, status: { in: ["DRAFT", "SUBMITTED"] } } });
  const u = await db.appraisalCycle.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
  await logAudit(ctx, { action: "APPRAISAL_CYCLE_CLOSE", entity: "AppraisalCycle", entityId: id, newValue: { stillOpen: open } });
  return { cycle: u, stillOpen: open };
}

export async function listCycles(ctx: Ctx) {
  assertCan(ctx, "appraisal.view");
  const [cycles, groups] = await Promise.all([
    db.appraisalCycle.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "desc" } }),
    db.appraisal.groupBy({ by: ["cycleId", "status"], where: { organizationId: ctx.orgId }, _count: true }),
  ]);
  return cycles.map((c) => {
    const counts = { DRAFT: 0, SUBMITTED: 0, APPROVED: 0, ACKNOWLEDGED: 0 };
    for (const g of groups.filter((x) => x.cycleId === c.id)) counts[g.status] = g._count;
    const total = counts.DRAFT + counts.SUBMITTED + counts.APPROVED + counts.ACKNOWLEDGED;
    return { ...c, counts, total, completed: counts.APPROVED + counts.ACKNOWLEDGED };
  });
}

export async function getCycle(ctx: Ctx, id: string) {
  assertCan(ctx, "appraisal.view");
  const cycle = await db.appraisalCycle.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!cycle) return null;
  const appraisals = await db.appraisal.findMany({
    where: { cycleId: id },
    include: { employee: { select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, category: { select: { name: true } } } } },
    orderBy: { employee: { employeeNumber: "asc" } },
  });
  const scored = appraisals.filter((a) => a.overallScore != null && (a.status === "APPROVED" || a.status === "ACKNOWLEDGED"));
  const bands = new Map<string, number>();
  for (const a of scored) bands.set(a.overallBand!, (bands.get(a.overallBand!) ?? 0) + 1);
  return {
    cycle,
    appraisals,
    average: scored.length ? Math.round((scored.reduce((s, a) => s + num(a.overallScore), 0) / scored.length) * 100) / 100 : null,
    bands: [...bands.entries()].map(([band, count]) => ({ band, count })),
    unassigned: appraisals.filter((a) => !a.reviewerUserId && a.status === "DRAFT").length,
  };
}

// ───────────────────────────── Access ─────────────────────────────

const isSelf = (ctx: Ctx, employeeId: string) => !!ctx.employeeId && ctx.employeeId === employeeId;

async function load(ctx: Ctx, id: string) {
  const a = await db.appraisal.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { cycle: true, ratings: { orderBy: { sortOrder: "asc" } }, employee: { include: { category: true } } },
  });
  if (!a) throw new BusinessError("Appraisal not found.");
  return a;
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** Only the assigned reviewer rates, and never their own appraisal. */
function assertReviewer(ctx: Ctx, a: Loaded) {
  assertCan(ctx, "appraisal.review");
  if (isSelf(ctx, a.employeeId)) throw new BusinessError("You can't review your own appraisal.");
  if (a.reviewerUserId !== ctx.userId) throw new BusinessError(a.reviewerUserId ? `This appraisal is assigned to ${a.reviewerName}.` : "No reviewer has been assigned to this appraisal yet.");
}

function assertOpen(a: Loaded) {
  if (a.cycle.status === "CLOSED") throw new BusinessError("This cycle is closed.");
  if (GONE.includes(a.employee.status)) throw new BusinessError("This employee has left.");
}

// ───────────────────────────── Reading one ─────────────────────────────

/**
 * The appraisal as the caller may see it. The employee (whatever their role) gets their own
 * self-assessment but not the reviewer's ratings or comments until the appraisal is signed off.
 */
export async function getAppraisal(ctx: Ctx, id: string) {
  const a = await load(ctx, id);
  const self = isSelf(ctx, a.employeeId);
  const reviewer = a.reviewerUserId === ctx.userId;
  if (!self && !reviewer && !can(ctx.role, "appraisal.view")) throw new BusinessError("Appraisal not found.");
  const released = a.status === "APPROVED" || a.status === "ACKNOWLEDGED";
  const hidden = self && !released;
  const view = hidden
    ? {
        ...a,
        ratings: a.ratings.map((r) => ({ ...r, rating: null, comment: null })),
        overallScore: null,
        overallBand: null,
        strengths: null,
        improvements: null,
        goals: null,
        reviewerComment: null,
        recommendation: "NONE" as const,
        returnNote: null,
      }
    : a;
  const policy = await getHrPolicy(ctx.orgId);
  return {
    ...view,
    redacted: hidden,
    selfGap: hidden ? null : selfGap(a.ratings),
    can: {
      self: self,
      selfAssess: self && a.status === "DRAFT" && policy.appraisalSelfAssessment && a.cycle.status === "OPEN",
      review: !self && reviewer && a.status === "DRAFT" && can(ctx.role, "appraisal.review") && a.cycle.status === "OPEN",
      approve: !self && a.status === "SUBMITTED" && can(ctx.role, "appraisal.approve") && !reviewer,
      acknowledge: self && a.status === "APPROVED",
      assign: can(ctx.role, "appraisal.manage") && a.status === "DRAFT" && a.cycle.status === "OPEN",
    },
    policy: { selfAssessment: policy.appraisalSelfAssessment, below: policy.appraisalCommentAtOrBelow, above: policy.appraisalCommentAtOrAbove },
  };
}

/** Every appraisal (optionally one cycle's), for the results report. Scores are only meaningful once signed off — callers decide what to show. */
export async function appraisalResults(ctx: Ctx, f: { cycleId?: string } = {}) {
  assertCan(ctx, "appraisal.view");
  return db.appraisal.findMany({
    where: { organizationId: ctx.orgId, ...(f.cycleId ? { cycleId: f.cycleId } : {}) },
    include: { cycle: true, employee: { select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, category: { select: { name: true } } } } },
    orderBy: [{ cycle: { createdAt: "desc" } }, { employee: { employeeNumber: "asc" } }],
  });
}

/** What each person has waiting for them. */
export async function myQueue(ctx: Ctx) {
  const toReview = can(ctx.role, "appraisal.review")
    ? await db.appraisal.findMany({
        where: { organizationId: ctx.orgId, reviewerUserId: ctx.userId, status: "DRAFT", cycle: { status: "OPEN" } },
        include: { cycle: true, employee: { select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true } } },
        orderBy: { cycle: { dueDate: "asc" } },
      })
    : [];
  const toApprove = can(ctx.role, "appraisal.approve")
    ? await db.appraisal.findMany({
        where: { organizationId: ctx.orgId, status: "SUBMITTED", NOT: { reviewerUserId: ctx.userId }, ...(ctx.employeeId ? { employeeId: { not: ctx.employeeId } } : {}) },
        include: { cycle: true, employee: { select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true } } },
        orderBy: { submittedAt: "asc" },
      })
    : [];
  return { toReview, toApprove };
}

/** The employee's own appraisals; scores are shown only once signed off. */
export async function myAppraisals(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const rows = await db.appraisal.findMany({ where: { organizationId: ctx.orgId, employeeId: ctx.employeeId }, include: { cycle: true }, orderBy: { createdAt: "desc" } });
  return rows.map((a) => ({ ...a, overallScore: a.status === "APPROVED" || a.status === "ACKNOWLEDGED" ? a.overallScore : null, overallBand: a.status === "APPROVED" || a.status === "ACKNOWLEDGED" ? a.overallBand : null }));
}

export async function employeeAppraisals(ctx: Ctx, employeeId: string) {
  assertCan(ctx, "appraisal.view");
  return db.appraisal.findMany({ where: { organizationId: ctx.orgId, employeeId }, include: { cycle: true }, orderBy: { createdAt: "desc" } });
}

// ───────────────────────────── Rating ─────────────────────────────

const ratingValue = z.coerce.number().int().min(1, "Ratings run from 1 to 5").max(5, "Ratings run from 1 to 5");
const entry = z.object({ criterionId: z.string().min(1), rating: ratingValue.optional(), comment: opt });

export const reviewSchema = z.object({
  ratings: z.array(entry).default([]),
  strengths: opt,
  improvements: opt,
  goals: opt,
  reviewerComment: opt,
  recommendation: z.enum(RECOMMENDATIONS).default("NONE"),
});

function checkEntries(a: Loaded, entries: Array<{ criterionId: string; rating?: number; comment?: string }>) {
  const known = new Set(a.ratings.map((r) => r.criterionId));
  for (const e of entries) if (!known.has(e.criterionId)) throw new BusinessError("One of the ratings isn't for a criterion on this appraisal.");
  if (new Set(entries.map((e) => e.criterionId)).size !== entries.length) throw new BusinessError("A criterion was rated twice.");
}

/** Saves the reviewer's work in progress; nothing is final until it is submitted. */
export async function saveReview(ctx: Ctx, id: string, raw: z.input<typeof reviewSchema>) {
  const a = await load(ctx, id);
  assertReviewer(ctx, a);
  assertOpen(a);
  if (a.status !== "DRAFT") throw new BusinessError("This appraisal has already been submitted.");
  const v = reviewSchema.parse(raw);
  checkEntries(a, v.ratings);
  const policy = await getHrPolicy(ctx.orgId);
  for (const e of v.ratings)
    if (e.rating && commentRequired(e.rating, policy) && !e.comment) {
      const name = a.ratings.find((r) => r.criterionId === e.criterionId)!.criterionName;
      throw new BusinessError(`Explain the ${e.rating} for "${name}" — ratings that low or high need a comment.`);
    }
  await db.$transaction(async (tx) => {
    for (const e of v.ratings)
      await tx.appraisalRating.update({ where: { appraisalId_criterionId: { appraisalId: id, criterionId: e.criterionId } }, data: { rating: e.rating ?? null, comment: e.comment ?? null } });
    await tx.appraisal.update({ where: { id }, data: { strengths: v.strengths ?? null, improvements: v.improvements ?? null, goals: v.goals ?? null, reviewerComment: v.reviewerComment ?? null, recommendation: v.recommendation } });
  });
}

export async function submitReview(ctx: Ctx, id: string) {
  const a = await load(ctx, id);
  assertReviewer(ctx, a);
  assertOpen(a);
  if (a.status !== "DRAFT") throw new BusinessError("This appraisal has already been submitted.");
  const missing = a.ratings.filter((r) => !r.rating);
  if (missing.length) throw new BusinessError(`Rate every criterion before submitting — still to rate: ${missing.map((m) => m.criterionName).join(", ")}.`);
  const policy = await getHrPolicy(ctx.orgId);
  const bare = a.ratings.find((r) => commentRequired(r.rating!, policy) && !r.comment);
  if (bare) throw new BusinessError(`Explain the ${bare.rating} for "${bare.criterionName}" — ratings that low or high need a comment.`);
  const { score } = weightedScore(a.ratings);
  const u = await db.appraisal.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date(), overallScore: score, overallBand: bandFor(score!), returnNote: null } });
  await logAudit(ctx, { action: "APPRAISAL_SUBMIT", entity: "Appraisal", entityId: id, newValue: { employeeId: a.employeeId, score, cycle: a.cycle.name } });
  return u;
}

/** The approver sends it back to the reviewer with a note. */
export async function returnReview(ctx: Ctx, id: string, note: string) {
  const a = await load(ctx, id);
  assertCan(ctx, "appraisal.approve");
  if (isSelf(ctx, a.employeeId)) throw new BusinessError("You can't act on your own appraisal.");
  if (a.reviewerUserId === ctx.userId) throw new BusinessError("You reviewed this one — someone else has to sign it off or return it.");
  if (a.status !== "SUBMITTED") throw new BusinessError("Only a submitted appraisal can be returned.");
  if (a.cycle.status === "CLOSED") throw new BusinessError("This cycle is closed.");
  if (!note || note.trim().length < 5) throw new BusinessError("Say what needs another look.");
  const u = await db.appraisal.update({ where: { id }, data: { status: "DRAFT", returnNote: note.trim(), submittedAt: null, overallScore: null, overallBand: null } });
  await logAudit(ctx, { action: "APPRAISAL_RETURN", entity: "Appraisal", entityId: id, reason: note });
  return u;
}

export async function approveAppraisal(ctx: Ctx, id: string, note?: string) {
  const a = await load(ctx, id);
  assertCan(ctx, "appraisal.approve");
  if (isSelf(ctx, a.employeeId)) throw new BusinessError("You can't sign off your own appraisal.");
  if (a.reviewerUserId === ctx.userId) throw new BusinessError("You reviewed this one — someone else has to sign it off.");
  if (a.status !== "SUBMITTED") throw new BusinessError(a.status === "DRAFT" ? "The reviewer hasn't submitted this yet." : `This appraisal is already ${a.status.toLowerCase()}.`);
  if (a.cycle.status === "CLOSED") throw new BusinessError("This cycle is closed.");
  const u = await db.appraisal.update({ where: { id }, data: { status: "APPROVED", approvedBy: ctx.name, approvedByUserId: ctx.userId, approvedAt: new Date(), approvalNote: note?.trim() || null } });
  await logAudit(ctx, { action: "APPRAISAL_APPROVE", entity: "Appraisal", entityId: id, newValue: { employeeId: a.employeeId, score: a.overallScore, band: a.overallBand }, reason: note });
  return u;
}

// ───────────────────────────── Employee ─────────────────────────────

export const selfSchema = z.object({
  ratings: z.array(entry).default([]),
  comment: opt,
});

export async function saveSelfAssessment(ctx: Ctx, id: string, raw: z.input<typeof selfSchema>) {
  const a = await load(ctx, id);
  if (!isSelf(ctx, a.employeeId)) throw new BusinessError("You can only assess yourself.");
  assertOpen(a);
  const policy = await getHrPolicy(ctx.orgId);
  if (!policy.appraisalSelfAssessment) throw new BusinessError("Self-assessment isn't switched on.");
  if (a.status !== "DRAFT") throw new BusinessError("Your manager has already submitted the review — self-assessment is closed.");
  const v = selfSchema.parse(raw);
  checkEntries(a, v.ratings);
  await db.$transaction(async (tx) => {
    for (const e of v.ratings)
      await tx.appraisalRating.update({ where: { appraisalId_criterionId: { appraisalId: id, criterionId: e.criterionId } }, data: { selfRating: e.rating ?? null, selfComment: e.comment ?? null } });
    await tx.appraisal.update({ where: { id }, data: { employeeSelfComment: v.comment ?? null, selfSubmittedAt: new Date() } });
    await logAudit(ctx, { action: "APPRAISAL_SELF", entity: "Appraisal", entityId: id, newValue: { cycle: a.cycle.name } }, tx);
  });
}

export async function acknowledgeAppraisal(ctx: Ctx, id: string, raw: { agree: boolean; comment?: string }) {
  const a = await load(ctx, id);
  if (!isSelf(ctx, a.employeeId)) throw new BusinessError("Only the employee can acknowledge their appraisal.");
  if (a.status !== "APPROVED") throw new BusinessError(a.status === "ACKNOWLEDGED" ? "You've already responded to this appraisal." : "This appraisal hasn't been signed off yet.");
  const comment = raw.comment?.trim();
  if (!raw.agree && (!comment || comment.length < 5)) throw new BusinessError("If you disagree, say why (at least a sentence).");
  const u = await db.appraisal.update({ where: { id }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), employeeAgreed: raw.agree, employeeResponse: comment || null } });
  await logAudit(ctx, { action: raw.agree ? "APPRAISAL_ACKNOWLEDGE" : "APPRAISAL_DISPUTE", entity: "Appraisal", entityId: id, reason: comment });
  return u;
}

// ───────────────────────────── Assigning ─────────────────────────────

/** Reviewers HR can choose from: active users whose role can review. */
export async function eligibleReviewers(ctx: Ctx) {
  assertCan(ctx, "appraisal.manage");
  const users = await db.user.findMany({ where: { organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true, employeeId: true }, orderBy: { name: "asc" } });
  return users.filter((u) => can(u.role, "appraisal.review"));
}

export async function assignReviewer(ctx: Ctx, id: string, userId: string) {
  assertCan(ctx, "appraisal.manage");
  const a = await load(ctx, id);
  assertOpen(a);
  if (a.status !== "DRAFT") throw new BusinessError("The review has been submitted — send it back before changing the reviewer.");
  const u = await db.user.findFirst({ where: { id: userId, organizationId: ctx.orgId, active: true } });
  if (!u || !can(u.role, "appraisal.review")) throw new BusinessError("That person can't review appraisals.");
  if (u.employeeId === a.employeeId) throw new BusinessError("Nobody can review their own appraisal.");
  const updated = await db.appraisal.update({ where: { id }, data: { reviewerUserId: u.id, reviewerName: u.name } });
  await logAudit(ctx, { action: "APPRAISAL_ASSIGN", entity: "Appraisal", entityId: id, oldValue: { reviewer: a.reviewerName }, newValue: { reviewer: u.name } });
  return updated;
}

// ───────────────────────────── Probation ─────────────────────────────

interface ProbationWindow {
  employeeId: string;
  startDate: Date;
  probationEndDate: Date | null;
}

/** The newest probation appraisal whose period overlaps this contract's probation, if any. */
export async function probationAppraisalFor(orgId: string, c: ProbationWindow) {
  if (!c.probationEndDate) return null;
  return db.appraisal.findFirst({
    where: { organizationId: orgId, employeeId: c.employeeId, cycle: { kind: "PROBATION", periodStart: { lte: c.probationEndDate }, periodEnd: { gte: c.startDate } } },
    include: { cycle: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Starts a one-person probation review covering the contract's probation period. */
export async function startProbationAppraisal(ctx: Ctx, contractId: string) {
  assertCan(ctx, "appraisal.manage");
  const c = await db.employmentContract.findFirst({ where: { id: contractId, organizationId: ctx.orgId }, include: { employee: true } });
  if (!c) throw new BusinessError("Contract not found.");
  if (c.status !== "ACTIVE" || (c.probationOutcome !== "PENDING" && c.probationOutcome !== "EXTENDED") || !c.probationEndDate)
    throw new BusinessError("Only a contract with a probation still under review can have a probation appraisal.");
  const existing = await probationAppraisalFor(ctx.orgId, c);
  if (existing && (existing.status === "DRAFT" || existing.status === "SUBMITTED"))
    throw new BusinessError(`A probation appraisal is already ${existing.status === "DRAFT" ? "under way" : "awaiting sign-off"} for this employee.`);
  const base = `Probation review — ${c.employee.employeeNumber} ${c.employee.firstName} ${c.employee.lastName} — ${c.contractNumber}`;
  const rounds = await db.appraisalCycle.count({ where: { organizationId: ctx.orgId, name: { startsWith: base } } });
  const today = new Date(`${iso(new Date())}T00:00:00.000Z`);
  const r = await launchCycle(ctx, {
    name: rounds ? `${base} (round ${rounds + 1})` : base,
    kind: "PROBATION",
    periodStart: iso(c.startDate),
    periodEnd: iso(c.probationEndDate),
    dueDate: iso(c.probationEndDate > today ? c.probationEndDate : today),
    employeeIds: [c.employeeId],
  });
  const appraisal = await db.appraisal.findFirstOrThrow({ where: { cycleId: r.cycle.id } });
  return { appraisal, unassigned: r.unassigned };
}

/**
 * When the HR policy requires it, a probation can be confirmed only after a signed-off probation appraisal
 * (and, if the policy sets a minimum, one that scored at least that). Throws with the reason otherwise.
 */
export async function assertProbationAppraisalAllows(orgId: string, c: ProbationWindow) {
  const policy = await getHrPolicy(orgId);
  if (!policy.probationRequiresAppraisal) return;
  const a = await probationAppraisalFor(orgId, c);
  const need = "The HR policy requires a signed-off probation appraisal before probation can be confirmed";
  if (!a) throw new BusinessError(`${need} — none has been started. Start one from this contract.`);
  if (a.status === "DRAFT" || a.status === "SUBMITTED")
    throw new BusinessError(`${need} — the probation appraisal is ${STATUS_PHRASES[a.status]}.`);
  const min = num(policy.probationMinScore);
  const score = a.overallScore == null ? 0 : num(a.overallScore);
  if (min > 0 && score < min)
    throw new BusinessError(`The probation appraisal scored ${score.toFixed(2)}, below the minimum of ${min.toFixed(2)} the HR policy sets for confirmation — extend probation, or record why it failed.`);
}

/** Overdue and waiting appraisals, for the HR digest (no permission check — it runs as the system). */
export async function appraisalAttention(orgId: string, today: Date) {
  const [overdue, awaiting] = await Promise.all([
    db.appraisal.findMany({
      where: { organizationId: orgId, status: "DRAFT", cycle: { status: "OPEN", dueDate: { lt: today } }, employee: { status: { notIn: GONE as never } } },
      include: { cycle: true, employee: true },
      orderBy: { cycle: { dueDate: "asc" } },
    }),
    db.appraisal.findMany({ where: { organizationId: orgId, status: "SUBMITTED", cycle: { status: "OPEN" } }, include: { cycle: true, employee: true }, orderBy: { submittedAt: "asc" } }),
  ]);
  return { overdue, awaiting };
}

