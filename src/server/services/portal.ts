/**
 * The client portal: a client's own approver and HR contact see their payroll month (dates, inputs, the draft) and the approver signs it off or
 * sends it back. They reach only their own organization, only through these functions, and always sign in with a second factor. A client's
 * sign-off names the calculation it covers, so a payroll calculated again afterwards needs a fresh one; where it is required, the payroll can't be
 * locked without it (the application and the database both refuse).
 */
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { milestonesFor, toDates } from "./payroll-calendar";
import { buildReconciliation } from "./payroll-controls";
import { sendRunBack } from "./payroll";
import { sendInvitation } from "./security";

export const CLIENT_ROLES = ["CLIENT_APPROVER", "CLIENT_HR"] as const;

// ─────────────────────────────── Inviting the client's people (bureau staff) ───────────────────────────────

export const inviteSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  email: z
    .string()
    .trim()
    .email()
    .transform((s) => s.toLowerCase()),
  role: z.enum(CLIENT_ROLES),
});

/** Gives one of a client's own people a portal account and emails them a link to choose a password. Only for clients of a bureau. */
export async function inviteClientUser(ctx: Ctx, raw: z.input<typeof inviteSchema>) {
  assertCan(ctx, "users.manage");
  const v = inviteSchema.parse(raw);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, bureauOrganizationId: true } });
  if (!org.bureauOrganizationId) throw new BusinessError("Portal accounts are for the clients of a payroll bureau.");
  if (await db.user.findUnique({ where: { email: v.email } })) throw new BusinessError("A user with this email already exists.");
  const user = await db.user.create({ data: { organizationId: ctx.orgId, name: v.name, email: v.email, role: v.role, passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10) } });
  await sendInvitation(user, org.name, ctx.name);
  await logAudit(ctx, { action: "CLIENT_USER_INVITE", entity: "User", entityId: user.id, newValue: { email: user.email, role: user.role } });
  return user;
}

export async function listClientUsers(ctx: Ctx) {
  assertCan(ctx, "users.manage");
  return db.user.findMany({ where: { organizationId: ctx.orgId, role: { in: [...CLIENT_ROLES] } }, select: { id: true, name: true, email: true, role: true, active: true, totpEnabled: true, lastLoginAt: true }, orderBy: { name: "asc" } });
}

export async function setClientApprovalRequired(ctx: Ctx, enabled: boolean) {
  assertCan(ctx, "settings.manage");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { bureauOrganizationId: true, clientApprovalRequired: true } });
  if (!org.bureauOrganizationId) throw new BusinessError("Client approval is for the clients of a payroll bureau.");
  if (enabled && !(await db.user.count({ where: { organizationId: ctx.orgId, role: "CLIENT_APPROVER", active: true } })))
    throw new BusinessError("Invite the client's approver first: with nobody to approve, the payroll could never be locked.");
  await db.organization.update({ where: { id: ctx.orgId }, data: { clientApprovalRequired: enabled } });
  await logAudit(ctx, { action: "CLIENT_APPROVAL_SETTING", entity: "Organization", entityId: ctx.orgId, oldValue: { required: org.clientApprovalRequired }, newValue: { required: enabled } });
}

// ─────────────────────────────── What the client sees ───────────────────────────────

const today = () => iso(new Date());

async function approvalState(orgId: string, run: { id: string; status: string; type: string; calculationCount: number }) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { clientApprovalRequired: true } });
  const last = await db.payrollClientApproval.findFirst({ where: { runId: run.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const approvedNow = !!last && last.decision === "APPROVED" && last.calculationCount === run.calculationCount;
  return { required: org.clientApprovalRequired && run.type === "REGULAR", last, approvedNow, awaiting: org.clientApprovalRequired && run.type === "REGULAR" && run.status === "APPROVED" && !approvedNow };
}

/** The client's months: their dates and where each deadline stands, the inputs, and whether a payroll is waiting for them. */
export async function portalOverview(ctx: Ctx) {
  assertCan(ctx, "portal.view");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, bureauOrganization: { select: { name: true } } } });
  const periods = await db.payrollPeriod.findMany({ where: { organizationId: ctx.orgId }, include: { calendarEntry: true }, orderBy: [{ year: "desc" }, { month: "desc" }], take: 6 });
  const months = [];
  for (const p of periods) {
    const run = await db.payrollRun.findFirst({ where: { periodId: p.id, organizationId: ctx.orgId, type: "REGULAR", status: { not: "SUPERSEDED" } }, orderBy: { runNumber: "desc" } });
    const [milestones, items] = await Promise.all([
      p.calendarEntry ? milestonesFor(ctx.orgId, p.id, toDates(p.calendarEntry), today()) : Promise.resolve([]),
      db.payrollInputItem.findMany({ where: { periodId: p.id }, orderBy: { kind: "asc" } }),
    ]);
    months.push({ period: p, milestones, items, run, approval: run ? await approvalState(ctx.orgId, run) : null });
  }
  return { organization: org.name, bureau: org.bureauOrganization?.name ?? null, months };
}

