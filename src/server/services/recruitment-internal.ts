/**
 * Internal vacancies (recruitment slice B, approved by the founder: plan section 5, rules 6 and 7; slice chosen 2026-11-17).
 *
 * HR publishes an APPROVED requisition inside the company with a MANDATORY deadline and a summary written for employees. Any employee may apply (once) while it is open. The system
 * tells NOBODY, least of all the applicant's manager: no message, no list, no page of the manager's carries the application. An internal applicant is read by HR (the right to assess
 * candidates) and the panel only (recruitment.ts, internalApplicantFilter). An internal applicant is already an employee, so the existing hire, which creates an employee, is refused for
 * them (hireCandidate). Selecting an internal applicant starts a PROMOTION PROPOSAL (startInternalMove, below): see docs/plans/internal-selection-plan.md.
 *
 * What an employee sees of a vacancy is a short list of fields. The justification, the budget, the hiring manager and who raised it are never shown.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { todayUtc } from "./hr-policy";
import { nextNumber } from "./numbering";
import { proposePromotion } from "./career";
import { LIVE_MOVE, takenPositions } from "./recruitment-moves";

const GONE = ["EXITED", "TERMINATED", "RESIGNED"];

async function loadRequisition(ctx: Ctx, id: string) {
  const r = await db.jobRequisition.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Requisition not found.");
  return r;
}

/** A vacancy is open to employees while it is published, approved and not past its deadline (the deadline day itself is still open). */
function isOpen(r: { publishedAt: Date | null; status: string; applicationDeadline: Date | null }) {
  return !!r.publishedAt && r.status === "APPROVED" && !!r.applicationDeadline && iso(r.applicationDeadline) >= iso(todayUtc());
}

// ───────────────────────────── HR publishes ─────────────────────────────

const publishSchema = z.object({
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Set the application deadline (a date)."),
  summary: z.string().trim().min(20, "Write a summary for employees (at least 20 characters).").max(600, "Keep the summary to 600 characters."),
});

/** Publishes (or updates) the vacancy inside the company. Approved requisitions only; the deadline is mandatory and not in the past. */
export async function publishVacancy(ctx: Ctx, requisitionId: string, raw: z.input<typeof publishSchema>) {
  assertCan(ctx, "hr.manage");
  const r = await loadRequisition(ctx, requisitionId);
  const v = publishSchema.parse(raw);
  if (r.status !== "APPROVED") throw new BusinessError("Only an approved requisition can be published.");
  if (v.deadline < iso(todayUtc())) throw new BusinessError("The deadline can't be in the past.");
  await db.$transaction(async (tx) => {
    await tx.jobRequisition.update({ where: { id: r.id }, data: { publishedAt: r.publishedAt ?? new Date(), applicationDeadline: d(v.deadline), vacancySummary: v.summary } });
    // the deadline and ids only: not the summary
    await logAudit(ctx, { action: "VACANCY_PUBLISH", entity: "JobRequisition", entityId: r.id, newValue: { deadline: v.deadline } }, tx);
  });
}

/** Takes the vacancy down. Applications already made stay. */
export async function unpublishVacancy(ctx: Ctx, requisitionId: string) {
  assertCan(ctx, "hr.manage");
  const r = await loadRequisition(ctx, requisitionId);
  await db.$transaction(async (tx) => {
    await tx.jobRequisition.update({ where: { id: r.id }, data: { publishedAt: null } });
    await logAudit(ctx, { action: "VACANCY_UNPUBLISH", entity: "JobRequisition", entityId: r.id }, tx);
  });
}

/** For HR's requisition page. */
export async function vacancyStatus(ctx: Ctx, requisitionId: string) {
  assertCan(ctx, "hr.view");
  const r = await loadRequisition(ctx, requisitionId);
  return { published: r.publishedAt !== null, deadline: r.applicationDeadline ? iso(r.applicationDeadline) : null, summary: r.vacancySummary, open: isOpen(r) };
}

// ───────────────────────────── An employee looks and applies ─────────────────────────────

