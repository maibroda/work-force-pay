/**
 * Career: the company's career paths (guidance), promotion proposals and their decision, and the employee's own career page.
 *
 * A promotion proposal is a RECORD OF A DECISION. Approving it changes no category, pay, allowance or payroll figure: HR applies it afterwards on the existing
 * screens (and pay goes through the existing pay-rate proposal and its own approval). Marking it applied checks that the employee's category really is the new one.
 * Who may propose whom is the same rule as for feedback (`mayGiveFeedback`): reused, not written again. The person who proposed never decides.
 * The audit log carries ids and warning codes only, never a reason or a note.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import { mayGiveFeedback } from "@/lib/feedback";
import { monthsBetween, promotionStatusAfter, proposalWarnings, proposerConflict, type PromotionStatus } from "@/lib/career";
import { assess } from "@/lib/training-compliance";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { todayUtc } from "./hr-policy";

const todayIso = () => iso(todayUtc());
const EMPLOYEE_SELECT = { id: true, employeeNumber: true, firstName: true, lastName: true } as const;
const NOT_FOUND = "Promotion proposal not found.";
const reasonText = (min: number, msg: string) => z.string().trim().min(min, msg).max(1000);

// ───────────────────────────── Career paths (guidance) ─────────────────────────────

export const careerPathSchema = z.object({
  fromCategoryId: z.string().min(1),
  toCategoryId: z.string().min(1),
  minMonths: z.coerce.number().int().min(0).max(600).optional(),
  requiredCourse: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export async function addCareerPath(ctx: Ctx, raw: z.input<typeof careerPathSchema>) {
  assertCan(ctx, "hr.configure");
  const v = careerPathSchema.parse(raw);
  if (v.fromCategoryId === v.toCategoryId) throw new BusinessError("Choose two different roles.");
  const cats = await db.employeeCategory.findMany({ where: { organizationId: ctx.orgId, id: { in: [v.fromCategoryId, v.toCategoryId] } }, select: { id: true } });
  if (cats.length !== 2) throw new BusinessError("Role not found.");
  if (await db.careerPath.findFirst({ where: { organizationId: ctx.orgId, fromCategoryId: v.fromCategoryId, toCategoryId: v.toCategoryId }, select: { id: true } }))
    throw new BusinessError("A career path for this move already exists.");
  const p = await db.careerPath.create({
    data: { organizationId: ctx.orgId, fromCategoryId: v.fromCategoryId, toCategoryId: v.toCategoryId, minMonths: v.minMonths ?? null, requiredCourse: v.requiredCourse ?? null, createdBy: ctx.name },
  });
  await logAudit(ctx, { action: "CAREER_PATH_ADD", entity: "CareerPath", entityId: p.id, newValue: { fromCategoryId: p.fromCategoryId, toCategoryId: p.toCategoryId, minMonths: p.minMonths } });
  return p;
}

export async function setCareerPathActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "hr.configure");
  const p = await db.careerPath.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!p) throw new BusinessError("Career path not found.");
  const u = await db.careerPath.update({ where: { id }, data: { active } });
  await logAudit(ctx, { action: "CAREER_PATH_UPDATE", entity: "CareerPath", entityId: id, newValue: { active } });
  return u;
}

/** HR and managers who propose read the paths; an employee reads only the paths from their own role (My career). */
export async function listCareerPaths(ctx: Ctx) {
  if (!can(ctx.role, "hr.view")) assertCan(ctx, "career.propose");
  return db.careerPath.findMany({
    where: { organizationId: ctx.orgId },
    include: { fromCategory: { select: { id: true, name: true } }, toCategory: { select: { id: true, name: true } } },
    orderBy: [{ fromCategory: { name: "asc" } }, { toCategory: { name: "asc" } }],
  });
}

// ───────────────────────────── Evidence ─────────────────────────────

/** The day the employee's current role began: the last applied promotion into it, else the day they joined. */
async function roleSince(orgId: string, employeeId: string, categoryId: string, employmentDate: Date): Promise<string> {
  const last = await db.promotionProposal.findFirst({ where: { organizationId: orgId, employeeId, toCategoryId: categoryId, status: "APPLIED", appliedAt: { not: null } }, orderBy: { appliedAt: "desc" }, select: { appliedAt: true } });
  return last?.appliedAt ? iso(last.appliedAt) : iso(employmentDate);
}

