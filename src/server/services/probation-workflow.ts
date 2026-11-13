/**
 * The probation workflow (docs/plans/probation-workflow-plan.md), behind the HR policy switch `probationWorkflow` (default OFF):
 *
 *   1. the employee's reporting manager RECOMMENDS (confirm, extend, do not confirm) with a reasoned note;
 *   2. a DIFFERENT HR person REVIEWS it against the policy and forwards it to the decider or returns it to the manager;
 *   3. an independent DESIGNATED decider decides: the Company Administrator (and platform staff), or a user the Company Administrator designated (for example a department
 *      head), never the recommender, the HR reviewer, the probation appraisal's reviewer or signer, or the employee; the contract changes through the one existing decision
 *      logic (`applyProbationDecision`), in the same transaction as the review;
 *   4. the employee receives documented FEEDBACK (once HR has told them) and may RESPOND once, inside the company's window; a response changes nothing by itself, and the
 *      decider records that they read it.
 *
 * Every step fills its own fields once and is never overwritten; a returned recommendation stays as it was and a new round is a new row. The audit log carries ids and the
 * step, never the notes, the feedback or the response. Queries for the employee select only what they show.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { iso } from "@/lib/dates";
import { num } from "@/lib/money";
import {
  RECOMMENDATIONS,
  checkFeedback,
  checkRecommendationNote,
  checkResponse,
  deciderConflict,
  departsFromReview,
  recommendationWindowOpen,
  responseOpen,
  reviewerConflict,
  type Recommendation,
} from "@/lib/probation-workflow";
import { assertCan, BusinessError, db } from "./_base";
import { probationAppraisalFor } from "./appraisals";
import { logAudit } from "./audit";
import { applyProbationDecision } from "./contracts";
import { getHrPolicy, todayUtc } from "./hr-policy";

const NOT_FOUND = "Probation review not found.";
const NO_CONTRACT = "Contract not found.";
const MIN_REVIEW_NOTE = 5;
const AGAINST_MIN = 20;
const todayIso = () => iso(todayUtc());
const OPEN = ["RECOMMENDED", "FORWARDED"] as const;

async function requireOn(orgId: string) {
  const policy = await getHrPolicy(orgId);
  if (!policy.probationWorkflow) throw new BusinessError("The probation workflow is not switched on for this company.");
  return policy;
}

// ───────────────────────────── Step 1: the recommendation ─────────────────────────────

const recommendSchema = z.object({
  recommendation: z.enum(RECOMMENDATIONS),
  months: z.coerce.number().int().min(1).max(12).optional(),
  note: z.string().optional(),
});

export async function recommendProbation(ctx: Ctx, contractId: string, raw: z.input<typeof recommendSchema>) {
  const v = recommendSchema.parse(raw);
  const policy = await requireOn(ctx.orgId);
  const c = await db.employmentContract.findFirst({
    where: { id: contractId, organizationId: ctx.orgId },
    select: { id: true, status: true, probationOutcome: true, probationEndDate: true, probationMonths: true, employeeId: true, employee: { select: { id: true, reportingManagerId: true } } },
  });
  if (!c) throw new BusinessError(NO_CONTRACT);
  if (ctx.employeeId && ctx.employeeId === c.employeeId) throw new BusinessError("You cannot recommend on your own probation.");

  // who may recommend: the employee's reporting manager; or HR, only where the employee has no reporting manager (the record is then marked)
  const isManager = !!ctx.employeeId && c.employee.reportingManagerId === ctx.employeeId;
  let recordedByHr = false;
  if (isManager) assertCan(ctx, "probation.recommend");
  else if (can(ctx.role, "hr.manage") && !c.employee.reportingManagerId) recordedByHr = true;
  else if (can(ctx.role, "hr.manage")) throw new BusinessError("This employee has a reporting manager: the recommendation comes from them.");
  else throw new BusinessError(NO_CONTRACT);

  if (c.status !== "ACTIVE") throw new BusinessError("Only an active contract has a probation to review.");
  if ((c.probationOutcome !== "PENDING" && c.probationOutcome !== "EXTENDED") || !c.probationEndDate) throw new BusinessError("This contract has no probation waiting for a decision.");
  if (!recommendationWindowOpen(iso(c.probationEndDate), todayIso(), policy.probationAlertDays))
    throw new BusinessError(`Not yet: a recommendation can be made from ${policy.probationAlertDays} days before the probation ends.`);
  const bad = checkRecommendationNote(v.note);
  if (bad) throw new BusinessError(bad);
  if (v.recommendation === "EXTEND") {
    if (!v.months) throw new BusinessError("Say how many months to extend probation by.");
    const total = c.probationMonths + v.months;
    if (total > policy.maxProbationMonths) throw new BusinessError(`Probation would reach ${total} month(s); the HR policy allows at most ${policy.maxProbationMonths}.`);
  }
  const reviews = await db.probationReview.findMany({ where: { contractId: c.id, organizationId: ctx.orgId }, select: { round: true, status: true } });
  if (reviews.some((r) => (OPEN as readonly string[]).includes(r.status))) throw new BusinessError("A recommendation for this probation is already in progress.");
  const round = reviews.reduce((m, r) => Math.max(m, r.round), 0) + 1;
  const row = await db.probationReview.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: c.employeeId,
      contractId: c.id,
      round,
      recommendation: v.recommendation,
      recommendedMonths: v.recommendation === "EXTEND" ? v.months! : null,
      recommendationNote: v.note!.trim(),
      recommendedByUserId: ctx.userId,
      recommendedBy: ctx.name,
      recordedByHr,
    },
  });
  await logAudit(ctx, { action: "PROBATION_REVIEW_RECOMMEND", entity: "ProbationReview", entityId: row.id, newValue: { contractId: c.id, employeeId: c.employeeId, recommendation: v.recommendation, round, recordedByHr } });
  return row;
}

// ───────────────────────────── Step 2: the HR review ─────────────────────────────

const reviewSchema = z.object({ outcome: z.enum(["FORWARD", "RETURN"]), note: z.string().trim().min(MIN_REVIEW_NOTE, `Write the reason (at least ${MIN_REVIEW_NOTE} characters)`).max(1000) });

export async function reviewRecommendation(ctx: Ctx, reviewId: string, raw: z.input<typeof reviewSchema>) {
  assertCan(ctx, "hr.manage");
  const v = reviewSchema.parse(raw);
  const review = await db.probationReview.findFirst({ where: { id: reviewId, organizationId: ctx.orgId }, include: { contract: true } });
  if (!review) throw new BusinessError(NOT_FOUND);
  if (review.status !== "RECOMMENDED") throw new BusinessError("This recommendation has already been reviewed: it is past the HR review stage.");
  const conflict = reviewerConflict(ctx.userId, review.recommendedByUserId);
  if (conflict) throw new BusinessError(conflict);

  // what the policy checks show now, recorded with the review (null = the policy does not ask)
  const policy = await getHrPolicy(ctx.orgId);
  const appraisal = await probationAppraisalFor(ctx.orgId, review.contract);
  const released = appraisal && (appraisal.status === "APPROVED" || appraisal.status === "ACKNOWLEDGED") ? appraisal : null;
  const appraisalSignedOff = policy.probationRequiresAppraisal ? !!released : null;
  const minScore = num(policy.probationMinScore);
  const minScoreMet = policy.probationRequiresAppraisal && minScore > 0 ? !!released && released.overallScore != null && num(released.overallScore) >= minScore : null;
  const withinMaxMonths = review.contract.probationMonths + (review.recommendation === "EXTEND" ? (review.recommendedMonths ?? 0) : 0) <= policy.maxProbationMonths;

  const row = await db.probationReview.update({
    where: { id: reviewId },
    data: { status: v.outcome === "FORWARD" ? "FORWARDED" : "RETURNED", reviewNote: v.note, reviewedByUserId: ctx.userId, reviewedBy: ctx.name, reviewedAt: new Date(), appraisalSignedOff, minScoreMet, withinMaxMonths },
  });
  await logAudit(ctx, { action: "PROBATION_REVIEW_HR", entity: "ProbationReview", entityId: reviewId, newValue: { contractId: review.contractId, outcome: v.outcome } });
  return row;
}

// ───────────────────────────── Step 3: the independent decision ─────────────────────────────

/** The Company Administrator and platform staff may always decide; anyone else only through a live designation, for their department or for all. */
export async function isDesignatedDecider(ctx: Ctx, departmentId: string | null): Promise<boolean> {
  if (ctx.role === "COMPANY_ADMIN" || ctx.role === "SUPER_ADMIN") return true;
  const rows = await db.probationDecider.findMany({ where: { organizationId: ctx.orgId, userId: ctx.userId, revokedAt: null }, select: { departmentId: true } });
  return rows.some((r) => r.departmentId === null || r.departmentId === departmentId);
}

