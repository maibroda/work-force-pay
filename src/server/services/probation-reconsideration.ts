/**
 * Reconsideration of a FAILED probation (docs/plans/failed-probation-renewal-proposal.md; the founder's approval of 2026-11-17, F1 to F4 as recommended), behind the HR policy switch
 * `reconsiderationEnabled` (default OFF). The founder's rule: an employee who fails probation may still be considered for renewal, never automatically.
 *
 * A failed probation stays RECORDED as failed (the history is never edited). A reconsideration is a new, separately approved step:
 *   1. the employee's reporting manager (or HR, only where the employee has none) ASKS, with a justification and measurable expectations, inside the window after the failed decision;
 *   2. a DIFFERENT HR person REVIEWS it: forwards it, returns it for more work, or declines it;
 *   3. a designated decider (the same independent-decider mechanism as the probation workflow: the Company Administrator, or someone designated; never the person who asked or the HR reviewer,
 *      nor the employee; the one who confirmed the failure may decide) APPROVES (possibly a different period, within the ceiling) or declines it;
 *   4. HR records that the employee has been formally told, with a statement of FACTS ONLY, and only then does the extension take effect: the probation moves to EXTENDED with a new end date,
 *      and the normal probation process, reminders and decisions apply from there;
 *   5. the employee may respond once.
 * A second failure after a reconsideration is final (the limit per contract). It sets no pay and changes no employee status. Nothing is automatic. The audit log carries ids and the step,
 * never the justification, a note, the statement or the response. The words are cleared when a former employee is erased (retention-anonymise.ts).
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import {
  ceilingProblem,
  checkExpectations,
  checkJustification,
  countsTowardLimit,
  extensionEnd,
  isOpenStatus,
  statementFor,
  windowOpen,
  type ReconsiderationStatus,
} from "@/lib/probation-reconsideration";
import { checkResponse, deciderConflict, responseOpen, reviewerConflict } from "@/lib/probation-workflow";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { isDesignatedDecider } from "./probation-workflow";

const NOT_FOUND = "Reconsideration not found.";
const NO_CONTRACT = "Contract not found.";
const MIN_NOTE = 5;
const todayIso = () => iso(todayUtc());
const EXIT_STARTED = ["PENDING", "APPROVED", "PROCESSED"] as const;

async function requireOn(orgId: string) {
  const policy = await getHrPolicy(orgId);
  if (!policy.reconsiderationEnabled) throw new BusinessError("Reconsideration of a failed probation is not switched on for this company.");
  return policy;
}

const exitStarted = async (orgId: string, employeeId: string) => (await db.exitRecord.count({ where: { organizationId: orgId, employeeId, status: { in: [...EXIT_STARTED] as never } } })) > 0;

async function lastFailure(contractId: string) {
  return db.probationDecision.findFirst({ where: { contractId, decision: "FAILED" }, orderBy: { decidedAt: "desc" }, select: { id: true, decidedAt: true } });
}

const note = (label: string) => z.string().trim().min(MIN_NOTE, `${label} (at least ${MIN_NOTE} characters)`).max(1000);

// ───────────────────────────── Step 1: asking ─────────────────────────────

const requestSchema = z.object({
  justification: z.string(),
  months: z.coerce.number(),
  expectations: z.array(z.object({ measure: z.string(), target: z.string(), reviewOn: z.string() })).default([]),
});

export async function requestReconsideration(ctx: Ctx, contractId: string, raw: z.input<typeof requestSchema>) {
  const v = requestSchema.parse(raw);
  const policy = await requireOn(ctx.orgId);
  const c = await db.employmentContract.findFirst({
    where: { id: contractId, organizationId: ctx.orgId },
    select: { id: true, status: true, probationOutcome: true, probationMonths: true, employeeId: true, employee: { select: { id: true, reportingManagerId: true } } },
  });
  if (!c) throw new BusinessError(NO_CONTRACT);
  if (ctx.employeeId && ctx.employeeId === c.employeeId) throw new BusinessError("You cannot ask for a reconsideration of your own probation.");

  // who may ask: the employee's reporting manager; or HR, only where the employee has no reporting manager (the record is then marked)
  const isManager = !!ctx.employeeId && c.employee.reportingManagerId === ctx.employeeId;
  let recordedByHr = false;
  if (isManager) assertCan(ctx, "probation.recommend");
  else if (can(ctx.role, "hr.manage") && !c.employee.reportingManagerId) recordedByHr = true;
  else if (can(ctx.role, "hr.manage")) throw new BusinessError("This employee has a reporting manager: the request comes from them.");
  else throw new BusinessError(NO_CONTRACT);

  if (c.status !== "ACTIVE" || c.probationOutcome !== "FAILED") throw new BusinessError("Only a probation recorded as failed, on an active contract, can be reconsidered.");
  const failure = await lastFailure(c.id);
  if (!failure) throw new BusinessError("Only a probation recorded as failed can be reconsidered.");
  if (!windowOpen(iso(failure.decidedAt), todayIso(), policy.reconsiderationWindowDays))
    throw new BusinessError(`The window to ask for a reconsideration (${policy.reconsiderationWindowDays} days after the failed decision) has passed.`);
  if (await exitStarted(ctx.orgId, c.employeeId)) throw new BusinessError("An exit has already been started for this employee, so the probation can't be reconsidered.");

  const existing = await db.probationReconsideration.findMany({ where: { contractId: c.id, organizationId: ctx.orgId }, select: { status: true } });
  if (existing.some((r) => isOpenStatus(r.status as ReconsiderationStatus))) throw new BusinessError("A reconsideration is already in progress for this probation.");
  if (existing.filter((r) => countsTowardLimit(r.status as ReconsiderationStatus)).length >= policy.reconsiderationMax)
    throw new BusinessError(`This probation has already had its reconsideration (the limit is ${policy.reconsiderationMax} per contract).`);

  const bad = checkJustification(v.justification, policy.reconsiderationMinJustification) ?? checkExpectations(v.expectations, policy.reconsiderationMinExpectations, todayIso()) ?? ceilingProblem(c.probationMonths, v.months, policy.probationCeilingMonths);
  if (bad) throw new BusinessError(bad);

  return db.$transaction(async (tx) => {
    const row = await tx.probationReconsideration.create({
      data: {
        organizationId: ctx.orgId,
        employeeId: c.employeeId,
        contractId: c.id,
        failedDecisionId: failure.id,
        justification: v.justification.trim(),
        proposedMonths: v.months,
        requestedByUserId: ctx.userId,
        requestedBy: ctx.name,
        recordedByHr,
        expectations: { create: v.expectations.map((e, i) => ({ organizationId: ctx.orgId, sortOrder: i, measure: e.measure.trim(), target: e.target.trim(), reviewOn: d(e.reviewOn) })) },
      },
    });
    await logAudit(ctx, { action: "RECONSIDERATION_REQUEST", entity: "ProbationReconsideration", entityId: row.id, newValue: { contractId: c.id, employeeId: c.employeeId, months: v.months, recordedByHr } }, tx);
    return row;
  });
}

// ───────────────────────────── Step 2: HR's review ─────────────────────────────

const reviewSchema = z.object({ outcome: z.enum(["FORWARD", "RETURN", "DECLINE"]), note: note("Write the reason") });

export async function reviewReconsideration(ctx: Ctx, id: string, raw: z.input<typeof reviewSchema>) {
  assertCan(ctx, "hr.manage");
  const v = reviewSchema.parse(raw);
  const r = await db.probationReconsideration.findFirst({ where: { id, organizationId: ctx.orgId }, select: { id: true, status: true, contractId: true, requestedByUserId: true } });
  if (!r) throw new BusinessError(NOT_FOUND);
  if (r.status !== "REQUESTED") throw new BusinessError("This request has already been reviewed: it is past the HR review stage.");
  const conflict = reviewerConflict(ctx.userId, r.requestedByUserId);
  if (conflict) throw new BusinessError(conflict.replace("recommendation", "request"));
  const status = v.outcome === "FORWARD" ? "FORWARDED" : v.outcome === "RETURN" ? "RETURNED" : "DECLINED";
  const row = await db.probationReconsideration.update({ where: { id }, data: { status, hrNote: v.note, hrByUserId: ctx.userId, hrBy: ctx.name, hrAt: new Date() } });
  await logAudit(ctx, { action: "RECONSIDERATION_REVIEW", entity: "ProbationReconsideration", entityId: id, newValue: { contractId: r.contractId, outcome: v.outcome } });
  return row;
}

// ───────────────────────────── Step 3: the independent decision ─────────────────────────────

const decideSchema = z.object({ decision: z.enum(["APPROVE", "DECLINE"]), months: z.coerce.number().optional(), note: z.string().optional() });

export async function decideReconsideration(ctx: Ctx, id: string, raw: z.input<typeof decideSchema>) {
  const v = decideSchema.parse(raw);
  const r = await db.probationReconsideration.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { contract: { select: { id: true, status: true, probationOutcome: true, probationMonths: true } }, employee: { select: { id: true, departmentId: true } } },
  });
  if (!r) throw new BusinessError(NOT_FOUND);
  if (r.status !== "FORWARDED") throw new BusinessError(`This request is not at the decision stage (it is ${r.status.toLowerCase()}).`);
  if (!(await isDesignatedDecider(ctx, r.employee.departmentId))) throw new BusinessError("Only a designated decider can decide a reconsideration.");
  const conflict = deciderConflict(ctx.userId, { recommenderUserId: r.requestedByUserId, reviewerUserId: r.hrByUserId, employeeId: r.employeeId, deciderEmployeeId: ctx.employeeId ?? null, appraisal: null });
  if (conflict) throw new BusinessError(conflict.replace("made the recommendation", "asked for this reconsideration").replace("this recommendation", "this request"));
  const words = (v.note ?? "").trim();

  if (v.decision === "DECLINE") {
    if (words.length < MIN_NOTE) throw new BusinessError(`Give the reason (at least ${MIN_NOTE} characters).`);
    const row = await db.probationReconsideration.update({ where: { id }, data: { status: "DECLINED", decisionNote: words, decidedByUserId: ctx.userId, decidedBy: ctx.name, decidedAt: new Date() } });
    await logAudit(ctx, { action: "RECONSIDERATION_DECIDE", entity: "ProbationReconsideration", entityId: id, newValue: { contractId: r.contractId, decision: "DECLINE" } });
    return row;
  }

  if (r.contract.status !== "ACTIVE" || r.contract.probationOutcome !== "FAILED") throw new BusinessError("This probation is no longer recorded as failed.");
  const policy = await getHrPolicy(ctx.orgId);
  const months = v.months ?? r.proposedMonths;
  if (months !== r.proposedMonths && words.length < MIN_NOTE) throw new BusinessError("Give the reason for approving a different period (at least 5 characters).");
  const bad = ceilingProblem(r.contract.probationMonths, months, policy.probationCeilingMonths);
  if (bad) throw new BusinessError(bad);
  const row = await db.probationReconsideration.update({
    where: { id },
    data: { status: "APPROVED", approvedMonths: months, decisionNote: words || null, decidedByUserId: ctx.userId, decidedBy: ctx.name, decidedAt: new Date() },
  });
  await logAudit(ctx, { action: "RECONSIDERATION_DECIDE", entity: "ProbationReconsideration", entityId: id, newValue: { contractId: r.contractId, decision: "APPROVE", months } });
  return row;
}

// ───────────────────────────── Step 4: formally told, and the extension takes effect ─────────────────────────────

/**
 * HR records that the employee has been formally given the statement (facts only: see statementFor). Only now does the extension take effect: the probation becomes EXTENDED with a new end date
 * (the period counted from today), and a probation decision records it beside the failed decision, which is never edited. No pay, no employee status and no contract term other than the probation
 * is touched. This is the only place, besides applyProbationDecision (contracts.ts), where a contract's probation outcome changes.
 */