async function courseValid(orgId: string, employeeId: string, course: string, employmentDate: Date): Promise<boolean> {
  const certs = await db.employeeTraining.findMany({ where: { organizationId: orgId, employeeId }, select: { courseName: true, expiryDate: true, status: true } });
  const a = assess({ courseName: course, graceDays: 0 }, certs, employmentDate, todayUtc(), 0);
  return a.state === "VALID" || a.state === "EXPIRING";
}

async function openFlags(orgId: string, employeeId: string) {
  const [plan, discipline] = await Promise.all([
    db.performanceImprovementPlan.findFirst({ where: { organizationId: orgId, employeeId, status: { in: ["DRAFT", "AWAITING_APPROVAL", "ACTIVE", "OUTCOME_PROPOSED"] } }, select: { id: true } }),
    db.relationsCase.findFirst({ where: { organizationId: orgId, employeeId, type: "MISCONDUCT", status: { in: ["OPEN", "INVESTIGATING", "HEARING"] } }, select: { id: true } }),
  ]);
  return { openPlan: !!plan, openDiscipline: !!discipline };
}

/** What the person deciding reads beside a proposal. Read-only, and never the contents of a plan or case: only whether one is open. */
export async function promotionEvidence(ctx: Ctx, employeeId: string) {
  assertCan(ctx, "hr.view");
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId }, select: { id: true, categoryId: true, employmentDate: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  const [since, appraisal, flags, paths] = await Promise.all([
    roleSince(ctx.orgId, emp.id, emp.categoryId, emp.employmentDate),
    db.appraisal.findFirst({ where: { organizationId: ctx.orgId, employeeId: emp.id, status: { in: ["APPROVED", "ACKNOWLEDGED"] } }, orderBy: { approvedAt: "desc" }, select: { overallScore: true, overallBand: true, recommendation: true, approvedAt: true } }),
    openFlags(ctx.orgId, emp.id),
    db.careerPath.findMany({ where: { organizationId: ctx.orgId, fromCategoryId: emp.categoryId, active: true }, include: { toCategory: { select: { id: true, name: true } } } }),
  ]);
  return {
    monthsInRole: monthsBetween(since, todayIso()),
    latestAppraisal: appraisal ? { score: appraisal.overallScore === null ? null : Number(appraisal.overallScore), band: appraisal.overallBand, recommendation: appraisal.recommendation } : null,
    ...flags,
    paths: paths.map((p) => ({ toCategoryId: p.toCategory.id, toRole: p.toCategory.name, minMonths: p.minMonths, requiredCourse: p.requiredCourse })),
  };
}

// ───────────────────────────── Proposing ─────────────────────────────

export const proposalSchema = z.object({
  employeeId: z.string().min(1),
  toCategoryId: z.string().min(1),
  reason: reasonText(10, "Say why, in a few plain sentences"),
  intendedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the intended date"),
});

export async function proposePromotion(ctx: Ctx, raw: z.input<typeof proposalSchema>) {
  assertCan(ctx, "career.propose");
  const v = proposalSchema.parse(raw);
  const emp = await db.employee.findFirst({
    where: { id: v.employeeId, organizationId: ctx.orgId },
    select: { id: true, status: true, categoryId: true, employmentDate: true, reportingManagerId: true },
  });
  if (!emp) throw new BusinessError("Employee not found.");
  // the same rule as for feedback: a manager about a direct report, HR about anyone, nobody about themselves
  const verdict = mayGiveFeedback({ giverEmployeeId: ctx.employeeId ?? null, isHr: can(ctx.role, "hr.manage") }, { employeeId: emp.id, reportingManagerId: emp.reportingManagerId });
  if (verdict === "SELF") throw new BusinessError("You can't propose yourself.");
  if (verdict === "NOT_FOUND") throw new BusinessError("Employee not found.");
  if (emp.status !== "ACTIVE" && emp.status !== "ON_LEAVE") throw new BusinessError("This employee is no longer active, so they can't be proposed.");
  const to = await db.employeeCategory.findFirst({ where: { id: v.toCategoryId, organizationId: ctx.orgId }, select: { id: true } });
  if (!to) throw new BusinessError("Role not found.");
  if (to.id === emp.categoryId) throw new BusinessError("Choose a different role from the one they have now.");
  if (v.intendedOn < todayIso()) throw new BusinessError("The intended date can't be in the past.");
  if (await db.promotionProposal.findFirst({ where: { organizationId: ctx.orgId, employeeId: emp.id, status: { in: ["PROPOSED", "APPROVED"] } }, select: { id: true } }))
    throw new BusinessError("This employee already has a promotion proposal that is not yet decided or applied.");

  const path = await db.careerPath.findFirst({ where: { organizationId: ctx.orgId, fromCategoryId: emp.categoryId, toCategoryId: to.id, active: true } });
  const since = await roleSince(ctx.orgId, emp.id, emp.categoryId, emp.employmentDate);
  const flags = await openFlags(ctx.orgId, emp.id);
  const warnings = proposalWarnings({
    pathExists: !!path,
    minMonths: path?.minMonths ?? null,
    monthsInRole: monthsBetween(since, todayIso()),
    courseRequired: path?.requiredCourse ?? null,
    courseValid: path?.requiredCourse ? await courseValid(ctx.orgId, emp.id, path.requiredCourse, emp.employmentDate) : null,
    ...flags,
  });
  const p = await db.promotionProposal.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: emp.id,
      fromCategoryId: emp.categoryId,
      toCategoryId: to.id,
      reason: v.reason,
      intendedOn: d(v.intendedOn),
      warnings,
      proposedByUserId: ctx.userId,
      proposedBy: ctx.name,
    },
  });
  await logAudit(ctx, { action: "PROMOTION_PROPOSE", entity: "PromotionProposal", entityId: p.id, newValue: { employeeId: emp.id, fromCategoryId: emp.categoryId, toCategoryId: to.id, warnings } });
  return p;
}