const decideSchema = z.object({
  decision: z.enum(["CONFIRMED", "EXTENDED", "FAILED"]),
  note: z.string().optional(),
  extensionMonths: z.coerce.number().int().min(1).max(12).optional(),
  effectiveDate: z.string().optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  feedback: z.string().optional(),
});

export async function decideReview(ctx: Ctx, reviewId: string, raw: z.input<typeof decideSchema>) {
  const v = decideSchema.parse(raw);
  const review = await db.probationReview.findFirst({ where: { id: reviewId, organizationId: ctx.orgId }, include: { contract: true, employee: { select: { id: true, departmentId: true } } } });
  if (!review) throw new BusinessError(NOT_FOUND);
  if (review.status !== "FORWARDED") throw new BusinessError(`This review is not at the decision stage (it is ${review.status.toLowerCase()}).`);
  if (!(await isDesignatedDecider(ctx, review.employee.departmentId))) throw new BusinessError("Only a designated decider can make the final probation decision.");
  const appraisal = await probationAppraisalFor(ctx.orgId, review.contract);
  const conflict = deciderConflict(ctx.userId, {
    recommenderUserId: review.recommendedByUserId,
    reviewerUserId: review.reviewedByUserId,
    employeeId: review.employeeId,
    deciderEmployeeId: ctx.employeeId ?? null,
    appraisal: appraisal ? { reviewerUserId: appraisal.reviewerUserId, approvedByUserId: appraisal.approvedByUserId } : null,
  });
  if (conflict) throw new BusinessError(conflict);

  const feedbackProblem = checkFeedback(v.decision, v.feedback);
  if (feedbackProblem) throw new BusinessError(feedbackProblem);
  const against = departsFromReview(v.decision, review.recommendation as Recommendation);
  if (against && (v.note ?? "").trim().length < AGAINST_MIN)
    throw new BusinessError(`This decision is not the one the manager recommended: give a fuller reason (at least ${AGAINST_MIN} characters).`);

  const result = await applyProbationDecision(
    ctx,
    review.contractId,
    { decision: v.decision, note: v.note, extensionMonths: v.decision === "EXTENDED" ? (v.extensionMonths ?? review.recommendedMonths ?? undefined) : undefined, effectiveDate: v.effectiveDate, noticePeriodDays: v.noticePeriodDays },
    { reviewId: review.id, feedback: v.feedback?.trim() || null, against },
  );
  const done = await db.probationReview.findUniqueOrThrow({ where: { id: review.id } });
  await logAudit(ctx, { action: "PROBATION_REVIEW_DECIDE", entity: "ProbationReview", entityId: review.id, newValue: { contractId: review.contractId, decision: v.decision, against } });
  return { ...result, review: done };
}

