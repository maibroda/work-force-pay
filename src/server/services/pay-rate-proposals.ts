import type { Ctx } from "@/lib/auth/context";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { isIsoDate, MONTHLY_GROSS_MESSAGE, parseMonthlyGross } from "@/lib/pay-rate";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { applyPayRate } from "./pay-rates";

/**
 * A personal monthly gross is PROPOSED (by HR, or by the payroll people) and APPROVED by a payroll manager, a second person, before it becomes a pay rate (the founder's decision,
 * 2026-11-05). A proposal is not a pay rate: the pay run reads only EmployeePayRate, and approval is what makes one, through the same code as before (applyPayRate). The amount is the
 * MONTHLY gross, held as exact text. Everything is for the caller's company only; another company's proposal is "not found". Audit entries carry ids and field names, not the amount.
 */
const LEFT = ["EXITED", "TERMINATED", "RESIGNED"];

export interface ProposalInput {
  employeeId: string;
  monthlyGross: unknown;
  structureCode?: string | null;
  reason: string;
  effectiveFrom: string;
}

const mayPropose = (ctx: Ctx) => can(ctx.role, "employee.manage") || can(ctx.role, "override.manage");
function assertMayPropose(ctx: Ctx) {
  if (!mayPropose(ctx)) throw new ForbiddenError("employee.manage");
}

/** The checks on what is proposed, shared by the single proposal, adding an employee and the import (which report the same message as a warning). Returns the clean values. */
export async function checkProposal(tx: Tx, orgId: string, v: ProposalInput) {
  const monthlyGross = parseMonthlyGross(v.monthlyGross);
  if (monthlyGross === null) throw new BusinessError(MONTHLY_GROSS_MESSAGE);
  const reason = (v.reason ?? "").trim();
  if (reason.length < 3) throw new BusinessError("Give a reason (at least a few words), for example “Office staff on a personal gross”.");
  if (!isIsoDate(v.effectiveFrom)) throw new BusinessError("Effective from must be a valid date (YYYY-MM-DD).");
  const structureCode = (v.structureCode ?? "").trim() || null;
  if (structureCode && !(await tx.salaryStructure.findFirst({ where: { organizationId: orgId, code: structureCode, status: "ACTIVE" }, select: { id: true } })))
    throw new BusinessError(`Salary structure ${structureCode} was not found, or is not active.`);
  return { monthlyGross, reason, structureCode, effectiveFrom: v.effectiveFrom };
}

/** Records a proposal inside a transaction (used by proposePayRate, adding an employee and the import). The caller has checked who may propose. */
export async function recordProposal(ctx: Ctx, tx: Tx, v: ProposalInput, source: "MANUAL" | "NEW_EMPLOYEE" | "IMPORT") {
  const clean = await checkProposal(tx, ctx.orgId, v);
  const emp = await tx.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId }, select: { id: true, status: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (LEFT.includes(emp.status)) throw new BusinessError("This employee has left: a pay rate can no longer be proposed for them.");
  if (await tx.payRateProposal.findFirst({ where: { organizationId: ctx.orgId, employeeId: emp.id, status: "PENDING" }, select: { id: true } }))
    throw new BusinessError("There is already a pending pay rate proposal for this employee: decide it or withdraw it first.");
  const row = await tx.payRateProposal.create({
    data: { organizationId: ctx.orgId, employeeId: emp.id, monthlyGross: clean.monthlyGross, structureCode: clean.structureCode, effectiveFrom: new Date(clean.effectiveFrom), reason: clean.reason, source, proposedBy: ctx.name, proposedByUserId: ctx.userId },
  });
  await logAudit(ctx, { action: "PAY_RATE_PROPOSED", entity: "PayRateProposal", entityId: row.id, newValue: { employeeId: emp.id, source, fields: ["monthlyGross", "structureCode", "effectiveFrom", "reason"] } }, tx);
  return row;
}

export async function proposePayRate(ctx: Ctx, raw: ProposalInput) {
  assertMayPropose(ctx);
  return db.$transaction((tx) => recordProposal(ctx, tx, raw, "MANUAL"));
}

async function loadOwn(ctx: Ctx, id: string, tx: Tx) {
  const row = await tx.payRateProposal.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!row) throw new BusinessError("Pay rate proposal not found.");
  return row;
}
const assertPending = (status: string) => {
  if (status !== "PENDING") throw new BusinessError(`This proposal is already ${status.toLowerCase()}.`);
};

/** Approval makes the pay rate, in one step with marking the proposal approved: if the rate cannot be made (for example a rate already starts on or after that date) nothing changes. */
export async function approvePayRate(ctx: Ctx, id: string, note?: string) {
  assertCan(ctx, "payrate.approve");
  return db.$transaction(async (tx) => {
    const p = await loadOwn(ctx, id, tx);
    assertPending(p.status);
    if (p.proposedByUserId === ctx.userId) throw new BusinessError("You made this proposal: someone else has to approve it.");
    if (ctx.employeeId && ctx.employeeId === p.employeeId) throw new BusinessError("This is your own pay: someone else has to decide it.");
    const rate = await applyPayRate(ctx, tx, {
      employeeId: p.employeeId,
      monthlyGross: p.monthlyGross.toString(),
      structureCode: p.structureCode,
      reason: p.reason,
      approvedBy: ctx.name,
      effectiveFrom: p.effectiveFrom.toISOString().slice(0, 10),
    });
    const done = await tx.payRateProposal.update({ where: { id }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note?.trim() || null, appliedRateId: rate.id } });
    await logAudit(ctx, { action: "PAY_RATE_APPROVED", entity: "PayRateProposal", entityId: id, newValue: { employeeId: p.employeeId, appliedRateId: rate.id } }, tx);
    return done;
  });
}

export async function rejectPayRate(ctx: Ctx, id: string, note: string) {
  assertCan(ctx, "payrate.approve");
  if ((note ?? "").trim().length < 3) throw new BusinessError("Give a reason for rejecting it.");
  return db.$transaction(async (tx) => {
    const p = await loadOwn(ctx, id, tx);
    assertPending(p.status);
    const done = await tx.payRateProposal.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note.trim() } });
    await logAudit(ctx, { action: "PAY_RATE_REJECTED", entity: "PayRateProposal", entityId: id, newValue: { employeeId: p.employeeId } }, tx);
    return done;
  });
}

/** The person who made a proposal may withdraw it while it is pending. */
export async function cancelPayRateProposal(ctx: Ctx, id: string) {
  assertMayPropose(ctx);
  return db.$transaction(async (tx) => {
    const p = await loadOwn(ctx, id, tx);
    assertPending(p.status);
    if (p.proposedByUserId !== ctx.userId) throw new BusinessError("You can withdraw only your own proposals.");
    const done = await tx.payRateProposal.update({ where: { id }, data: { status: "CANCELLED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date() } });
    await logAudit(ctx, { action: "PAY_RATE_WITHDRAWN", entity: "PayRateProposal", entityId: id, newValue: { employeeId: p.employeeId } }, tx);
    return done;
  });
}

/** Proposals for the company, newest first, with the employee's name and number; for people who may propose or approve. */
export async function listPayRateProposals(ctx: Ctx, f: { status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; employeeId?: string }) {
  if (!mayPropose(ctx) && !can(ctx.role, "payrate.approve")) throw new ForbiddenError("employee.manage");
  return db.payRateProposal.findMany({
    where: { organizationId: ctx.orgId, ...(f.status ? { status: f.status } : {}), ...(f.employeeId ? { employeeId: f.employeeId } : {}) },
    include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });
}
