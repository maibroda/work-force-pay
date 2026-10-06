/**
 * Removing a former employee's personal details once the retention period is over.
 *
 * Nothing here runs by itself. HR asks (a retention-period request, or a request from the person); a different
 * person approves; approving carries it out in one transaction. It is blocked until the retention period set in
 * the HR policy has passed, and while anything is still owed either way (a loan, a settlement), or a case or data
 * request is open.
 *
 * What goes: name, date of birth, contact details, bank / tax / pension details, the people they listed (next of
 * kin, guarantors), the text of their documents, letters, disciplinary and exit records, case notes, appraisal
 * comments, any job application, their login. What stays: the employee number, dates, category, and every pay and
 * leave figure — the business and the tax authority still need those, and without a name they identify no one.
 * The audit trail is a security record and is kept as it is (it names who did what, and may show earlier values).
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { eraseFrom, erasureBlockers, LEFT_STATUSES, type ErasureFacts } from "@/lib/employee-retention";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { employeeLoanBalances } from "./loans";

const REMOVED = "[removed]";

/** Everything the blocking rules need about one employee. */
async function factsFor(orgId: string, employeeId: string, years: number, today: Date, ignoreErasureId?: string): Promise<ErasureFacts & { employee: { id: string; employeeNumber: string; firstName: string; middleName: string | null; lastName: string; status: string; exitDate: Date | null } }> {
  const e = await db.employee.findFirst({ where: { id: employeeId, organizationId: orgId }, select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, status: true, exitDate: true, anonymizedAt: true } });
  if (!e) throw new BusinessError("Employee not found.");
  const [loans, settlementsOpen, casesOpen, dataRequestsOpen, pending] = await Promise.all([
    employeeLoanBalances(orgId, employeeId),
    db.exitSettlement.count({ where: { organizationId: orgId, employeeId, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] } } }),
    db.relationsCase.count({ where: { organizationId: orgId, employeeId, status: { not: "CLOSED" } } }),
    db.dataAccessRequest.count({ where: { organizationId: orgId, employeeId, status: "OPEN" } }),
    db.employeeErasure.count({ where: { organizationId: orgId, employeeId, status: "PENDING", ...(ignoreErasureId ? { id: { not: ignoreErasureId } } : {}) } }),
  ]);
  return {
    years,
    status: e.status,
    exitDate: e.exitDate,
    anonymizedAt: e.anonymizedAt,
    today,
    loanOwed: loans.reduce((s, l) => s + l.outstanding, 0),
    settlementsOpen,
    casesOpen,
    dataRequestsOpen,
    alreadyPending: pending > 0,
    employee: e,
  };
}

