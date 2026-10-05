/**
 * Recruitment: requisition → candidates → interviews → vetting → offer → hire.
 *
 * Maker/checker throughout: a requisition or offer can't be approved by the person who raised it.
 * Hiring converts the candidate into an Employee, an employment contract and (for staff paid a
 * personal salary) a pay rate, and stamps the onboarding checklist — all in one transaction, so a
 * half-created hire can never exist.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { addDays, iso } from "@/lib/dates";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { contractSchema, createContractInTx, EMPLOYMENT_TYPES } from "./contracts";
import { createEmployeeInTx, employeeSchema } from "./employees";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { nextNumber } from "./numbering";
import { d } from "@/lib/dates";
import { num } from "@/lib/money";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const GONE = ["EXITED", "TERMINATED", "RESIGNED"];
const OPEN_STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "ASSESSMENT", "OFFER"] as const;
const OPEN_OFFER = ["PENDING_APPROVAL", "APPROVED", "SENT"];

// ───────────────────────────── Requisitions ─────────────────────────────

export const requisitionSchema = z.object({
  title: z.string().trim().min(3, "A job title is required"),
  categoryId: z.string().min(1, "Category is required"),
  departmentId: opt,
  costCenterId: opt,
  beatId: opt,
  hiringManagerId: opt,
  headcount: z.coerce.number().int().min(1).max(500).default(1),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("PERMANENT"),
  budgetedMonthlyGross: z.coerce.number().positive().optional(),
  justification: z.string().trim().min(5, "Say why this role is needed"),
  targetStartDate: opt,
});

export async function createRequisition(ctx: Ctx, raw: z.input<typeof requisitionSchema>) {
  assertCan(ctx, "hr.manage");
  const v = requisitionSchema.parse(raw);
  const cat = await db.employeeCategory.findFirst({ where: { id: v.categoryId, organizationId: ctx.orgId } });
  if (!cat) throw new BusinessError("Employee category not found.");
  if (v.departmentId && !(await db.department.findFirst({ where: { id: v.departmentId, organizationId: ctx.orgId } })))
    throw new BusinessError("Department not found.");
  if (v.costCenterId && !(await db.costCenter.findFirst({ where: { id: v.costCenterId, organizationId: ctx.orgId } })))
    throw new BusinessError("Cost center not found.");
  if (v.beatId && !(await db.beat.findFirst({ where: { id: v.beatId, organizationId: ctx.orgId } })))
    throw new BusinessError("Beat / location not found.");
  if (v.hiringManagerId && !(await db.employee.findFirst({ where: { id: v.hiringManagerId, organizationId: ctx.orgId } })))
    throw new BusinessError("Hiring manager not found.");
  return db.$transaction(async (tx) => {
    const requisitionNumber = await nextNumber(tx, ctx.orgId, "REQUISITION");
    const r = await tx.jobRequisition.create({
      data: {
        organizationId: ctx.orgId,
        requisitionNumber,
        title: v.title,
        categoryId: v.categoryId,
        departmentId: v.departmentId ?? null,
        costCenterId: v.costCenterId ?? null,
        beatId: v.beatId ?? null,
        hiringManagerId: v.hiringManagerId ?? null,
        headcount: v.headcount,
        employmentType: v.employmentType,
        budgetedMonthlyGross: v.budgetedMonthlyGross ?? null,
        justification: v.justification,
        targetStartDate: v.targetStartDate ? d(v.targetStartDate) : null,
        requestedBy: ctx.name,
        requestedById: ctx.userId,
      },
    });
    await logAudit(ctx, { action: "REQUISITION_RAISE", entity: "JobRequisition", entityId: r.id, newValue: r }, tx);
    return r;
  });
}

async function loadRequisition(ctx: Ctx, id: string) {
  const r = await db.jobRequisition.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Requisition not found.");
  return r;
}

export async function approveRequisition(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "hr.approve");
  const r = await loadRequisition(ctx, id);
  if (r.status !== "PENDING_APPROVAL") throw new BusinessError(`This requisition is already ${r.status.replace(/_/g, " ").toLowerCase()}.`);
  if (r.requestedById === ctx.userId) throw new BusinessError("You can't approve a requisition you raised — someone else must.");
  const u = await db.jobRequisition.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: ctx.name, approvedAt: new Date(), decisionNote: note?.trim() || null },
  });
  await logAudit(ctx, { action: "REQUISITION_APPROVE", entity: "JobRequisition", entityId: id, newValue: u });
  return u;
}

export async function rejectRequisition(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "hr.approve");
  if (!note || note.trim().length < 3) throw new BusinessError("Give a reason for rejecting the requisition.");
  const r = await loadRequisition(ctx, id);
  if (r.status !== "PENDING_APPROVAL") throw new BusinessError(`This requisition is already ${r.status.replace(/_/g, " ").toLowerCase()}.`);
  if (r.requestedById === ctx.userId) throw new BusinessError("You can't decide a requisition you raised — someone else must.");
  const u = await db.jobRequisition.update({
    where: { id },
    data: { status: "REJECTED", approvedBy: ctx.name, approvedAt: new Date(), decisionNote: note.trim() },
  });
  await logAudit(ctx, { action: "REQUISITION_REJECT", entity: "JobRequisition", entityId: id, newValue: u, reason: note });
  return u;
}

/** Pause or resume hiring against an approved requisition. */
export async function setRequisitionHold(ctx: Ctx, id: string, hold: boolean) {
  assertCan(ctx, "hr.manage");
  const r = await loadRequisition(ctx, id);
  if (hold && r.status !== "APPROVED") throw new BusinessError("Only an open (approved) requisition can be put on hold.");
  if (!hold && r.status !== "ON_HOLD") throw new BusinessError("This requisition isn't on hold.");
  const u = await db.jobRequisition.update({ where: { id }, data: { status: hold ? "ON_HOLD" : "APPROVED" } });
  await logAudit(ctx, { action: hold ? "REQUISITION_HOLD" : "REQUISITION_RESUME", entity: "JobRequisition", entityId: id });
  return u;
}

