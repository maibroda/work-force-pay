import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import {
  DEFAULT_EXIT_TEMPLATE,
  DEFAULT_ONBOARDING_TEMPLATE,
  getHrPolicy,
  instantiateExitTasks,
  instantiateOnboardingTasks,
} from "./hr-policy";
import { endActiveContract } from "./contracts";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

/** The out-of-the-box checklists. Each organization edits its own copy under Settings → Checklists. */
export const ONBOARDING_TASKS = DEFAULT_ONBOARDING_TEMPLATE.map((t) => t.taskName);
export const EXIT_CLEARANCE_TASKS = DEFAULT_EXIT_TEMPLATE.map((t) => t.taskName);

async function assertEmployee(ctx: Ctx, employeeId: string) {
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  return emp;
}

// ─────────────────────────────── Documents ───────────────────────────────

export const documentSchema = z.object({
  employeeId: z.string().min(1),
  documentType: z.enum([
    "NATIONAL_ID",
    "PASSPORT",
    "DRIVERS_LICENSE",
    "GUARD_LICENSE",
    "FIREARMS_LICENSE",
    "MEDICAL_CERTIFICATE",
    "POLICE_CLEARANCE",
    "EMPLOYMENT_CONTRACT",
    "ACADEMIC_CERTIFICATE",
    "OTHER",
  ]),
  documentNumber: opt,
  issueDate: opt,
  expiryDate: opt,
  fileReference: z.string().trim().min(1, "A filename, reference or description is required"),
  notes: opt,
});

export async function addDocument(ctx: Ctx, raw: z.input<typeof documentSchema>) {
  assertCan(ctx, "hr.manage");
  const v = documentSchema.parse(raw);
  await assertEmployee(ctx, v.employeeId);
  const doc = await db.employeeDocument.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: v.employeeId,
      documentType: v.documentType,
      documentNumber: v.documentNumber ?? null,
      issueDate: v.issueDate ? d(v.issueDate) : null,
      expiryDate: v.expiryDate ? d(v.expiryDate) : null,
      fileReference: v.fileReference,
      notes: v.notes ?? null,
      uploadedBy: ctx.name,
    },
  });
  await logAudit(ctx, {
    action: "EMPLOYEE_DOCUMENT_ADD",
    entity: "Employee",
    entityId: v.employeeId,
    newValue: doc,
  });
  return doc;
}

export async function deleteDocument(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.manage");
  const doc = await db.employeeDocument.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!doc) throw new BusinessError("Document not found.");
  await db.employeeDocument.delete({ where: { id } });
  await logAudit(ctx, {
    action: "EMPLOYEE_DOCUMENT_DELETE",
    entity: "Employee",
    entityId: doc.employeeId,
    oldValue: doc,
  });
}

/** Documents expiring within `withinDays` (or already expired) across the organization. */
export async function listExpiringDocuments(ctx: Ctx, withinDays = 60) {
  const cutoff = new Date(Date.now() + withinDays * 86400000);
  return db.employeeDocument.findMany({
    where: { organizationId: ctx.orgId, expiryDate: { not: null, lte: cutoff } },
    include: { employee: true },
    orderBy: { expiryDate: "asc" },
  });
}

// ─────────────────────────────── Training & certifications ───────────────────────────────

export const trainingSchema = z.object({
  employeeId: z.string().min(1),
  courseName: z.string().trim().min(1, "Course / certification name is required"),
  provider: opt,
  certificateNumber: opt,
  issueDate: z.string().min(10, "Issue date is required"),
  expiryDate: opt,
  fileReference: opt,
});

export async function addTraining(ctx: Ctx, raw: z.input<typeof trainingSchema>) {
  assertCan(ctx, "hr.manage");
  const v = trainingSchema.parse(raw);
  await assertEmployee(ctx, v.employeeId);
  const rec = await db.employeeTraining.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: v.employeeId,
      courseName: v.courseName,
      provider: v.provider ?? null,
      certificateNumber: v.certificateNumber ?? null,
      issueDate: d(v.issueDate),
      expiryDate: v.expiryDate ? d(v.expiryDate) : null,
      fileReference: v.fileReference ?? null,
      recordedBy: ctx.name,
    },
  });
  await logAudit(ctx, {
    action: "EMPLOYEE_TRAINING_ADD",
    entity: "Employee",
    entityId: v.employeeId,
    newValue: rec,
  });
  return rec;
}

