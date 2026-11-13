/**
 * Engagement surveys, anonymous by design.
 *
 * WHAT IS KEPT WHERE. An ANSWER carries no person, no user and no time, and its id is a random UUID (not one that orders by time). Who has taken part is kept only on the
 * access-code row (an employee's single-use code, stored as a hash) and NO page, report or export lists it: HR sees counts. When someone submits, the code is marked used and
 * the answer is stored WITHOUT the code, in one step; after that nothing links the code (so the person) to the answer. The audit log never records a submission.
 *
 * WHAT IS SHOWN. Nothing below five answers; a group only with at least ten invited and five answers; a hidden group is combined with the others, and when exactly one would be
 * hidden a second is hidden too (so it cannot be found by subtraction). Results wait for the close. Comments are unnamed, unlabelled and sorted. After the retention period
 * the raw answers and the codes are deleted and the anonymised result is kept.
 *
 * Limit, stated plainly: this stops anyone using the application from tying an answer to a person. It cannot stop someone with direct access to the database and its
 * transaction metadata from reasoning about when rows were written; keep database access tightly controlled.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { surveyCodeLimiter } from "@/lib/rate-limit";
import { MAX_QUESTIONS, COMMENT_MAX, QUESTION_TEXT_MAX, MIN_RESPONSES, breakdown, generateCode, hashCode, normaliseCode, retentionDue, summarise, surveyState, type GroupCount, type ScaleSummary } from "@/lib/survey";
import { canCtx } from "@/lib/hr-functions";
import { assertCan, BusinessError, db } from "./_base";

/** Reading surveys and their results: HR viewers, and a Delegated HR Officer who holds the Surveys function (who has no general HR permission). */
function assertSurveyReader(ctx: Ctx) {
  if (!canCtx(ctx, "hr.view")) assertCan(ctx, "survey.manage");
}
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { categoryHeld } from "./retention-holds";

const todayIso = () => iso(todayUtc());
const NOT_FOUND = "Survey not found.";
type Answer = { questionId: string; value?: number; comment?: string };

// ───────────────────────────── Building a survey (HR) ─────────────────────────────

export const surveySchema = z.object({
  title: z.string().trim().min(3, "Give the survey a title").max(120),
  intro: z
    .string()
    .trim()
    .max(600)
    .optional()
    .transform((v) => (v ? v : undefined)),
  categoryId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  opensOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the opening day"),
  closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the closing day"),
});

export async function createSurvey(ctx: Ctx, raw: z.input<typeof surveySchema>) {
  assertCan(ctx, "survey.manage");
  const v = surveySchema.parse(raw);
  if (v.closesOn < v.opensOn) throw new BusinessError("The survey cannot close before it opens.");
  if (v.categoryId && v.departmentId) throw new BusinessError("Invite everyone, one role or one department, not a combination.");
  if (v.categoryId && !(await db.employeeCategory.findFirst({ where: { id: v.categoryId, organizationId: ctx.orgId }, select: { id: true } }))) throw new BusinessError("Role not found.");
  if (v.departmentId && !(await db.department.findFirst({ where: { id: v.departmentId, organizationId: ctx.orgId }, select: { id: true } }))) throw new BusinessError("Department not found.");
  const s = await db.survey.create({
    data: { organizationId: ctx.orgId, title: v.title, intro: v.intro ?? null, categoryId: v.categoryId || null, departmentId: v.departmentId || null, opensOn: d(v.opensOn), closesOn: d(v.closesOn), createdBy: ctx.name },
  });
  await logAudit(ctx, { action: "SURVEY_CREATE", entity: "Survey", entityId: s.id, newValue: { everyone: !s.categoryId && !s.departmentId } });
  return s;
}

async function loadSurvey(ctx: Ctx, id: string) {
  const s = await db.survey.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!s) throw new BusinessError(NOT_FOUND);
  return s;
}

