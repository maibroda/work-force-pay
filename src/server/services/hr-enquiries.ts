/**
 * HR enquiries (slice 5A, approved by the founder on 2026-11-17: docs/plans/hr-phases-4-5-plan.md, section 6, rules E1 to E6 as recommended; docs/plans/hr-enquiries-explain-back.md).
 *
 * An employee asks HR a question, HR replies in a thread, and it is answered and closed. It copies the SHAPE of the client Service Desk (client-queries.ts) but is its own pair of tables:
 * that one is a client company asking the bureau; this one is an employee asking HR. Nothing here changes pay: a pay question is a question.
 *
 *  - Who reads (E3, E6): the employee who asked it and the HR administrator (the enquiry.respond right), and nobody else: not another employee, a manager, finance, payroll, the auditor or an
 *    administrator. Every read of an enquiry by HR is written to the record of who looked at sensitive details, by the enquiry's own number and never by the employee. The HR list shows the
 *    number, the category and the wait, never the subject.
 *  - The sensitive route (E2): a grievance, harassment, whistleblowing or welfare concern is not answered here. HR moves it into an Employee relations case through the existing process
 *    (relations.ts), which is closed on this side with a plain notice; the conversation is not copied into the case.
 *  - The first-response target (E4): a company setting in working days (Monday to Friday, not a public holiday the company has entered). Overdue ones are listed in the HR digest by number only.
 *  - The audit log carries ids, numbers and categories, never a subject or a word of the conversation. The words are cleared when a former employee is erased (employee-retention.ts, E5).
 *  - No automatic reply, no chatbot, no email: the words about a person stay in the application.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { iso } from "@/lib/dates";
import { ENQUIRY_CATEGORIES, MOVABLE_CASE_TYPES, isFirstResponseOverdue, responseDueDay, watDay, workingDaysWaiting, type EnquiryStatus } from "@/lib/hr-enquiries";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy } from "./hr-policy";
import { nextNumber } from "./numbering";
import { raiseCase } from "./relations";
import { recordSensitiveAccess } from "./sensitive-access";

export const raiseSchema = z.object({
  category: z.enum(ENQUIRY_CATEGORIES),
  subject: z.string().trim().min(5, "Give the enquiry a short title (at least 5 characters)").max(150),
  body: z.string().trim().min(10, "Say what you need to ask (at least 10 characters)").max(5000),
});

const messageSchema = z.string().trim().min(2, "Write your message.").max(5000);

type CaseInput = Parameters<typeof raiseCase>[1];
export interface MoveInput {
  type: (typeof MOVABLE_CASE_TYPES)[number];
  severity?: CaseInput["severity"];
  welfareKind?: CaseInput["welfareKind"];
  summary: string;
  description: string;
}
const moveTypeSchema = z.enum(MOVABLE_CASE_TYPES);

/** What the employee is told when it is moved. No case number: a confidential case is not announced in a thread. */
export const MOVED_NOTICE = "HR has moved this into the Employee relations process, where it is handled in confidence. You will be contacted there; nothing more is needed here.";

const holidayDays = async (orgId: string) => new Set((await db.publicHoliday.findMany({ where: { organizationId: orgId }, select: { date: true } })).map((h) => iso(h.date)));

/** Where an enquiry stands against the first-response target. `today` is a plain day (West Africa Time); tests pass one, the application passes none. */
function standing(e: { createdAt: Date; firstResponseAt: Date | null; status: EnquiryStatus }, targetDays: number, holidays: ReadonlySet<string>, today: string) {
  const raisedDay = watDay(e.createdAt);
  const dueDay = responseDueDay(raisedDay, targetDays, holidays);
  const waiting = !e.firstResponseAt && e.status !== "CLOSED";
  return {
    raisedDay,
    dueDay,
    overdue: isFirstResponseOverdue({ status: e.status, firstResponseAt: e.firstResponseAt, raisedDay, today, targetDays, holidays }),
    waitingDays: waiting ? workingDaysWaiting(raisedDay, today, holidays) : null,
  };
}