export async function revokeTraining(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "hr.manage");
  const rec = await db.employeeTraining.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!rec) throw new BusinessError("Training record not found.");
  const updated = await db.employeeTraining.update({ where: { id }, data: { status: "REVOKED" } });
  await logAudit(ctx, {
    action: "EMPLOYEE_TRAINING_REVOKE",
    entity: "Employee",
    entityId: rec.employeeId,
    oldValue: rec,
    newValue: updated,
    reason,
  });
  return updated;
}

/** Certifications expiring within `withinDays` (or already expired), excluding revoked ones. */
export async function listExpiringTrainings(ctx: Ctx, withinDays = 60) {
  const cutoff = new Date(Date.now() + withinDays * 86400000);
  return db.employeeTraining.findMany({
    where: {
      organizationId: ctx.orgId,
      status: { not: "REVOKED" },
      expiryDate: { not: null, lte: cutoff },
    },
    include: { employee: true },
    orderBy: { expiryDate: "asc" },
  });
}

// ─────────────────────────────── Disciplinary records ───────────────────────────────

export const disciplinarySchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum([
    "QUERY",
    "VERBAL_WARNING",
    "WRITTEN_WARNING",
    "SUSPENSION",
    "TERMINATION_RECOMMENDATION",
    "COMMENDATION",
  ]),
  incidentDate: z.string().min(10, "Incident date is required"),
  description: z.string().trim().min(5, "A description is required"),
  actionTaken: opt,
  /** Set when the sanction comes out of an employee-relations case. */
  caseId: opt,
});

/** Raises a disciplinary action or commendation — PENDING until signed off (maker/checker). */
export async function raiseDisciplinary(ctx: Ctx, raw: z.input<typeof disciplinarySchema>) {
  assertCan(ctx, "hr.manage");
  const v = disciplinarySchema.parse(raw);
  await assertEmployee(ctx, v.employeeId);
  if (v.caseId) {
    const c = await db.relationsCase.findFirst({ where: { id: v.caseId, organizationId: ctx.orgId } });
    if (!c || c.employeeId !== v.employeeId) throw new BusinessError("That case doesn't belong to this employee.");
  }
  const rec = await db.disciplinaryRecord.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: v.employeeId,
      type: v.type,
      incidentDate: d(v.incidentDate),
      description: v.description,
      actionTaken: v.actionTaken ?? null,
      issuedBy: ctx.name,
      caseId: v.caseId ?? null,
    },
  });
  await logAudit(ctx, {
    action: "DISCIPLINARY_RECORD_RAISE",
    entity: "Employee",
    entityId: v.employeeId,
    newValue: rec,
  });
  return rec;
}

export async function approveDisciplinary(ctx: Ctx, id: string, remarks?: string) {
  assertCan(ctx, "hr.approve");
  const rec = await db.disciplinaryRecord.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!rec) throw new BusinessError("Disciplinary record not found.");
  if (rec.status !== "PENDING") throw new BusinessError("Already decided.");
  const updated = await db.disciplinaryRecord.update({
    where: { id },
    data: { status: "APPROVED", approvedBy: ctx.name, remarks: remarks ?? null },
  });
  await logAudit(ctx, {
    action: "DISCIPLINARY_RECORD_APPROVE",
    entity: "Employee",
    entityId: rec.employeeId,
    newValue: updated,
  });
  return updated;
}

export async function rejectDisciplinary(ctx: Ctx, id: string, remarks: string) {
  assertCan(ctx, "hr.approve");
  const rec = await db.disciplinaryRecord.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!rec) throw new BusinessError("Disciplinary record not found.");
  if (rec.status !== "PENDING") throw new BusinessError("Already decided.");
  const updated = await db.disciplinaryRecord.update({
    where: { id },
    data: { status: "REJECTED", approvedBy: ctx.name, remarks },
  });
  await logAudit(ctx, {
    action: "DISCIPLINARY_RECORD_REJECT",
    entity: "Employee",
    entityId: rec.employeeId,
    newValue: updated,
  });
  return updated;
}

