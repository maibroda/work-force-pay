/**
 * Manager training requests and training evaluation (learning and development, step 2).
 *
 * A request is a manager's ask for a course for one of their own direct reports (HR for anyone; the same rule as feedback, reused via `mayGiveFeedback`). HR decides;
 * accepting ONLY adds a training need to HR's list (never an enrolment, a seat or a certificate). The person who made the request never decides it.
 *
 * An evaluation is about the course, not a score on the person: it changes no pay, status, certificate or appraisal. The participant answers once (was it useful?);
 * the manager answers once, a company-set number of days after the session (was it applied on the job?). HR sees results per programme only from five answers (the
 * same minimum as the welfare summary), and the participant's comments without any name. The audit log carries ids and the kind only, never a rating's comment or a reason.
 * Every query selects only the fields it returns, so nothing withheld is fetched.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { addDays, iso } from "@/lib/dates";
import { mayGiveFeedback } from "@/lib/feedback";
import {
  checkOptionalRating,
  checkRating,
  COMMENT_MAX,
  EFFECTIVENESS_OUTCOMES,
  effectivenessRefusal,
  managerEvaluationDue,
  requestStatusAfter,
  requesterConflict,
  skillEvidence,
  summariseEffectiveness,
  summariseRatings,
  type EffectivenessOutcome,
  type TrainingRequestStatus,
} from "@/lib/training-evaluation";
import { sameCourse } from "@/lib/training-plan";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { addNeed } from "./training-plan";

const todayIso = () => iso(todayUtc());
const EMPLOYEE_SELECT = { id: true, employeeNumber: true, firstName: true, lastName: true } as const;
const REQUEST_NOT_FOUND = "Training request not found.";
const ENROLMENT_NOT_FOUND = "Enrolment not found.";
const ASK_WINDOW_DAYS = 120; // a participant is asked about a course for this long after it

// ───────────────────────────── Requests ─────────────────────────────

export const requestSchema = z.object({
  employeeId: z.string().min(1),
  courseName: z
    .string()
    .trim()
    .min(3, "Name the course")
    .max(120)
    .transform((v) => v.replace(/\s+/g, " ")),
  reason: z.string().trim().min(10, "Say why, in a few plain sentences").max(1000),
});

export async function requestTraining(ctx: Ctx, raw: z.input<typeof requestSchema>) {
  assertCan(ctx, "training.request");
  const v = requestSchema.parse(raw);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId }, select: { id: true, status: true, reportingManagerId: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  // the same rule as for feedback: a manager about a direct report, HR about anyone, nobody about themselves
  const verdict = mayGiveFeedback({ giverEmployeeId: ctx.employeeId ?? null, isHr: can(ctx.role, "hr.manage") }, { employeeId: emp.id, reportingManagerId: emp.reportingManagerId });
  if (verdict === "SELF") throw new BusinessError("You can't request training for yourself here.");
  if (verdict === "NOT_FOUND") throw new BusinessError("Employee not found.");
  if (emp.status !== "ACTIVE" && emp.status !== "ON_LEAVE") throw new BusinessError("This employee is no longer active, so training can't be requested for them.");
  const [openRequests, openNeeds] = await Promise.all([
    db.trainingRequest.findMany({ where: { organizationId: ctx.orgId, employeeId: emp.id, status: "REQUESTED" }, select: { courseName: true } }),
    db.trainingNeed.findMany({ where: { organizationId: ctx.orgId, employeeId: emp.id, status: { in: ["OPEN", "PLANNED"] } }, select: { courseName: true } }),
  ]);
  if (openRequests.some((r) => sameCourse(r.courseName, v.courseName))) throw new BusinessError("This employee already has an open request for that course.");
  if (openNeeds.some((n) => sameCourse(n.courseName, v.courseName))) throw new BusinessError("This employee already has an open need for that course.");
  const r = await db.trainingRequest.create({ data: { organizationId: ctx.orgId, employeeId: emp.id, courseName: v.courseName, reason: v.reason, requestedByUserId: ctx.userId, requestedBy: ctx.name } });
  await logAudit(ctx, { action: "TRAINING_REQUEST", entity: "TrainingRequest", entityId: r.id, newValue: { employeeId: emp.id } });
  return r;
}

async function loadRequest(ctx: Ctx, id: string) {
  const r = await db.trainingRequest.findFirst({ where: { id, organizationId: ctx.orgId }, select: { id: true, employeeId: true, courseName: true, status: true, requestedByUserId: true } });
  if (!r) throw new BusinessError(REQUEST_NOT_FOUND);
  return r;
}

/** HR (hr.manage), not the person who made the request, accepts it. Accepting adds one training need and nothing else. */
export async function acceptRequest(ctx: Ctx, id: string, opts: { priority?: "LOW" | "NORMAL" | "HIGH"; dueBy?: string } = {}) {
  assertCan(ctx, "hr.manage");
  const r = await loadRequest(ctx, id);
  const conflict = requesterConflict(ctx.userId, r.requestedByUserId);
  if (conflict) throw new BusinessError(conflict);
  if (!requestStatusAfter(r.status as TrainingRequestStatus, "ACCEPT")) throw new BusinessError(`This request is already ${r.status.toLowerCase()}.`);
  // the need is added first: it refuses a person who already has an open need for the course, and then the request stays undecided
  const need = await addNeed(ctx, { employeeId: r.employeeId, courseName: r.courseName, source: "REQUEST", note: "Requested by a manager", priority: opts.priority ?? "NORMAL", dueBy: opts.dueBy });
  const u = await db.trainingRequest.update({ where: { id }, data: { status: "ACCEPTED", decidedByUserId: ctx.userId, decidedBy: ctx.name, decidedAt: new Date(), needId: need.id } });
  await logAudit(ctx, { action: "TRAINING_REQUEST_ACCEPT", entity: "TrainingRequest", entityId: id, newValue: { employeeId: r.employeeId, needId: need.id } });
  return u;
}