/** Closes a requisition without filling it (role cancelled / budget pulled). */
export async function closeRequisition(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "hr.manage");
  if (!reason || reason.trim().length < 3) throw new BusinessError("Give a reason for closing the requisition.");
  const r = await loadRequisition(ctx, id);
  if (!["APPROVED", "ON_HOLD", "PENDING_APPROVAL"].includes(r.status))
    throw new BusinessError(`A ${r.status.replace(/_/g, " ").toLowerCase()} requisition can't be closed.`);
  const open = await db.candidate.count({
    where: { requisitionId: id, organizationId: ctx.orgId, stage: { in: [...OPEN_STAGES] } },
  });
  if (open) throw new BusinessError(`${open} candidate(s) are still in the pipeline — reject or move them first.`);
  const u = await db.jobRequisition.update({ where: { id }, data: { status: "CLOSED", decisionNote: reason.trim() } });
  await logAudit(ctx, { action: "REQUISITION_CLOSE", entity: "JobRequisition", entityId: id, reason });
  return u;
}

export async function listRequisitions(ctx: Ctx, f: { status?: string } = {}) {
  assertCan(ctx, "hr.view");
  const rows = await db.jobRequisition.findMany({
    where: { organizationId: ctx.orgId, ...(f.status ? { status: f.status as never } : {}) },
    include: { category: true, department: true, candidates: { select: { stage: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return rows.map((r) => ({
    ...r,
    inPipeline: r.candidates.filter((c) => (OPEN_STAGES as readonly string[]).includes(c.stage)).length,
    hired: r.candidates.filter((c) => c.stage === "HIRED").length,
  }));
}

export async function getRequisition(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.view");
  const r = await db.jobRequisition.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      category: true,
      department: true,
      costCenter: true,
      hiringManager: true,
      candidates: {
        include: { interviews: true, checks: true, offers: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return r;
}

// ───────────────────────────── Candidates ─────────────────────────────

export const candidateSchema = z.object({
  requisitionId: z.string().min(1),
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: opt,
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  source: z.enum(["REFERRAL", "JOB_BOARD", "WALK_IN", "AGENCY", "INTERNAL", "SOCIAL_MEDIA", "OTHER"]).default("OTHER"),
  expectedMonthlyGross: z.coerce.number().positive().optional(),
  resumeReference: opt,
  notes: opt,
});

export async function addCandidate(ctx: Ctx, raw: z.input<typeof candidateSchema>) {
  assertCan(ctx, "hr.manage");
  const v = candidateSchema.parse(raw);
  const req = await loadRequisition(ctx, v.requisitionId);
  if (req.status !== "APPROVED")
    throw new BusinessError(
      req.status === "PENDING_APPROVAL"
        ? "This requisition hasn't been approved yet — candidates can be added once it is."
        : `This requisition is ${req.status.replace(/_/g, " ").toLowerCase()} — it isn't open for candidates.`,
    );
  // The same person applying twice to the same role is almost always a double entry.
  const dupe = await db.candidate.findFirst({
    where: {
      organizationId: ctx.orgId,
      requisitionId: v.requisitionId,
      stage: { in: [...OPEN_STAGES] },
      OR: [
        ...(v.phone ? [{ phone: v.phone }] : []),
        ...(v.email ? [{ email: { equals: v.email, mode: "insensitive" as const } }] : []),
      ],
    },
  });
  if (dupe) throw new BusinessError(`${dupe.firstName} ${dupe.lastName} (${dupe.candidateNumber}) is already in this requisition's pipeline with the same contact details.`);
  return db.$transaction(async (tx) => {
    const candidateNumber = await nextNumber(tx, ctx.orgId, "CANDIDATE");
    const c = await tx.candidate.create({
      data: {
        organizationId: ctx.orgId,
        candidateNumber,
        requisitionId: v.requisitionId,
        firstName: v.firstName,
        lastName: v.lastName,
        phone: v.phone ?? null,
        email: v.email ?? null,
        source: v.source,
        expectedMonthlyGross: v.expectedMonthlyGross ?? null,
        resumeReference: v.resumeReference ?? null,
        notes: v.notes ?? null,
        createdBy: ctx.name,
      },
    });
    await logAudit(ctx, { action: "CANDIDATE_ADD", entity: "Candidate", entityId: c.id, newValue: c }, tx);
    return c;
  });
}

async function loadCandidate(ctx: Ctx, id: string) {
  const c = await db.candidate.findFirst({ where: { id, organizationId: ctx.orgId }, include: { requisition: true } });
  if (!c) throw new BusinessError("Candidate not found.");
  return c;
}

const isOpen = (stage: string) => (OPEN_STAGES as readonly string[]).includes(stage);

/** Moves a candidate between pipeline stages. HIRED is only reachable through hireCandidate. */
export async function moveCandidate(
  ctx: Ctx,
  id: string,
  stage: "APPLIED" | "SCREENING" | "INTERVIEW" | "ASSESSMENT" | "OFFER" | "REJECTED" | "WITHDRAWN",
  reason?: string,
) {
  assertCan(ctx, "hr.manage");
  const c = await loadCandidate(ctx, id);
  if (!isOpen(c.stage)) throw new BusinessError(`This candidate is already ${c.stage.toLowerCase()}.`);
  if (c.stage === stage) throw new BusinessError(`This candidate is already at the ${stage.toLowerCase()} stage.`);
  if ((stage === "REJECTED" || stage === "WITHDRAWN") && (!reason || reason.trim().length < 3))
    throw new BusinessError("Give a reason.");
  if (stage === "OFFER") {
    const done = await db.interview.count({ where: { candidateId: id, completedAt: { not: null } } });
    if (!done) throw new BusinessError("Record at least one completed interview before moving a candidate to the offer stage.");
  }
  if (stage === "REJECTED" || stage === "WITHDRAWN") {
    const live = await db.jobOffer.count({ where: { candidateId: id, status: { in: OPEN_OFFER as never } } });
    if (live) throw new BusinessError("Withdraw this candidate's open offer first.");
  }
  const u = await db.candidate.update({
    where: { id },
    data: {
      stage,
      stageChangedAt: new Date(),
      ...(stage === "REJECTED" || stage === "WITHDRAWN" ? { rejectionReason: reason!.trim() } : {}),
    },
  });
  await logAudit(ctx, {
    action: "CANDIDATE_STAGE",
    entity: "Candidate",
    entityId: id,
    oldValue: { stage: c.stage },
    newValue: { stage },
    reason,
  });
  return u;
}

// ───────────────────────────── Interviews ─────────────────────────────

export const interviewSchema = z.object({
  candidateId: z.string().min(1),
  scheduledAt: z.string().min(10, "Interview date/time is required"),
  interviewer: z.string().trim().min(2, "Name the interviewer"),
  mode: opt,
});

export async function scheduleInterview(ctx: Ctx, raw: z.input<typeof interviewSchema>) {
  assertCan(ctx, "hr.manage");
  const v = interviewSchema.parse(raw);
  const c = await loadCandidate(ctx, v.candidateId);
  if (!isOpen(c.stage)) throw new BusinessError(`This candidate is already ${c.stage.toLowerCase()}.`);
  const when = new Date(v.scheduledAt);
  if (Number.isNaN(when.getTime())) throw new BusinessError("That interview date isn't valid.");
  return db.$transaction(async (tx) => {
    const round = (await tx.interview.count({ where: { candidateId: c.id } })) + 1;
    const iv = await tx.interview.create({
      data: {
        organizationId: ctx.orgId,
        candidateId: c.id,
        round,
        scheduledAt: when,
        interviewer: v.interviewer,
        mode: v.mode ?? null,
        createdBy: ctx.name,
      },
    });
    if (c.stage === "APPLIED" || c.stage === "SCREENING")
      await tx.candidate.update({ where: { id: c.id }, data: { stage: "INTERVIEW", stageChangedAt: new Date() } });
    await logAudit(ctx, { action: "INTERVIEW_SCHEDULE", entity: "Candidate", entityId: c.id, newValue: iv }, tx);
    return iv;
  });
}

export const feedbackSchema = z.object({
  score: z.coerce.number().int().min(1).max(5),
  recommendation: z.enum(["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"]),
  feedback: z.string().trim().min(5, "Write a short assessment"),
});

export async function recordInterviewFeedback(ctx: Ctx, interviewId: string, raw: z.input<typeof feedbackSchema>) {
  assertCan(ctx, "hr.manage");
  const v = feedbackSchema.parse(raw);
  const iv = await db.interview.findFirst({ where: { id: interviewId, organizationId: ctx.orgId } });
  if (!iv) throw new BusinessError("Interview not found.");
  if (iv.completedAt) throw new BusinessError("Feedback has already been recorded for this interview.");
  const u = await db.interview.update({
    where: { id: interviewId },
    data: { score: v.score, recommendation: v.recommendation, feedback: v.feedback, completedAt: new Date() },
  });
  await logAudit(ctx, { action: "INTERVIEW_FEEDBACK", entity: "Candidate", entityId: iv.candidateId, newValue: u });
  return u;
}

// ───────────────────────────── Pre-employment vetting ─────────────────────────────

export const STANDARD_CHECKS = ["REFERENCE", "ID_VERIFICATION", "POLICE_CLEARANCE", "GUARANTOR"] as const;

export async function addStandardChecks(ctx: Ctx, candidateId: string) {
  assertCan(ctx, "hr.manage");
  const c = await loadCandidate(ctx, candidateId);
  if (!isOpen(c.stage)) throw new BusinessError(`This candidate is already ${c.stage.toLowerCase()}.`);
  const res = await db.candidateCheck.createMany({
    data: STANDARD_CHECKS.map((checkType) => ({ organizationId: ctx.orgId, candidateId, checkType })),
    skipDuplicates: true,
  });
  await logAudit(ctx, { action: "CANDIDATE_CHECKS_ADD", entity: "Candidate", entityId: candidateId, newValue: { added: res.count } });
  return res.count;
}

export const checkSchema = z.object({
  candidateId: z.string().min(1),
  checkType: z.enum(["REFERENCE", "ID_VERIFICATION", "POLICE_CLEARANCE", "GUARANTOR", "MEDICAL", "EDUCATION", "CREDIT", "OTHER"]),
});

export async function addCheck(ctx: Ctx, raw: z.input<typeof checkSchema>) {
  assertCan(ctx, "hr.manage");
  const v = checkSchema.parse(raw);
  const c = await loadCandidate(ctx, v.candidateId);
  if (!isOpen(c.stage)) throw new BusinessError(`This candidate is already ${c.stage.toLowerCase()}.`);
  const exists = await db.candidateCheck.findFirst({ where: { candidateId: v.candidateId, checkType: v.checkType } });
  if (exists) throw new BusinessError("That check is already on this candidate.");
  const chk = await db.candidateCheck.create({ data: { organizationId: ctx.orgId, ...v } });
  await logAudit(ctx, { action: "CANDIDATE_CHECK_ADD", entity: "Candidate", entityId: v.candidateId, newValue: chk });
  return chk;
}

export async function updateCheck(
  ctx: Ctx,
  id: string,
  status: "PENDING" | "CLEARED" | "FAILED" | "WAIVED",
  notes?: string,
) {
  assertCan(ctx, "hr.manage");
  const chk = await db.candidateCheck.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!chk) throw new BusinessError("Check not found.");
  if ((status === "FAILED" || status === "WAIVED") && (!notes || notes.trim().length < 3))
    throw new BusinessError(status === "FAILED" ? "Record what the check found." : "Give a reason for waiving this check.");
  const u = await db.candidateCheck.update({
    where: { id },
    data: { status, notes: notes?.trim() || chk.notes, checkedBy: ctx.name, checkedAt: new Date() },
  });
  await logAudit(ctx, { action: "CANDIDATE_CHECK_UPDATE", entity: "Candidate", entityId: chk.candidateId, oldValue: chk, newValue: u });
  return u;
}

// ───────────────────────────── Offers ─────────────────────────────

export const offerSchema = z.object({
  candidateId: z.string().min(1),
  jobTitle: z.string().trim().min(2, "A job title is required"),
  monthlyGross: z.coerce.number().positive("Monthly gross must be greater than zero"),
  employmentType: z.enum(EMPLOYMENT_TYPES).default("PERMANENT"),
  probationMonths: z.coerce.number().int().min(0).max(24).optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  startDate: z.string().min(10, "Start date is required"),
  validUntil: opt,
  setPayRate: z.boolean().default(true),
});

export async function createOffer(ctx: Ctx, raw: z.input<typeof offerSchema>) {
  assertCan(ctx, "hr.manage");
  const v = offerSchema.parse(raw);
  const c = await loadCandidate(ctx, v.candidateId);
  if (c.stage !== "OFFER") throw new BusinessError("Move the candidate to the offer stage before raising an offer.");
  const live = await db.jobOffer.findFirst({ where: { candidateId: c.id, status: { in: OPEN_OFFER as never } } });
  if (live) throw new BusinessError(`There is already an open offer (${live.offerNumber}) for this candidate.`);
  const policy = await getHrPolicy(ctx.orgId);
  const validUntil = v.validUntil ? d(v.validUntil) : addDays(todayUtc(), policy.offerValidityDays);
  if (validUntil < todayUtc()) throw new BusinessError("The offer's expiry date is in the past.");
  const probationMonths = v.probationMonths ?? (v.employmentType === "PROBATION" ? policy.defaultProbationMonths : 0);
  if (probationMonths > policy.maxProbationMonths)
    throw new BusinessError(`Probation can't be longer than ${policy.maxProbationMonths} month(s) under the HR policy.`);
  return db.$transaction(async (tx) => {
    const offerNumber = await nextNumber(tx, ctx.orgId, "JOB_OFFER");
    const o = await tx.jobOffer.create({
      data: {
        organizationId: ctx.orgId,
        offerNumber,
        candidateId: c.id,
        jobTitle: v.jobTitle,
        monthlyGross: v.monthlyGross,
        employmentType: v.employmentType,
        probationMonths,
        noticePeriodDays: v.noticePeriodDays ?? policy.defaultNoticeDays,
        startDate: d(v.startDate),
        validUntil,
        setPayRate: v.setPayRate,
        createdBy: ctx.name,
        createdById: ctx.userId,
      },
    });
    await logAudit(ctx, { action: "OFFER_RAISE", entity: "Candidate", entityId: c.id, newValue: o }, tx);
    return o;
  });
}

async function loadOffer(ctx: Ctx, id: string) {
  const o = await db.jobOffer.findFirst({ where: { id, organizationId: ctx.orgId }, include: { candidate: { include: { requisition: true } } } });
  if (!o) throw new BusinessError("Offer not found.");
  return o;
}

export async function approveOffer(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "hr.approve");
  const o = await loadOffer(ctx, id);
  if (o.status !== "PENDING_APPROVAL") throw new BusinessError(`This offer is already ${o.status.replace(/_/g, " ").toLowerCase()}.`);
  if (o.createdById === ctx.userId) throw new BusinessError("You can't approve an offer you raised — someone else must.");
  const u = await db.jobOffer.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: ctx.name, approvedAt: new Date(), decisionNote: note?.trim() || null },
  });
  await logAudit(ctx, { action: "OFFER_APPROVE", entity: "Candidate", entityId: o.candidateId, newValue: u });
  return u;
}

export async function rejectOffer(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "hr.approve");
  if (!note || note.trim().length < 3) throw new BusinessError("Give a reason for rejecting the offer.");
  const o = await loadOffer(ctx, id);
  if (o.status !== "PENDING_APPROVAL") throw new BusinessError(`This offer is already ${o.status.replace(/_/g, " ").toLowerCase()}.`);
  if (o.createdById === ctx.userId) throw new BusinessError("You can't decide an offer you raised — someone else must.");
  const u = await db.jobOffer.update({ where: { id }, data: { status: "REJECTED", approvedBy: ctx.name, approvedAt: new Date(), decisionNote: note.trim() } });
  await logAudit(ctx, { action: "OFFER_REJECT", entity: "Candidate", entityId: o.candidateId, newValue: u, reason: note });
  return u;
}

export async function markOfferSent(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.manage");
  const o = await loadOffer(ctx, id);
  if (o.status !== "APPROVED") throw new BusinessError("Only an approved offer can be sent to the candidate.");
  const u = await db.jobOffer.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
  await logAudit(ctx, { action: "OFFER_SEND", entity: "Candidate", entityId: o.candidateId, newValue: u });
  return u;
}

export async function recordOfferResponse(ctx: Ctx, id: string, decision: "ACCEPTED" | "DECLINED", reason?: string) {
  assertCan(ctx, "hr.manage");
  const o = await loadOffer(ctx, id);
  if (o.status !== "SENT") throw new BusinessError("Send the offer to the candidate before recording their answer.");
  if (decision === "ACCEPTED" && o.validUntil < todayUtc()) {
    await db.jobOffer.update({ where: { id }, data: { status: "EXPIRED" } });
    throw new BusinessError(`This offer expired on ${iso(o.validUntil)} — raise a fresh one.`);
  }
  if (decision === "DECLINED" && (!reason || reason.trim().length < 3)) throw new BusinessError("Record why the candidate declined.");
  const u = await db.jobOffer.update({
    where: { id },
    data: { status: decision, respondedAt: new Date(), declineReason: decision === "DECLINED" ? reason!.trim() : null },
  });
  await logAudit(ctx, { action: decision === "ACCEPTED" ? "OFFER_ACCEPTED" : "OFFER_DECLINED", entity: "Candidate", entityId: o.candidateId, newValue: u, reason });
  return u;
}

export async function withdrawOffer(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "hr.manage");
  if (!reason || reason.trim().length < 3) throw new BusinessError("Give a reason for withdrawing the offer.");
  const o = await loadOffer(ctx, id);
  if (!OPEN_OFFER.includes(o.status)) throw new BusinessError(`A ${o.status.replace(/_/g, " ").toLowerCase()} offer can't be withdrawn.`);
  const u = await db.jobOffer.update({ where: { id }, data: { status: "WITHDRAWN", declineReason: reason.trim() } });
  await logAudit(ctx, { action: "OFFER_WITHDRAW", entity: "Candidate", entityId: o.candidateId, newValue: u, reason });
  return u;
}