// ─────────────────────────────── Onboarding ───────────────────────────────

/** Stamps the organization's onboarding template onto a new hire — called automatically on hire. */
export async function seedOnboardingTasks(ctx: Ctx, employeeId: string, tx: Tx = db) {
  const emp = await tx.employee.findFirstOrThrow({ where: { id: employeeId, organizationId: ctx.orgId } });
  await instantiateOnboardingTasks(ctx, emp, tx);
}

export async function addOnboardingTask(ctx: Ctx, employeeId: string, taskName: string, dueDate?: string) {
  assertCan(ctx, "hr.manage");
  await assertEmployee(ctx, employeeId);
  const max = await db.onboardingTask.count({ where: { employeeId, organizationId: ctx.orgId } });
  const task = await db.onboardingTask.create({
    data: {
      organizationId: ctx.orgId,
      employeeId,
      taskName,
      dueDate: dueDate ? d(dueDate) : null,
      sortOrder: max,
    },
  });
  await logAudit(ctx, {
    action: "ONBOARDING_TASK_ADD",
    entity: "Employee",
    entityId: employeeId,
    newValue: task,
  });
  return task;
}

export async function completeOnboardingTask(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.manage");
  const task = await db.onboardingTask.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!task) throw new BusinessError("Onboarding task not found.");
  const updated = await db.onboardingTask.update({
    where: { id },
    data: { status: "DONE", completedBy: ctx.name, completedAt: new Date() },
  });
  await logAudit(ctx, {
    action: "ONBOARDING_TASK_COMPLETE",
    entity: "Employee",
    entityId: task.employeeId,
    newValue: updated,
  });
  return updated;
}

// ─────────────────────────────── Exit / offboarding ───────────────────────────────

export const exitSchema = z.object({
  employeeId: z.string().min(1),
  exitType: z.enum([
    "RESIGNATION",
    "TERMINATION",
    "END_OF_CONTRACT",
    "RETIREMENT",
    "ABSCONDMENT",
    "DECEASED",
  ]),
  noticeDate: z.string().min(10, "Notice date is required"),
  lastWorkingDate: z.string().min(10, "Last working date is required"),
  reason: z.string().trim().min(5, "A reason is required"),
  reasonCategory: z
    .enum([
      "BETTER_PAY",
      "CAREER_GROWTH",
      "RELOCATION",
      "PERSONAL_OR_HEALTH",
      "WORK_CONDITIONS",
      "MANAGER_RELATIONSHIP",
      "PERFORMANCE",
      "MISCONDUCT",
      "REDUNDANCY",
      "CONTRACT_END",
      "RETIREMENT",
      "DEATH",
      "OTHER",
    ])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Gross-misconduct dismissal — forfeits notice pay, gratuity and severance. */
  summaryDismissal: z.boolean().default(false),
});

const EXIT_TO_EMPLOYEE_STATUS: Record<string, string> = {
  RESIGNATION: "RESIGNED",
  TERMINATION: "TERMINATED",
  END_OF_CONTRACT: "TERMINATED",
  RETIREMENT: "EXITED",
  ABSCONDMENT: "TERMINATED",
  DECEASED: "EXITED",
};

/** Initiates offboarding — PENDING until HR/admin signs off (maker/checker, mirrors StaffMovement). */
export async function initiateExit(ctx: Ctx, raw: z.input<typeof exitSchema>) {
  assertCan(ctx, "hr.manage");
  const v = exitSchema.parse(raw);
  const emp = await assertEmployee(ctx, v.employeeId);
  if (["EXITED", "TERMINATED", "RESIGNED"].includes(emp.status))
    throw new BusinessError("This employee has already exited.");
  const existing = await db.exitRecord.findFirst({
    where: { employeeId: v.employeeId, organizationId: ctx.orgId, status: "PENDING" },
  });
  if (existing) throw new BusinessError("An exit is already pending for this employee.");
  if (d(v.lastWorkingDate) < d(v.noticeDate))
    throw new BusinessError("Last working date cannot be before the notice date.");
  if (v.summaryDismissal && v.exitType !== "TERMINATION")
    throw new BusinessError("Only a termination can be a summary dismissal.");
  // The notice owed is fixed now (contract term, else the org default) so a later policy edit
  // can't change a settlement that's already being prepared.
  const [contract, policy] = await Promise.all([
    db.employmentContract.findFirst({
      where: { organizationId: ctx.orgId, employeeId: v.employeeId, status: "ACTIVE" },
    }),
    getHrPolicy(ctx.orgId),
  ]);
  const rec = await db.exitRecord.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: v.employeeId,
      exitType: v.exitType,
      noticeDate: d(v.noticeDate),
      lastWorkingDate: d(v.lastWorkingDate),
      reason: v.reason,
      reasonCategory: v.reasonCategory ?? null,
      summaryDismissal: v.summaryDismissal,
      noticePeriodDays: contract?.noticePeriodDays ?? policy.defaultNoticeDays,
      initiatedBy: ctx.name,
    },
  });
  await logAudit(ctx, {
    action: "EXIT_INITIATE",
    entity: "Employee",
    entityId: v.employeeId,
    newValue: rec,
  });
  return rec;
}

