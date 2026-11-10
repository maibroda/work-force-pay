import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { addMonths } from "@/lib/leave";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { addTraining } from "@/server/services/hr";
import { todayUtc } from "@/server/services/hr-policy";
import { complianceFor } from "@/server/services/training";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import {
  addNeed,
  addProgramme,
  cancelSession,
  completeSession,
  dropNeed,
  enrol,
  getSession,
  listNeeds,
  listProgrammes,
  listSessions,
  markAttendance,
  myTraining,
  needsFromAppraisal,
  scheduleSession,
  trainingGaps,
  unenrol,
  updateProgramme,
} from "@/server/services/training-plan";
import { isolatedOrg, uid } from "../helpers";

// Learning and development, step 1: training needs and a training calendar (the founder's go of 2026-11-10; plan docs/plans/learning-development-plan.md).
// Recommended answers were used: attending creates the certificate record, HR alone adds needs, no costs, a hard seat limit with no waiting list.

const today = () => iso(todayUtc());
const day = (n: number) => iso(addDays(todayUtc(), n));

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@trn.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function world() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN");
  const guards = [] as Awaited<ReturnType<typeof createEmployee>>[];
  for (const n of ["One", "Two", "Three", "Four"]) guards.push(await createEmployee(hr, { firstName: "Guard", lastName: n, employmentDate: "2023-01-05", categoryId: t.guardId }));
  const me = await login(t, "EMPLOYEE", guards[0].id);
  const firstAid = await addProgramme(hr, { name: "First aid", provider: "Red Cross (synthetic)", validityMonths: 24 });
  const session = (over: Record<string, unknown> = {}) => scheduleSession(hr, { programmeId: firstAid.id, sessionDate: today(), venue: "Head office", trainer: "Trainer A", seats: 3, ...over } as never);
  return { t, hr, guards, me, firstAid, session };
}
type W = Awaited<ReturnType<typeof world>>;
const requireCourse = (w: W, name = "First aid") => db.trainingRequirement.create({ data: { organizationId: w.t.org.id, courseName: name, categoryId: w.t.guardId, graceDays: 30 } });
const stateOf = async (w: W, e: { id: string }, course = "First aid") => (await complianceFor(w.t.org.id)).rows.find((r) => r.employee.id === e.id)!.items.find((i) => i.requirement.courseName === course)?.assessment.state;

describe("programmes", () => {
  it("are the courses the company runs: a name (which is the course name a certificate carries), a provider and how long the certificate stays valid", async () => {
    const w = await world();
    expect(w.firstAid).toMatchObject({ name: "First aid", provider: "Red Cross (synthetic)", validityMonths: 24, active: true });
    expect((await addProgramme(w.hr, { name: "Fire marshal" })).validityMonths).toBeNull(); // does not expire
    await expect(addProgramme(w.hr, { name: "  first   AID " })).rejects.toThrow(/already/i); // the same course, however it is typed
    await expect(addProgramme(w.hr, { name: "Ab" })).rejects.toThrow();
    await expect(addProgramme(w.hr, { name: "Bad validity", validityMonths: 0 })).rejects.toThrow();
    await expect(addProgramme(w.hr, { name: "Bad validity", validityMonths: 121 })).rejects.toThrow();
    expect((await listProgrammes(w.hr)).map((p) => p.name)).toEqual(["Fire marshal", "First aid"]);
  });
  it("can be switched off and have their provider and validity changed, never renamed; a switched-off programme takes no new session", async () => {
    const w = await world();
    const u = await updateProgramme(w.hr, w.firstAid.id, { provider: "St John (synthetic)", validityMonths: 12 });
    expect(u).toMatchObject({ provider: "St John (synthetic)", validityMonths: 12, name: "First aid" });
    await updateProgramme(w.hr, w.firstAid.id, { active: false });
    await expect(w.session()).rejects.toThrow(/switched off|not active/i);
  });
  it("are managed by HR, read by anyone who reads HR records, and kept to their own company", async () => {
    const w = await world();
    await expect(addProgramme(await login(w.t, "AUDITOR"), { name: "Nope" })).rejects.toThrow(/permission/);
    await expect(addProgramme(w.me, { name: "Nope" })).rejects.toThrow(/permission/);
    expect((await listProgrammes(await login(w.t, "AUDITOR"))).length).toBe(1);
    await expect(listProgrammes(w.me)).rejects.toThrow(/permission/);
    const other = await world();
    expect((await listProgrammes(other.hr)).map((p) => p.id)).not.toContain(w.firstAid.id);
    await expect(updateProgramme(other.hr, w.firstAid.id, { active: false })).rejects.toThrow(/not found/i);
    await expect(scheduleSession(other.hr, { programmeId: w.firstAid.id, sessionDate: today(), seats: 5 } as never)).rejects.toThrow(/programme not found/i);
  });
});