export async function declineRequest(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "hr.manage");
  const why = z.string().trim().min(5, "A reason is needed").max(500).parse(reason ?? "");
  const r = await loadRequest(ctx, id);
  const conflict = requesterConflict(ctx.userId, r.requestedByUserId);
  if (conflict) throw new BusinessError(conflict);
  if (!requestStatusAfter(r.status as TrainingRequestStatus, "DECLINE")) throw new BusinessError(`This request is already ${r.status.toLowerCase()}.`);
  const u = await db.trainingRequest.update({ where: { id }, data: { status: "DECLINED", decidedByUserId: ctx.userId, decidedBy: ctx.name, decidedAt: new Date(), decisionNote: why } });
  await logAudit(ctx, { action: "TRAINING_REQUEST_DECLINE", entity: "TrainingRequest", entityId: id, newValue: { employeeId: r.employeeId } });
  return u;
}

/** Whoever made the request withdraws it while it is undecided (HR may withdraw any), with a reason. */
export async function withdrawRequest(ctx: Ctx, id: string, reason: string) {
  const why = z.string().trim().min(5, "A reason is needed").max(500).parse(reason ?? "");
  const r = await loadRequest(ctx, id);
  if (!requestStatusAfter(r.status as TrainingRequestStatus, "WITHDRAW")) throw new BusinessError(`This request is already ${r.status.toLowerCase()}.`);
  if (r.requestedByUserId !== ctx.userId) assertCan(ctx, "hr.manage");
  const u = await db.trainingRequest.update({ where: { id }, data: { status: "WITHDRAWN", withdrawReason: why } });
  await logAudit(ctx, { action: "TRAINING_REQUEST_WITHDRAW", entity: "TrainingRequest", entityId: id, newValue: { employeeId: r.employeeId } });
  return u;
}

/** HR (and the auditor, who reads HR records) read every request; a manager reads only the ones they made. */
export async function listRequests(ctx: Ctx, f: { status?: TrainingRequestStatus } = {}) {
  const all = can(ctx.role, "hr.view");
  if (!all) assertCan(ctx, "training.request");
  return db.trainingRequest.findMany({
    where: { organizationId: ctx.orgId, ...(all ? {} : { requestedByUserId: ctx.userId }), ...(f.status ? { status: f.status } : {}) },
    select: {
      id: true,
      courseName: true,
      reason: true,
      status: true,
      requestedBy: true,
      requestedByUserId: true,
      requestedAt: true,
      decidedBy: true,
      decidedAt: true,
      decisionNote: true,
      withdrawReason: true,
      employee: { select: EMPLOYEE_SELECT },
    },
    orderBy: { requestedAt: "desc" },
    take: 300,
  });
}

