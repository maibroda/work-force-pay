/**
 * Employee relations — grievances, misconduct investigations, harassment and whistleblowing
 * concerns, counselling and mediation, handled as cases with an append-only case file.
 *
 * Employees can raise their own grievance / confidential concern (self-service). Confidential cases
 * show only their existence — never their content — to read-only HR viewers (e.g. auditors).
 * Formal sanctions still go through the existing disciplinary register; a substantiated case can
 * issue one, linked back to the case.
 *
 * Misconduct is DISCIPLINARY, not employee relations (the founder's decision, 2026-11-05). It stays in the same
 * case engine, but a misconduct case needs the HR permission AND a disciplinary one (discipline.view to see it,
 * discipline.manage to work it), so this only ever narrows access. A person without discipline.view cannot list a
 * misconduct case, count it, or open it by its id ("Case not found": the case's existence is not confirmed).
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can, ForbiddenError, type Permission } from "@/lib/auth/permissions";
import { canCtx } from "@/lib/hr-functions";
import { addDays, iso } from "@/lib/dates";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { recordSensitiveAccess } from "./sensitive-access";
import { otherHolders } from "./second-person";
import { secondPerson } from "@/lib/second-person";
import type { RecordKind } from "@/lib/sensitive-access";
import { raiseDisciplinary } from "./hr";
import { nextNumber } from "./numbering";
import { WELFARE_KINDS } from "@/lib/welfare";

const CASE_TYPES = ["GRIEVANCE", "MISCONDUCT", "HARASSMENT", "WHISTLEBLOWING", "COUNSELLING", "MEDIATION", "WELFARE", "OTHER"] as const;
/** What an employee may open for themselves — misconduct is HR's to open about someone. */
const SELF_TYPES = ["GRIEVANCE", "HARASSMENT", "WHISTLEBLOWING", "WELFARE"];
const ALWAYS_CONFIDENTIAL = ["HARASSMENT", "WHISTLEBLOWING", "WELFARE"];
const OPEN_STATUSES = ["OPEN", "INVESTIGATING", "HEARING"];

/** Which page a case belongs to: misconduct is disciplinary; everything else is employee relations. */
export type CaseScope = "relations" | "discipline";
const isMisconduct = (c: { type: string }) => c.type === "MISCONDUCT";
/** Welfare support (bereavement, hardship, health, family): the most sensitive kind, read and worked only with welfare.manage. */
const isWelfare = (c: { type: string }) => c.type === "WELFARE";

/**
 * The welfare lane: a Delegated HR Officer holding the Welfare function has no HR permission at all, yet may read and work WELFARE cases, and only those. For every other
 * case they get "Case not found". Everyone else is checked exactly as before.
 */
const inWelfareLane = (ctx: Ctx) => ctx.role === "HR_OFFICER" && canCtx(ctx, "welfare.manage");
function assertHr(ctx: Ctx, permission: Permission) {
  if (inWelfareLane(ctx)) return;
  assertCan(ctx, permission);
}

/**
 * Which kind of read-log entry a case belongs to (governance step 2a): a welfare case, a disciplinary (misconduct) case, or any other confidential case (harassment, whistleblowing,
 * or one marked confidential). A plain grievance is none of them and is not logged.
 */
export const caseAccessKind = (c: { type: string; confidential: boolean }): RecordKind | null => (isWelfare(c) ? "WELFARE_CASE" : isMisconduct(c) ? "DISCIPLINARY_CASE" : c.confidential ? "CONFIDENTIAL_CASE" : null);

/** The "which kinds of case" part of a query. With no scope, a caller sees every kind they are allowed to. */
function scopeWhere(ctx: Ctx, scope?: CaseScope) {
  if (inWelfareLane(ctx)) {
    if (scope === "discipline") throw new ForbiddenError("discipline.view");
    return { type: "WELFARE" as const };
  }
  if (scope === "discipline") {
    assertCan(ctx, "discipline.view");
    return { type: "MISCONDUCT" as const };
  }
  const hidden: Array<"MISCONDUCT" | "WELFARE"> = [];
  if (scope === "relations" || !can(ctx.role, "discipline.view")) hidden.push("MISCONDUCT");
  if (!canCtx(ctx, "welfare.manage")) hidden.push("WELFARE");
  return hidden.length ? { type: { notIn: hidden } } : {};
}

