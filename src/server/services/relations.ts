/**
 * Employee relations — grievances, misconduct investigations, harassment and whistleblowing
 * concerns, counselling and mediation, handled as cases with an append-only case file.
 *
 * Employees can raise their own grievance / confidential concern (self-service). Confidential cases
 * show only their existence — never their content — to read-only HR viewers (e.g. auditors).
 * Formal sanctions still go through the existing disciplinary register; a substantiated case can
 * issue one, linked back to the case.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { addDays, iso } from "@/lib/dates";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { raiseDisciplinary } from "./hr";
import { nextNumber } from "./numbering";

const CASE_TYPES = ["GRIEVANCE", "MISCONDUCT", "HARASSMENT", "WHISTLEBLOWING", "COUNSELLING", "MEDIATION", "OTHER"] as const;
/** What an employee may open for themselves — misconduct is HR's to open about someone. */
const SELF_TYPES = ["GRIEVANCE", "HARASSMENT", "WHISTLEBLOWING"];
const ALWAYS_CONFIDENTIAL = ["HARASSMENT", "WHISTLEBLOWING"];
const OPEN_STATUSES = ["OPEN", "INVESTIGATING", "HEARING"];

export const caseSchema = z.object({
  employeeId: z.string().optional(),
  type: z.enum(CASE_TYPES),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  confidential: z.boolean().optional(),
  summary: z.string().trim().min(5, "Give the case a short summary").max(200),
  description: z.string().trim().min(10, "Describe what happened"),
});

export async function raiseCase(ctx: Ctx, raw: z.input<typeof caseSchema>) {
  const v = caseSchema.parse(raw);
  const hr = can(ctx.role, "hr.manage");
  let employeeId = v.employeeId;
  let selfRaised = false;
  if (!hr) {
    assertCan(ctx, "relations.raise");
    if (!ctx.employeeId) throw new BusinessError("Your user account isn't linked to an employee record.");
    if (!SELF_TYPES.includes(v.type))
      throw new BusinessError("You can raise a grievance, a harassment complaint or a whistleblowing concern.");
    employeeId = ctx.employeeId;
    selfRaised = true;
  } else if (!employeeId) {
    throw new BusinessError("Choose the employee this case is about.");
  }
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId } });
  if (!emp) throw new BusinessError("Employee not found.");
  const policy = await getHrPolicy(ctx.orgId);
  return db.$transaction(async (tx) => {
    const caseNumber = await nextNumber(tx, ctx.orgId, "RELATIONS_CASE");
    const c = await tx.relationsCase.create({
      data: {
        organizationId: ctx.orgId,
        caseNumber,
        employeeId: emp.id,
        type: v.type,
        severity: v.severity,
        confidential: ALWAYS_CONFIDENTIAL.includes(v.type) ? true : (v.confidential ?? false),
        summary: v.summary,
        description: v.description,
        raisedBy: ctx.name,
        raisedByUserId: ctx.userId,
        selfRaised,
        dueDate: addDays(todayUtc(), policy.relationsCaseSlaDays),
      },
    });
    await logAudit(ctx, { action: "RELATIONS_CASE_RAISE", entity: "RelationsCase", entityId: c.id, newValue: { caseNumber, type: v.type, severity: v.severity, selfRaised } }, tx);
    return c;
  });
}

type CaseRow = Awaited<ReturnType<typeof loadCase>>;

async function loadCase(ctx: Ctx, id: string) {
  const c = await db.relationsCase.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { employee: true, notes: { orderBy: { createdAt: "asc" } }, disciplinaryRecords: true },
  });
  if (!c) throw new BusinessError("Case not found.");
  return c;
}

/** Read-only HR viewers see a confidential case exist, but not what it contains. */
const canSeeContent = (ctx: Ctx, c: { confidential: boolean }) => !c.confidential || can(ctx.role, "hr.manage");

function redact<T extends CaseRow>(ctx: Ctx, c: T): T & { redacted: boolean } {
  if (canSeeContent(ctx, c)) return { ...c, redacted: false };
  return { ...c, summary: "Confidential case", description: "", resolution: null, notes: [], disciplinaryRecords: [], redacted: true };
}

