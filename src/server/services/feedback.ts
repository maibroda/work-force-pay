/**
 * Continuous feedback: short, dated notes about an employee from their reporting manager or from HR, in two kinds (Recognition, Coaching).
 *
 * The employee ALWAYS sees what is recorded about them (there are no private notes about a person's performance) and may reply once to each entry. An entry is
 * never edited: a mistake is voided by HR with a reason, and the entry is kept. Feedback changes no pay, status, discipline or appraisal score; on an appraisal
 * it is only read-only evidence for the reviewer and HR. The audit log carries ids and field names only, never what a note, reply or reason says.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import { checkBody, checkRelatesOn, FEEDBACK_KINDS, FEEDBACK_LIMITS, mayGiveFeedback, type FeedbackKind } from "@/lib/feedback";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30");
const todayIso = () => iso(new Date());
const NOT_FOUND = "Feedback not found.";

const EMPLOYEE_SELECT = { id: true, employeeNumber: true, firstName: true, lastName: true } as const;

export const feedbackSchema = z.object({
  employeeId: z.string().min(1),
  kind: z.enum(FEEDBACK_KINDS),
  body: z.string(),
  relatesOn: day.optional(),
});

export async function giveFeedback(ctx: Ctx, raw: z.input<typeof feedbackSchema>) {
  assertCan(ctx, "feedback.give");
  const v = feedbackSchema.parse(raw);
  const bad = checkBody(v.body);
  if (bad) throw new BusinessError(bad);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId }, select: { id: true, status: true, reportingManagerId: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  const verdict = mayGiveFeedback({ giverEmployeeId: ctx.employeeId ?? null, isHr: can(ctx.role, "feedback.manage") }, { employeeId: emp.id, reportingManagerId: emp.reportingManagerId });
  if (verdict === "SELF") throw new BusinessError("You can't give feedback about yourself.");
  if (verdict === "NOT_FOUND") throw new BusinessError("Employee not found.");
  if (emp.status !== "ACTIVE" && emp.status !== "ON_LEAVE") throw new BusinessError("This employee is no longer active, so feedback can't be recorded about them.");
  const relatesOn = v.relatesOn ?? todayIso();
  const late = checkRelatesOn(relatesOn, todayIso());
  if (late) throw new BusinessError(late);
  return db.$transaction(async (tx) => {
    const f = await tx.performanceFeedback.create({
      data: { organizationId: ctx.orgId, employeeId: emp.id, authorUserId: ctx.userId, authorName: ctx.name, authorEmployeeId: ctx.employeeId ?? null, kind: v.kind, body: v.body.trim(), relatesOn: d(relatesOn) },
    });
    await logAudit(ctx, { action: "FEEDBACK_GIVE", entity: "PerformanceFeedback", entityId: f.id, newValue: { employeeId: emp.id, kind: v.kind } }, tx);
    return f;
  });
}

export interface FeedbackFilters {
  employeeId?: string;
  /** The employee's number, not case-sensitive. */
  employeeNumber?: string;
  kind?: FeedbackKind;
  from?: string;
  to?: string;
  includeVoided?: boolean;
  /** "team" = only the caller's own direct reports, even for HR. */
  scope?: "all" | "team";
}

/** HR reads everyone's; anyone else who gives feedback reads only their own direct reports'. */
export async function listFeedback(ctx: Ctx, f: FeedbackFilters = {}) {
  assertCan(ctx, "feedback.give");
  const everyone = can(ctx.role, "feedback.manage") && f.scope !== "team";
  if (!everyone && !ctx.employeeId) return [];
  return db.performanceFeedback.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(everyone && !f.employeeNumber ? {} : { employee: { ...(everyone ? {} : { reportingManagerId: ctx.employeeId! }), ...(f.employeeNumber ? { employeeNumber: { equals: f.employeeNumber.trim(), mode: "insensitive" as const } } : {}) } }),
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.from || f.to ? { relatesOn: { ...(f.from ? { gte: d(f.from) } : {}), ...(f.to ? { lte: d(f.to) } : {}) } } : {}),
      ...(f.includeVoided ? {} : { voidedAt: null }),
    },
    include: { employee: { select: EMPLOYEE_SELECT } },
    orderBy: [{ relatesOn: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
}

/** The signed-in employee's own entries: everything recorded about them that has not been voided. */
export async function myFeedback(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const rows = await db.performanceFeedback.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, voidedAt: null },
    select: { id: true, kind: true, body: true, relatesOn: true, authorName: true, employeeReply: true, employeeReplyAt: true, createdAt: true },
    orderBy: [{ relatesOn: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((r) => ({ id: r.id, kind: r.kind as FeedbackKind, body: r.body, relatesOn: r.relatesOn, authorName: r.authorName, reply: r.employeeReply, replyAt: r.employeeReplyAt, createdAt: r.createdAt }));
}

export async function replyToFeedback(ctx: Ctx, id: string, text: string) {
  const reply = z.string().trim().min(3, "Write a short reply").max(FEEDBACK_LIMITS.maxChars).parse(text ?? "");
  const f = ctx.employeeId ? await db.performanceFeedback.findFirst({ where: { id, organizationId: ctx.orgId, employeeId: ctx.employeeId, voidedAt: null } }) : null;
  if (!f) throw new BusinessError(NOT_FOUND);
  if (f.employeeReply) throw new BusinessError("You have already replied to this feedback.");
  const u = await db.performanceFeedback.update({ where: { id }, data: { employeeReply: reply, employeeReplyAt: new Date() } });
  await logAudit(ctx, { action: "FEEDBACK_REPLY", entity: "PerformanceFeedback", entityId: id, newValue: { employeeId: f.employeeId } });
  return u;
}

/** HR corrects a mistake: the entry is kept, marked, with a reason; it leaves the employee's page and the default lists. */
export async function voidFeedback(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "feedback.manage");
  const why = z.string().trim().min(5, "Say why it is being voided").max(FEEDBACK_LIMITS.maxChars).parse(reason ?? "");
  const f = await db.performanceFeedback.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!f) throw new BusinessError(NOT_FOUND);
  if (f.voidedAt) throw new BusinessError("This feedback has already been voided.");
  const u = await db.performanceFeedback.update({ where: { id }, data: { voidedAt: new Date(), voidedByUserId: ctx.userId, voidedBy: ctx.name, voidReason: why } });
  await logAudit(ctx, { action: "FEEDBACK_VOID", entity: "PerformanceFeedback", entityId: id, newValue: { employeeId: f.employeeId } });
  return u;
}

/**
 * The entries dated inside an appraisal's period, for the reviewer (the employee's reporting manager) and HR: read-only evidence, never a score. Anyone else,
 * including the employee, gets nothing here (the employee reads their own entries under My feedback).
 */
export async function feedbackForAppraisal(ctx: Ctx, appraisalId: string) {
  const a = await db.appraisal.findFirst({ where: { id: appraisalId, organizationId: ctx.orgId }, include: { cycle: true, employee: { select: { reportingManagerId: true } } } });
  if (!a) return [];
  const allowed = can(ctx.role, "feedback.manage") || (can(ctx.role, "feedback.give") && !!ctx.employeeId && a.employee.reportingManagerId === ctx.employeeId);
  if (!allowed) return [];
  return db.performanceFeedback.findMany({
    where: { organizationId: ctx.orgId, employeeId: a.employeeId, voidedAt: null, relatesOn: { gte: a.cycle.periodStart, lte: a.cycle.periodEnd } },
    orderBy: [{ relatesOn: "asc" }, { createdAt: "asc" }],
  });
}
