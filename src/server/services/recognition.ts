/**
 * Recognition awards: the company's own award types, a nomination by a manager (about a direct report) or by HR (about anyone), approval by a second person, the
 * employee's own view, an optional recognition board (only for an award type that may be announced and a recipient who agrees), and a prompt of long-service
 * milestones. It handles no money: a cash or gift value is not part of this step.
 *
 * Who may nominate whom is the same rule as for feedback (`mayGiveFeedback`): reused, not written again. The person who nominated an award never decides it. An
 * approved award is never edited: a mistake is a withdrawal with a reason. The audit log carries ids and field names only, never a citation or a reason.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import { mayGiveFeedback } from "@/lib/feedback";
import { awardStatusAfter, nominatorConflict, upcomingMilestones, type AwardStatus } from "@/lib/recognition";
import { sameCourse } from "@/lib/training-plan";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";

const todayIso = () => iso(todayUtc());
const EMPLOYEE_SELECT = { id: true, employeeNumber: true, firstName: true, lastName: true } as const;
const NOT_FOUND = "Award not found.";
const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

// ───────────────────────────── Award types ─────────────────────────────

export const awardTypeSchema = z.object({
  name: z.string().trim().min(3, "Name the award").max(120),
  description: opt,
  longServiceYears: z.coerce.number().int().min(1).max(60).optional(),
  mayAnnounce: z.boolean().optional(),
});

export async function addAwardType(ctx: Ctx, raw: z.input<typeof awardTypeSchema>) {
  assertCan(ctx, "hr.configure");
  const v = awardTypeSchema.parse(raw);
  const all = await db.recognitionAwardType.findMany({ where: { organizationId: ctx.orgId }, select: { name: true } });
  if (all.some((t) => sameCourse(t.name, v.name))) throw new BusinessError("An award with that name already exists.");
  const t = await db.recognitionAwardType.create({
    data: { organizationId: ctx.orgId, name: v.name, description: v.description ?? null, longServiceYears: v.longServiceYears ?? null, mayAnnounce: v.mayAnnounce ?? false, createdBy: ctx.name },
  });
  await logAudit(ctx, { action: "RECOGNITION_TYPE_ADD", entity: "RecognitionAwardType", entityId: t.id, newValue: { longServiceYears: t.longServiceYears, mayAnnounce: t.mayAnnounce } });
  return t;
}

export async function setAwardTypeActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "hr.configure");
  const t = await db.recognitionAwardType.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!t) throw new BusinessError("Award type not found.");
  const u = await db.recognitionAwardType.update({ where: { id }, data: { active } });
  await logAudit(ctx, { action: "RECOGNITION_TYPE_UPDATE", entity: "RecognitionAwardType", entityId: id, newValue: { active } });
  return u;
}

/** HR and managers who nominate read the award types (an employee does not). */
export async function listAwardTypes(ctx: Ctx) {
  if (!can(ctx.role, "hr.view")) assertCan(ctx, "recognition.nominate");
  return db.recognitionAwardType.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" } });
}

// ───────────────────────────── Nominating and deciding ─────────────────────────────

export const nominationSchema = z.object({ employeeId: z.string().min(1), typeId: z.string().min(1), citation: z.string().trim().min(10, "Say why, in a few plain sentences").max(1000) });

export async function nominate(ctx: Ctx, raw: z.input<typeof nominationSchema>) {
  assertCan(ctx, "recognition.nominate");
  const v = nominationSchema.parse(raw);
  const type = await db.recognitionAwardType.findFirst({ where: { id: v.typeId, organizationId: ctx.orgId } });
  if (!type) throw new BusinessError("Award type not found.");
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId }, select: { id: true, status: true, reportingManagerId: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  // the same rule as for feedback: a manager about a direct report, HR about anyone, nobody about themselves
  const verdict = mayGiveFeedback({ giverEmployeeId: ctx.employeeId ?? null, isHr: can(ctx.role, "hr.manage") }, { employeeId: emp.id, reportingManagerId: emp.reportingManagerId });
  if (verdict === "SELF") throw new BusinessError("You can't nominate yourself.");
  if (verdict === "NOT_FOUND") throw new BusinessError("Employee not found.");
  if (!type.active) throw new BusinessError("This award is switched off.");
  if (emp.status !== "ACTIVE" && emp.status !== "ON_LEAVE") throw new BusinessError("This employee is no longer active, so they can't be nominated.");
  if (await db.recognitionAward.findFirst({ where: { organizationId: ctx.orgId, employeeId: emp.id, typeId: type.id, status: "NOMINATED" }, select: { id: true } }))
    throw new BusinessError("This employee is already nominated for that award and it has not been decided yet.");
  const a = await db.recognitionAward.create({ data: { organizationId: ctx.orgId, employeeId: emp.id, typeId: type.id, citation: v.citation, nominatedByUserId: ctx.userId, nominatedBy: ctx.name } });
  await logAudit(ctx, { action: "RECOGNITION_NOMINATE", entity: "RecognitionAward", entityId: a.id, newValue: { employeeId: emp.id, typeId: type.id } });
  return a;
}