/** The enquiry, if this person may see it: HR in this company, or the employee who asked it. Anyone else is told it does not exist, so its existence is not revealed. */
async function loadFor(ctx: Ctx, id: string) {
  const hr = can(ctx.role, "enquiry.respond");
  if (!hr) assertCan(ctx, "enquiry.raise");
  if (!hr && !ctx.employeeId) throw new BusinessError("Enquiry not found.");
  const e = await db.hrEnquiry.findFirst({
    where: { id, organizationId: ctx.orgId, ...(hr ? {} : { employeeId: ctx.employeeId! }) },
    include: { messages: { orderBy: { createdAt: "asc" } }, employee: { select: { employeeNumber: true, firstName: true, lastName: true } } },
  });
  if (!e) throw new BusinessError("Enquiry not found.");
  return { e, hr };
}

export async function raiseEnquiry(ctx: Ctx, raw: z.input<typeof raiseSchema>) {
  assertCan(ctx, "enquiry.raise");
  const v = raiseSchema.parse(raw);
  if (!ctx.employeeId) throw new BusinessError("Your user account isn't linked to an employee record.");
  const emp = await db.employee.findFirst({ where: { id: ctx.employeeId, organizationId: ctx.orgId }, select: { id: true } });
  if (!emp) throw new BusinessError("Your user account isn't linked to an employee record.");
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "HR_ENQUIRY");
    const e = await tx.hrEnquiry.create({ data: { organizationId: ctx.orgId, number, employeeId: emp.id, category: v.category, subject: v.subject } });
    await tx.hrEnquiryMessage.create({ data: { organizationId: ctx.orgId, enquiryId: e.id, side: "EMPLOYEE", authorName: ctx.name, authorUserId: ctx.userId, body: v.body } });
    await logAudit(ctx, { action: "HR_ENQUIRY_RAISE", entity: "HrEnquiry", entityId: e.id, newValue: { number, category: v.category } }, tx);
    return e;
  });
}

/** A message on an enquiry: from HR (it becomes answered, and the time of the first reply is kept) or from the employee who asked it (it goes back to waiting for HR). Never edited afterwards. */
export async function replyToEnquiry(ctx: Ctx, id: string, raw: string) {
  const body = messageSchema.parse(raw);
  const { e, hr } = await loadFor(ctx, id);
  if (e.status === "CLOSED") throw new BusinessError("This enquiry is closed; raise a new one.");
  if (hr && e.employeeId === ctx.employeeId) throw new BusinessError("You can't answer your own enquiry.");
  await db.$transaction(async (tx) => {
    await tx.hrEnquiryMessage.create({ data: { organizationId: ctx.orgId, enquiryId: id, side: hr ? "HR" : "EMPLOYEE", authorName: ctx.name, authorUserId: ctx.userId, body } });
    await tx.hrEnquiry.update({ where: { id }, data: hr ? { status: "ANSWERED", ...(e.firstResponseAt ? {} : { firstResponseAt: new Date() }) } : { status: "OPEN" } });
    await logAudit(ctx, { action: hr ? "HR_ENQUIRY_HR_REPLY" : "HR_ENQUIRY_EMPLOYEE_REPLY", entity: "HrEnquiry", entityId: id, newValue: { number: e.number } }, tx);
  });
}

/** Closed by the employee (at any time) or by HR (once it has been answered, so an enquiry is never closed without a reply: reply, or move it into a case). Closing is final. */
export async function closeEnquiry(ctx: Ctx, id: string) {
  const { e, hr } = await loadFor(ctx, id);
  if (e.status === "CLOSED") throw new BusinessError("This enquiry is already closed.");
  if (hr && !e.firstResponseAt) throw new BusinessError("Reply to the enquiry first (or move it into a case) before closing it.");
  await db.$transaction(async (tx) => {
    await tx.hrEnquiry.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closedBy: ctx.name } });
    await logAudit(ctx, { action: "HR_ENQUIRY_CLOSE", entity: "HrEnquiry", entityId: id, newValue: { number: e.number, by: hr ? "HR" : "EMPLOYEE" } }, tx);
  });
}

/**
 * E2. HR opens an Employee relations case for this employee through the existing process (the case rules and permissions are relations.ts's own), types the case's summary and description
 * itself (the conversation is NOT copied), and the enquiry is closed with a plain notice and counted as answered. Only the kinds an employee can raise themselves, never a disciplinary case.
 */
