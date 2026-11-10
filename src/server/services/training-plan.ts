/**
 * Planning training: programmes (the courses the company runs), sessions (a dated calendar with seats), enrolment and attendance, and training needs.
 *
 * Attending a session creates the SAME certificate record HR creates by hand today (hr.ts `addTraining`), so the existing compliance check (training.ts) turns a
 * Missing or Expired required course into Valid on its own and the digest keeps working unchanged; nothing here changes how compliance is worked out. Correcting a
 * mistaken attendance revokes only the certificate that attendance created. Needs are added by a person, never automatically; seats are a hard limit; attendance is
 * recorded by HR, never by the employee. The audit log carries ids and field names only, never an absence reason or a need's note.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { isGap } from "@/lib/training-compliance";
import { canEnrol, canMarkAttendance, certificateExpiry, monthRange, NEED_SOURCES, needStatusAfter, sameCourse, seatsLeft, type NeedEvent, type NeedStatus } from "@/lib/training-plan";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { addTraining } from "./hr";
import { todayUtc } from "./hr-policy";
import { complianceFor } from "./training";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-30");
const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));
const todayIso = () => iso(todayUtc());
const EMPLOYEE_SELECT = { id: true, employeeNumber: true, firstName: true, lastName: true } as const;

// ───────────────────────────── Programmes ─────────────────────────────

export const programmeSchema = z.object({
  name: z.string().trim().min(3, "Name the course").max(120),
  provider: opt,
  validityMonths: z.coerce.number().int().min(1).max(120).optional(),
});

export async function addProgramme(ctx: Ctx, raw: z.input<typeof programmeSchema>) {
  assertCan(ctx, "hr.manage");
  const v = programmeSchema.parse(raw);
  const all = await db.trainingProgramme.findMany({ where: { organizationId: ctx.orgId }, select: { name: true } });
  if (all.some((p) => sameCourse(p.name, v.name))) throw new BusinessError("A programme for that course already exists.");
  const p = await db.trainingProgramme.create({ data: { organizationId: ctx.orgId, name: v.name, provider: v.provider ?? null, validityMonths: v.validityMonths ?? null, createdBy: ctx.name } });
  await logAudit(ctx, { action: "TRAINING_PROGRAMME_ADD", entity: "TrainingProgramme", entityId: p.id, newValue: { validityMonths: p.validityMonths } });
  return p;
}

export async function listProgrammes(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  return db.trainingProgramme.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" } });
}

/** A programme's name is the course name a certificate carries, so it is never renamed. */
export async function updateProgramme(ctx: Ctx, id: string, raw: { provider?: string; validityMonths?: number | null; active?: boolean }) {
  assertCan(ctx, "hr.manage");
  const p = await db.trainingProgramme.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!p) throw new BusinessError("Programme not found.");
  const data: Record<string, unknown> = {};
  if (raw.provider !== undefined) data.provider = raw.provider.trim() || null;
  if (raw.validityMonths !== undefined) data.validityMonths = raw.validityMonths === null ? null : z.coerce.number().int().min(1).max(120).parse(raw.validityMonths);
  if (raw.active !== undefined) data.active = raw.active;
  const u = await db.trainingProgramme.update({ where: { id }, data });
  await logAudit(ctx, { action: "TRAINING_PROGRAMME_UPDATE", entity: "TrainingProgramme", entityId: id, newValue: { fields: Object.keys(data) } });
  return u;
}

// ───────────────────────────── Sessions: the calendar ─────────────────────────────

export const sessionSchema = z.object({
  programmeId: z.string().min(1),
  sessionDate: day,
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:30").optional().or(z.literal("").transform(() => undefined)),
  venue: opt,
  trainer: opt,
  seats: z.coerce.number().int().min(1, "A session needs at least one seat").max(500),
});