describe("sessions: the calendar", () => {
  it("a session is a dated occurrence of a programme with seats; the calendar lists a month at a time", async () => {
    const w = await world();
    const s = await w.session({ sessionDate: day(20), startTime: "09:00" });
    expect(s).toMatchObject({ status: "SCHEDULED", seats: 3, venue: "Head office", trainer: "Trainer A", startTime: "09:00" });
    const month = iso(addDays(todayUtc(), 20)).slice(0, 7);
    const rows = await listSessions(w.hr, { month });
    expect(rows.map((r) => r.id)).toContain(s.id);
    expect(rows.find((r) => r.id === s.id)).toMatchObject({ taken: 0, seatsLeft: 3, programme: { name: "First aid" } });
    expect((await listSessions(w.hr, { month: "2001-01" })).map((r) => r.id)).not.toContain(s.id);
  });
  it("needs real seats and a date that is not in the past, and a valid time", async () => {
    const w = await world();
    await expect(w.session({ seats: 0 })).rejects.toThrow();
    await expect(w.session({ seats: 501 })).rejects.toThrow();
    await expect(w.session({ sessionDate: day(-1) })).rejects.toThrow(/past/i);
    await expect(w.session({ startTime: "25:99" })).rejects.toThrow();
  });
  it("can be cancelled with a reason, and then takes no enrolment and no attendance", async () => {
    const w = await world();
    const s = await w.session();
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    await expect(cancelSession(w.hr, s.id, "")).rejects.toThrow(/reason/i);
    expect(await cancelSession(w.hr, s.id, "Trainer unwell")).toMatchObject({ status: "CANCELLED", cancelledReason: "Trainer unwell" });
    await expect(enrol(w.hr, s.id, w.guards[1].id)).rejects.toThrow(/cancelled/i);
    await expect(markAttendance(w.hr, e.id, { result: "ATTENDED" })).rejects.toThrow(/cancelled/i);
    await expect(cancelSession(w.hr, s.id, "Cancelling it twice")).rejects.toThrow(/already|cancelled/i);
  });
  it("is completed only when everyone enrolled has been marked", async () => {
    const w = await world();
    const s = await w.session();
    const a = await enrol(w.hr, s.id, w.guards[0].id);
    const b = await enrol(w.hr, s.id, w.guards[1].id);
    await markAttendance(w.hr, a.id, { result: "ATTENDED" });
    await expect(completeSession(w.hr, s.id)).rejects.toThrow(/not been marked|still to mark/i);
    await markAttendance(w.hr, b.id, { result: "ABSENT", reason: "On leave" });
    expect((await completeSession(w.hr, s.id)).status).toBe("COMPLETED");
    await expect(completeSession(w.hr, s.id)).rejects.toThrow(/already|completed/i);
    await expect(enrol(w.hr, s.id, w.guards[2].id)).rejects.toThrow(/completed/i);
  });
  it("shows who is enrolled, with their result", async () => {
    const w = await world();
    const s = await w.session();
    await enrol(w.hr, s.id, w.guards[0].id);
    const full = await getSession(w.hr, s.id);
    expect(full.enrolments).toHaveLength(1);
    expect(full).toMatchObject({ taken: 1, seatsLeft: 2 });
    expect(full.enrolments[0]).toMatchObject({ status: "ENROLLED", employee: { id: w.guards[0].id } });
    await expect(getSession((await world()).hr, s.id)).rejects.toThrow(/not found/i);
  });
});