/** Approving an exit updates the employee's status/exitDate and seeds the clearance checklist. */
export async function approveExit(ctx: Ctx, id: string, remarks?: string) {
  assertCan(ctx, "hr.approve");
  const rec = await db.exitRecord.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!rec) throw new BusinessError("Exit record not found.");
  if (rec.status !== "PENDING") throw new BusinessError("Already decided.");
  return db.$transaction(async (tx) => {
    const updated = await tx.exitRecord.update({
      where: { id },
      data: { status: "APPROVED", approvedBy: ctx.name, remarks: remarks ?? null },
    });
    const emp = await tx.employee.update({
      where: { id: rec.employeeId },
      data: {
        status: EXIT_TO_EMPLOYEE_STATUS[rec.exitType] as never,
        exitDate: rec.lastWorkingDate,
      },
    });
    await instantiateExitTasks(ctx, rec, emp, tx);
    await endActiveContract(tx, ctx.orgId, rec.employeeId, rec.lastWorkingDate, `Exit — ${rec.exitType.replace(/_/g, " ").toLowerCase()}`);
    // Leave that was still awaiting a decision can't be taken any more.
    await tx.leaveRequest.updateMany({
      where: { organizationId: ctx.orgId, employeeId: rec.employeeId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    await logAudit(
      ctx,
      { action: "EXIT_APPROVE", entity: "Employee", entityId: rec.employeeId, newValue: updated },
      tx,
    );
    return updated;
  });
}

export async function rejectExit(ctx: Ctx, id: string, remarks: string) {
  assertCan(ctx, "hr.approve");
  const rec = await db.exitRecord.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!rec) throw new BusinessError("Exit record not found.");
  if (rec.status !== "PENDING") throw new BusinessError("Already decided.");
  const updated = await db.exitRecord.update({
    where: { id },
    data: { status: "REJECTED", approvedBy: ctx.name, remarks },
  });
  await logAudit(ctx, {
    action: "EXIT_REJECT",
    entity: "Employee",
    entityId: rec.employeeId,
    newValue: updated,
  });
  return updated;
}

export async function completeExitTask(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.manage");
  const task = await db.exitTask.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { exitRecord: true },
  });
  if (!task) throw new BusinessError("Clearance task not found.");
  const updated = await db.exitTask.update({
    where: { id },
    data: { status: "DONE", completedBy: ctx.name, completedAt: new Date() },
  });
  await logAudit(ctx, {
    action: "EXIT_TASK_COMPLETE",
    entity: "Employee",
    entityId: task.exitRecord.employeeId,
    newValue: updated,
  });
  return updated;
}