/** The vacancies open to this employee, with only the fields an employee may see, and whether they have applied. Another company's vacancies are never listed. */
export async function openVacancies(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const rows = await db.jobRequisition.findMany({
    where: { organizationId: ctx.orgId, publishedAt: { not: null }, status: "APPROVED", applicationDeadline: { gte: d(iso(todayUtc())) } },
    select: { id: true, title: true, employmentType: true, targetStartDate: true, applicationDeadline: true, vacancySummary: true, category: { select: { name: true } }, department: { select: { name: true } } },
    orderBy: { applicationDeadline: "asc" },
  });
  const mine = await db.candidate.findMany({ where: { organizationId: ctx.orgId, applicantEmployeeId: ctx.employeeId, requisitionId: { in: rows.map((r) => r.id) } }, select: { requisitionId: true } });
  const applied = new Set(mine.map((c) => c.requisitionId));
  return rows.map((r) => ({
    requisitionId: r.id,
    title: r.title,
    category: r.category.name,
    department: r.department?.name ?? null,
    employmentType: r.employmentType,
    targetStartDate: r.targetStartDate,
    applicationDeadline: r.applicationDeadline!,
    summary: r.vacancySummary ?? "",
    applied: applied.has(r.id),
  }));
}

/** An employee applies to an open vacancy, once. It creates an internal candidate (source INTERNAL) and tells nobody. */
export async function applyInternally(ctx: Ctx, requisitionId: string, note?: string) {
  if (!ctx.employeeId) throw new BusinessError("Your login isn't linked to an employee record, so you can't apply.");
  const me = await db.employee.findFirst({ where: { id: ctx.employeeId, organizationId: ctx.orgId }, select: { id: true, firstName: true, lastName: true, status: true } });
  if (!me) throw new BusinessError("Your login isn't linked to an employee record, so you can't apply.");
  if (GONE.includes(me.status)) throw new BusinessError("You are no longer employed here, so you can't apply.");
  const r = await db.jobRequisition.findFirst({ where: { id: requisitionId, organizationId: ctx.orgId } });
  if (!r || !isOpen(r)) throw new BusinessError("This vacancy isn't open for applications.");
  if (r.hiringManagerId === me.id) throw new BusinessError("You are the hiring manager for this vacancy, so you can't apply for it.");
  const existing = await db.candidate.findFirst({ where: { requisitionId: r.id, applicantEmployeeId: me.id }, select: { id: true } });
  if (existing) throw new BusinessError("You have already applied for this vacancy.");
  const words = (note ?? "").trim();
  if (words.length > 500) throw new BusinessError("Keep your note to 500 characters.");
  return db.$transaction(async (tx) => {
    const candidateNumber = await nextNumber(tx, ctx.orgId, "CANDIDATE");
    const c = await tx.candidate.create({
      data: { organizationId: ctx.orgId, candidateNumber, requisitionId: r.id, firstName: me.firstName, lastName: me.lastName, source: "INTERNAL", applicantEmployeeId: me.id, notes: words || null, createdBy: me.firstName + " " + me.lastName },
    });
    // ids only: not the applicant's name or their note, and no message goes to anyone
    await logAudit(ctx, { action: "INTERNAL_APPLY", entity: "Candidate", entityId: c.id, newValue: { requisitionId: r.id } }, tx);
    return c;
  });
}