// ───────────────────────────── Steps 4 and 5: the feedback and the response ─────────────────────────────

const responseSchema = z.object({ agree: z.boolean(), comment: z.string().optional() });

/** The employee's one response, once HR has told them, inside the company's window (counted from the day they were told). It changes nothing by itself. */
export async function respondToReview(ctx: Ctx, reviewId: string, raw: z.input<typeof responseSchema>) {
  const v = responseSchema.parse(raw);
  const review = ctx.employeeId
    ? await db.probationReview.findFirst({ where: { id: reviewId, organizationId: ctx.orgId, employeeId: ctx.employeeId }, select: { id: true, contractId: true, respondedAt: true, decision: { select: { informedAt: true } } } })
    : null;
  if (!review) throw new BusinessError(NOT_FOUND);
  const informedAt = review.decision?.informedAt;
  if (!informedAt) throw new BusinessError("HR has not told you about this decision yet.");
  if (review.respondedAt) throw new BusinessError("You have already responded to this decision.");
  const policy = await getHrPolicy(ctx.orgId);
  if (!responseOpen(iso(informedAt), todayIso(), policy.probationResponseDays))
    throw new BusinessError(`The time to respond has passed (the window is ${policy.probationResponseDays} days from the day you were told).`);
  const bad = checkResponse(v.agree, v.comment);
  if (bad) throw new BusinessError(bad);
  const row = await db.probationReview.update({ where: { id: reviewId }, data: { responseAgreed: v.agree, responseText: v.comment?.trim() || null, respondedAt: new Date() } });
  await logAudit(ctx, { action: "PROBATION_REVIEW_RESPOND", entity: "ProbationReview", entityId: reviewId, newValue: { contractId: review.contractId, agreed: v.agree } });
  return row;
}