// ───────────────────────────── Evaluations ─────────────────────────────

const answerSchema = z.object({
  rating: z.coerce.number(),
  comment: z
    .string()
    .trim()
    .max(COMMENT_MAX, `Keep the comment to at most ${COMMENT_MAX} characters`)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

function parseAnswer(raw: { rating: number; comment?: string }) {
  const v = answerSchema.parse(raw);
  const bad = checkRating(v.rating);
  if (bad) throw new BusinessError(bad);
  return v;
}

const participantSchema = z.object({
  rating: z.coerce.number(),
  content: z.coerce.number().optional(),
  facilitator: z.coerce.number().optional(),
  delivery: z.coerce.number().optional(),
  comment: answerSchema.shape.comment,
});

/** Stage 1: the participant answers once about a course they attended: relevance (was it useful for their work: the existing question), content, facilitator and delivery, with one comment. */
export async function evaluateAsParticipant(ctx: Ctx, enrolmentId: string, raw: { rating: number; content?: number; facilitator?: number; delivery?: number; comment?: string }) {
  const p = participantSchema.parse(raw);
  for (const bad of [checkRating(p.rating), checkOptionalRating(p.content), checkOptionalRating(p.facilitator), checkOptionalRating(p.delivery)]) if (bad) throw new BusinessError(bad);
  const v = { rating: p.rating, comment: p.comment };
  const e = ctx.employeeId
    ? await db.trainingEnrolment.findFirst({ where: { id: enrolmentId, organizationId: ctx.orgId, employeeId: ctx.employeeId }, select: { id: true, status: true, evaluations: { where: { kind: "PARTICIPANT" }, select: { id: true } } } })
    : null;
  if (!e) throw new BusinessError(ENROLMENT_NOT_FOUND);
  if (e.status !== "ATTENDED") throw new BusinessError("You can evaluate only a course you attended.");
  if (e.evaluations.length) throw new BusinessError("You have already answered for this course.");
  const row = await db.trainingEvaluation.create({ data: { organizationId: ctx.orgId, enrolmentId: e.id, kind: "PARTICIPANT", rating: v.rating, contentRating: p.content ?? null, facilitatorRating: p.facilitator ?? null, deliveryRating: p.delivery ?? null, comment: v.comment ?? null, byUserId: ctx.userId, byName: ctx.name } });
  await logAudit(ctx, { action: "TRAINING_EVALUATE", entity: "TrainingEvaluation", entityId: row.id, newValue: { enrolmentId: e.id, kind: "PARTICIPANT" } });
  return row;
}

/** The manager answers once, the company's number of days after the session, about a direct report who attended: was it applied on the job? */
export async function evaluateAsManager(ctx: Ctx, enrolmentId: string, raw: { rating: number; comment?: string }) {
  assertCan(ctx, "training.request");
  const v = parseAnswer(raw);
  const e = await db.trainingEnrolment.findFirst({
    where: { id: enrolmentId, organizationId: ctx.orgId },
    select: { id: true, status: true, session: { select: { sessionDate: true } }, employee: { select: { id: true, reportingManagerId: true } }, evaluations: { where: { kind: "MANAGER" }, select: { id: true } } },
  });
  if (!e) throw new BusinessError(ENROLMENT_NOT_FOUND);
  const verdict = mayGiveFeedback({ giverEmployeeId: ctx.employeeId ?? null, isHr: can(ctx.role, "hr.manage") }, { employeeId: e.employee.id, reportingManagerId: e.employee.reportingManagerId });
  if (verdict === "SELF") throw new BusinessError("You can't evaluate your own training.");
  if (verdict === "NOT_FOUND") throw new BusinessError(ENROLMENT_NOT_FOUND);
  if (e.status !== "ATTENDED") throw new BusinessError("Only a course the person attended can be evaluated.");
  const days = (await getHrPolicy(ctx.orgId)).trainingEvaluationDays;
  if (days === 0) throw new BusinessError("Manager evaluations are switched off by the company.");
  if (!managerEvaluationDue(iso(e.session.sessionDate), todayIso(), days)) throw new BusinessError(`Not yet: the manager is asked ${days} days after the session.`);
  if (e.evaluations.length) throw new BusinessError("This course has already been evaluated by a manager.");
  const row = await db.trainingEvaluation.create({ data: { organizationId: ctx.orgId, enrolmentId: e.id, kind: "MANAGER", rating: v.rating, comment: v.comment ?? null, byUserId: ctx.userId, byName: ctx.name } });
  await logAudit(ctx, { action: "TRAINING_EVALUATE", entity: "TrainingEvaluation", entityId: row.id, newValue: { enrolmentId: e.id, kind: "MANAGER" } });
  return row;
}

/** The signed-in employee's attended courses they have not yet answered about (optional), for a while after the course. */
export async function evaluationsToGive(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const since = addDays(todayUtc(), -ASK_WINDOW_DAYS);
  const rows = await db.trainingEnrolment.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, status: "ATTENDED", session: { sessionDate: { gte: since } }, evaluations: { none: { kind: "PARTICIPANT" } } },
    select: { id: true, session: { select: { sessionDate: true, programme: { select: { name: true } } } } },
    orderBy: { session: { sessionDate: "desc" } },
  });
  return rows.map((r) => ({ enrolmentId: r.id, programmeName: r.session.programme.name, sessionDate: r.session.sessionDate }));
}