export async function addQuestion(ctx: Ctx, surveyId: string, raw: { kind: "SCALE" | "COMMENT"; text: string }) {
  assertCan(ctx, "survey.manage");
  const v = z.object({ kind: z.enum(["SCALE", "COMMENT"]), text: z.string().trim().min(3, "Write the question").max(QUESTION_TEXT_MAX) }).parse(raw);
  const s = await loadSurvey(ctx, surveyId);
  if (s.status !== "DRAFT") throw new BusinessError("Questions can be changed only while the survey is a draft.");
  const count = await db.surveyQuestion.count({ where: { surveyId } });
  if (count >= MAX_QUESTIONS) throw new BusinessError(`A survey has at most ${MAX_QUESTIONS} questions.`);
  return db.surveyQuestion.create({ data: { organizationId: ctx.orgId, surveyId, position: count + 1, kind: v.kind, text: v.text } });
}

export async function removeQuestion(ctx: Ctx, questionId: string) {
  assertCan(ctx, "survey.manage");
  const q = await db.surveyQuestion.findFirst({ where: { id: questionId, organizationId: ctx.orgId }, include: { survey: { select: { status: true } } } });
  if (!q) throw new BusinessError("Question not found.");
  if (q.survey.status !== "DRAFT") throw new BusinessError("Questions can be changed only while the survey is a draft.");
  await db.surveyQuestion.delete({ where: { id: questionId } });
  return { id: questionId };
}

// ───────────────────────────── Opening: one code for each invited employee ─────────────────────────────

/** Opens the survey: every invited active employee gets one single-use code. The codes are returned ONCE, in a sheet for HR to hand out; only their hashes are stored. */
export async function openSurvey(ctx: Ctx, id: string) {
  assertCan(ctx, "survey.manage");
  const s = await loadSurvey(ctx, id);
  if (s.status !== "DRAFT") throw new BusinessError("This survey is already open or closed.");
  if (!(await db.surveyQuestion.count({ where: { surveyId: id } }))) throw new BusinessError("Add at least one question first.");
  const people = await db.employee.findMany({
    where: { organizationId: ctx.orgId, status: { in: ["ACTIVE", "ON_LEAVE"] }, ...(s.categoryId ? { categoryId: s.categoryId } : {}), ...(s.departmentId ? { departmentId: s.departmentId } : {}) },
    select: { id: true, employeeNumber: true, firstName: true, lastName: true, categoryId: true, departmentId: true },
    orderBy: { employeeNumber: "asc" },
  });
  if (!people.length) throw new BusinessError("No one is invited: the audience is empty.");
  const sheet: Array<{ employeeNumber: string; name: string; code: string }> = [];
  const rows = people.map((p) => {
    const code = generateCode();
    sheet.push({ employeeNumber: p.employeeNumber, name: `${p.firstName} ${p.lastName}`, code });
    return { organizationId: ctx.orgId, surveyId: id, employeeId: p.id, categoryId: p.categoryId, departmentId: p.departmentId, codeHash: hashCode(normaliseCode(code)) };
  });
  const survey = await db.$transaction(async (tx) => {
    await tx.surveyAccessCode.createMany({ data: rows });
    return tx.survey.update({ where: { id }, data: { status: "OPEN", invitedCount: people.length } });
  });
  await logAudit(ctx, { action: "SURVEY_OPEN", entity: "Survey", entityId: id, newValue: { invited: people.length } });
  return { survey, sheet };
}