/** A payroll as the client reviews it: totals, who joined and left, what had to be explained, the employee list, and the sign-off history. */
export async function portalRun(ctx: Ctx, runId: string) {
  assertCan(ctx, "portal.view");
  const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId: ctx.orgId }, include: { period: true } });
  if (!run) throw new BusinessError("Payroll not found.");
  // a client sees a payroll once the bureau has approved it, not while it is still being prepared
  if (!["APPROVED", "LOCKED", "PAID"].includes(run.status) && ctx.role !== "COMPANY_ADMIN" && ctx.role !== "SUPER_ADMIN") throw new BusinessError("This payroll is still being prepared.");
  const [recs, recon, explained, history] = await Promise.all([
    db.payrollRecord.findMany({ where: { runId, organizationId: ctx.orgId }, select: { id: true, employeeNumber: true, employeeName: true, departmentName: true, totalEarnings: true, paye: true, employeePension: true, totalDeductions: true, netPay: true, daysWorked: true, basisDays: true }, orderBy: { employeeNumber: "asc" } }),
    run.type === "REGULAR" ? buildReconciliation(ctx, runId) : Promise.resolve(null),
    db.payrollValidationIssue.findMany({ where: { runId, requiresExplanation: true }, select: { message: true, explanation: true, explainedBy: true } }),
    db.payrollClientApproval.findMany({ where: { runId }, orderBy: { createdAt: "desc" } }),
  ]);
  return { run, records: recs, reconciliation: recon, explained, history, approval: await approvalState(ctx.orgId, run) };
}

// ─────────────────────────────── The client's decision ───────────────────────────────

async function loadForDecision(ctx: Ctx, runId: string) {
  assertCan(ctx, "portal.approve");
  const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId: ctx.orgId } });
  if (!run) throw new BusinessError("Payroll not found.");
  const st = await approvalState(ctx.orgId, run);
  if (!st.required) throw new BusinessError("This payroll doesn't need the client's approval.");
  if (run.status !== "APPROVED") throw new BusinessError(run.status === "LOCKED" || run.status === "PAID" ? "This payroll is already locked." : "This payroll isn't ready for your approval yet: the bureau is still preparing or checking it.");
  return { run, st };
}

export async function clientApproveRun(ctx: Ctx, runId: string, comment?: string) {
  const { run, st } = await loadForDecision(ctx, runId);
  if (st.approvedNow) throw new BusinessError("You have already approved this payroll.");
  await db.payrollClientApproval.create({ data: { organizationId: ctx.orgId, runId, calculationCount: run.calculationCount, decision: "APPROVED", comment: comment?.trim() || null, byName: ctx.name, byUserId: ctx.userId } });
  await logAudit(ctx, { action: "PAYROLL_CLIENT_APPROVED", entity: "PayrollRun", entityId: runId, newValue: { net: num(run.totalNet), employees: run.employeeCount }, reason: comment });
}

/** The client sends the payroll back with a reason; it returns to the bureau's preparer with the comment, and needs approving afresh. */
export async function clientRejectRun(ctx: Ctx, runId: string, comment: string) {
  const { run } = await loadForDecision(ctx, runId);
  if (!comment || comment.trim().length < 5) throw new BusinessError("Say what needs to change, so the bureau knows what to put right.");
  await db.payrollClientApproval.create({ data: { organizationId: ctx.orgId, runId, calculationCount: run.calculationCount, decision: "REJECTED", comment: comment.trim(), byName: ctx.name, byUserId: ctx.userId } });
  await sendRunBack(ctx, runId, `The client sent it back: ${comment.trim()}`, "PAYROLL_CLIENT_REJECTED");
}

/** For the bureau's staff: where the client's sign-off stands for a payroll. */
export async function clientApprovalStatus(ctx: Ctx, runId: string) {
  assertCan(ctx, "payroll.view");
  const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId: ctx.orgId } });
  if (!run) throw new BusinessError("Payroll run not found.");
  const st = await approvalState(ctx.orgId, run);
  const history = await db.payrollClientApproval.findMany({ where: { runId }, orderBy: { createdAt: "desc" }, take: 5 });
  return { ...st, history };
}