export async function communicateReconsideration(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.manage");
  const r = await db.probationReconsideration.findFirst({ where: { id, organizationId: ctx.orgId }, include: { expectations: { orderBy: { sortOrder: "asc" } }, contract: true } });
  if (!r) throw new BusinessError(NOT_FOUND);
  if (r.status !== "APPROVED" || !r.approvedMonths) throw new BusinessError("Only an approved reconsideration can be recorded as told to the employee.");
  const c = r.contract;
  if (c.status !== "ACTIVE" || c.probationOutcome !== "FAILED") throw new BusinessError("This probation is no longer recorded as failed, so it can't be extended.");
  if (await exitStarted(ctx.orgId, r.employeeId)) throw new BusinessError("An exit has already been started for this employee, so the probation can't be extended.");
  const policy = await getHrPolicy(ctx.orgId);
  const bad = ceilingProblem(c.probationMonths, r.approvedMonths, policy.probationCeilingMonths);
  if (bad) throw new BusinessError(bad);

  const today = todayIso();
  const newEnd = extensionEnd(today, r.approvedMonths);
  const failure = await db.probationDecision.findUnique({ where: { id: r.failedDecisionId }, select: { decidedAt: true } });
  const statement = statementFor({
    failedOn: iso(failure?.decidedAt ?? new Date()),
    months: r.approvedMonths,
    newEnd,
    expectations: r.expectations.map((e) => ({ measure: e.measure, target: e.target, reviewOn: iso(e.reviewOn) })),
  });
  return db.$transaction(async (tx) => {
    await tx.employmentContract.update({
      where: { id: c.id },
      data: { probationMonths: c.probationMonths + r.approvedMonths!, probationEndDate: d(newEnd), probationOutcome: "EXTENDED", probationExtensions: { increment: 1 } },
    });
    const decision = await tx.probationDecision.create({
      data: {
        organizationId: ctx.orgId,
        employeeId: r.employeeId,
        contractId: c.id,
        decision: "EXTENDED",
        decidedByUserId: r.decidedByUserId!,
        decidedBy: r.decidedBy!,
        note: "Probation extended after a reconsideration of the failed decision",
        extensionMonths: r.approvedMonths,
        effectiveDate: d(newEnd),
        informedAt: new Date(),
        informedBy: ctx.name,
      },
    });
    const row = await tx.probationReconsideration.update({
      where: { id },
      data: { status: "EFFECTIVE", statement, communicatedByUserId: ctx.userId, communicatedBy: ctx.name, communicatedAt: new Date(), newEndDate: d(newEnd), extensionDecisionId: decision.id },
    });
    await logAudit(ctx, { action: "RECONSIDERATION_EFFECTIVE", entity: "ProbationReconsideration", entityId: id, newValue: { contractId: c.id, employeeId: r.employeeId, months: r.approvedMonths, newEndDate: newEnd } }, tx);
    return row;
  });
}