/** A lost code: the old one is cancelled and a new one issued. If the person had already taken part the new code is created already cancelled, and the answer looks the same, so HR cannot tell who took part. */
export async function reissueCode(ctx: Ctx, surveyId: string, employeeId: string) {
  assertCan(ctx, "survey.manage");
  const s = await loadSurvey(ctx, surveyId);
  if (s.status !== "OPEN") throw new BusinessError("Codes can be reissued only while the survey is open.");
  const old = await db.surveyAccessCode.findMany({ where: { surveyId, employeeId }, select: { id: true, status: true, categoryId: true, departmentId: true } });
  if (!old.length) throw new BusinessError("That person was not invited.");
  const alreadyUsed = old.some((o) => o.status === "USED");
  const code = generateCode();
  await db.$transaction(async (tx) => {
    await tx.surveyAccessCode.updateMany({ where: { surveyId, employeeId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
    await tx.surveyAccessCode.create({
      data: { organizationId: ctx.orgId, surveyId, employeeId, categoryId: old[0].categoryId, departmentId: old[0].departmentId, codeHash: hashCode(normaliseCode(code)), status: alreadyUsed ? "CANCELLED" : "ACTIVE" },
    });
  });
  await logAudit(ctx, { action: "SURVEY_CODE_REISSUE", entity: "Survey", entityId: surveyId, newValue: { employeeId } });
  return { code };
}

export async function closeSurvey(ctx: Ctx, id: string) {
  assertCan(ctx, "survey.manage");
  const s = await loadSurvey(ctx, id);
  if (s.status === "DRAFT") throw new BusinessError("This survey has not been opened.");
  if (s.status === "CLOSED") throw new BusinessError("This survey is already closed.");
  const u = await db.survey.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
  await logAudit(ctx, { action: "SURVEY_CLOSE", entity: "Survey", entityId: id, newValue: { invited: s.invitedCount } });
  return u;
}

/** What the company is doing about the results, once the survey has closed: every invited employee reads it. */
export async function setFollowUp(ctx: Ctx, id: string, text: string) {
  assertCan(ctx, "survey.manage");
  const note = z.string().trim().min(5, "Write a short note").max(1000).parse(text ?? "");
  const s = await loadSurvey(ctx, id);
  if (surveyState(s.status, iso(s.opensOn), iso(s.closesOn), todayIso()) !== "CLOSED") throw new BusinessError("Write the note once the survey has closed.");
  const u = await db.survey.update({ where: { id }, data: { followUp: note } });
  await logAudit(ctx, { action: "SURVEY_FOLLOW_UP", entity: "Survey", entityId: id, newValue: { written: true } });
  return u;
}

// ───────────────────────────── Reading (HR): counts only ─────────────────────────────

function groups(codes: Array<{ employeeId: string; status: string; categoryId: string | null }>, names: Map<string, string>): GroupCount[] {
  const byGroup = new Map<string, { invited: Set<string>; took: Set<string> }>();
  for (const c of codes) {
    const k = c.categoryId ?? "none";
    const g = byGroup.get(k) ?? { invited: new Set(), took: new Set() };
    g.invited.add(c.employeeId);
    if (c.status === "USED") g.took.add(c.employeeId);
    byGroup.set(k, g);
  }
  return [...byGroup.entries()].map(([k, g]) => ({ key: k, label: names.get(k) ?? "No role", invited: g.invited.size, answers: g.took.size }));
}

export async function listSurveys(ctx: Ctx) {
  assertSurveyReader(ctx);
  const rows = await db.survey.findMany({
    where: { organizationId: ctx.orgId },
    select: { id: true, title: true, status: true, opensOn: true, closesOn: true, invitedCount: true, closedAt: true, rawDeletedAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const used = await db.surveyAccessCode.groupBy({ by: ["surveyId"], where: { organizationId: ctx.orgId, status: "USED" }, _count: { _all: true } });
  const took = new Map(used.map((u) => [u.surveyId, u._count._all]));
  const today = todayIso();
  return rows.map((r) => ({ id: r.id, title: r.title, state: surveyState(r.status, iso(r.opensOn), iso(r.closesOn), today), opensOn: r.opensOn, closesOn: r.closesOn, invited: r.invitedCount, took: took.get(r.id) ?? 0, rawDeleted: !!r.rawDeletedAt }));
}

/** One survey for HR: its questions and the participation COUNTS (overall, and by role only where safe). Never who took part. */
export async function getSurvey(ctx: Ctx, id: string) {
  assertCan(ctx, "survey.manage");
  const s = await db.survey.findFirst({ where: { id, organizationId: ctx.orgId }, select: { id: true, title: true, intro: true, status: true, opensOn: true, closesOn: true, invitedCount: true, followUp: true, categoryId: true, departmentId: true, rawDeletedAt: true } });
  if (!s) throw new BusinessError(NOT_FOUND);
  const [questions, codes, cats] = await Promise.all([
    db.surveyQuestion.findMany({ where: { surveyId: id }, select: { id: true, position: true, kind: true, text: true }, orderBy: { position: "asc" } }),
    db.surveyAccessCode.findMany({ where: { surveyId: id }, select: { employeeId: true, status: true, categoryId: true } }),
    db.employeeCategory.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true } }),
  ]);
  const took = new Set(codes.filter((c) => c.status === "USED").map((c) => c.employeeId)).size;
  const b = breakdown(groups(codes, new Map(cats.map((c) => [c.id, c.name]))));
  return {
    id: s.id,
    title: s.title,
    intro: s.intro,
    state: surveyState(s.status, iso(s.opensOn), iso(s.closesOn), todayIso()),
    opensOn: s.opensOn,
    closesOn: s.closesOn,
    followUp: s.followUp,
    rawDeleted: !!s.rawDeletedAt,
    questions,
    participation: {
      invited: s.invitedCount,
      took,
      byRole: { shown: b.shown.map((g) => ({ label: g.label, invited: g.invited, took: g.answers })), other: b.other },
    },
  };
}

// ───────────────────────────── Results ─────────────────────────────

type Row = { value: number | null; comment: string | null; id: string; hidden: boolean; questionId: string; categoryId: string | null; departmentId: string | null };

function groupResult(rows: Array<{ key: string; label: string; invited: number; values: number[] }>) {
  const b = breakdown(rows.map((r) => ({ key: r.key, label: r.label, invited: r.invited, answers: r.values.length })));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const hiddenValues = rows.filter((r) => !b.shown.some((g) => g.key === r.key)).flatMap((r) => r.values);
  return {
    shown: b.shown.map((g) => ({ label: g.label, invited: g.invited, summary: summarise(byKey.get(g.key)!.values) })),
    other: b.other ? { invited: b.other.invited, answers: b.other.shown ? b.other.answers : null, shown: b.other.shown, summary: b.other.shown ? summarise(hiddenValues) : null } : null,
  };
}

/** The results of a closed survey, without picking a person out. After the retention period they come from the kept anonymised summary. */
export async function results(ctx: Ctx, id: string) {
  assertSurveyReader(ctx);
  const s = await db.survey.findFirst({ where: { id, organizationId: ctx.orgId }, include: { aggregate: { select: { summary: true } } } });
  if (!s) throw new BusinessError(NOT_FOUND);
  const state = surveyState(s.status, iso(s.opensOn), iso(s.closesOn), todayIso());
  if (state !== "CLOSED") throw new BusinessError("Results are shown once the survey closes.");
  if (s.aggregate) return { ...(s.aggregate.summary as unknown as Built), purged: true as const };
  const r = await buildResults(s.id, s.organizationId, s.invitedCount);
  return { ...r, purged: false as const };
}

type Built = Awaited<ReturnType<typeof buildResults>>;

async function buildResults(surveyId: string, orgId: string, invited: number) {
  const [questions, responses, codes, cats, depts] = await Promise.all([
    db.surveyQuestion.findMany({ where: { surveyId }, select: { id: true, position: true, kind: true, text: true }, orderBy: { position: "asc" } }),
    db.surveyResponse.findMany({ where: { surveyId }, select: { id: true, categoryId: true, departmentId: true, answers: { select: { id: true, questionId: true, value: true, comment: true, hidden: true } } } }),
    db.surveyAccessCode.findMany({ where: { surveyId }, select: { employeeId: true, status: true, categoryId: true, departmentId: true } }),
    db.employeeCategory.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    db.department.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
  ]);
  const total = responses.length;
  const enough = total >= MIN_RESPONSES;
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const deptName = new Map(depts.map((x) => [x.id, x.name]));
  const flat: Row[] = responses.flatMap((r) => r.answers.map((a) => ({ ...a, categoryId: r.categoryId, departmentId: r.departmentId })));
  const invitedBy = (key: "categoryId" | "departmentId") => {
    const m = new Map<string, Set<string>>();
    for (const c of codes) {
      const k = c[key] ?? "none";
      m.set(k, (m.get(k) ?? new Set()).add(c.employeeId));
    }
    return m;
  };
  const invCat = invitedBy("categoryId");
  const invDept = invitedBy("departmentId");
  const out = questions.map((q) => {
    const mine = flat.filter((a) => a.questionId === q.id);
    if (q.kind === "COMMENT") {
      const comments = enough
        ? mine
            .filter((a) => a.comment && !a.hidden)
            .map((a) => ({ id: a.id, text: a.comment! }))
            .sort((a, b) => a.text.localeCompare(b.text))
        : null;
      return { id: q.id, text: q.text, kind: q.kind, summary: null as ScaleSummary | null, byRole: null, byDepartment: null, comments };
    }
    const values = mine.filter((a) => a.value !== null).map((a) => a.value as number);
    const rowsFor = (key: "categoryId" | "departmentId", inv: Map<string, Set<string>>, names: Map<string, string>) =>
      [...inv.entries()].map(([k, set]) => ({ key: k, label: names.get(k) ?? "No group", invited: set.size, values: mine.filter((a) => (a[key] ?? "none") === k && a.value !== null).map((a) => a.value as number) }));
    return {
      id: q.id,
      text: q.text,
      kind: q.kind,
      summary: summarise(values),
      byRole: enough ? groupResult(rowsFor("categoryId", invCat, catName)) : null,
      byDepartment: enough ? groupResult(rowsFor("departmentId", invDept, deptName)) : null,
      comments: null as Array<{ id: string; text: string }> | null,
    };
  });
  const took = new Set(codes.filter((c) => c.status === "USED").map((c) => c.employeeId)).size;
  return { responses: enough ? total : null, participation: { invited, took }, questions: out };
}

/** HR hides a comment (for example one that names a person) with a recorded reason. It stays out of the results; nobody is told which comment it was. */
export async function hideComment(ctx: Ctx, answerId: string, reason: string) {
  assertCan(ctx, "survey.manage");
  const why = z.string().trim().min(5, "A reason is needed").max(300).parse(reason ?? "");
  const a = await db.surveyAnswer.findFirst({ where: { id: answerId, question: { organizationId: ctx.orgId } }, select: { id: true, comment: true, question: { select: { surveyId: true } } } });
  if (!a || !a.comment) throw new BusinessError("Comment not found.");
  await db.surveyAnswer.update({ where: { id: answerId }, data: { hidden: true, hiddenReason: why } });
  await logAudit(ctx, { action: "SURVEY_COMMENT_HIDE", entity: "Survey", entityId: a.question.surveyId, newValue: { hidden: true } });
  return { id: answerId };
}

// ───────────────────────────── Taking a survey ─────────────────────────────

function cleanAnswers(questions: Array<{ id: string; kind: string }>, raw: Answer[]) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: Array<{ questionId: string; value: number | null; comment: string | null }> = [];
  for (const a of raw ?? []) {
    const q = byId.get(a.questionId);
    if (!q) throw new BusinessError("One of the answers is for a question that is not in this survey.");
    if (q.kind === "SCALE") {
      if (a.value === undefined || a.value === null || (a.value as unknown) === "") continue;
      const v = Number(a.value);
      if (!Number.isInteger(v) || v < 1 || v > 5) throw new BusinessError("Rate each statement from 1 to 5.");
      out.push({ questionId: q.id, value: v, comment: null });
    } else {
      const c = (a.comment ?? "").trim();
      if (!c) continue;
      if (c.length > COMMENT_MAX) throw new BusinessError(`Keep a comment to at most ${COMMENT_MAX} characters.`);
      out.push({ questionId: q.id, value: null, comment: c });
    }
  }
  if (!out.length) throw new BusinessError("Answer at least one question.");
  return out;
}

/** The only place an answer is written: the code is marked used and the answer is stored WITHOUT it, in one step. A second use of the same code finds it used. */
async function record(surveyId: string, code: { id: string; categoryId: string | null; departmentId: string | null }, answers: Array<{ questionId: string; value: number | null; comment: string | null }>) {
  await db.$transaction(async (tx) => {
    const claimed = await tx.surveyAccessCode.updateMany({ where: { id: code.id, status: "ACTIVE" }, data: { status: "USED", usedOn: d(todayIso()) } });
    if (claimed.count !== 1) throw new BusinessError("INVALID_CODE");
    const resp = await tx.surveyResponse.create({ data: { surveyId, categoryId: code.categoryId, departmentId: code.departmentId } });
    await tx.surveyAnswer.createMany({ data: answers.map((a) => ({ responseId: resp.id, questionId: a.questionId, value: a.value, comment: a.comment })) });
  });
}

function isOpen(s: { status: "DRAFT" | "OPEN" | "CLOSED"; opensOn: Date; closesOn: Date }) {
  return surveyState(s.status, iso(s.opensOn), iso(s.closesOn), todayIso()) === "OPEN";
}

/** The surveys open to the signed-in employee, and the follow-up notes of closed ones they were invited to. Only their own invitation: never who else took part. */
export async function mySurveys(ctx: Ctx) {
  if (!ctx.employeeId) return { open: [] as Array<{ id: string; title: string; intro: string | null; closesOn: Date }>, closed: [] as Array<{ id: string; title: string; followUp: string }> };
  const mine = await db.surveyAccessCode.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId },
    select: { status: true, survey: { select: { id: true, title: true, intro: true, status: true, opensOn: true, closesOn: true, followUp: true } } },
  });
  const seen = new Set<string>();
  const open: Array<{ id: string; title: string; intro: string | null; closesOn: Date }> = [];
  const closed: Array<{ id: string; title: string; followUp: string }> = [];
  for (const m of mine) {
    const s = m.survey;
    if (seen.has(s.id)) continue;
    const state = surveyState(s.status, iso(s.opensOn), iso(s.closesOn), todayIso());
    if (state === "OPEN" && mine.some((x) => x.survey.id === s.id && x.status === "ACTIVE")) {
      open.push({ id: s.id, title: s.title, intro: s.intro, closesOn: s.closesOn });
      seen.add(s.id);
    } else if (state === "CLOSED" && s.followUp) {
      closed.push({ id: s.id, title: s.title, followUp: s.followUp });
      seen.add(s.id);
    }
  }
  return { open, closed };
}