describe("enrolment", () => {
  it("seats are a hard limit: the next person is refused, and a seat freed by taking someone off is available again", async () => {
    const w = await world();
    const s = await w.session({ seats: 2 });
    const a = await enrol(w.hr, s.id, w.guards[0].id);
    await enrol(w.hr, s.id, w.guards[1].id);
    await expect(enrol(w.hr, s.id, w.guards[2].id)).rejects.toThrow(/full/i);
    await unenrol(w.hr, a.id);
    await expect(enrol(w.hr, s.id, w.guards[2].id)).resolves.toBeTruthy();
  });
  it("a person is never enrolled twice in a session, and only a person who is still active is enrolled", async () => {
    const w = await world();
    const s = await w.session();
    await enrol(w.hr, s.id, w.guards[0].id);
    await expect(enrol(w.hr, s.id, w.guards[0].id)).rejects.toThrow(/already enrolled/i);
    await db.employee.update({ where: { id: w.guards[1].id }, data: { status: "RESIGNED" } });
    await expect(enrol(w.hr, s.id, w.guards[1].id)).rejects.toThrow(/no longer active/i);
    await expect(enrol(w.hr, s.id, "does-not-exist")).rejects.toThrow(/employee not found/i);
    const other = await world();
    await expect(enrol(w.hr, s.id, other.guards[0].id)).rejects.toThrow(/employee not found/i);
  });
  it("is refused for a session that has already taken place, and taking someone off is only while enrolled", async () => {
    const w = await world();
    const s = await w.session();
    const a = await enrol(w.hr, s.id, w.guards[0].id);
    await markAttendance(w.hr, a.id, { result: "ATTENDED" });
    await expect(unenrol(w.hr, a.id)).rejects.toThrow(/only.*enrolled|already marked/i);
    await db.trainingSession.update({ where: { id: s.id }, data: { sessionDate: new Date(`${day(-3)}T00:00:00.000Z`) } });
    await expect(enrol(w.hr, s.id, w.guards[1].id)).rejects.toThrow(/already taken place/i);
  });
  it("is HR's alone; another company's session is not found", async () => {
    const w = await world();
    const s = await w.session();
    await expect(enrol(await login(w.t, "AUDITOR"), s.id, w.guards[0].id)).rejects.toThrow(/permission/);
    await expect(enrol(w.me, s.id, w.guards[0].id)).rejects.toThrow(/permission/);
    const other = await world();
    await expect(enrol(other.hr, s.id, other.guards[0].id)).rejects.toThrow(/session not found/i);
  });
});