// ───────────────────────────── Step 5: the employee's one response ─────────────────────────────

const responseSchema = z.object({ agree: z.boolean(), comment: z.string().optional() });

/** The employee's one response, once HR has told them, inside the company's response window (counted from the day they were told). It changes nothing by itself. */
export async function respondToReconsideration(ctx: Ctx, id: string, raw: z.input<typeof responseSchema>) {
  const v = responseSchema.parse(raw);
  const r = ctx.employeeId
    ? await db.probationReconsideration.findFirst({ where: { id, organizationId: ctx.orgId, employeeId: ctx.employeeId }, select: { id: true, status: true, contractId: true, communicatedAt: true, respondedAt: true } })
    : null;
  if (!r) throw new BusinessError(NOT_FOUND);
  if (r.status !== "EFFECTIVE" || !r.communicatedAt) throw new BusinessError("HR has not told you about this yet.");
  if (r.respondedAt) throw new BusinessError("You have already responded.");
  const policy = await getHrPolicy(ctx.orgId);
  if (!responseOpen(iso(r.communicatedAt), todayIso(), policy.probationResponseDays))
    throw new BusinessError(`The time to respond has passed (the window is ${policy.probationResponseDays} days from the day you were told).`);
  const bad = checkResponse(v.agree, v.comment);
  if (bad) throw new BusinessError(bad);
  const row = await db.probationReconsideration.update({ where: { id }, data: { responseAgreed: v.agree, responseText: v.comment?.trim() || null, respondedAt: new Date() } });
  await logAudit(ctx, { action: "RECONSIDERATION_RESPOND", entity: "ProbationReconsideration", entityId: id, newValue: { contractId: r.contractId, agreed: v.agree } });
  return row;
}