async function ownActiveCode(ctx: Ctx, surveyId: string) {
  if (!ctx.employeeId) throw new BusinessError(NOT_FOUND);
  const s = await db.survey.findFirst({ where: { id: surveyId, organizationId: ctx.orgId }, select: { id: true, title: true, intro: true, status: true, opensOn: true, closesOn: true } });
  if (!s || s.status === "DRAFT") throw new BusinessError(NOT_FOUND);
  if (!isOpen(s)) throw new BusinessError("This survey is not open.");
  const codes = await db.surveyAccessCode.findMany({ where: { surveyId, employeeId: ctx.employeeId }, select: { id: true, status: true, categoryId: true, departmentId: true } });
  if (!codes.length) throw new BusinessError("You were not invited to this survey.");
  const active = codes.find((c) => c.status === "ACTIVE");
  if (!active) throw new BusinessError("You have already answered this survey.");
  return { s, active };
}

export async function surveyFormFor(ctx: Ctx, surveyId: string) {
  const { s } = await ownActiveCode(ctx, surveyId);
  const questions = await db.surveyQuestion.findMany({ where: { surveyId }, select: { id: true, position: true, kind: true, text: true }, orderBy: { position: "asc" } });
  return { id: s.id, title: s.title, intro: s.intro, questions };
}