/** A misconduct case needs the disciplinary permission as well as the HR one that was already needed; a welfare case needs the welfare one. */
function assertDisciplinary(ctx: Ctx, c: { type: string }) {
  if (isMisconduct(c)) assertCan(ctx, "discipline.manage");
  if (isWelfare(c)) assertCan(ctx, "welfare.manage");
}

export const caseSchema = z.object({
  employeeId: z.string().optional(),
  type: z.enum(CASE_TYPES),
  severity: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  confidential: z.boolean().optional(),
  /** For a welfare case only: the kind of support asked for (required then). */
  welfareKind: z.enum(WELFARE_KINDS).optional(),
  summary: z.string().trim().min(5, "Give the case a short summary").max(200),
  description: z.string().trim().min(10, "Describe what happened"),
});

export async function raiseCase(ctx: Ctx, raw: z.input<typeof caseSchema>) {
  const v = caseSchema.parse(raw);
  if (v.type === "WELFARE" && !v.welfareKind) throw new BusinessError("Choose the kind of support you are asking for.");
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
  if (hr) assertDisciplinary(ctx, v);
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
        welfareKind: v.type === "WELFARE" ? v.welfareKind! : null,
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
  // someone without disciplinary access is not even told that a misconduct case exists
  if (isMisconduct(c) && !can(ctx.role, "discipline.view")) throw new BusinessError("Case not found.");
  if (isWelfare(c) && !canCtx(ctx, "welfare.manage")) throw new BusinessError("Case not found.");
  if (inWelfareLane(ctx) && !isWelfare(c)) throw new BusinessError("Case not found.");
  return c;
}

/** Read-only HR viewers see a confidential case exist, but not what it contains. */
const canSeeContent = (ctx: Ctx, c: { confidential: boolean; type: string }) =>
  !c.confidential || (inWelfareLane(ctx) && isWelfare(c)) || (can(ctx.role, "hr.manage") && (!isMisconduct(c) || can(ctx.role, "discipline.manage")) && (!isWelfare(c) || can(ctx.role, "welfare.manage")));

function redact<T extends CaseRow>(ctx: Ctx, c: T): T & { redacted: boolean } {
  if (canSeeContent(ctx, c)) return { ...c, redacted: false };
  return { ...c, summary: "Confidential case", description: "", resolution: null, notes: [], disciplinaryRecords: [], redacted: true };
}