// ───────────────────────────── Deciding, withdrawing, applying ─────────────────────────────

async function loadProposal(ctx: Ctx, id: string) {
  const p = await db.promotionProposal.findFirst({ where: { id, organizationId: ctx.orgId }, include: { employee: { select: { id: true, categoryId: true } } } });
  if (!p) throw new BusinessError(NOT_FOUND);
  return p;
}

/** A second person (hr.approve) approves; never the person who proposed it. With a warning on the proposal, a reason is needed. Changes nothing about the employee. */
export async function approvePromotion(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "hr.approve");
  const p = await loadProposal(ctx, id);
  const conflict = proposerConflict(ctx.userId, p.proposedByUserId);
  if (conflict) throw new BusinessError(conflict);
  if (!promotionStatusAfter(p.status as PromotionStatus, "APPROVE")) throw new BusinessError(`This proposal is already ${p.status.toLowerCase()}.`);
  if (p.employee.categoryId !== p.fromCategoryId) throw new BusinessError("The employee's role has changed since this was proposed, so it can't be approved. Withdraw it and propose again.");
  const why = (note ?? "").trim();
  if (p.warnings.length && why.length < 5) throw new BusinessError("A reason is needed to approve a proposal that has a warning.");
  const u = await db.promotionProposal.update({ where: { id }, data: { status: "APPROVED", decidedByUserId: ctx.userId, decidedBy: ctx.name, decidedAt: new Date(), decisionNote: why ? why.slice(0, 500) : null } });
  await logAudit(ctx, { action: "PROMOTION_APPROVE", entity: "PromotionProposal", entityId: id, newValue: { employeeId: p.employeeId, toCategoryId: p.toCategoryId, warnings: p.warnings } });
  return u;
}

export async function declinePromotion(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "hr.approve");
  const why = reasonText(5, "A reason is needed").parse(reason ?? "");
  const p = await loadProposal(ctx, id);
  const conflict = proposerConflict(ctx.userId, p.proposedByUserId);
  if (conflict) throw new BusinessError(conflict);
  if (!promotionStatusAfter(p.status as PromotionStatus, "DECLINE")) throw new BusinessError(`This proposal is already ${p.status.toLowerCase()}.`);
  const u = await db.promotionProposal.update({ where: { id }, data: { status: "DECLINED", decidedByUserId: ctx.userId, decidedBy: ctx.name, decidedAt: new Date(), decisionNote: why } });
  await logAudit(ctx, { action: "PROMOTION_DECLINE", entity: "PromotionProposal", entityId: id, newValue: { employeeId: p.employeeId, toCategoryId: p.toCategoryId } });
  return u;
}

/** The proposer withdraws their own proposal while it is undecided; after approval only the approve right can withdraw. */
export async function withdrawPromotion(ctx: Ctx, id: string, reason: string) {
  const why = reasonText(5, "A reason is needed").parse(reason ?? "");
  const p = await loadProposal(ctx, id);
  const own = p.proposedByUserId === ctx.userId && p.status === "PROPOSED";
  if (!own) assertCan(ctx, "hr.approve");
  if (!promotionStatusAfter(p.status as PromotionStatus, "WITHDRAW")) throw new BusinessError(`This proposal is already ${p.status.toLowerCase()}.`);
  const u = await db.promotionProposal.update({ where: { id }, data: { status: "WITHDRAWN", withdrawnByUserId: ctx.userId, withdrawnBy: ctx.name, withdrawnAt: new Date(), withdrawReason: why } });
  await logAudit(ctx, { action: "PROMOTION_WITHDRAW", entity: "PromotionProposal", entityId: id, newValue: { employeeId: p.employeeId, toCategoryId: p.toCategoryId } });
  return u;
}