/** An employee with a login answers once. Nothing about the submission is audited: that would say who took part and when. */
export async function submitAsEmployee(ctx: Ctx, surveyId: string, raw: Answer[]) {
  const { active } = await ownActiveCode(ctx, surveyId);
  const questions = await db.surveyQuestion.findMany({ where: { surveyId }, select: { id: true, kind: true } });
  const answers = cleanAnswers(questions, raw);
  try {
    await record(surveyId, active, answers);
  } catch (e) {
    if (e instanceof BusinessError && e.message === "INVALID_CODE") throw new BusinessError("You have already answered this survey.");
    throw e;
  }
  return { ok: true };
}

/** The survey a person reaches from a QR code or a shared device (no login), if it is open. */
export async function publicSurvey(surveyId: string) {
  const s = await db.survey.findFirst({ where: { id: surveyId }, select: { id: true, title: true, intro: true, status: true, opensOn: true, closesOn: true } });
  if (!s || !isOpen(s)) return null;
  const questions = await db.surveyQuestion.findMany({ where: { surveyId }, select: { id: true, position: true, kind: true, text: true }, orderBy: { position: "asc" } });
  return { id: s.id, title: s.title, intro: s.intro, questions };
}

/**
 * Answers with an access code, no login. A wrong, used, cancelled or other survey's code, and a closed survey, all get the same answer ("invalid"). A person who keeps guessing is
 * slowed down (by the address passed in as `throttleKey`). The code is single-use and is separated from the answer at the moment it is used.
 */