/** A designated decider records that they read the employee's response. */
export async function markResponseRead(ctx: Ctx, reviewId: string) {
  const review = await db.probationReview.findFirst({ where: { id: reviewId, organizationId: ctx.orgId }, select: { id: true, contractId: true, respondedAt: true, responseReadAt: true, employee: { select: { departmentId: true } } } });
  if (!review) throw new BusinessError(NOT_FOUND);
  if (!(await isDesignatedDecider(ctx, review.employee.departmentId))) throw new BusinessError("Only a designated decider can record that a response was read.");
  if (!review.respondedAt) throw new BusinessError("The employee has not responded.");
  if (review.responseReadAt) throw new BusinessError("This response is already marked as read.");
  const row = await db.probationReview.update({ where: { id: reviewId }, data: { responseReadAt: new Date(), responseReadByUserId: ctx.userId, responseReadBy: ctx.name } });
  await logAudit(ctx, { action: "PROBATION_REVIEW_READ", entity: "ProbationReview", entityId: reviewId, newValue: { contractId: review.contractId } });
  return row;
}

// ───────────────────────────── Designating deciders ─────────────────────────────

const designateSchema = z.object({ userId: z.string().min(1), departmentId: z.string().optional(), reason: z.string().trim().min(5, "Give the reason (at least five characters)").max(300) });

export async function designateDecider(ctx: Ctx, raw: z.input<typeof designateSchema>) {
  assertCan(ctx, "probation.designate");
  const v = designateSchema.parse(raw);
  const u = await db.user.findFirst({ where: { id: v.userId, organizationId: ctx.orgId, active: true }, select: { id: true } });
  if (!u) throw new BusinessError("User not found.");
  if (v.departmentId && !(await db.department.findFirst({ where: { id: v.departmentId, organizationId: ctx.orgId }, select: { id: true } }))) throw new BusinessError("Department not found.");
  const dup = await db.probationDecider.findFirst({ where: { organizationId: ctx.orgId, userId: u.id, departmentId: v.departmentId ?? null, revokedAt: null }, select: { id: true } });
  if (dup) throw new BusinessError("This person is already designated for that scope.");
  const row = await db.probationDecider.create({ data: { organizationId: ctx.orgId, userId: u.id, departmentId: v.departmentId ?? null, reason: v.reason, grantedByUserId: ctx.userId, grantedBy: ctx.name } });
  await logAudit(ctx, { action: "PROBATION_DECIDER_DESIGNATE", entity: "ProbationDecider", entityId: row.id, newValue: { userId: u.id, departmentId: v.departmentId ?? null } });
  return row;
}

export async function revokeDecider(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "probation.designate");
  const why = z.string().trim().min(5, "Give the reason (at least five characters)").max(300).parse(reason ?? "");
  const row = await db.probationDecider.findFirst({ where: { id, organizationId: ctx.orgId }, select: { id: true, userId: true, revokedAt: true } });
  if (!row) throw new BusinessError("Designation not found.");
  if (row.revokedAt) throw new BusinessError("This designation is already revoked.");
  const u = await db.probationDecider.update({ where: { id }, data: { revokedAt: new Date(), revokedByUserId: ctx.userId, revokedBy: ctx.name, revokeReason: why } });
  await logAudit(ctx, { action: "PROBATION_DECIDER_REVOKE", entity: "ProbationDecider", entityId: id, newValue: { userId: row.userId } });
  return u;
}