export async function scheduleSession(ctx: Ctx, raw: z.input<typeof sessionSchema>) {
  assertCan(ctx, "hr.manage");
  const v = sessionSchema.parse(raw);
  const p = await db.trainingProgramme.findFirst({ where: { id: v.programmeId, organizationId: ctx.orgId } });
  if (!p) throw new BusinessError("Programme not found.");
  if (!p.active) throw new BusinessError("This programme is switched off.");
  if (v.sessionDate < todayIso()) throw new BusinessError("A session can't be scheduled in the past.");
  const s = await db.trainingSession.create({
    data: { organizationId: ctx.orgId, programmeId: p.id, sessionDate: d(v.sessionDate), startTime: v.startTime ?? null, venue: v.venue ?? null, trainer: v.trainer ?? null, seats: v.seats, createdBy: ctx.name },
  });
  await logAudit(ctx, { action: "TRAINING_SESSION_SCHEDULE", entity: "TrainingSession", entityId: s.id, newValue: { programmeId: p.id, sessionDate: v.sessionDate, seats: v.seats } });
  return s;
}

const withSeats = <T extends { seats: number; _count: { enrolments: number } }>(s: T) => ({ ...s, taken: s._count.enrolments, seatsLeft: seatsLeft(s.seats, s._count.enrolments) });

export async function listSessions(ctx: Ctx, f: { month?: string; status?: "SCHEDULED" | "COMPLETED" | "CANCELLED" } = {}) {
  assertCan(ctx, "hr.view");
  const range = f.month && /^\d{4}-\d{2}$/.test(f.month) ? monthRange(f.month) : null;
  const rows = await db.trainingSession.findMany({
    where: { organizationId: ctx.orgId, ...(f.status ? { status: f.status } : {}), ...(range ? { sessionDate: { gte: d(range.from), lte: d(range.to) } } : {}) },
    include: { programme: { select: { id: true, name: true } }, _count: { select: { enrolments: true } } },
    orderBy: [{ sessionDate: "asc" }, { startTime: "asc" }],
    take: 500,
  });
  return rows.map(withSeats);
}

export async function getSession(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.view");
  const s = await db.trainingSession.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { programme: true, enrolments: { include: { employee: { select: EMPLOYEE_SELECT } }, orderBy: { createdAt: "asc" } }, _count: { select: { enrolments: true } } },
  });
  if (!s) throw new BusinessError("Session not found.");
  return withSeats(s);
}

async function loadSession(ctx: Ctx, id: string, tx: Tx = db) {
  const s = await tx.trainingSession.findFirst({ where: { id, organizationId: ctx.orgId }, include: { programme: true, _count: { select: { enrolments: true } } } });
  if (!s) throw new BusinessError("Session not found.");
  return s;
}

export async function cancelSession(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "hr.manage");
  const why = z.string().trim().min(3, "A reason is needed").max(500).parse(reason ?? "");
  const s = await loadSession(ctx, id);
  if (s.status === "CANCELLED") throw new BusinessError("This session is already cancelled.");
  if (s.status === "COMPLETED") throw new BusinessError("A completed session can't be cancelled.");
  const u = await db.trainingSession.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledReason: why } });
  await logAudit(ctx, { action: "TRAINING_SESSION_CANCEL", entity: "TrainingSession", entityId: id, newValue: { programmeId: s.programmeId } });
  return u;
}

/** Completed once the day has come and everyone enrolled has been marked Attended or Did not attend. */
export async function completeSession(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.manage");
  const s = await loadSession(ctx, id);
  if (s.status === "COMPLETED") throw new BusinessError("This session is already completed.");
  if (s.status === "CANCELLED") throw new BusinessError("This session was cancelled.");
  const late = canMarkAttendance({ status: s.status, sessionDate: iso(s.sessionDate) }, todayIso());
  if (late) throw new BusinessError(late);
  const open = await db.trainingEnrolment.count({ where: { sessionId: id, status: "ENROLLED" } });
  if (open) throw new BusinessError(`${open} ${open === 1 ? "person has" : "people have"} not been marked yet: record who attended first.`);
  const u = await db.trainingSession.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
  await logAudit(ctx, { action: "TRAINING_SESSION_COMPLETE", entity: "TrainingSession", entityId: id, newValue: { programmeId: s.programmeId } });
  return u;
}

// ───────────────────────────── Needs: keeping them in step ─────────────────────────────

/** Moves an employee's open or planned needs for a course along when they are enrolled, taken off, or attend. */
async function moveNeeds(tx: Tx, orgId: string, employeeId: string, courseName: string, event: NeedEvent) {
  const needs = await tx.trainingNeed.findMany({ where: { organizationId: orgId, employeeId, status: { in: ["OPEN", "PLANNED"] } } });
  for (const n of needs.filter((x) => sameCourse(x.courseName, courseName))) {
    const next = needStatusAfter(n.status as NeedStatus, event);
    if (next) await tx.trainingNeed.update({ where: { id: n.id }, data: { status: next, ...(next === "MET" ? { metAt: new Date() } : {}) } });
  }
}