/** The removal itself, inside the caller's transaction. Returns how many records of each kind were touched. */
export async function anonymizeEmployee(tx: Tx, orgId: string, employeeId: string, now: Date) {
  const where = { organizationId: orgId, employeeId };
  const counts: Record<string, number> = {};

  const cases = await tx.relationsCase.findMany({ where, select: { id: true } });
  const caseIds = cases.map((c) => c.id);
  const appraisals = await tx.appraisal.findMany({ where, select: { id: true } });
  const candidates = await tx.candidate.findMany({ where, select: { id: true } });
  const candidateIds = candidates.map((c) => c.id);

  counts.contacts = (await tx.employeeContact.deleteMany({ where })).count;
  counts.guarantors = (await tx.employeeGuarantor.deleteMany({ where })).count;
  counts.changeRequests = (await tx.employeeChangeRequest.updateMany({ where, data: { proposed: { removed: true }, previous: { removed: true }, reason: REMOVED, decisionNote: null } })).count;
  counts.documents = (await tx.employeeDocument.updateMany({ where, data: { fileReference: REMOVED, documentNumber: null, notes: null } })).count;
  counts.disciplinary = (await tx.disciplinaryRecord.updateMany({ where, data: { description: REMOVED, actionTaken: null, remarks: null } })).count;
  counts.cases = (await tx.relationsCase.updateMany({ where, data: { summary: REMOVED, description: REMOVED, resolution: null } })).count;
  counts.caseNotes = caseIds.length ? (await tx.relationsCaseNote.updateMany({ where: { caseId: { in: caseIds } }, data: { note: REMOVED } })).count : 0;
  counts.letters = (await tx.generatedLetter.updateMany({ where, data: { recipientName: REMOVED, subject: REMOVED, body: REMOVED } })).count;
  counts.exits = (await tx.exitRecord.updateMany({ where, data: { reason: REMOVED, remarks: null, exitInterviewNotes: null } })).count;
  counts.appraisals = (
    await tx.appraisal.updateMany({ where, data: { employeeSelfComment: null, strengths: null, improvements: null, goals: null, reviewerComment: null, returnNote: null, approvalNote: null, employeeResponse: null } })
  ).count;
  if (appraisals.length) await tx.appraisalRating.updateMany({ where: { appraisalId: { in: appraisals.map((a) => a.id) } }, data: { selfComment: null, comment: null } });
  counts.dataRequests = (await tx.dataAccessRequest.updateMany({ where, data: { requesterName: REMOVED, identityNote: null, completionNote: null, refusalReason: null } })).count;
  if (candidateIds.length) {
    await tx.candidate.updateMany({ where: { id: { in: candidateIds } }, data: { firstName: "Anonymised", lastName: "Candidate", phone: null, email: null, resumeReference: null, notes: null, rejectionReason: REMOVED, anonymizedAt: now } });
    await tx.interview.updateMany({ where: { candidateId: { in: candidateIds }, feedback: { not: null } }, data: { feedback: REMOVED } });
    await tx.candidateCheck.updateMany({ where: { candidateId: { in: candidateIds }, notes: { not: null } }, data: { notes: null } });
    await tx.jobOffer.updateMany({ where: { candidateId: { in: candidateIds } }, data: { declineReason: null, decisionNote: null } });
  }
  counts.applications = candidateIds.length;

  // Their login, if they had one: closed for good, with nothing identifying left on it.
  const user = await tx.user.findFirst({ where: { organizationId: orgId, employeeId }, select: { id: true } });
  if (user) {
    await tx.user.update({
      where: { id: user.id },
      data: { active: false, name: "Former employee", email: `erased-${user.id}@invalid.local`, passwordHash: `!${randomBytes(24).toString("hex")}`, totpEnabled: false, totpSecret: null, totpVerifiedAt: null, backupCodes: [], sessionVersion: { increment: 1 } },
    });
  }
  counts.logins = user ? 1 : 0;

  await tx.employee.update({
    where: { id: employeeId },
    data: { firstName: "Former", middleName: null, lastName: "Employee", gender: null, dateOfBirth: null, phone: null, email: null, address: null, bankName: null, accountNumber: null, accountName: null, taxId: null, pensionPin: null, pfa: null, annualRent: null, anonymizedAt: now },
  });
  counts.employee = 1;
  return counts;
}

const reasonSchema = z.string().trim().min(15, "Say why, in a sentence or two — this is recorded and can't be undone.");

export async function requestErasure(ctx: Ctx, employeeId: string, kind: "RETENTION" | "REQUEST", reason: string) {
  assertCan(ctx, "hr.manage");
  const why = reasonSchema.parse(reason);
  const policy = await getHrPolicy(ctx.orgId);
  const facts = await factsFor(ctx.orgId, employeeId, policy.employeeRetentionYears, todayUtc());
  const blockers = erasureBlockers(facts);
  if (blockers.length) throw new BusinessError(`Can't be erased yet: ${blockers.join(" ")}`);
  return db.$transaction(async (tx) => {
    const r = await tx.employeeErasure.create({ data: { organizationId: ctx.orgId, employeeId, kind, reason: why, requestedBy: ctx.name, requestedByUserId: ctx.userId } });
    await logAudit(ctx, { action: "ERASURE_REQUEST", entity: "Employee", entityId: employeeId, newValue: { erasureId: r.id, kind, employeeNumber: facts.employee.employeeNumber }, reason: why }, tx);
    return r;
  });
}