export async function listDeciders(ctx: Ctx) {
  assertCan(ctx, "probation.designate");
  const rows = await db.probationDecider.findMany({
    where: { organizationId: ctx.orgId },
    select: { id: true, userId: true, user: { select: { name: true, email: true } }, departmentId: true, department: { select: { name: true } }, reason: true, grantedBy: true, grantedAt: true, revokedAt: true },
    orderBy: { grantedAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, userId: r.userId, userName: r.user.name, email: r.user.email, departmentId: r.departmentId, departmentName: r.department?.name ?? null, reason: r.reason, grantedBy: r.grantedBy, grantedAt: r.grantedAt, revokedAt: r.revokedAt }));
}

// ───────────────────────────── Reading ─────────────────────────────

/** Every round for one contract, newest first, for HR. */
export async function reviewsForContract(ctx: Ctx, contractId: string) {
  assertCan(ctx, "hr.view");
  const c = await db.employmentContract.findFirst({ where: { id: contractId, organizationId: ctx.orgId }, select: { id: true } });
  if (!c) throw new BusinessError(NO_CONTRACT);
  return db.probationReview.findMany({ where: { contractId, organizationId: ctx.orgId }, orderBy: { round: "desc" } });
}

/** What a manager may recommend on now: their own direct reports (and, for HR, people with no reporting manager) whose probation is inside the window. */
export async function teamProbations(ctx: Ctx) {
  assertCan(ctx, "probation.recommend");
  const policy = await getHrPolicy(ctx.orgId);
  if (!policy.probationWorkflow) return [];
  const asHr = can(ctx.role, "hr.manage");
  const rows = await db.employmentContract.findMany({
    where: {
      organizationId: ctx.orgId,
      status: "ACTIVE",
      probationOutcome: { in: ["PENDING", "EXTENDED"] },
      probationEndDate: { not: null },
      employee: { OR: [...(ctx.employeeId ? [{ reportingManagerId: ctx.employeeId }] : []), ...(asHr ? [{ reportingManagerId: null }] : [])] },
    },
    select: { id: true, employeeId: true, probationEndDate: true, probationMonths: true, employee: { select: { firstName: true, lastName: true, employeeNumber: true } }, probationReviews: { where: { status: { in: [...OPEN] } }, select: { id: true, status: true }, take: 1 } },
    orderBy: { probationEndDate: "asc" },
  });
  const today = todayIso();
  return rows
    .filter((r) => r.employeeId !== ctx.employeeId && recommendationWindowOpen(iso(r.probationEndDate), today, policy.probationAlertDays))
    .map((r) => ({ contractId: r.id, employeeId: r.employeeId, name: `${r.employee.firstName} ${r.employee.lastName}`, employeeNumber: r.employee.employeeNumber, probationEndDate: r.probationEndDate!, months: r.probationMonths, openReview: r.probationReviews[0] ?? null }));
}

/** Recommendations waiting for HR to review. */
export async function reviewQueue(ctx: Ctx) {
  assertCan(ctx, "hr.manage");
  const rows = await db.probationReview.findMany({
    where: { organizationId: ctx.orgId, status: "RECOMMENDED" },
    select: { id: true, contractId: true, recommendation: true, recommendedAt: true, recommendedByUserId: true, recordedByHr: true, employee: { select: { firstName: true, lastName: true, employeeNumber: true } } },
    orderBy: { recommendedAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, contractId: r.contractId, recommendation: r.recommendation, recommendedAt: r.recommendedAt, recordedByHr: r.recordedByHr, mine: r.recommendedByUserId === ctx.userId, name: `${r.employee.firstName} ${r.employee.lastName}`, employeeNumber: r.employee.employeeNumber }));
}