/** Evaluations a manager has been asked for and not yet given: their direct reports' (HR reads everyone's). */
export async function evaluationsDue(ctx: Ctx) {
  const all = can(ctx.role, "hr.view");
  if (!all) assertCan(ctx, "training.request");
  const days = (await getHrPolicy(ctx.orgId)).trainingEvaluationDays;
  if (days === 0 || (!all && !ctx.employeeId)) return [];
  const rows = await db.trainingEnrolment.findMany({
    where: {
      organizationId: ctx.orgId,
      status: "ATTENDED",
      session: { sessionDate: { lte: addDays(todayUtc(), -days) } },
      evaluations: { none: { kind: "MANAGER" } },
      ...(all ? {} : { employee: { reportingManagerId: ctx.employeeId } }),
    },
    select: { id: true, employee: { select: EMPLOYEE_SELECT }, session: { select: { sessionDate: true, programme: { select: { name: true } } } } },
    orderBy: { session: { sessionDate: "asc" } },
    take: 200,
  });
  return rows.map((r) => ({ enrolmentId: r.id, employee: r.employee, programmeName: r.session.programme.name, sessionDate: r.session.sessionDate }));
}

/**
 * Results per programme without picking a person out (never per session, never per trainer, never per person). From five answers: the average of each of the four participant ratings (each
 * on its own answers) and the spread of effectiveness answers; below five nothing, not even a count. The participant's comments never carry a name and are listed in alphabetical order.
 * Every query selects only the fields it returns, so a participant's id and name are never fetched.
 */
export async function programmeResults(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const [programmes, rows, effects] = await Promise.all([
    db.trainingProgramme.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true, evaluateEffectiveness: true }, orderBy: { name: "asc" } }),
    db.trainingEvaluation.findMany({
      where: { organizationId: ctx.orgId },
      select: { kind: true, rating: true, contentRating: true, facilitatorRating: true, deliveryRating: true, comment: true, enrolment: { select: { session: { select: { programmeId: true } } } } },
    }),
    db.trainingEffectiveness.findMany({ where: { organizationId: ctx.orgId }, select: { outcome: true, enrolment: { select: { session: { select: { programmeId: true } } } } } }),
  ]);
  const nums = (xs: Array<number | null>) => xs.filter((x): x is number => x !== null);
  return programmes.map((p) => {
    const mine = rows.filter((r) => r.enrolment.session.programmeId === p.id);
    const participant = mine.filter((r) => r.kind === "PARTICIPANT");
    const participantSummary = summariseRatings(participant.map((r) => r.rating));
    const comments = participantSummary.shown ? participant.map((r) => r.comment).filter((c): c is string => !!c).sort((a, b) => a.localeCompare(b)) : null;
    return {
      programmeId: p.id,
      name: p.name,
      evaluateEffectiveness: p.evaluateEffectiveness,
      participant: participantSummary,
      content: summariseRatings(nums(participant.map((r) => r.contentRating))),
      facilitator: summariseRatings(nums(participant.map((r) => r.facilitatorRating))),
      delivery: summariseRatings(nums(participant.map((r) => r.deliveryRating))),
      comments,
      manager: summariseRatings(mine.filter((r) => r.kind === "MANAGER").map((r) => r.rating)),
      effectiveness: summariseEffectiveness(effects.filter((x) => x.enrolment.session.programmeId === p.id).map((x) => x.outcome as EffectivenessOutcome)),
    };
  });
}