// ───────────────────────────── Withdrawing ─────────────────────────────

/** The supervisor withdraws their own request while it waits for HR; a designated decider can withdraw one until it takes effect. */
export async function withdrawReconsideration(ctx: Ctx, id: string, reason: string) {
  const why = note("Give the reason").parse(reason ?? "");
  const r = await db.probationReconsideration.findFirst({ where: { id, organizationId: ctx.orgId }, select: { id: true, status: true, contractId: true, requestedByUserId: true, employee: { select: { departmentId: true } } } });
  if (!r) throw new BusinessError(NOT_FOUND);
  if (r.status === "EFFECTIVE") throw new BusinessError("This reconsideration is already in effect and can't be withdrawn.");
  if (!isOpenStatus(r.status as ReconsiderationStatus)) throw new BusinessError(`This reconsideration is already ${r.status.toLowerCase()}.`);
  const own = r.requestedByUserId === ctx.userId && r.status === "REQUESTED";
  if (!own && !(await isDesignatedDecider(ctx, r.employee.departmentId))) throw new BusinessError(NOT_FOUND);
  const row = await db.probationReconsideration.update({ where: { id }, data: { status: "WITHDRAWN", withdrawnByUserId: ctx.userId, withdrawnBy: ctx.name, withdrawnAt: new Date(), withdrawReason: why } });
  await logAudit(ctx, { action: "RECONSIDERATION_WITHDRAW", entity: "ProbationReconsideration", entityId: id, newValue: { contractId: r.contractId } });
  return row;
}