// ───────────────────────────── Enrolment ─────────────────────────────

export async function enrol(ctx: Ctx, sessionId: string, employeeId: string) {
  assertCan(ctx, "hr.manage");
  return db.$transaction(async (tx) => {
    const s = await loadSession(ctx, sessionId, tx);
    const emp = await tx.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId }, select: { id: true, status: true } });
    if (!emp) throw new BusinessError("Employee not found.");
    if (emp.status !== "ACTIVE" && emp.status !== "ON_LEAVE") throw new BusinessError("This employee is no longer active, so they can't be enrolled.");
    // lock the session so two enrolments at once cannot both take the last seat
    await tx.$queryRaw`SELECT id FROM "TrainingSession" WHERE id = ${sessionId} FOR UPDATE`;
    if (await tx.trainingEnrolment.findUnique({ where: { sessionId_employeeId: { sessionId, employeeId } }, select: { id: true } })) throw new BusinessError("This person is already enrolled in the session.");
    const taken = await tx.trainingEnrolment.count({ where: { sessionId } });
    const bad = canEnrol({ status: s.status, sessionDate: iso(s.sessionDate), seats: s.seats, taken }, todayIso());
    if (bad) throw new BusinessError(bad);
    const e = await tx.trainingEnrolment.create({ data: { organizationId: ctx.orgId, sessionId, employeeId, enrolledBy: ctx.name } });
    await moveNeeds(tx, ctx.orgId, employeeId, s.programme.name, "ENROLLED");
    await logAudit(ctx, { action: "TRAINING_ENROL", entity: "TrainingEnrolment", entityId: e.id, newValue: { sessionId, employeeId } }, tx);
    return e;
  });
}

/** Only someone who has not yet been marked can be taken off a session (their seat is freed). */
export async function unenrol(ctx: Ctx, enrolmentId: string) {
  assertCan(ctx, "hr.manage");
  return db.$transaction(async (tx) => {
    const e = await tx.trainingEnrolment.findFirst({ where: { id: enrolmentId, organizationId: ctx.orgId }, include: { session: { include: { programme: true } } } });
    if (!e) throw new BusinessError("Enrolment not found.");
    if (e.status !== "ENROLLED") throw new BusinessError("Only someone who is still enrolled can be taken off: their attendance is already marked.");
    await tx.trainingEnrolment.delete({ where: { id: enrolmentId } });
    await moveNeeds(tx, ctx.orgId, e.employeeId, e.session.programme.name, "UNENROLLED");
    await logAudit(ctx, { action: "TRAINING_UNENROL", entity: "TrainingEnrolment", entityId: enrolmentId, newValue: { sessionId: e.sessionId, employeeId: e.employeeId } }, tx);
    return { ok: true };
  });
}

// ───────────────────────────── Attendance: the link to the certificate record ─────────────────────────────

export const attendanceSchema = z.object({ result: z.enum(["ATTENDED", "ABSENT"]), reason: opt });

/**
 * Records that the person attended or did not. **Attended creates the certificate record** (the course, the session date as the issue date, the expiry from the
 * programme's validity) through the same function HR uses by hand, so compliance follows on its own. Changing Attended to Did not attend (a correction) revokes only
 * that record and unlinks it; a certificate HR recorded separately is never touched. Marking the same result twice is refused (no second certificate).
 */