// ───────────────────────────── Hire ─────────────────────────────

export const hireSchema = z.object({
  offerId: z.string().min(1),
  /** Defaults to the offer's start date. */
  employmentDate: opt,
  signedDate: opt,
  documentReference: opt,
});

/**
 * Converts an accepted offer into an employee. Everything happens in one transaction: the employee
 * record, the employment contract, the personal pay rate (when the offer sets one) and the
 * onboarding checklist. Blocked while any vetting check is pending/failed, if the person is already
 * on staff, or if a previous exit flagged them as not eligible for rehire.
 */
export async function hireCandidate(ctx: Ctx, raw: z.input<typeof hireSchema>) {
  assertCan(ctx, "hr.manage");
  assertCan(ctx, "employee.manage");
  const v = hireSchema.parse(raw);
  const o = await loadOffer(ctx, v.offerId);
  const c = o.candidate;
  const req = c.requisition;
  if (o.status !== "ACCEPTED") throw new BusinessError("The candidate must have accepted the offer before they can be hired.");
  if (c.stage !== "OFFER" || c.employeeId) throw new BusinessError("This candidate has already been hired or has left the pipeline.");
  if (!["APPROVED", "ON_HOLD"].includes(req.status) && req.status !== "FILLED")
    throw new BusinessError(`The requisition is ${req.status.replace(/_/g, " ").toLowerCase()} — it can't take a hire.`);
  const hired = await db.candidate.count({ where: { requisitionId: req.id, stage: "HIRED" } });
  if (hired >= req.headcount) throw new BusinessError(`All ${req.headcount} position(s) on this requisition are already filled.`);

  const checks = await db.candidateCheck.findMany({ where: { candidateId: c.id } });
  const blocking = checks.filter((k) => k.status === "PENDING" || k.status === "FAILED");
  if (blocking.length)
    throw new BusinessError(
      `Vetting isn't complete: ${blocking.map((k) => `${k.checkType.replace(/_/g, " ").toLowerCase()} (${k.status.toLowerCase()})`).join(", ")}. Clear or waive each check first.`,
    );

  const contact = [...(c.phone ? [{ phone: c.phone }] : []), ...(c.email ? [{ email: { equals: c.email, mode: "insensitive" as const } }] : [])];
  if (contact.length) {
    const matches = await db.employee.findMany({
      where: { organizationId: ctx.orgId, OR: contact },
      include: { exitRecords: { where: { status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const current = matches.find((m) => !GONE.includes(m.status));
    if (current) throw new BusinessError(`${current.employeeNumber} (${current.firstName} ${current.lastName}) is already on staff with the same contact details.`);
    const barred = matches.find((m) => m.exitRecords[0]?.eligibleForRehire === false);
    if (barred)
      throw new BusinessError(`${barred.employeeNumber} previously left and was marked NOT eligible for rehire — this hire needs that flag reviewed first.`);
  }

  const employmentDate = v.employmentDate ?? iso(o.startDate);
  return db.$transaction(async (tx) => {
    const emp = await createEmployeeInTx(
      ctx,
      tx,
      employeeSchema.parse({
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
        employmentDate,
        categoryId: req.categoryId,
        departmentId: req.departmentId ?? undefined,
        reportingManagerId: req.hiringManagerId ?? undefined,
      }),
    );
    const contract = await createContractInTx(
      ctx,
      tx,
      contractSchema.parse({
        employeeId: emp.id,
        type: o.employmentType,
        jobTitle: o.jobTitle,
        startDate: employmentDate,
        endDate: undefined,
        probationMonths: o.probationMonths,
        noticePeriodDays: o.noticePeriodDays,
        signedDate: v.signedDate,
        documentReference: v.documentReference,
        notes: `Hired from offer ${o.offerNumber}`,
      }),
    );
    if (o.setPayRate)
      await tx.employeePayRate.create({
        data: {
          organizationId: ctx.orgId,
          employeeId: emp.id,
          monthlyGross: o.monthlyGross,
          reason: `Hired — offer ${o.offerNumber}`,
          approvedBy: o.approvedBy ?? ctx.name,
          effectiveFrom: d(employmentDate),
        },
      });
    await tx.candidate.update({ where: { id: c.id }, data: { stage: "HIRED", stageChangedAt: new Date(), employeeId: emp.id } });
    if (hired + 1 >= req.headcount && req.status !== "FILLED")
      await tx.jobRequisition.update({ where: { id: req.id }, data: { status: "FILLED" } });
    await logAudit(
      ctx,
      {
        action: "CANDIDATE_HIRE",
        entity: "Candidate",
        entityId: c.id,
        newValue: { employee: emp.employeeNumber, contract: contract.contractNumber, offer: o.offerNumber, monthlyGross: num(o.monthlyGross) },
      },
      tx,
    );
    return { employee: emp, contract };
  });
}

// ───────────────────────────── Queries ─────────────────────────────

export async function listCandidates(ctx: Ctx, f: { stage?: string; requisitionId?: string; q?: string } = {}) {
  assertCan(ctx, "hr.view");
  return db.candidate.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(f.stage ? { stage: f.stage as never } : {}),
      ...(f.requisitionId ? { requisitionId: f.requisitionId } : {}),
      ...(f.q
        ? {
            OR: [
              { firstName: { contains: f.q, mode: "insensitive" } },
              { lastName: { contains: f.q, mode: "insensitive" } },
              { candidateNumber: { contains: f.q, mode: "insensitive" } },
              { phone: { contains: f.q } },
              { email: { contains: f.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { requisition: true },
    orderBy: [{ stageChangedAt: "desc" }],
    take: 300,
  });
}

export async function getCandidate(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.view");
  return db.candidate.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      requisition: { include: { category: true } },
      interviews: { orderBy: { round: "asc" } },
      checks: { orderBy: { createdAt: "asc" } },
      offers: { orderBy: { createdAt: "desc" } },
      employee: true,
    },
  });
}

/** Funnel counts for the recruitment overview. */
export async function recruitmentSummary(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const [reqs, stages, offers] = await Promise.all([
    db.jobRequisition.groupBy({ by: ["status"], where: { organizationId: ctx.orgId }, _count: true }),
    db.candidate.groupBy({ by: ["stage"], where: { organizationId: ctx.orgId }, _count: true }),
    db.jobOffer.groupBy({ by: ["status"], where: { organizationId: ctx.orgId }, _count: true }),
  ]);
  const count = <T extends { _count: number }>(rows: Array<T & Record<string, unknown>>, key: string, val: string) =>
    (rows.find((r) => r[key] === val)?._count as number | undefined) ?? 0;
  return {
    requisitionsPending: count(reqs, "status", "PENDING_APPROVAL"),
    requisitionsOpen: count(reqs, "status", "APPROVED"),
    inPipeline: OPEN_STAGES.reduce((s, st) => s + count(stages, "stage", st), 0),
    offersPending: count(offers, "status", "PENDING_APPROVAL") + count(offers, "status", "APPROVED") + count(offers, "status", "SENT"),
    hired: count(stages, "stage", "HIRED"),
    stages: Object.fromEntries(stages.map((s) => [s.stage, s._count])) as Record<string, number>,
  };
}