export async function listCases(ctx: Ctx, f: { status?: string; type?: string; q?: string; overdue?: boolean } = {}) {
  assertCan(ctx, "hr.view");
  const today = todayUtc();
  const rows = await db.relationsCase.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.type ? { type: f.type as never } : {}),
      ...(f.overdue ? { status: { in: OPEN_STATUSES as never }, dueDate: { lt: today } } : {}),
      ...(f.q
        ? {
            OR: [
              { caseNumber: { contains: f.q, mode: "insensitive" } },
              { summary: { contains: f.q, mode: "insensitive" } },
              { employee: { firstName: { contains: f.q, mode: "insensitive" } } },
              { employee: { lastName: { contains: f.q, mode: "insensitive" } } },
              { employee: { employeeNumber: { contains: f.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { employee: true },
    orderBy: [{ status: "asc" }, { openedAt: "desc" }],
    take: 300,
  });
  return rows.map((c) => ({
    ...c,
    summary: canSeeContent(ctx, c) ? c.summary : "Confidential case",
    overdue: OPEN_STATUSES.includes(c.status) && c.dueDate !== null && c.dueDate < today,
  }));
}

export async function getCase(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.view");
  return redact(ctx, await loadCase(ctx, id));
}

/** An employee's own cases — status and outcome only, never the investigators' notes. */
export async function myCases(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const rows = await db.relationsCase.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, selfRaised: true },
    orderBy: { openedAt: "desc" },
  });
  return rows.map((c) => ({
    id: c.id,
    caseNumber: c.caseNumber,
    type: c.type,
    status: c.status,
    summary: c.summary,
    openedAt: c.openedAt,
    dueDate: c.dueDate,
    outcome: c.outcome,
    resolution: c.resolvedAt ? c.resolution : null,
  }));
}

export const noteSchema = z.object({
  kind: z.enum(["NOTE", "INVESTIGATION", "HEARING", "EVIDENCE", "DECISION", "APPEAL"]).default("NOTE"),
  note: z.string().trim().min(3, "Write the note"),
});

async function appendNote(
  ctx: Ctx,
  tx: Pick<typeof db, "relationsCaseNote">,
  caseId: string,
  kind: z.infer<typeof noteSchema>["kind"],
  note: string,
) {
  return tx.relationsCaseNote.create({
    data: { organizationId: ctx.orgId, caseId, kind, note, authorName: ctx.name, authorUserId: ctx.userId },
  });
}

export async function addCaseNote(ctx: Ctx, caseId: string, raw: z.input<typeof noteSchema>) {
  assertCan(ctx, "hr.manage");
  const v = noteSchema.parse(raw);
  const c = await loadCase(ctx, caseId);
  if (c.status === "CLOSED") throw new BusinessError("This case is closed — re-open it to add to the file.");
  const n = await appendNote(ctx, db, caseId, v.kind, v.note);
  await logAudit(ctx, { action: "RELATIONS_CASE_NOTE", entity: "RelationsCase", entityId: caseId, newValue: { kind: v.kind } });
  return n;
}

export async function assignCase(ctx: Ctx, caseId: string, assignedTo: string) {
  assertCan(ctx, "hr.manage");
  const c = await loadCase(ctx, caseId);
  if (!OPEN_STATUSES.includes(c.status)) throw new BusinessError("Only an open case can be assigned.");
  const u = await db.relationsCase.update({ where: { id: caseId }, data: { assignedTo: assignedTo.trim() || null } });
  await appendNote(ctx, db, caseId, "NOTE", `Assigned to ${assignedTo.trim() || "nobody"}.`);
  await logAudit(ctx, { action: "RELATIONS_CASE_ASSIGN", entity: "RelationsCase", entityId: caseId, newValue: { assignedTo } });
  return u;
}

const NEXT: Record<string, string[]> = {
  OPEN: ["INVESTIGATING"],
  INVESTIGATING: ["HEARING"],
  HEARING: ["INVESTIGATING"],
};

export async function setCaseStatus(ctx: Ctx, caseId: string, status: "INVESTIGATING" | "HEARING") {
  assertCan(ctx, "hr.manage");
  const c = await loadCase(ctx, caseId);
  if (!(NEXT[c.status] ?? []).includes(status))
    throw new BusinessError(`A case that's ${c.status.toLowerCase()} can't move to ${status.toLowerCase()}.`);
  return db.$transaction(async (tx) => {
    const u = await tx.relationsCase.update({ where: { id: caseId }, data: { status } });
    await appendNote(ctx, tx, caseId, status === "HEARING" ? "HEARING" : "INVESTIGATION", `Case moved from ${c.status.toLowerCase()} to ${status.toLowerCase()}.`);
    await logAudit(ctx, { action: "RELATIONS_CASE_STATUS", entity: "RelationsCase", entityId: caseId, oldValue: { status: c.status }, newValue: { status } }, tx);
    return u;
  });
}

export const resolveSchema = z.object({
  outcome: z.enum(["SUBSTANTIATED", "PARTIALLY_SUBSTANTIATED", "UNSUBSTANTIATED", "RESOLVED_INFORMALLY", "WITHDRAWN"]),
  resolution: z.string().trim().min(10, "Describe the finding and what was decided"),
});

export async function resolveCase(ctx: Ctx, caseId: string, raw: z.input<typeof resolveSchema>) {
  assertCan(ctx, "hr.manage");
  const v = resolveSchema.parse(raw);
  const c = await loadCase(ctx, caseId);
  if (!OPEN_STATUSES.includes(c.status)) throw new BusinessError(`A ${c.status.toLowerCase()} case can't be resolved again.`);
  return db.$transaction(async (tx) => {
    const u = await tx.relationsCase.update({
      where: { id: caseId },
      data: { status: "RESOLVED", outcome: v.outcome, resolution: v.resolution, resolvedAt: new Date() },
    });
    await appendNote(ctx, tx, caseId, "DECISION", `Resolved — ${v.outcome.replace(/_/g, " ").toLowerCase()}. ${v.resolution}`);
    await logAudit(ctx, { action: "RELATIONS_CASE_RESOLVE", entity: "RelationsCase", entityId: caseId, newValue: u }, tx);
    return u;
  });
}