export async function markAttendance(ctx: Ctx, enrolmentId: string, raw: z.input<typeof attendanceSchema>) {
  assertCan(ctx, "hr.manage");
  const v = attendanceSchema.parse(raw);
  if (v.result === "ABSENT" && (!v.reason || v.reason.length < 3)) throw new BusinessError("Give the reason they did not attend.");
  return db.$transaction(async (tx) => {
    const e = await tx.trainingEnrolment.findFirst({ where: { id: enrolmentId, organizationId: ctx.orgId }, include: { session: { include: { programme: true } } } });
    if (!e) throw new BusinessError("Enrolment not found.");
    const bad = canMarkAttendance({ status: e.session.status, sessionDate: iso(e.session.sessionDate) }, todayIso());
    if (bad) throw new BusinessError(bad);
    if (e.status === v.result) throw new BusinessError("This person's attendance is already marked that way.");
    if (e.status === "ATTENDED") {
      // a correction: revoke the certificate this attendance created, and only that one
      const cert = await tx.employeeTraining.findUnique({ where: { enrolmentId } });
      if (cert) {
        await tx.employeeTraining.update({ where: { id: cert.id }, data: { status: "REVOKED", enrolmentId: null } });
        await logAudit(ctx, { action: "EMPLOYEE_TRAINING_REVOKE", entity: "Employee", entityId: e.employeeId, newValue: { trainingId: cert.id, enrolmentId } }, tx);
      }
    }
    const u = await tx.trainingEnrolment.update({ where: { id: enrolmentId }, data: { status: v.result, absenceReason: v.result === "ABSENT" ? v.reason! : null, markedBy: ctx.name, markedAt: new Date() } });
    if (v.result === "ATTENDED") {
      const sessionDay = iso(e.session.sessionDate);
      await addTraining(
        ctx,
        { employeeId: e.employeeId, courseName: e.session.programme.name, provider: e.session.programme.provider ?? undefined, issueDate: sessionDay, expiryDate: certificateExpiry(sessionDay, e.session.programme.validityMonths) ?? undefined },
        { enrolmentId, tx },
      );
      await moveNeeds(tx, ctx.orgId, e.employeeId, e.session.programme.name, "ATTENDED");
    }
    await logAudit(ctx, { action: "TRAINING_ATTENDANCE", entity: "TrainingEnrolment", entityId: enrolmentId, newValue: { employeeId: e.employeeId, sessionId: e.sessionId, result: v.result } }, tx);
    return u;
  });
}

// ───────────────────────────── Needs ─────────────────────────────

export const needSchema = z.object({
  employeeId: z.string().min(1),
  courseName: z.string().trim().min(3, "Name the course").max(120),
  source: z.enum(NEED_SOURCES),
  note: opt,
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
  dueBy: day.optional(),
  appraisalId: z.string().optional(),
});

export async function addNeed(ctx: Ctx, raw: z.input<typeof needSchema>) {
  assertCan(ctx, "hr.manage");
  const v = needSchema.parse(raw);
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId }, select: { id: true, status: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  if (emp.status !== "ACTIVE" && emp.status !== "ON_LEAVE") throw new BusinessError("This employee is no longer active, so a need can't be recorded for them.");
  const open = await db.trainingNeed.findMany({ where: { organizationId: ctx.orgId, employeeId: emp.id, status: { in: ["OPEN", "PLANNED"] } }, select: { courseName: true } });
  if (open.some((n) => sameCourse(n.courseName, v.courseName))) throw new BusinessError("This employee already has an open need for that course.");
  // already enrolled in a coming session of that course: it is planned from the start
  const coming = await db.trainingEnrolment.findMany({
    where: { organizationId: ctx.orgId, employeeId: emp.id, status: "ENROLLED", session: { status: "SCHEDULED", sessionDate: { gte: todayUtc() } } },
    include: { session: { include: { programme: { select: { name: true } } } } },
  });
  const planned = coming.some((c) => sameCourse(c.session.programme.name, v.courseName));
  const n = await db.trainingNeed.create({
    data: {
      organizationId: ctx.orgId,
      employeeId: emp.id,
      courseName: v.courseName,
      source: v.source,
      note: v.note ?? null,
      priority: v.priority,
      dueBy: v.dueBy ? d(v.dueBy) : null,
      status: planned ? "PLANNED" : "OPEN",
      appraisalId: v.appraisalId ?? null,
      createdBy: ctx.name,
    },
  });
  await logAudit(ctx, { action: "TRAINING_NEED_ADD", entity: "TrainingNeed", entityId: n.id, newValue: { employeeId: emp.id, source: v.source } });
  return n;
}

/** An approved appraisal that recommended further training: HR adds the need (naming the course) when they choose to. Never automatic. */
export async function needsFromAppraisal(ctx: Ctx, appraisalId: string, courseName: string) {
  assertCan(ctx, "hr.manage");
  const a = await db.appraisal.findFirst({ where: { id: appraisalId, organizationId: ctx.orgId }, select: { id: true, employeeId: true, status: true, recommendation: true } });
  if (!a) throw new BusinessError("Appraisal not found.");
  if (a.status !== "APPROVED" && a.status !== "ACKNOWLEDGED") throw new BusinessError("Only an approved appraisal can add a training need.");
  if (a.recommendation !== "TRAINING") throw new BusinessError("This appraisal did not recommend further training.");
  return addNeed(ctx, { employeeId: a.employeeId, courseName, source: "APPRAISAL", note: "Recommended on an appraisal", appraisalId: a.id });
}