/** Waives a checklist step that doesn't apply (e.g. no firearm issued) — a reason is mandatory. */
export async function markTaskNotApplicable(ctx: Ctx, kind: "onboarding" | "exit", id: string, reason: string) {
  assertCan(ctx, "hr.manage");
  if (!reason || reason.trim().length < 3) throw new BusinessError("Give a reason for waiving this step.");
  const notes = reason.trim();
  if (kind === "onboarding") {
    const task = await db.onboardingTask.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!task) throw new BusinessError("Onboarding task not found.");
    if (task.status !== "PENDING") throw new BusinessError("Only a pending step can be waived.");
    const updated = await db.onboardingTask.update({
      where: { id },
      data: { status: "NOT_APPLICABLE", completedBy: ctx.name, completedAt: new Date(), notes },
    });
    await logAudit(ctx, { action: "ONBOARDING_TASK_WAIVE", entity: "Employee", entityId: task.employeeId, newValue: updated, reason: notes });
    return updated;
  }
  const task = await db.exitTask.findFirst({ where: { id, organizationId: ctx.orgId }, include: { exitRecord: true } });
  if (!task) throw new BusinessError("Clearance task not found.");
  if (task.status !== "PENDING") throw new BusinessError("Only a pending step can be waived.");
  const updated = await db.exitTask.update({
    where: { id },
    data: { status: "NOT_APPLICABLE", completedBy: ctx.name, completedAt: new Date(), notes },
  });
  await logAudit(ctx, { action: "EXIT_TASK_WAIVE", entity: "Employee", entityId: task.exitRecord.employeeId, newValue: updated, reason: notes });
  return updated;
}

export const exitInterviewSchema = z.object({
  exitRecordId: z.string().min(1),
  interviewDate: z.string().min(10, "Interview date is required"),
  notes: z.string().trim().min(5, "Record what was discussed"),
  eligibleForRehire: z.boolean(),
  reasonCategory: exitSchema.shape.reasonCategory,
});

/** Records the exit interview, the rehire flag (which the recruitment module enforces) and ticks the clearance step. */
export async function recordExitInterview(ctx: Ctx, raw: z.input<typeof exitInterviewSchema>) {
  assertCan(ctx, "hr.manage");
  const v = exitInterviewSchema.parse(raw);
  const rec = await db.exitRecord.findFirst({ where: { id: v.exitRecordId, organizationId: ctx.orgId } });
  if (!rec) throw new BusinessError("Exit record not found.");
  if (rec.status === "REJECTED") throw new BusinessError("This exit was rejected.");
  return db.$transaction(async (tx) => {
    const updated = await tx.exitRecord.update({
      where: { id: rec.id },
      data: {
        exitInterviewDate: d(v.interviewDate),
        exitInterviewNotes: v.notes,
        exitInterviewBy: ctx.name,
        eligibleForRehire: v.eligibleForRehire,
        ...(v.reasonCategory ? { reasonCategory: v.reasonCategory } : {}),
      },
    });
    await tx.exitTask.updateMany({
      where: {
        exitRecordId: rec.id,
        status: "PENDING",
        taskName: { contains: "exit interview", mode: "insensitive" },
      },
      data: { status: "DONE", completedBy: ctx.name, completedAt: new Date() },
    });
    await logAudit(ctx, { action: "EXIT_INTERVIEW_RECORD", entity: "Employee", entityId: rec.employeeId, newValue: updated }, tx);
    return updated;
  });
}

// ─────────────────────────────── Org chart ───────────────────────────────

export interface OrgNode {
  id: string;
  employeeNumber: string;
  name: string;
  categoryName: string;
  status: string;
  children: OrgNode[];
}

/** Builds the reporting-line tree from every active-ish employee's reportingManagerId. */
export async function orgChart(ctx: Ctx): Promise<{ tree: OrgNode[]; unassignedCount: number }> {
  const emps = await db.employee.findMany({
    where: { organizationId: ctx.orgId, status: { notIn: ["EXITED"] } },
    include: { category: true },
    orderBy: { employeeNumber: "asc" },
  });
  const nodes = new Map<string, OrgNode>(
    emps.map((e) => [
      e.id,
      {
        id: e.id,
        employeeNumber: e.employeeNumber,
        name: `${e.firstName} ${e.lastName}`,
        categoryName: e.category.name,
        status: e.status,
        children: [],
      },
    ]),
  );
  const roots: OrgNode[] = [];
  let unassignedCount = 0;
  for (const e of emps) {
    const node = nodes.get(e.id)!;
    if (e.reportingManagerId && nodes.has(e.reportingManagerId)) {
      nodes.get(e.reportingManagerId)!.children.push(node);
    } else {
      if (e.reportingManagerId) unassignedCount++; // manager set but exited/missing
      roots.push(node);
    }
  }
  return { tree: roots, unassignedCount };
}