/** The managers' evaluations, by name: HR reads them (and the employee reads their own). */
export async function listManagerEvaluations(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const rows = await db.trainingEvaluation.findMany({
    where: { organizationId: ctx.orgId, kind: "MANAGER" },
    select: { id: true, rating: true, comment: true, byName: true, createdAt: true, enrolment: { select: { employee: { select: EMPLOYEE_SELECT }, session: { select: { sessionDate: true, programme: { select: { name: true } } } } } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return rows.map((r) => ({ id: r.id, employee: r.enrolment.employee, programmeName: r.enrolment.session.programme.name, sessionDate: r.enrolment.session.sessionDate, rating: r.rating, comment: r.comment, byName: r.byName, createdAt: r.createdAt }));
}

/** The manager's evaluations of the signed-in employee, as they read feedback about themselves. Never a participant's answer, never anyone else's. */
export async function myTrainingEvaluations(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const rows = await db.trainingEvaluation.findMany({
    where: { organizationId: ctx.orgId, kind: "MANAGER", enrolment: { employeeId: ctx.employeeId } },
    select: { rating: true, comment: true, byName: true, createdAt: true, enrolment: { select: { session: { select: { programme: { select: { name: true } } } } } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ programmeName: r.enrolment.session.programme.name, rating: r.rating, comment: r.comment, byName: r.byName, createdAt: r.createdAt }));
}

// ───────────────────────────── Stage 3: effectiveness ─────────────────────────────

const effectivenessSchema = z.object({ outcome: z.enum(EFFECTIVENESS_OUTCOMES), comment: answerSchema.shape.comment });

/**
 * The manager says whether the person's performance on the work the training targets improved, the company's number of days after the session (120 by default), only for a programme HR has
 * marked, once, about a direct report who attended (HR may act for anyone, as for the application evaluation). "Not yet visible" is a choice, so a manager is never forced to judge.
 * It changes no pay, skill, appraisal or promotion. The audit log carries the ids and the outcome, never the comment.
 */
export async function evaluateEffectiveness(ctx: Ctx, enrolmentId: string, raw: { outcome: EffectivenessOutcome; comment?: string }) {
  assertCan(ctx, "training.request");
  const v = effectivenessSchema.parse(raw);
  const e = await db.trainingEnrolment.findFirst({
    where: { id: enrolmentId, organizationId: ctx.orgId },
    select: {
      id: true,
      status: true,
      session: { select: { sessionDate: true, programme: { select: { evaluateEffectiveness: true } } } },
      employee: { select: { id: true, reportingManagerId: true } },
      effectiveness: { select: { id: true } },
    },
  });
  if (!e) throw new BusinessError(ENROLMENT_NOT_FOUND);
  const verdict = mayGiveFeedback({ giverEmployeeId: ctx.employeeId ?? null, isHr: can(ctx.role, "hr.manage") }, { employeeId: e.employee.id, reportingManagerId: e.employee.reportingManagerId });
  if (verdict === "SELF") throw new BusinessError("You can't evaluate your own training.");
  if (verdict === "NOT_FOUND") throw new BusinessError(ENROLMENT_NOT_FOUND);
  const refusal = effectivenessRefusal({
    attended: e.status === "ATTENDED",
    flagged: e.session.programme.evaluateEffectiveness,
    days: (await getHrPolicy(ctx.orgId)).trainingEffectivenessDays,
    sessionDay: iso(e.session.sessionDate),
    today: todayIso(),
    alreadyAnswered: !!e.effectiveness,
  });
  if (refusal) throw new BusinessError(refusal);
  const row = await db.trainingEffectiveness.create({ data: { organizationId: ctx.orgId, enrolmentId: e.id, outcome: v.outcome, comment: v.comment ?? null, byUserId: ctx.userId, byName: ctx.name } });
  await logAudit(ctx, { action: "TRAINING_EFFECTIVENESS", entity: "TrainingEffectiveness", entityId: row.id, newValue: { enrolmentId: e.id, outcome: v.outcome } });
  return row;
}

/** Effectiveness evaluations a manager has been asked for and not yet given: their direct reports' (HR reads everyone's), for marked programmes only, once the company's days have passed. */
export async function effectivenessDueList(ctx: Ctx) {
  const all = can(ctx.role, "hr.view");
  if (!all) assertCan(ctx, "training.request");
  const days = (await getHrPolicy(ctx.orgId)).trainingEffectivenessDays;
  if (days === 0 || (!all && !ctx.employeeId)) return [];
  const rows = await db.trainingEnrolment.findMany({
    where: {
      organizationId: ctx.orgId,
      status: "ATTENDED",
      session: { sessionDate: { lte: addDays(todayUtc(), -days) }, programme: { evaluateEffectiveness: true } },
      effectiveness: { is: null },
      ...(all ? {} : { employee: { reportingManagerId: ctx.employeeId } }),
    },
    select: { id: true, employee: { select: EMPLOYEE_SELECT }, session: { select: { sessionDate: true, programme: { select: { name: true } } } } },
    orderBy: { session: { sessionDate: "asc" } },
    take: 200,
  });
  return rows.map((r) => ({ enrolmentId: r.id, employee: r.employee, programmeName: r.session.programme.name, sessionDate: r.session.sessionDate }));
}

/**
 * The evidence shown beside the effectiveness question, read-only and never a score: for each skill the course builds (a skill whose list of courses names this programme), the latest assessment
 * on or before the session and the latest after it, with "not assessed" as nothing. Nothing is ever changed. Shown only to someone who may give the answer.
 */
export async function effectivenessEvidence(ctx: Ctx, enrolmentId: string) {
  assertCan(ctx, "training.request");
  const e = await db.trainingEnrolment.findFirst({
    where: { id: enrolmentId, organizationId: ctx.orgId },
    select: { id: true, employee: { select: { id: true, reportingManagerId: true } }, session: { select: { sessionDate: true, programme: { select: { name: true } } } } },
  });
  if (!e) throw new BusinessError(ENROLMENT_NOT_FOUND);
  const verdict = mayGiveFeedback({ giverEmployeeId: ctx.employeeId ?? null, isHr: can(ctx.role, "hr.manage") }, { employeeId: e.employee.id, reportingManagerId: e.employee.reportingManagerId });
  if (verdict !== null) throw new BusinessError(ENROLMENT_NOT_FOUND);
  const programmeName = e.session.programme.name;
  const skills = (await db.skill.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true, courses: true } })).filter((s) => s.courses.some((c) => sameCourse(c, programmeName)));
  const assessments = skills.length
    ? await db.skillAssessment.findMany({ where: { organizationId: ctx.orgId, employeeId: e.employee.id, skillId: { in: skills.map((s) => s.id) } }, select: { skillId: true, level: true, assessedOn: true, skill: { select: { name: true } } } })
    : [];
  return {
    programmeName,
    sessionDate: e.session.sessionDate,
    skills: skillEvidence(
      assessments.map((a) => ({ skillId: a.skillId, skillName: a.skill.name, level: a.level, assessedOn: iso(a.assessedOn) })),
      skills.map((s) => ({ id: s.id, name: s.name })),
      iso(e.session.sessionDate),
    ),
  };
}

/** The manager's effectiveness answers about the signed-in employee, as they read the application evaluation. Never anyone else's. */
export async function myEffectivenessEvaluations(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const rows = await db.trainingEffectiveness.findMany({
    where: { organizationId: ctx.orgId, enrolment: { employeeId: ctx.employeeId } },
    select: { outcome: true, comment: true, byName: true, createdAt: true, enrolment: { select: { session: { select: { programme: { select: { name: true } } } } } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ programmeName: r.enrolment.session.programme.name, outcome: r.outcome as EffectivenessOutcome, comment: r.comment, byName: r.byName, createdAt: r.createdAt }));
}