async function loadAward(ctx: Ctx, id: string) {
  const a = await db.recognitionAward.findFirst({ where: { id, organizationId: ctx.orgId }, include: { type: true } });
  if (!a) throw new BusinessError(NOT_FOUND);
  return a;
}

/** A second person (hr.approve) approves; never the person who nominated it. The award date is today. */
export async function approveAward(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.approve");
  const a = await loadAward(ctx, id);
  const conflict = nominatorConflict(ctx.userId, a.nominatedByUserId);
  if (conflict) throw new BusinessError(conflict);
  if (!awardStatusAfter(a.status as AwardStatus, "APPROVE")) throw new BusinessError(`This nomination is already ${a.status.toLowerCase()}.`);
  const u = await db.recognitionAward.update({ where: { id }, data: { status: "APPROVED", decidedByUserId: ctx.userId, decidedBy: ctx.name, decidedAt: new Date(), awardedOn: d(todayIso()) } });
  await logAudit(ctx, { action: "RECOGNITION_APPROVE", entity: "RecognitionAward", entityId: id, newValue: { employeeId: a.employeeId, typeId: a.typeId } });
  return u;
}

export async function rejectAward(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "hr.approve");
  const why = z.string().trim().min(5, "A reason is needed").max(500).parse(reason ?? "");
  const a = await loadAward(ctx, id);
  const conflict = nominatorConflict(ctx.userId, a.nominatedByUserId);
  if (conflict) throw new BusinessError(conflict);
  if (!awardStatusAfter(a.status as AwardStatus, "REJECT")) throw new BusinessError(`This nomination is already ${a.status.toLowerCase()}.`);
  const u = await db.recognitionAward.update({ where: { id }, data: { status: "REJECTED", decidedByUserId: ctx.userId, decidedBy: ctx.name, decidedAt: new Date(), decisionNote: why } });
  await logAudit(ctx, { action: "RECOGNITION_REJECT", entity: "RecognitionAward", entityId: id, newValue: { employeeId: a.employeeId, typeId: a.typeId } });
  return u;
}

/** The nominator withdraws their own nomination before it is decided; after approval only the approve right can withdraw (a correction). */
export async function withdrawAward(ctx: Ctx, id: string, reason: string) {
  const why = z.string().trim().min(5, "A reason is needed").max(500).parse(reason ?? "");
  const a = await loadAward(ctx, id);
  const own = a.nominatedByUserId === ctx.userId && a.status === "NOMINATED";
  if (!own) assertCan(ctx, "hr.approve");
  if (!awardStatusAfter(a.status as AwardStatus, "WITHDRAW")) throw new BusinessError(`This award is already ${a.status.toLowerCase()}.`);
  const u = await db.recognitionAward.update({ where: { id }, data: { status: "WITHDRAWN", withdrawnByUserId: ctx.userId, withdrawnBy: ctx.name, withdrawnAt: new Date(), withdrawReason: why, announceAgreed: null } });
  await logAudit(ctx, { action: "RECOGNITION_WITHDRAW", entity: "RecognitionAward", entityId: id, newValue: { employeeId: a.employeeId, typeId: a.typeId } });
  return u;
}