export async function dropNeed(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "hr.manage");
  const why = z.string().trim().min(3, "A reason is needed").max(500).parse(reason ?? "");
  const n = await db.trainingNeed.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!n) throw new BusinessError("Need not found.");
  if (!needStatusAfter(n.status as NeedStatus, "DROPPED")) throw new BusinessError(`This need is already ${n.status === "MET" ? "met" : "dropped"}.`);
  const u = await db.trainingNeed.update({ where: { id }, data: { status: "DROPPED", droppedReason: why } });
  await logAudit(ctx, { action: "TRAINING_NEED_DROP", entity: "TrainingNeed", entityId: id, newValue: { employeeId: n.employeeId } });
  return u;
}

export async function listNeeds(ctx: Ctx, f: { status?: NeedStatus } = {}) {
  assertCan(ctx, "hr.view");
  return db.trainingNeed.findMany({
    where: { organizationId: ctx.orgId, ...(f.status ? { status: f.status } : {}) },
    include: { employee: { select: EMPLOYEE_SELECT } },
    orderBy: [{ createdAt: "desc" }],
    take: 500,
  });
}

/** The compliance gaps (a required course Missing or Expired) whose person is not yet enrolled in a coming session of it. */
export async function trainingGaps(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const [overview, coming, needs] = await Promise.all([
    complianceFor(ctx.orgId),
    db.trainingEnrolment.findMany({
      where: { organizationId: ctx.orgId, status: "ENROLLED", session: { status: "SCHEDULED", sessionDate: { gte: todayUtc() } } },
      select: { employeeId: true, session: { select: { programme: { select: { name: true } } } } },
    }),
    db.trainingNeed.findMany({ where: { organizationId: ctx.orgId, status: { in: ["OPEN", "PLANNED"] } }, select: { employeeId: true, courseName: true } }),
  ]);
  const enrolled = (employeeId: string, course: string) => coming.some((c) => c.employeeId === employeeId && sameCourse(c.session.programme.name, course));
  const hasNeed = (employeeId: string, course: string) => needs.some((n) => n.employeeId === employeeId && sameCourse(n.courseName, course));
  return overview.rows.flatMap((row) =>
    row.items
      .filter((i) => isGap(i.assessment.state) && !enrolled(row.employee.id, i.requirement.courseName))
      .map((i) => ({
        employee: { id: row.employee.id, employeeNumber: row.employee.employeeNumber, firstName: row.employee.firstName, lastName: row.employee.lastName },
        courseName: i.requirement.courseName,
        state: i.assessment.state,
        hasNeed: hasNeed(row.employee.id, i.requirement.courseName),
      })),
  );
}

// ───────────────────────────── The employee's own training ─────────────────────────────

/** The signed-in employee's own coming sessions and attended courses. Nothing about anyone else. */
export async function myTraining(ctx: Ctx) {
  if (!ctx.employeeId) return { upcoming: [] as never[], attended: [] as never[] };
  const rows = await db.trainingEnrolment.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, status: { in: ["ENROLLED", "ATTENDED"] } },
    include: { session: { include: { programme: { select: { name: true } } } }, certificate: { select: { expiryDate: true } } },
    orderBy: { session: { sessionDate: "asc" } },
  });
  const today = todayIso();
  return {
    upcoming: rows
      .filter((r) => r.status === "ENROLLED" && r.session.status === "SCHEDULED" && iso(r.session.sessionDate) >= today)
      .map((r) => ({ sessionId: r.sessionId, programmeName: r.session.programme.name, sessionDate: r.session.sessionDate, startTime: r.session.startTime, venue: r.session.venue })),
    attended: rows
      .filter((r) => r.status === "ATTENDED")
      .map((r) => ({ programmeName: r.session.programme.name, sessionDate: r.session.sessionDate, certificateExpires: r.certificate?.expiryDate ? iso(r.certificate.expiryDate) : null })),
  };
}