export async function submitWithCode(surveyId: string, rawCode: string, raw: Answer[], throttleKey: string): Promise<{ status: "ok" | "invalid" | "slow" }> {
  if (!surveyCodeLimiter.check(`${surveyId}:${throttleKey}`).ok) return { status: "slow" };
  const s = await db.survey.findFirst({ where: { id: surveyId }, select: { id: true, status: true, opensOn: true, closesOn: true } });
  if (!s || !isOpen(s)) return { status: "invalid" };
  const code = await db.surveyAccessCode.findFirst({ where: { surveyId, codeHash: hashCode(normaliseCode(rawCode ?? "")), status: "ACTIVE" }, select: { id: true, categoryId: true, departmentId: true } });
  if (!code) return { status: "invalid" };
  const questions = await db.surveyQuestion.findMany({ where: { surveyId }, select: { id: true, kind: true } });
  const answers = cleanAnswers(questions, raw); // a bad answer is the person's to fix: the code is not used until the answers are valid
  try {
    await record(surveyId, code, answers);
  } catch (e) {
    if (e instanceof BusinessError && e.message === "INVALID_CODE") return { status: "invalid" };
    throw e;
  }
  return { status: "ok" };
}

/** Records that an authorised HR representative started an assisted session: the survey, the day and the device. Never who took part. */
export async function startKioskSession(ctx: Ctx, surveyId: string, deviceLabel: string) {
  assertCan(ctx, "survey.assist");
  const label = z.string().trim().min(3, "Name the device").max(80).parse(deviceLabel ?? "");
  const s = await loadSurvey(ctx, surveyId);
  if (s.status !== "OPEN") throw new BusinessError("The survey is not open.");
  await db.surveyKioskSession.create({ data: { organizationId: ctx.orgId, surveyId, day: d(todayIso()), deviceLabel: label, startedByUserId: ctx.userId } });
  await logAudit(ctx, { action: "SURVEY_KIOSK_SESSION", entity: "Survey", entityId: surveyId, newValue: { started: true } });
  return { path: `/survey/${surveyId}` };
}