/** A different person decides. Approving checks everything again and then carries the removal out. */
export async function decideErasure(ctx: Ctx, id: string, approve: boolean, note?: string) {
  assertCan(ctx, "hr.approve");
  const r = await db.employeeErasure.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Request not found.");
  if (r.status !== "PENDING") throw new BusinessError(`This request is already ${r.status.toLowerCase()}.`);
  if (r.requestedByUserId === ctx.userId) throw new BusinessError("You asked for this, so someone else has to approve it.");
  if (!approve) {
    if (!note || note.trim().length < 10) throw new BusinessError("Say why it is being turned down.");
    const u = await db.employeeErasure.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decisionNote: note.trim(), decidedAt: new Date() } });
    await logAudit(ctx, { action: "ERASURE_REJECT", entity: "Employee", entityId: r.employeeId, newValue: { erasureId: id }, reason: note });
    return u;
  }
  const policy = await getHrPolicy(ctx.orgId);
  const facts = await factsFor(ctx.orgId, r.employeeId, policy.employeeRetentionYears, todayUtc(), id);
  const blockers = erasureBlockers(facts);
  if (blockers.length) throw new BusinessError(`Can't be erased: ${blockers.join(" ")}`);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const summary = await anonymizeEmployee(tx, ctx.orgId, r.employeeId, now);
    const u = await tx.employeeErasure.update({ where: { id }, data: { status: "EXECUTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decisionNote: note?.trim() || null, decidedAt: now, summary } });
    await logAudit(ctx, { action: "ERASURE_EXECUTE", entity: "Employee", entityId: r.employeeId, newValue: { erasureId: id, employeeNumber: facts.employee.employeeNumber, removed: summary }, reason: note }, tx);
    return u;
  });
}

export async function retentionOverview(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const policy = await getHrPolicy(ctx.orgId);
  const years = policy.employeeRetentionYears;
  const today = todayUtc();
  const requests = await db.employeeErasure.findMany({ where: { organizationId: ctx.orgId }, include: { employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true, anonymizedAt: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  if (years <= 0) return { years, due: [], waiting: 0, requests };
  const left = await db.employee.findMany({
    where: { organizationId: ctx.orgId, status: { in: [...LEFT_STATUSES] }, anonymizedAt: null, exitDate: { not: null } },
    select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, exitDate: true },
    orderBy: { exitDate: "asc" },
  });
  const pastPeriod = left.filter((e) => eraseFrom(e.exitDate!, years) <= today);
  const due = [];
  for (const e of pastPeriod) {
    const f = await factsFor(ctx.orgId, e.id, years, today);
    due.push({ ...e, eraseFrom: eraseFrom(e.exitDate!, years), blockers: erasureBlockers(f) });
  }
  return { years, due, waiting: left.length - pastPeriod.length, requests };
}

/** What HR should look at, for the digest (runs as the system): leavers past the period with nothing in the way, and requests waiting. */
export async function retentionAttention(orgId: string, today: Date) {
  const policy = await getHrPolicy(orgId);
  const pending = await db.employeeErasure.count({ where: { organizationId: orgId, status: "PENDING" } });
  let ready = 0;
  if (policy.employeeRetentionYears > 0) {
    const left = await db.employee.findMany({ where: { organizationId: orgId, status: { in: [...LEFT_STATUSES] }, anonymizedAt: null, exitDate: { not: null } }, select: { id: true, exitDate: true } });
    for (const e of left.filter((x) => eraseFrom(x.exitDate!, policy.employeeRetentionYears) <= today)) {
      if (!erasureBlockers(await factsFor(orgId, e.id, policy.employeeRetentionYears, today)).length) ready += 1;
    }
  }
  return { pending, ready };
}