export async function moveEnquiryToCase(ctx: Ctx, id: string, raw: MoveInput) {
  assertCan(ctx, "enquiry.respond");
  const type = moveTypeSchema.parse(raw.type);
  const { e } = await loadFor(ctx, id);
  if (e.movedToCaseId) throw new BusinessError("This enquiry has already been moved into a case.");
  if (e.status === "CLOSED") throw new BusinessError("This enquiry is closed.");
  // the case first: if it cannot be opened (a summary too short, a missing welfare kind, no right to open it) nothing about the enquiry has changed
  const c = await raiseCase(ctx, { employeeId: e.employeeId, type, severity: raw.severity ?? "MEDIUM", welfareKind: raw.welfareKind, summary: raw.summary, description: raw.description });
  await db.$transaction(async (tx) => {
    await tx.hrEnquiryMessage.create({ data: { organizationId: ctx.orgId, enquiryId: id, side: "HR", authorName: ctx.name, authorUserId: ctx.userId, body: MOVED_NOTICE } });
    await tx.hrEnquiry.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closedBy: ctx.name, movedToCaseId: c.id, ...(e.firstResponseAt ? {} : { firstResponseAt: new Date() }) } });
    await logAudit(ctx, { action: "HR_ENQUIRY_MOVE", entity: "HrEnquiry", entityId: id, newValue: { number: e.number, caseId: c.id, caseType: type } }, tx);
  });
  return c;
}

/** The enquiry with its thread. HR's read is written to the record of who looked at sensitive details, by the enquiry's own number; the employee reading their own is not. */
export async function getEnquiry(ctx: Ctx, id: string) {
  const { e, hr } = await loadFor(ctx, id);
  if (hr) await recordSensitiveAccess(ctx, { kind: "HR_ENQUIRY", entity: "HrEnquiry", ref: e.id });
  const policy = await getHrPolicy(ctx.orgId);
  return { ...e, ...standing(e, policy.enquiryResponseDays, await holidayDays(ctx.orgId), watDay(new Date())) };
}

/** The employee's own enquiries, newest first. */
export async function myEnquiries(ctx: Ctx) {
  assertCan(ctx, "enquiry.raise");
  if (!ctx.employeeId) return [];
  return db.hrEnquiry.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId },
    select: { id: true, number: true, category: true, subject: true, status: true, createdAt: true, closedAt: true, _count: { select: { messages: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/** HR's list: the number, the category, who asked, and the wait. NEVER the subject or the words (opening one is what is logged). Waiting ones first, oldest first. */
export async function listEnquiries(ctx: Ctx, f: { status?: EnquiryStatus; overdue?: boolean; today?: string } = {}) {
  assertCan(ctx, "enquiry.respond");
  const [policy, holidays] = await Promise.all([getHrPolicy(ctx.orgId), holidayDays(ctx.orgId)]);
  const today = f.today ?? watDay(new Date());
  const rows = await db.hrEnquiry.findMany({
    where: { organizationId: ctx.orgId, ...(f.status ? { status: f.status } : {}) },
    select: { id: true, number: true, category: true, status: true, createdAt: true, firstResponseAt: true, closedAt: true, movedToCaseId: true, employee: { select: { employeeNumber: true, firstName: true, lastName: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  const out = rows.map((r) => ({ ...r, ...standing(r, policy.enquiryResponseDays, holidays, today) }));
  return f.overdue ? out.filter((r) => r.overdue) : out;
}

/** For the HR digest: waiting enquiries past the target, by number and category only. No permission check: the digest runs as the system, and it carries nothing a reader should not see. */
export async function enquiriesOverdue(orgId: string, today: string) {
  const [policy, holidays] = await Promise.all([getHrPolicy(orgId), holidayDays(orgId)]);
  const rows = await db.hrEnquiry.findMany({ where: { organizationId: orgId, status: "OPEN", firstResponseAt: null }, select: { id: true, number: true, category: true, status: true, createdAt: true, firstResponseAt: true }, orderBy: { createdAt: "asc" } });
  return rows
    .map((r) => ({ id: r.id, number: r.number, category: r.category, ...standing(r, policy.enquiryResponseDays, holidays, today) }))
    .filter((r) => r.overdue)
    .map((r) => ({ id: r.id, number: r.number, category: r.category, raisedDay: r.raisedDay, dueDay: r.dueDay, waitingDays: r.waitingDays ?? 0 }));
}