/** For a designated decider: reviews forwarded to them (never one they are conflicted on), and responses they have not marked as read. */
export async function decisionQueue(ctx: Ctx) {
  const empty = { toDecide: [] as Array<{ id: string; contractId: string; recommendation: string; recommendedMonths: number | null; recommendationNote: string; recommendedBy: string; reviewNote: string | null; reviewedBy: string | null; appraisalSignedOff: boolean | null; minScoreMet: boolean | null; withinMaxMonths: boolean | null; name: string; employeeNumber: string; probationEndDate: Date | null }>, unreadResponses: [] as Array<{ id: string; name: string; employeeNumber: string; respondedAt: Date }> };
  const isAdmin = ctx.role === "COMPANY_ADMIN" || ctx.role === "SUPER_ADMIN";
  if (!isAdmin && (await db.probationDecider.count({ where: { organizationId: ctx.orgId, userId: ctx.userId, revokedAt: null } })) === 0) return empty;
  const [forwarded, unread] = await Promise.all([
    db.probationReview.findMany({
      where: { organizationId: ctx.orgId, status: "FORWARDED" },
      select: { id: true, contractId: true, recommendation: true, recommendedMonths: true, recommendationNote: true, recommendedBy: true, reviewNote: true, reviewedBy: true, appraisalSignedOff: true, minScoreMet: true, withinMaxMonths: true, recommendedByUserId: true, reviewedByUserId: true, employeeId: true, contract: { select: { probationEndDate: true } }, employee: { select: { firstName: true, lastName: true, employeeNumber: true, departmentId: true } } },
      orderBy: { recommendedAt: "asc" },
    }),
    db.probationReview.findMany({
      where: { organizationId: ctx.orgId, respondedAt: { not: null }, responseReadAt: null },
      select: { id: true, respondedAt: true, employee: { select: { firstName: true, lastName: true, employeeNumber: true, departmentId: true } } },
      orderBy: { respondedAt: "asc" },
    }),
  ]);
  const toDecide = [];
  for (const r of forwarded) {
    if (!(await isDesignatedDecider(ctx, r.employee.departmentId))) continue;
    if (r.recommendedByUserId === ctx.userId || r.reviewedByUserId === ctx.userId || (ctx.employeeId && ctx.employeeId === r.employeeId)) continue;
    toDecide.push({ id: r.id, contractId: r.contractId, recommendation: r.recommendation, recommendedMonths: r.recommendedMonths, recommendationNote: r.recommendationNote, recommendedBy: r.recommendedBy, reviewNote: r.reviewNote, reviewedBy: r.reviewedBy, appraisalSignedOff: r.appraisalSignedOff, minScoreMet: r.minScoreMet, withinMaxMonths: r.withinMaxMonths, name: `${r.employee.firstName} ${r.employee.lastName}`, employeeNumber: r.employee.employeeNumber, probationEndDate: r.contract.probationEndDate });
  }
  const unreadResponses = [];
  for (const r of unread) {
    if (!(await isDesignatedDecider(ctx, r.employee.departmentId))) continue;
    unreadResponses.push({ id: r.id, name: `${r.employee.firstName} ${r.employee.lastName}`, employeeNumber: r.employee.employeeNumber, respondedAt: r.respondedAt! });
  }
  return { toDecide, unreadResponses };
}

/** The signed-in employee's own decided probations that HR has told them about: the decision, the feedback written for them and their response. Never the internal notes. */
export async function myProbationReviews(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const policy = await getHrPolicy(ctx.orgId);
  const rows = await db.probationReview.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, status: "DECIDED", decision: { informedAt: { not: null } } },
    select: { id: true, feedbackText: true, responseAgreed: true, responseText: true, respondedAt: true, decision: { select: { decision: true, effectiveDate: true, decidedAt: true, informedAt: true } } },
    orderBy: { decidedAt: "desc" },
  });
  const today = todayIso();
  return rows.map((r) => ({
    id: r.id,
    decision: r.decision!.decision,
    effectiveDate: r.decision!.effectiveDate,
    decidedAt: r.decision!.decidedAt,
    feedback: r.feedbackText,
    response: r.respondedAt ? { agreed: r.responseAgreed, text: r.responseText, at: r.respondedAt } : null,
    canRespond: !r.respondedAt && responseOpen(iso(r.decision!.informedAt!), today, policy.probationResponseDays),
  }));
}