// ───────────────────────────── Reading ─────────────────────────────

/**
 * The reconsiderations of a contract with everything written. Read by HR, a designated decider, and (only their own request) the supervisor who asked; nobody else, including finance, the auditor
 * and the employee (who sees only the statement, once it is in effect: myReconsiderations).
 */
export async function reconsiderationsForContract(ctx: Ctx, contractId: string) {
  const c = await db.employmentContract.findFirst({ where: { id: contractId, organizationId: ctx.orgId }, select: { id: true, employee: { select: { departmentId: true } } } });
  if (!c) return [];
  const all = can(ctx.role, "hr.manage") || can(ctx.role, "hr.approve") || (await isDesignatedDecider(ctx, c.employee.departmentId));
  const rows = await db.probationReconsideration.findMany({
    where: { contractId, organizationId: ctx.orgId, ...(all ? {} : { requestedByUserId: ctx.userId }) },
    include: { expectations: { orderBy: { sortOrder: "asc" } } },
    orderBy: { requestedAt: "desc" },
  });
  return rows;
}

/** The employee's own reconsiderations that are in effect: the statement, the conditions and their response. Nothing the supervisor or HR wrote, no user id, nothing before it takes effect. */
export async function myReconsiderations(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const policy = await getHrPolicy(ctx.orgId);
  const rows = await db.probationReconsideration.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, status: "EFFECTIVE" },
    select: {
      id: true,
      statement: true,
      communicatedAt: true,
      newEndDate: true,
      responseAgreed: true,
      responseText: true,
      respondedAt: true,
      expectations: { select: { measure: true, target: true, reviewOn: true }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { communicatedAt: "desc" },
  });
  return rows.map((r) => ({ ...r, canRespond: !r.respondedAt && !!r.communicatedAt && responseOpen(iso(r.communicatedAt), todayIso(), policy.probationResponseDays) }));
}