// ───────────────────────────── Keeping the answers for a limited time ─────────────────────────────

/**
 * Deletes the raw answers and the codes of surveys that closed more than the company's number of months ago (default 24; 0 = never) and keeps the anonymised result.
 * Audited by survey and counts only.
 */
export async function purgeExpired(ctx: Ctx, today = todayIso()) {
  assertCan(ctx, "survey.manage");
  const months = (await getHrPolicy(ctx.orgId)).surveyRetentionMonths;
  if (months === 0) return { surveys: 0, responses: 0 };
  if (await categoryHeld(ctx.orgId, "RAW_SURVEYS")) return { surveys: 0, responses: 0, held: true }; // a legal hold: nothing is purged until it is released
  const candidates = await db.survey.findMany({ where: { organizationId: ctx.orgId, rawDeletedAt: null, status: { in: ["OPEN", "CLOSED"] } }, select: { id: true, status: true, opensOn: true, closesOn: true, closedAt: true, invitedCount: true } });
  let surveys = 0;
  let responses = 0;
  for (const s of candidates) {
    if (surveyState(s.status, iso(s.opensOn), iso(s.closesOn), today) !== "CLOSED") continue;
    if (!retentionDue(iso(s.closedAt ?? s.closesOn), today, months)) continue;
    const kept = await buildResults(s.id, ctx.orgId, s.invitedCount);
    // the anonymised result is kept without the comments (they are raw words)
    const summary = { ...kept, questions: kept.questions.map((q) => ({ ...q, comments: null })) };
    const count = await db.$transaction(async (tx) => {
      const n = await tx.surveyResponse.count({ where: { surveyId: s.id } });
      await tx.surveyAggregate.create({ data: { organizationId: ctx.orgId, surveyId: s.id, summary: JSON.parse(JSON.stringify(summary)) as Prisma.InputJsonObject } });
      await tx.surveyAnswer.deleteMany({ where: { question: { surveyId: s.id } } });
      await tx.surveyResponse.deleteMany({ where: { surveyId: s.id } });
      await tx.surveyAccessCode.deleteMany({ where: { surveyId: s.id } });
      await tx.survey.update({ where: { id: s.id }, data: { rawDeletedAt: new Date() } });
      return n;
    });
    surveys++;
    responses += count;
    await logAudit(ctx, { action: "SURVEY_RETENTION_RUN", entity: "Survey", entityId: s.id, newValue: { responses: count } });
  }
  return { surveys, responses };
}

