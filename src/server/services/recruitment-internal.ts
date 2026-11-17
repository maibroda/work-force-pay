/**
 * Internal vacancies (recruitment slice B, approved by the founder: plan section 5, rules 6 and 7; slice chosen 2026-11-17).
 *
 * HR publishes an APPROVED requisition inside the company with a MANDATORY deadline and a summary written for employees. Any employee may apply (once) while it is open. The system
 * tells NOBODY, least of all the applicant's manager: no message, no list, no page of the manager's carries the application. An internal applicant is read by HR (the right to assess
 * candidates) and the panel only (recruitment.ts, internalApplicantFilter). An internal applicant is already an employee, so the existing hire, which creates an employee, is refused for
 * them (hireCandidate): the move itself is a promotion or transfer, which is not built here and is for the founder to decide.
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