/** For a supervisor: their direct reports whose probation failed inside the window, with nothing in progress and the limit not reached. */
export async function reconsiderationCandidates(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const policy = await getHrPolicy(ctx.orgId);
  if (!policy.reconsiderationEnabled) return [];
  const contracts = await db.employmentContract.findMany({
    where: { organizationId: ctx.orgId, status: "ACTIVE", probationOutcome: "FAILED", employee: { reportingManagerId: ctx.employeeId } },
    select: { id: true, employeeId: true, employee: { select: { employeeNumber: true, firstName: true, lastName: true } } },
  });
  const out: Array<{ contractId: string; employeeId: string; employeeNumber: string; name: string; failedOn: string; lastDay: string }> = [];
  for (const c of contracts) {
    const failure = await lastFailure(c.id);
    if (!failure) continue;
    const failedOn = iso(failure.decidedAt);
    if (!windowOpen(failedOn, todayIso(), policy.reconsiderationWindowDays)) continue;
    const existing = await db.probationReconsideration.findMany({ where: { contractId: c.id, organizationId: ctx.orgId }, select: { status: true } });
    if (existing.some((r) => isOpenStatus(r.status as ReconsiderationStatus))) continue;
    if (existing.filter((r) => countsTowardLimit(r.status as ReconsiderationStatus)).length >= policy.reconsiderationMax) continue;
    if (await exitStarted(ctx.orgId, c.employeeId)) continue;
    const last = new Date(`${failedOn}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() + policy.reconsiderationWindowDays);
    out.push({ contractId: c.id, employeeId: c.employeeId, employeeNumber: c.employee.employeeNumber, name: `${c.employee.firstName} ${c.employee.lastName}`, failedOn, lastDay: iso(last) });
  }
  return out;
}

/** For a designated decider: the reconsiderations forwarded to them (never one they are conflicted on: they asked it, reviewed it, or are its subject). */
export async function reconsiderationQueue(ctx: Ctx) {
  const rows = await db.probationReconsideration.findMany({
    where: { organizationId: ctx.orgId, status: "FORWARDED" },
    include: { expectations: { orderBy: { sortOrder: "asc" } }, employee: { select: { employeeNumber: true, firstName: true, lastName: true, departmentId: true } }, contract: { select: { probationMonths: true } } },
    orderBy: { requestedAt: "asc" },
  });
  const out = [];
  for (const r of rows) {
    if (!(await isDesignatedDecider(ctx, r.employee.departmentId))) continue;
    if (r.requestedByUserId === ctx.userId || r.hrByUserId === ctx.userId || (ctx.employeeId && ctx.employeeId === r.employeeId)) continue;
    out.push({
      id: r.id,
      employeeNumber: r.employee.employeeNumber,
      name: `${r.employee.firstName} ${r.employee.lastName}`,
      probationMonths: r.contract.probationMonths,
      proposedMonths: r.proposedMonths,
      justification: r.justification,
      requestedBy: r.requestedBy,
      hrNote: r.hrNote,
      hrBy: r.hrBy,
      expectations: r.expectations.map((e) => ({ measure: e.measure, target: e.target, reviewOn: e.reviewOn })),
    });
  }
  return out;
}