/** HR reads every nomination; a manager reads the ones they made. */
export async function listAwards(ctx: Ctx, f: { status?: AwardStatus } = {}) {
  const all = can(ctx.role, "hr.view");
  if (!all) assertCan(ctx, "recognition.nominate");
  return db.recognitionAward.findMany({
    where: { organizationId: ctx.orgId, ...(all ? {} : { nominatedByUserId: ctx.userId }), ...(f.status ? { status: f.status } : {}) },
    include: { employee: { select: EMPLOYEE_SELECT }, type: { select: { id: true, name: true, mayAnnounce: true } } },
    orderBy: [{ nominatedAt: "desc" }],
    take: 300,
  });
}

// ───────────────────────────── The employee's own recognition, and the board ─────────────────────────────

/** The signed-in employee's own APPROVED awards. A nomination still being considered, or one rejected or withdrawn, is not shown. */
export async function myRecognition(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const rows = await db.recognitionAward.findMany({ where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, status: "APPROVED" }, include: { type: true }, orderBy: { awardedOn: "desc" } });
  return rows.map((a) => ({ id: a.id, awardName: a.type.name, citation: a.citation, awardedOn: a.awardedOn, mayAnnounce: a.type.mayAnnounce, announceAgreed: a.announceAgreed }));
}

/** The recipient agrees (or not) to be shown on the recognition board. Only their own approved award, and only for an award type that may be announced. */
export async function setAnnounceAgreement(ctx: Ctx, id: string, agree: boolean) {
  const a = ctx.employeeId ? await db.recognitionAward.findFirst({ where: { id, organizationId: ctx.orgId, employeeId: ctx.employeeId, status: "APPROVED" }, include: { type: true } }) : null;
  if (!a) throw new BusinessError(NOT_FOUND);
  if (!a.type.mayAnnounce) throw new BusinessError("This award is not announced: it may not be shown on the recognition board.");
  const u = await db.recognitionAward.update({ where: { id }, data: { announceAgreed: agree, announceAnsweredAt: new Date() } });
  await logAudit(ctx, { action: "RECOGNITION_ANNOUNCE", entity: "RecognitionAward", entityId: id, newValue: { employeeId: a.employeeId, agreed: agree } });
  return u;
}

/** What any employee of the company may read: approved awards of a type that may be announced, which the recipient agreed to, for someone still here. */
export async function recognitionBoard(ctx: Ctx) {
  const rows = await db.recognitionAward.findMany({
    where: { organizationId: ctx.orgId, status: "APPROVED", announceAgreed: true, type: { mayAnnounce: true }, employee: { status: { in: ["ACTIVE", "ON_LEAVE"] } } },
    include: { type: { select: { name: true } }, employee: { select: { firstName: true, lastName: true } } },
    orderBy: { awardedOn: "desc" },
    take: 50,
  });
  return rows.map((a) => ({ id: a.id, employeeName: `${a.employee.firstName} ${a.employee.lastName}`, awardName: a.type.name, citation: a.citation, awardedOn: a.awardedOn }));
}

// ───────────────────────────── Long-service milestones: a prompt ─────────────────────────────

/** Active employees reaching one of the company's milestone years soon, to prompt a nomination. Creates nothing. */
export async function milestones(ctx: Ctx, f: { withinDays?: number } = {}) {
  assertCan(ctx, "hr.view");
  const policy = await getHrPolicy(ctx.orgId);
  const emps = await db.employee.findMany({ where: { organizationId: ctx.orgId, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { ...EMPLOYEE_SELECT, employmentDate: true } });
  const found = upcomingMilestones(emps.map((e) => ({ id: e.id, employmentDate: iso(e.employmentDate) })), todayIso(), policy.longServiceYears, f.withinDays ?? 60);
  if (!found.length) return [];
  const awards = await db.recognitionAward.findMany({
    where: { organizationId: ctx.orgId, status: { in: ["NOMINATED", "APPROVED"] }, employeeId: { in: found.map((x) => x.employeeId) }, type: { longServiceYears: { not: null } } },
    select: { employeeId: true, type: { select: { longServiceYears: true } } },
  });
  const byId = new Map(emps.map((e) => [e.id, e]));
  return found.map((x) => ({
    employee: { id: x.employeeId, employeeNumber: byId.get(x.employeeId)!.employeeNumber, firstName: byId.get(x.employeeId)!.firstName, lastName: byId.get(x.employeeId)!.lastName },
    years: x.years,
    on: x.on,
    hasAward: awards.some((a) => a.employeeId === x.employeeId && a.type.longServiceYears === x.years),
  }));
}