/** This employee's own applications: the vacancy, the stage and the day. Nothing HR recorded about them. */
export async function myApplications(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const rows = await db.candidate.findMany({
    where: { organizationId: ctx.orgId, applicantEmployeeId: ctx.employeeId },
    select: { id: true, stage: true, createdAt: true, requisition: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((c) => ({ candidateId: c.id, title: c.requisition.title, stage: c.stage, appliedOn: c.createdAt }));
}

// ───────────────────────────── Selecting an internal applicant: the move ─────────────────────────────

const moveSchema = z.object({
  intendedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the intended date (year-month-day)."),
  reason: z.string(),
});

/**
 * Selecting an internal applicant starts a PROMOTION PROPOSAL through the existing process, and nothing else (docs/plans/internal-selection-plan.md, S1 to S6, approved 2026-11-17):
 *  - HR administrator only (the right to assess candidates AND the right to propose promotions);
 *  - for an internal applicant who has reached the offer stage; a candidate a panel interviewed needs the chair's recommendation and a second person's approval first, as for an offer;
 *  - to the requisition's role; a move to the role they already hold is a lateral move, recorded on the employee screens (S2);
 *  - HR writes the reason: nothing from the interviews is copied; the proposal is linked to the candidate;
 *  - the existing promotion rules then apply unchanged (a different HR person approves, a warning needs a reason, the employee sees it only once approved, nobody is told by the system);
 *  - it takes a position on the vacancy from now until it is declined or withdrawn, and fills it when the promotion is applied (recruitment-moves.ts).
 * It sets no pay, no contract and no salary structure: those follow on the existing screens.
 */
export async function startInternalMove(ctx: Ctx, candidateId: string, raw: z.input<typeof moveSchema>) {
  assertCan(ctx, "recruitment.assess");
  assertCan(ctx, "career.propose");
  const v = moveSchema.parse(raw);
  const c = await db.candidate.findFirst({ where: { id: candidateId, organizationId: ctx.orgId }, include: { requisition: true } });
  if (!c) throw new BusinessError("Candidate not found.");
  if (!c.applicantEmployeeId) throw new BusinessError("This candidate is not an internal applicant: an outside candidate is hired, not moved.");
  if (c.stage !== "OFFER") throw new BusinessError("Move the candidate to the offer stage before starting the move.");
  const req = c.requisition;
  if (!["APPROVED", "ON_HOLD"].includes(req.status)) throw new BusinessError(`The requisition is ${req.status.replace(/_/g, " ").toLowerCase()} — it can't take a move.`);
  // a candidate a panel interviewed: the same recommendation and second-person approval an offer would need (recruitment.ts, createOffer)
  if (await db.interviewPanelMember.count({ where: { interview: { candidateId: c.id } } })) {
    const selection = await db.candidateSelection.findUnique({ where: { candidateId: c.id } });
    if (!selection) throw new BusinessError("A panel interviewed this candidate: the chair must recommend selecting them, and a second person must approve it, before the move can start.");
    if (selection.status !== "APPROVED") throw new BusinessError("The selection of this candidate has not been approved yet, so the move can't start.");
  }
  if (await db.promotionProposal.count({ where: { candidateId: c.id, status: { in: [...LIVE_MOVE] } } }))
    throw new BusinessError("A promotion proposal has already been started from this application. Withdraw it first to start another.");
  if ((await takenPositions(db, req.id)) >= req.headcount) throw new BusinessError(`All ${req.headcount} position(s) on this requisition are already filled or held by another move in progress.`);
  const emp = await db.employee.findFirst({ where: { id: c.applicantEmployeeId, organizationId: ctx.orgId }, select: { categoryId: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (emp.categoryId === req.categoryId)
    throw new BusinessError("This employee already holds the vacancy's role, so this is a lateral move, not a promotion. Record it on the employee screens (department, site or manager) and close the application with a reason.");
  // the existing promotion process: its own checks (the employee is active, the date is not in the past, a real reason, no other open proposal) and its own audit entry
  const p = await proposePromotion(ctx, { employeeId: c.applicantEmployeeId, toCategoryId: req.categoryId, reason: v.reason, intendedOn: v.intendedOn }, { candidateId: c.id });
  // ids only: not the reason, and nothing from the interviews
  await logAudit(ctx, { action: "INTERNAL_MOVE_START", entity: "Candidate", entityId: c.id, newValue: { requisitionId: req.id, proposalId: p.id } });
  return p;
}

/** HR's view of the move started from a candidate: the latest promotion proposal linked to it, or nothing. */
export async function internalMove(ctx: Ctx, candidateId: string) {
  assertCan(ctx, "recruitment.assess");
  const p = await db.promotionProposal.findFirst({ where: { organizationId: ctx.orgId, candidateId }, orderBy: { proposedAt: "desc" }, select: { id: true, status: true, intendedOn: true, appliedAt: true } });
  return p ? { proposalId: p.id, status: p.status, intendedOn: p.intendedOn, appliedAt: p.appliedAt } : null;
}