export async function listCases(ctx: Ctx, f: { status?: string; type?: string; q?: string; overdue?: boolean; scope?: CaseScope } = {}) {
  assertHr(ctx, "hr.view");
  const today = todayUtc();
  const rows = await db.relationsCase.findMany({
    where: {
      organizationId: ctx.orgId,
      AND: [scopeWhere(ctx, f.scope)],
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
  // opening the list shows the summaries of the cases the reader may read: how many of each kind is recorded, never whom they are about
  const shown: Partial<Record<RecordKind, number>> = {};
  for (const c of rows) {
    const kind = canSeeContent(ctx, c) ? caseAccessKind(c) : null;
    if (kind) shown[kind] = (shown[kind] ?? 0) + 1;
  }
  for (const [kind, count] of Object.entries(shown)) await recordSensitiveAccess(ctx, { kind: kind as RecordKind, ref: "case-list", count });
  return rows.map((c) => ({
    ...c,
    summary: canSeeContent(ctx, c) ? c.summary : "Confidential case",
    overdue: OPEN_STATUSES.includes(c.status) && c.dueDate !== null && c.dueDate < today,
  }));
}

export async function getCase(ctx: Ctx, id: string) {
  assertHr(ctx, "hr.view");
  const c = await loadCase(ctx, id);
  const shown = redact(ctx, c);
  // reading a welfare, confidential or disciplinary case is recorded by the case's own id (never the employee, never the text); a view that shows nothing is not a read
  const kind = shown.redacted ? null : caseAccessKind(c);
  if (kind) await recordSensitiveAccess(ctx, { kind, entity: "RelationsCase", ref: c.id, subjectEmployeeId: c.employeeId });
  return shown;
}

/** An employee's own cases — status and outcome only, never the investigators' notes. */
export async function myCases(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  // only the fields the page shows; the resolution is fetched only for a case that has been resolved (never a handler's note or a draft)
  const rows = await db.relationsCase.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, selfRaised: true },
    select: { id: true, caseNumber: true, type: true, status: true, summary: true, openedAt: true, dueDate: true, outcome: true, resolvedAt: true },
    orderBy: { openedAt: "desc" },
  });
  const resolvedIds = rows.filter((c) => c.resolvedAt).map((c) => c.id);
  const resolutions = resolvedIds.length ? await db.relationsCase.findMany({ where: { id: { in: resolvedIds }, organizationId: ctx.orgId, employeeId: ctx.employeeId }, select: { id: true, resolution: true } }) : [];
  const resolutionOf = new Map(resolutions.map((r) => [r.id, r.resolution]));
  return rows.map((c) => ({
    id: c.id,
    caseNumber: c.caseNumber,
    type: c.type,
    status: c.status,
    summary: c.summary,
    openedAt: c.openedAt,
    dueDate: c.dueDate,
    outcome: c.outcome,
    resolution: c.resolvedAt ? (resolutionOf.get(c.id) ?? null) : null,
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
  assertHr(ctx, "hr.manage");
  const v = noteSchema.parse(raw);
  const c = await loadCase(ctx, caseId);
  assertDisciplinary(ctx, c);
  if (c.status === "CLOSED") throw new BusinessError("This case is closed — re-open it to add to the file.");
  const n = await appendNote(ctx, db, caseId, v.kind, v.note);
  await logAudit(ctx, { action: "RELATIONS_CASE_NOTE", entity: "RelationsCase", entityId: caseId, newValue: { kind: v.kind } });
  return n;
}

export async function assignCase(ctx: Ctx, caseId: string, assignedTo: string) {
  assertHr(ctx, "hr.manage");
  const c = await loadCase(ctx, caseId);
  assertDisciplinary(ctx, c);
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
  assertHr(ctx, "hr.manage");
  const c = await loadCase(ctx, caseId);
  assertDisciplinary(ctx, c);
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
  assertHr(ctx, "hr.manage");
  const v = resolveSchema.parse(raw);
  const c = await loadCase(ctx, caseId);
  assertDisciplinary(ctx, c);
  if (!OPEN_STATUSES.includes(c.status)) throw new BusinessError(`A ${c.status.toLowerCase()} case can't be resolved again.`);
  return db.$transaction(async (tx) => {
    const u = await tx.relationsCase.update({
      where: { id: caseId },
      data: { status: "RESOLVED", outcome: v.outcome, resolution: v.resolution, resolvedAt: new Date(), resolvedByUserId: ctx.userId, closedSingleHolder: false, closedSingleReason: null },
    });
    await appendNote(ctx, tx, caseId, "DECISION", `Resolved — ${v.outcome.replace(/_/g, " ").toLowerCase()}. ${v.resolution}`);
    await logAudit(ctx, { action: "RELATIONS_CASE_RESOLVE", entity: "RelationsCase", entityId: caseId, newValue: u }, tx);
    return u;
  });
}

/** The right a closer needs: a welfare case is closed by a holder of the welfare function, any other case by someone who may approve. */
const closerRight = (c: { type: string }) => (isWelfare(c) ? "welfare.manage" : "hr.approve") as Permission;

/**
 * Governance step 2b: the person who resolved a case does not also close it. Where they are the only holder of the right needed they may, with a written reason of at least 20
 * characters, and the case is flagged. A case resolved before the rule has no recorded resolver, so it does not apply.
 */
async function closureVerdict(ctx: Ctx, c: { type: string; resolvedByUserId: string | null }, reason: string | undefined) {
  if (!c.resolvedByUserId || c.resolvedByUserId !== ctx.userId) return { ok: true as const, singleHolder: false };
  return secondPerson({ samePerson: true, otherHolders: await otherHolders(ctx, closerRight(c)), reason, did: "resolved this case", does: "closes it" });
}

/** What the close button needs to know for this person: blocked (they resolved it and someone else could close it), or needs a written reason (they are the only holder). */
export async function closeAdvice(ctx: Ctx, caseId: string) {
  assertHr(ctx, "hr.approve");
  const c = await loadCase(ctx, caseId);
  if (!c.resolvedByUserId || c.resolvedByUserId !== ctx.userId) return { blocked: false, needsReason: false };
  const others = await otherHolders(ctx, closerRight(c));
  return { blocked: others > 0, needsReason: others === 0 };
}

/** Sign-off that a resolved case is complete. A second pair of eyes, hence hr.approve, and not the person who resolved it (see above). */
export async function closeCase(ctx: Ctx, caseId: string, opts: { reason?: string } = {}) {
  assertHr(ctx, "hr.approve");
  const c = await loadCase(ctx, caseId);
  assertDisciplinary(ctx, c);
  if (c.status !== "RESOLVED") throw new BusinessError("Resolve the case before closing it.");
  const verdict = await closureVerdict(ctx, c, opts.reason);
  if (!verdict.ok) throw new BusinessError(verdict.error);
  return db.$transaction(async (tx) => {
    const u = await tx.relationsCase.update({
      where: { id: caseId },
      data: { status: "CLOSED", closedAt: new Date(), closedBy: ctx.name, closedSingleHolder: verdict.singleHolder, closedSingleReason: verdict.singleHolder ? (opts.reason ?? "").trim() : null },
    });
    await appendNote(ctx, tx, caseId, "NOTE", verdict.singleHolder ? "Case closed by the person who resolved it, being the only person who could (flagged)." : "Case closed.");
    // the audit entry carries ids, the flag and the step, never the reason
    const { closedSingleReason: _reason, ...safe } = u;
    void _reason;
    await logAudit(ctx, { action: "RELATIONS_CASE_CLOSE", entity: "RelationsCase", entityId: caseId, newValue: safe }, tx);
    return u;
  });
}

/** An appeal or new evidence: a resolved or closed case goes back under investigation. */
export async function reopenCase(ctx: Ctx, caseId: string, reason: string) {
  assertCan(ctx, "hr.approve");
  if (!reason || reason.trim().length < 5) throw new BusinessError("Record why the case is being re-opened.");
  const c = await loadCase(ctx, caseId);
  assertDisciplinary(ctx, c);
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
        resolvedByUserId: null,
        closedSingleHolder: false,
        closedSingleReason: null,
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
  assertDisciplinary(ctx, c);
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

/** Headline numbers for the HR overview and the two case pages (misconduct is counted under discipline, not employee relations). */
export async function caseStats(ctx: Ctx, scope?: CaseScope) {
  assertHr(ctx, "hr.view");
  const today = todayUtc();
  const kind = scopeWhere(ctx, scope);
  const [open, overdue, resolved, byType] = await Promise.all([
    db.relationsCase.count({ where: { organizationId: ctx.orgId, ...kind, status: { in: OPEN_STATUSES as never } } }),
    db.relationsCase.count({ where: { organizationId: ctx.orgId, ...kind, status: { in: OPEN_STATUSES as never }, dueDate: { lt: today } } }),
    db.relationsCase.findMany({
      where: { organizationId: ctx.orgId, ...kind, resolvedAt: { not: null }, openedAt: { gte: addDays(today, -365) } },
      select: { openedAt: true, resolvedAt: true },
    }),
    db.relationsCase.groupBy({ by: ["type"], where: { organizationId: ctx.orgId, ...kind }, _count: true }),
  ]);
  const days = resolved.map((r) => (r.resolvedAt!.getTime() - r.openedAt.getTime()) / 86400000);
  return {
    open,
    overdue,
    avgResolutionDays: days.length ? Math.round((days.reduce((s, x) => s + x, 0) / days.length) * 10) / 10 : null,
    byType: Object.fromEntries(byType.map((t) => [t.type, t._count])) as Record<string, number>,
  };
}