describe("attending creates the certificate record, and compliance follows", () => {
  it("marking Attended creates exactly one certificate (the session date, the programme's validity) and turns Missing into Valid on its own", async () => {
    const w = await world();
    await requireCourse(w);
    expect(await stateOf(w, w.guards[0])).toBe("MISSING");
    const s = await w.session();
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    const m = await markAttendance(w.hr, e.id, { result: "ATTENDED" });
    expect(m.status).toBe("ATTENDED");
    const certs = await db.employeeTraining.findMany({ where: { employeeId: w.guards[0].id } });
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ courseName: "First aid", provider: "Red Cross (synthetic)", status: "VALID", enrolmentId: e.id });
    expect(iso(certs[0].issueDate)).toBe(today());
    expect(iso(certs[0].expiryDate)).toBe(iso(addMonths(todayUtc(), 24))); // the session date plus 24 months
    expect(await stateOf(w, w.guards[0])).toBe("VALID"); // the existing compliance check, unchanged
    await expect(markAttendance(w.hr, e.id, { result: "ATTENDED" })).rejects.toThrow(/already marked/i); // no second certificate
    expect(await db.employeeTraining.count({ where: { employeeId: w.guards[0].id } })).toBe(1);
  });
  it("a programme whose certificate does not expire creates one with no expiry", async () => {
    const w = await world();
    const p = await addProgramme(w.hr, { name: "Fire marshal" });
    const s = await scheduleSession(w.hr, { programmeId: p.id, sessionDate: today(), seats: 5 } as never);
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    await markAttendance(w.hr, e.id, { result: "ATTENDED" });
    expect((await db.employeeTraining.findFirstOrThrow({ where: { enrolmentId: e.id } })).expiryDate).toBeNull();
  });
  it("Did not attend creates nothing and needs a reason", async () => {
    const w = await world();
    const s = await w.session();
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    await expect(markAttendance(w.hr, e.id, { result: "ABSENT" })).rejects.toThrow(/reason/i);
    expect(await markAttendance(w.hr, e.id, { result: "ABSENT", reason: "On leave" })).toMatchObject({ status: "ABSENT", absenceReason: "On leave" });
    expect(await db.employeeTraining.count({ where: { employeeId: w.guards[0].id } })).toBe(0);
  });
  it("attendance is not recorded before the session takes place", async () => {
    const w = await world();
    const s = await w.session({ sessionDate: day(5) });
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    await expect(markAttendance(w.hr, e.id, { result: "ATTENDED" })).rejects.toThrow(/before the session/i);
  });
  it("correcting a mistake revokes only the certificate that attendance created; a certificate HR typed in is never touched; re-marking creates a new one", async () => {
    const w = await world();
    await requireCourse(w);
    const typed = await addTraining(w.hr, { employeeId: w.guards[0].id, courseName: "Fire marshal", issueDate: day(-30), expiryDate: day(300) });
    const s = await w.session();
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    await markAttendance(w.hr, e.id, { result: "ATTENDED" });
    expect(await stateOf(w, w.guards[0])).toBe("VALID");
    await markAttendance(w.hr, e.id, { result: "ABSENT", reason: "Marked in error" }); // the correction
    const created = await db.employeeTraining.findMany({ where: { employeeId: w.guards[0].id, courseName: "First aid" } });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ status: "REVOKED", enrolmentId: null }); // kept, revoked, unlinked
    expect(await stateOf(w, w.guards[0])).toBe("MISSING");
    expect((await db.employeeTraining.findUniqueOrThrow({ where: { id: typed.id } })).status).toBe("VALID"); // untouched
    await markAttendance(w.hr, e.id, { result: "ATTENDED" });
    expect(await stateOf(w, w.guards[0])).toBe("VALID");
    expect(await db.employeeTraining.count({ where: { employeeId: w.guards[0].id, courseName: "First aid", status: "VALID" } })).toBe(1);
  });
  it("is HR's alone, and another company's enrolment is not found", async () => {
    const w = await world();
    const s = await w.session();
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    await expect(markAttendance(await login(w.t, "AUDITOR"), e.id, { result: "ATTENDED" })).rejects.toThrow(/permission/);
    await expect(markAttendance(w.me, e.id, { result: "ATTENDED" })).rejects.toThrow(/permission/);
    await expect(markAttendance((await world()).hr, e.id, { result: "ATTENDED" })).rejects.toThrow(/not found/i);
  });
});