/** How many surveys have raw answers past the retention period (read-only: the same test purgeExpired applies, without deleting anything). Counts only. */
export async function expiredSurveyCount(orgId: string, months: number, today = todayIso()): Promise<number> {
  if (months <= 0) return 0;
  const rows = await db.survey.findMany({ where: { organizationId: orgId, rawDeletedAt: null, status: { in: ["OPEN", "CLOSED"] } }, select: { status: true, opensOn: true, closesOn: true, closedAt: true } });
  return rows.filter((s) => surveyState(s.status, iso(s.opensOn), iso(s.closesOn), today) === "CLOSED" && retentionDue(iso(s.closedAt ?? s.closesOn), today, months)).length;
}

/** Surveys currently open, for the HR digest: the title and the counts, never a name. */
export async function openSurveysFor(orgId: string, today = todayUtc()) {
  const rows = await db.survey.findMany({ where: { organizationId: orgId, status: "OPEN", opensOn: { lte: today }, closesOn: { gte: today } }, select: { id: true, title: true, closesOn: true, invitedCount: true } });
  const out = [];
  for (const r of rows) {
    const took = (await db.surveyAccessCode.findMany({ where: { surveyId: r.id, status: "USED" }, select: { employeeId: true } })).length;
    out.push({ id: r.id, title: r.title, closesOn: r.closesOn, invited: r.invitedCount, took, daysLeft: Math.round((+r.closesOn - +today) / 86_400_000) });
  }
  return out;
}