/** HR marks an approved promotion applied, once they have changed the employee's role on the existing screens. This changes no category and no pay itself. */
export async function applyPromotion(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.manage");
  const p = await loadProposal(ctx, id);
  if (!promotionStatusAfter(p.status as PromotionStatus, "APPLY")) throw new BusinessError("Only an approved proposal can be marked applied.");
  if (p.employee.categoryId !== p.toCategoryId) throw new BusinessError("Change the employee's role (category) first, then mark this applied.");
  const u = await db.promotionProposal.update({ where: { id }, data: { status: "APPLIED", appliedByUserId: ctx.userId, appliedBy: ctx.name, appliedAt: new Date() } });
  await logAudit(ctx, { action: "PROMOTION_APPLY", entity: "PromotionProposal", entityId: id, newValue: { employeeId: p.employeeId, toCategoryId: p.toCategoryId } });
  return u;
}

// ───────────────────────────── Reading ─────────────────────────────

/** HR (and the auditor) read every proposal with its warnings; a manager reads only the ones they made, without the warnings (they are for the decider). */
export async function listPromotions(ctx: Ctx, f: { status?: PromotionStatus } = {}) {
  const all = can(ctx.role, "hr.view");
  if (!all) assertCan(ctx, "career.propose");
  const rows = await db.promotionProposal.findMany({
    where: { organizationId: ctx.orgId, ...(all ? {} : { proposedByUserId: ctx.userId }), ...(f.status ? { status: f.status } : {}) },
    include: { employee: { select: EMPLOYEE_SELECT }, fromCategory: { select: { name: true } }, toCategory: { select: { name: true } } },
    orderBy: { proposedAt: "desc" },
    take: 300,
  });
  return rows.map((r) => {
    const { warnings, ...rest } = r;
    return all ? { ...rest, warnings } : rest;
  });
}

/** The signed-in employee's own career page: their role, the paths from it with their own progress, and their own approved or applied promotion (never one still being considered or declined). */
export async function myCareer(ctx: Ctx) {
  if (!ctx.employeeId) return { role: null as string | null, monthsInRole: 0, paths: [] as Array<{ toRole: string; minMonths: number | null; requiredCourse: string | null; serviceMet: boolean; courseValid: boolean | null }>, promotion: null as null | { toRole: string; status: string; intendedOn: Date; appliedAt: Date | null } };
  const emp = await db.employee.findFirst({ where: { id: ctx.employeeId, organizationId: ctx.orgId }, select: { id: true, categoryId: true, employmentDate: true, category: { select: { name: true } } } });
  if (!emp) return { role: null, monthsInRole: 0, paths: [], promotion: null };
  const since = await roleSince(ctx.orgId, emp.id, emp.categoryId, emp.employmentDate);
  const months = monthsBetween(since, todayIso());
  const [paths, promo] = await Promise.all([
    db.careerPath.findMany({ where: { organizationId: ctx.orgId, fromCategoryId: emp.categoryId, active: true }, include: { toCategory: { select: { name: true } } }, orderBy: { toCategory: { name: "asc" } } }),
    db.promotionProposal.findFirst({ where: { organizationId: ctx.orgId, employeeId: emp.id, status: { in: ["APPROVED", "APPLIED"] } }, orderBy: { proposedAt: "desc" }, include: { toCategory: { select: { name: true } } } }),
  ]);
  const progress = [];
  for (const p of paths)
    progress.push({
      toRole: p.toCategory.name,
      minMonths: p.minMonths,
      requiredCourse: p.requiredCourse,
      serviceMet: p.minMonths === null || months >= p.minMonths,
      courseValid: p.requiredCourse ? await courseValid(ctx.orgId, emp.id, p.requiredCourse, emp.employmentDate) : null,
    });
  return { role: emp.category.name, monthsInRole: months, paths: progress, promotion: promo ? { toRole: promo.toCategory.name, status: promo.status, intendedOn: promo.intendedOn, appliedAt: promo.appliedAt } : null };
}

/** The company's roles (employee categories), for the proposal and career-path forms. */
export async function listRoles(ctx: Ctx) {
  if (!can(ctx.role, "hr.view")) assertCan(ctx, "career.propose");
  return db.employeeCategory.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}