describe("training needs", () => {
  it("HR records a need: the employee, the course, why, a priority and a due date; the same open need is not recorded twice", async () => {
    const w = await world();
    const n = await addNeed(w.hr, { employeeId: w.guards[0].id, courseName: "First aid", source: "REQUEST", note: "Asked by the supervisor", priority: "HIGH", dueBy: day(60) });
    expect(n).toMatchObject({ status: "OPEN", source: "REQUEST", priority: "HIGH", courseName: "First aid" });
    await expect(addNeed(w.hr, { employeeId: w.guards[0].id, courseName: "  FIRST aid", source: "OTHER" })).rejects.toThrow(/already has an open need/i);
    await expect(addNeed(w.hr, { employeeId: w.guards[0].id, courseName: "Fire marshal", source: "GOSSIP" } as never)).rejects.toThrow();
    await db.employee.update({ where: { id: w.guards[1].id }, data: { status: "RESIGNED" } });
    await expect(addNeed(w.hr, { employeeId: w.guards[1].id, courseName: "First aid", source: "OTHER" })).rejects.toThrow(/no longer active/i);
    await expect(addNeed(await login(w.t, "AUDITOR"), { employeeId: w.guards[0].id, courseName: "Fire marshal", source: "OTHER" })).rejects.toThrow(/permission/);
  });
  it("is planned when the person is enrolled, open again when taken off, and met when they attend", async () => {
    const w = await world();
    const n = await addNeed(w.hr, { employeeId: w.guards[0].id, courseName: "First aid", source: "COMPLIANCE" });
    const s = await w.session();
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    expect((await listNeeds(w.hr, {})).find((x) => x.id === n.id)!.status).toBe("PLANNED");
    await unenrol(w.hr, e.id);
    expect((await listNeeds(w.hr, {})).find((x) => x.id === n.id)!.status).toBe("OPEN");
    const e2 = await enrol(w.hr, s.id, w.guards[0].id);
    await markAttendance(w.hr, e2.id, { result: "ATTENDED" });
    expect((await listNeeds(w.hr, { status: "MET" })).map((x) => x.id)).toEqual([n.id]);
  });
  it("can be dropped with a reason, and then never changes again", async () => {
    const w = await world();
    const n = await addNeed(w.hr, { employeeId: w.guards[0].id, courseName: "First aid", source: "OTHER" });
    await expect(dropNeed(w.hr, n.id, "")).rejects.toThrow(/reason/i);
    expect(await dropNeed(w.hr, n.id, "No longer posted to a site that needs it")).toMatchObject({ status: "DROPPED" });
    await expect(dropNeed(w.hr, n.id, "Dropping it twice")).rejects.toThrow(/already|dropped/i);
    const s = await w.session();
    await enrol(w.hr, s.id, w.guards[0].id);
    expect((await listNeeds(w.hr, {})).find((x) => x.id === n.id)!.status).toBe("DROPPED");
    await expect(dropNeed((await world()).hr, n.id, "Another company's need")).rejects.toThrow(/not found/i);
  });
  it("lists the compliance gaps that have no session yet, and a gap leaves the list once the person is enrolled", async () => {
    const w = await world();
    await requireCourse(w);
    let gaps = await trainingGaps(w.hr);
    expect(gaps.map((g) => g.employee.id).sort()).toEqual(w.guards.map((g) => g.id).sort());
    expect(gaps[0]).toMatchObject({ courseName: "First aid", state: "MISSING", hasNeed: false });
    await addNeed(w.hr, { employeeId: w.guards[0].id, courseName: "First aid", source: "COMPLIANCE" });
    const s = await w.session({ seats: 4 });
    await enrol(w.hr, s.id, w.guards[0].id);
    await enrol(w.hr, s.id, w.guards[1].id);
    gaps = await trainingGaps(w.hr);
    expect(gaps.map((g) => g.employee.id).sort()).toEqual([w.guards[2].id, w.guards[3].id].sort());
    expect((await trainingGaps(w.hr)).every((g) => g.hasNeed === false)).toBe(true);
    expect((await trainingGaps((await world()).hr)).length).toBe(0); // another company's gaps are its own
    await expect(trainingGaps(w.me)).rejects.toThrow(/permission/);
  });
  it("an appraisal that recommended training adds a need only when HR asks, never by itself", async () => {
    const w = await world();
    const cycle = await db.appraisalCycle.create({ data: { organizationId: w.t.org.id, name: `Cycle ${uid()}`, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-06-30"), dueDate: new Date("2026-07-15"), createdBy: "test" } });
    const mk = (over: Record<string, unknown>) => db.appraisal.create({ data: { organizationId: w.t.org.id, cycleId: cycle.id, employeeId: w.guards[0].id, status: "APPROVED", recommendation: "TRAINING", ...over } });
    const a = await mk({});
    expect(await db.trainingNeed.count({ where: { organizationId: w.t.org.id } })).toBe(0); // approving it started nothing
    const n = await needsFromAppraisal(w.hr, a.id, "Report writing");
    expect(n).toMatchObject({ source: "APPRAISAL", courseName: "Report writing", employeeId: w.guards[0].id, appraisalId: a.id });
    const other = await db.appraisalCycle.create({ data: { organizationId: w.t.org.id, name: `Cycle ${uid()}`, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-06-30"), dueDate: new Date("2026-07-15"), createdBy: "test" } });
    const none = await db.appraisal.create({ data: { organizationId: w.t.org.id, cycleId: other.id, employeeId: w.guards[1].id, status: "APPROVED", recommendation: "INCREMENT" } });
    await expect(needsFromAppraisal(w.hr, none.id, "Report writing")).rejects.toThrow(/recommend/i);
    const draft = await db.appraisal.create({ data: { organizationId: w.t.org.id, cycleId: other.id, employeeId: w.guards[2].id, status: "DRAFT", recommendation: "TRAINING" } });
    await expect(needsFromAppraisal(w.hr, draft.id, "Report writing")).rejects.toThrow(/approved/i);
    await expect(needsFromAppraisal((await world()).hr, a.id, "Report writing")).rejects.toThrow(/not found/i);
    await expect(needsFromAppraisal(await login(w.t, "AUDITOR"), a.id, "Report writing")).rejects.toThrow(/permission/);
  });
});

describe("the employee's own training", () => {
  it("shows their upcoming sessions and the courses they have attended, and nothing else", async () => {
    const w = await world();
    const done = await w.session();
    const e1 = await enrol(w.hr, done.id, w.guards[0].id);
    await markAttendance(w.hr, e1.id, { result: "ATTENDED" });
    const later = await scheduleSession(w.hr, { programmeId: (await addProgramme(w.hr, { name: "Fire marshal" })).id, sessionDate: day(14), seats: 5 } as never);
    await enrol(w.hr, later.id, w.guards[0].id);
    await enrol(w.hr, later.id, w.guards[1].id);
    const mine = await myTraining(w.me);
    expect(mine.upcoming.map((u) => u.programmeName)).toEqual(["Fire marshal"]);
    expect(mine.attended.map((a) => a.programmeName)).toEqual(["First aid"]);
    expect(mine.attended[0].certificateExpires).toBeTruthy();
    expect(JSON.stringify(mine)).not.toContain(w.guards[1].id); // nobody else
    const cancelled = await w.session({ sessionDate: day(30) });
    await enrol(w.hr, cancelled.id, w.guards[0].id);
    await cancelSession(w.hr, cancelled.id, "Trainer unwell");
    expect((await myTraining(w.me)).upcoming.map((u) => u.sessionId)).not.toContain(cancelled.id);
    expect(await myTraining(await login(w.t, "FINANCE"))).toEqual({ upcoming: [], attended: [] }); // no employee record
  });
});

describe("another company", () => {
  it("sees none of it", async () => {
    const w = await world();
    await w.session();
    await addNeed(w.hr, { employeeId: w.guards[0].id, courseName: "First aid", source: "OTHER" });
    const o = await world();
    expect(await listSessions(o.hr, {})).toEqual([]);
    expect(await listNeeds(o.hr, {})).toEqual([]);
  });
});

describe("the audit trail", () => {
  it("records every step by ids, never an absence reason or a need's note", async () => {
    const w = await world();
    const s = await w.session();
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    await markAttendance(w.hr, e.id, { result: "ABSENT", reason: "SECRET-REASON on leave for family matters" });
    const n = await addNeed(w.hr, { employeeId: w.guards[1].id, courseName: "Fire marshal", source: "REQUEST", note: "SECRET-NOTE asked by the supervisor" });
    await dropNeed(w.hr, n.id, "SECRET-DROP wrong person");
    await cancelSession(w.hr, s.id, "SECRET-CANCEL trainer unwell");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "TRAINING_" } } });
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["TRAINING_PROGRAMME_ADD", "TRAINING_SESSION_SCHEDULE", "TRAINING_ENROL", "TRAINING_ATTENDANCE", "TRAINING_NEED_ADD", "TRAINING_NEED_DROP", "TRAINING_SESSION_CANCEL"]) expect(actions.has(a), a).toBe(true);
    const text = JSON.stringify(rows);
    for (const secret of ["SECRET-REASON", "SECRET-NOTE", "SECRET-DROP", "SECRET-CANCEL"]) expect(text, secret).not.toContain(secret);
    expect(rows.find((r) => r.action === "TRAINING_ATTENDANCE")).toMatchObject({ entity: "TrainingEnrolment", entityId: e.id, userId: w.hr.userId });
  });
});

describe("personal data: the employee's copy and erasure", () => {
  it("their enrolments, results and needs are in the copy of their data they can ask for, and no one else's", async () => {
    const w = await world();
    const s = await w.session();
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    await markAttendance(w.hr, e.id, { result: "ABSENT", reason: "SECRET-REASON on leave" });
    await addNeed(w.hr, { employeeId: w.guards[0].id, courseName: "Fire marshal", source: "REQUEST", note: "SECRET-NOTE asked by the supervisor" });
    await addNeed(w.hr, { employeeId: w.guards[1].id, courseName: "Fire marshal", source: "REQUEST", note: "OTHER-NOTE about someone else" });
    const data = await compileEmployeeData(w.t.org.id, w.guards[0].id);
    const enrolments = JSON.stringify(data.sections.trainingEnrolments.records);
    const needs = JSON.stringify(data.sections.trainingNeeds.records);
    expect(enrolments).toContain("SECRET-REASON");
    expect(enrolments).toContain("First aid");
    expect(needs).toContain("SECRET-NOTE");
    expect(needs).not.toContain("OTHER-NOTE");
  });
  it("erasing an employee removes the words (an absence reason, a need's note and drop reason), keeps the shape and the audit log, and touches no one else's", async () => {
    const w = await world();
    const s = await w.session();
    const e = await enrol(w.hr, s.id, w.guards[0].id);
    await markAttendance(w.hr, e.id, { result: "ABSENT", reason: "SECRET-REASON on leave" });
    const n = await addNeed(w.hr, { employeeId: w.guards[0].id, courseName: "Fire marshal", source: "REQUEST", note: "SECRET-NOTE asked" });
    await dropNeed(w.hr, n.id, "SECRET-DROP wrong person");
    const other = await addNeed(w.hr, { employeeId: w.guards[1].id, courseName: "Fire marshal", source: "REQUEST", note: "OTHER-STAYS written about someone else" });
    const auditBefore = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.guards[0].id, new Date()));
    expect(counts.trainingEnrolments).toBe(1);
    expect(counts.trainingNeeds).toBe(1);
    const text = JSON.stringify([await db.trainingEnrolment.findMany({ where: { employeeId: w.guards[0].id } }), await db.trainingNeed.findMany({ where: { employeeId: w.guards[0].id } })]);
    for (const s2 of ["SECRET-REASON", "SECRET-NOTE", "SECRET-DROP"]) expect(text, s2).not.toContain(s2);
    expect(await db.trainingEnrolment.findFirstOrThrow({ where: { employeeId: w.guards[0].id } })).toMatchObject({ status: "ABSENT" }); // the shape stays
    expect(await db.trainingNeed.findFirstOrThrow({ where: { employeeId: w.guards[0].id } })).toMatchObject({ status: "DROPPED", courseName: "Fire marshal" });
    expect((await db.trainingNeed.findUniqueOrThrow({ where: { id: other.id } })).note).toContain("OTHER-STAYS");
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBe(auditBefore);
  });
});