/** Sign-off that a resolved case is complete. A second pair of eyes, hence hr.approve. */
export async function closeCase(ctx: Ctx, caseId: string) {
  assertCan(ctx, "hr.approve");
  const c = await loadCase(ctx, caseId);
  if (c.status !== "RESOLVED") throw new BusinessError("Resolve the case before closing it.");
  return db.$transaction(async (tx) => {
    const u = await tx.relationsCase.update({ where: { id: caseId }, data: { status: "CLOSED", closedAt: new Date(), closedBy: ctx.name } });
    await appendNote(ctx, tx, caseId, "NOTE", "Case closed.");
    await logAudit(ctx, { action: "RELATIONS_CASE_CLOSE", entity: "RelationsCase", entityId: caseId, newValue: u }, tx);
    return u;
  });
}

/** An appeal or new evidence: a resolved or closed case goes back under investigation. */
export async function reopenCase(ctx: Ctx, caseId: string, reason: string) {
  assertCan(ctx, "hr.approve");
  if (!reason || reason.trim().length < 5) throw new BusinessError("Record why the case is being re-opened.");
  const c = await loadCase(ctx, caseId);
  if (!["RESOLVED", "CLOSED"].includes(c.status)) throw new BusinessError("Only a resolved or closed case can be re-opened.");
  const policy = await getHrPolicy(ctx.orgId);
  return db.$transaction(async (tx) => {
    const u = await tx.relationsCase.update({
      where: { id: caseId },
      data: {
        status: "INVESTIGATING",
        outcome: null,
        resolution: null,
        resolvedAt: null,
        closedAt: null,
        closedBy: null,
        dueDate: addDays(todayUtc(), policy.relationsCaseSlaDays),
      },
    });
    await appendNote(ctx, tx, caseId, "APPEAL", `Re-opened: ${reason.trim()}`);
    await logAudit(ctx, { action: "RELATIONS_CASE_REOPEN", entity: "RelationsCase", entityId: caseId, newValue: u, reason }, tx);
    return u;
  });
}

export const sanctionSchema = z.object({
  type: z.enum(["QUERY", "VERBAL_WARNING", "WRITTEN_WARNING", "SUSPENSION", "TERMINATION_RECOMMENDATION"]),
  actionTaken: z.string().trim().min(3, "Say what action was taken"),
});

/** Turns a substantiated case into a (pending, maker/checker) disciplinary record linked to it. */
export async function issueSanctionFromCase(ctx: Ctx, caseId: string, raw: z.input<typeof sanctionSchema>) {
  assertCan(ctx, "hr.manage");
  const v = sanctionSchema.parse(raw);
  const c = await loadCase(ctx, caseId);
  if (c.selfRaised && c.type === "GRIEVANCE")
    throw new BusinessError("A grievance is the employee's own complaint — sanctions belong on a separate misconduct case.");
  if (c.outcome !== "SUBSTANTIATED" && c.outcome !== "PARTIALLY_SUBSTANTIATED")
    throw new BusinessError("A sanction can only follow a substantiated (or partly substantiated) finding.");
  const rec = await raiseDisciplinary(ctx, {
    employeeId: c.employeeId,
    type: v.type,
    incidentDate: iso(c.openedAt),
    description: `${c.caseNumber}: ${c.summary}`,
    actionTaken: v.actionTaken,
    caseId,
  });
  await appendNote(ctx, db, caseId, "DECISION", `Sanction raised: ${v.type.replace(/_/g, " ").toLowerCase()} — ${v.actionTaken}`);
  return rec;
}

/** Headline numbers for the HR overview. */
export async function caseStats(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const today = todayUtc();
  const [open, overdue, resolved, byType] = await Promise.all([
    db.relationsCase.count({ where: { organizationId: ctx.orgId, status: { in: OPEN_STATUSES as never } } }),
    db.relationsCase.count({ where: { organizationId: ctx.orgId, status: { in: OPEN_STATUSES as never }, dueDate: { lt: today } } }),
    db.relationsCase.findMany({
      where: { organizationId: ctx.orgId, resolvedAt: { not: null }, openedAt: { gte: addDays(today, -365) } },
      select: { openedAt: true, resolvedAt: true },
    }),
    db.relationsCase.groupBy({ by: ["type"], where: { organizationId: ctx.orgId }, _count: true }),
  ]);
  const days = resolved.map((r) => (r.resolvedAt!.getTime() - r.openedAt.getTime()) / 86400000);
  return {
    open,
    overdue,
    avgResolutionDays: days.length ? Math.round((days.reduce((s, x) => s + x, 0) / days.length) * 10) / 10 : null,
    byType: Object.fromEntries(byType.map((t) => [t.type, t._count])) as Record<string, number>,
  };
}
