import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { getHrPolicy, todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { buildHrDigest } from "@/server/services/reminders";
import { addRequirement, complianceFor } from "@/server/services/training";
import { addNeed, addProgramme, enrol, markAttendance, myRequiredTraining, myTraining, scheduleSession } from "@/server/services/training-plan";
import {
  acceptRequest,
  declineRequest,
  evaluateAsManager,
  evaluateAsParticipant,
  evaluationsDue,
  evaluationsToGive,
  listManagerEvaluations,
  listRequests,
  myTrainingEvaluations,
  programmeResults,
  requestTraining,
  withdrawRequest,
} from "@/server/services/training-evaluation";
import { isolatedOrg, uid } from "../helpers";

// Learning and development, step 2: manager training requests, my required training and training evaluation (the founder's go of 2026-11-10; plan
// docs/plans/learning-development-step2-plan.md). An evaluation is about the course, not a score on the person: it changes no pay, status, certificate or score.

const today = () => iso(todayUtc());
const REASON = "SECRET-REQUEST-REASON the guard now covers a site with a first aid post";
const COMMENT = "SECRET-COMMENT the practical part was the most useful";

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@tev.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function world() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN"); // requests (anyone), plans and marks attendance
  const boss = await login(t, "COMPANY_ADMIN"); // decides
  const supEmp = await createEmployee(hr, { firstName: "Sade", lastName: "Supervisor", employmentDate: "2020-01-01", categoryId: t.officeId });
  const sup = await login(t, "SUPERVISOR", supEmp.id);
  const sup2Emp = await createEmployee(hr, { firstName: "Tunde", lastName: "Other", employmentDate: "2020-01-01", categoryId: t.officeId });
  const sup2 = await login(t, "SUPERVISOR", sup2Emp.id);
  const g: Awaited<ReturnType<typeof createEmployee>>[] = [];
  for (const n of ["One", "Two", "Three", "Four", "Five", "Six"]) g.push(await createEmployee(hr, { firstName: "Gbenga", lastName: `Eval${n}`, employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: supEmp.id }));
  const other = await createEmployee(hr, { firstName: "Ife", lastName: "EvalOther", employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: sup2Emp.id });
  // one login per employee (a user is linked to one employee record)
  const logins = new Map<number, Ctx>();
  const asEmp = async (i: number) => {
    if (!logins.has(i)) logins.set(i, await login(t, "EMPLOYEE", g[i].id));
    return logins.get(i)!;
  };
  const me = await asEmp(0);
  const auditor = await login(t, "AUDITOR");
  const finance = await login(t, "FINANCE");
  const prog = await addProgramme(hr, { name: "First aid", provider: "Red Cross", validityMonths: 24 });
  /** Enrols someone in a session today and marks them attended (which creates their certificate). */
  const attend = async (emp: { id: string }, sessionId?: string) => {
    const s = sessionId ? { id: sessionId } : await scheduleSession(hr, { programmeId: prog.id, sessionDate: today(), seats: 20 });
    const e = await enrol(hr, s.id, emp.id);
    await markAttendance(hr, e.id, { result: "ATTENDED" });
    return { sessionId: s.id, enrolmentId: e.id };
  };
  /** Moves the session into the past so the manager's evaluation is due. */
  const makeDue = (sessionId: string, daysAgo = 61) => db.trainingSession.update({ where: { id: sessionId }, data: { sessionDate: addDays(todayUtc(), -daysAgo) } });
  const request = (ctx: Ctx, employeeId: string, over: Record<string, unknown> = {}) => requestTraining(ctx, { employeeId, courseName: "First aid", reason: REASON, ...over } as never);
  return { t, hr, boss, supEmp, sup, sup2Emp, sup2, g, other, me, asEmp, auditor, finance, prog, attend, makeDue, request };
}
type W = Awaited<ReturnType<typeof world>>;

describe("requesting a course", () => {
  it("is done by HR for anyone, and by a manager for their own direct reports only", async () => {
    const w = await world();
    expect(await w.request(w.hr, w.other.id)).toMatchObject({ status: "REQUESTED", employeeId: w.other.id });
    expect(await w.request(w.sup, w.g[0].id)).toMatchObject({ status: "REQUESTED" });
    await expect(w.request(w.sup, w.other.id), "someone else's report").rejects.toThrow(/employee not found/i);
  });
  it("is never for oneself, and never by the employee, the auditor or finance", async () => {
    const w = await world();
    const selfEmp = await createEmployee(w.hr, { firstName: "Halima", lastName: "Hr", employmentDate: "2020-01-01", categoryId: w.t.guardId });
    await expect(w.request(await login(w.t, "HR_ADMIN", selfEmp.id), selfEmp.id)).rejects.toThrow(/yourself/i);
    for (const ctx of [w.me, w.auditor, w.finance]) await expect(w.request(ctx, w.g[1].id), ctx.role).rejects.toThrow(/permission/);
  });
  it("needs a named course and a real reason, an employee still here, and no second open request or need for the same course", async () => {
    const w = await world();
    await expect(w.request(w.hr, w.g[0].id, { courseName: "ab" })).rejects.toThrow();
    await expect(w.request(w.hr, w.g[0].id, { reason: "short" })).rejects.toThrow();
    await db.employee.update({ where: { id: w.g[5].id }, data: { status: "EXITED" } });
    await expect(w.request(w.hr, w.g[5].id)).rejects.toThrow(/no longer active/i);
    await w.request(w.hr, w.g[0].id);
    await expect(w.request(w.sup, w.g[0].id, { courseName: "  FIRST   aid " }), "same course, typed differently").rejects.toThrow(/already/i);
    await addNeed(w.hr, { employeeId: w.g[1].id, courseName: "First aid", source: "OTHER" });
    await expect(w.request(w.hr, w.g[1].id)).rejects.toThrow(/already/i);
  });
});

describe("deciding a request", () => {
  it("is done by someone with the training right who did not make it, and a decline needs a reason", async () => {
    const w = await world();
    const r = await w.request(w.hr, w.g[0].id);
    await expect(acceptRequest(w.hr, r.id)).rejects.toThrow(/someone else/i);
    await expect(declineRequest(w.hr, r.id, "no thanks really")).rejects.toThrow(/someone else/i);
    for (const ctx of [w.sup, w.auditor, w.finance, w.me]) await expect(acceptRequest(ctx, r.id), ctx.role).rejects.toThrow(/permission/);
    await expect(declineRequest(w.boss, r.id, "no")).rejects.toThrow();
    expect((await declineRequest(w.boss, r.id, "Not this quarter, budget is fixed")).status).toBe("DECLINED");
    await expect(acceptRequest(w.boss, r.id)).rejects.toThrow(/already/i);
  });
  it("accepting adds exactly one training need and nothing else: no enrolment, no seat, no certificate", async () => {
    const w = await world();
    const r = await w.request(w.sup, w.g[0].id);
    const before = { enrol: await db.trainingEnrolment.count({ where: { organizationId: w.t.org.id } }), certs: await db.employeeTraining.count({ where: { organizationId: w.t.org.id } }) };
    const acc = await acceptRequest(w.boss, r.id);
    expect(acc.status).toBe("ACCEPTED");
    const needs = await db.trainingNeed.findMany({ where: { organizationId: w.t.org.id, employeeId: w.g[0].id } });
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ source: "REQUEST", status: "OPEN", courseName: "First aid" });
    expect(needs[0].note ?? "").not.toMatch(/SECRET/);
    expect(await db.trainingEnrolment.count({ where: { organizationId: w.t.org.id } })).toBe(before.enrol);
    expect(await db.employeeTraining.count({ where: { organizationId: w.t.org.id } })).toBe(before.certs);
  });
  it("is refused when the employee already has an open need by then, and another company cannot decide it", async () => {
    const w = await world();
    const r = await w.request(w.hr, w.g[0].id);
    await addNeed(w.hr, { employeeId: w.g[0].id, courseName: "First aid", source: "OTHER" });
    await expect(acceptRequest(w.boss, r.id)).rejects.toThrow(/already/i);
    const o = await world();
    await expect(acceptRequest(o.boss, r.id)).rejects.toThrow(/not found/i);
    expect(await listRequests(o.hr)).toEqual([]);
  });
});

describe("withdrawing a request", () => {
  it("is done by whoever made it while it is undecided, with a reason", async () => {
    const w = await world();
    const r = await w.request(w.sup, w.g[0].id);
    await expect(withdrawRequest(w.sup, r.id, "no")).rejects.toThrow();
    await expect(withdrawRequest(w.sup2, r.id, "Not mine to withdraw")).rejects.toThrow(/permission|not found/i);
    expect((await withdrawRequest(w.sup, r.id, "Asked for the wrong person")).status).toBe("WITHDRAWN");
    const q = await w.request(w.sup, w.g[0].id);
    await acceptRequest(w.boss, q.id);
    await expect(withdrawRequest(w.sup, q.id, "Changed my mind about it")).rejects.toThrow(/already/i);
  });
});

describe("who sees the requests", () => {
  it("HR reads every request; a manager only the ones they made; the employee none, and is told of none", async () => {
    const w = await world();
    await w.request(w.hr, w.other.id);
    const mine = await w.request(w.sup, w.g[0].id);
    expect(await listRequests(w.hr)).toHaveLength(2);
    expect((await listRequests(w.sup)).map((x) => x.id)).toEqual([mine.id]);
    await expect(listRequests(w.me)).rejects.toThrow(/permission/);
    expect(JSON.stringify(await myTraining(w.me))).not.toMatch(/SECRET/);
    expect(JSON.stringify(await myRequiredTraining(w.me))).not.toMatch(/SECRET/);
  });
});

describe("my required training", () => {
  it("shows the employee their own required courses, with the same answer as the HR compliance screen", async () => {
    const w = await world();
    await addRequirement(w.hr, { courseName: "First aid", graceDays: 30 } as never);
    await addRequirement(w.hr, { courseName: "Fire safety", categoryId: w.t.officeId, graceDays: 0 } as never); // not for a guard
    const mine = await myRequiredTraining(w.me);
    const hrView = (await complianceFor(w.t.org.id)).rows.find((r) => r.employee.id === w.g[0].id)!.items;
    expect(mine.map((m) => [m.courseName, m.state])).toEqual(hrView.map((i) => [i.requirement.courseName, i.assessment.state]));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ courseName: "First aid", state: "MISSING" });
    await w.attend(w.g[0]);
    const after = await myRequiredTraining(w.me);
    expect(after[0].state).toBe("VALID");
    expect(after[0].expires).toBeTruthy();
  });
  it("shows the grace period of a new joiner, only the employee's own record, and nothing without an employee record", async () => {
    const w = await world();
    await addRequirement(w.hr, { courseName: "First aid", graceDays: 30 } as never);
    const fresh = await createEmployee(w.hr, { firstName: "Newly", lastName: "Joined", employmentDate: today(), categoryId: w.t.guardId });
    const fm = await login(w.t, "EMPLOYEE", fresh.id);
    const r = await myRequiredTraining(fm);
    expect(r[0]).toMatchObject({ state: "GRACE" });
    expect(r[0].dueBy).toBe(iso(addDays(todayUtc(), 30)));
    expect(JSON.stringify(r)).not.toMatch(/Eval/);
    expect(await myRequiredTraining(await login(w.t, "EMPLOYEE"))).toEqual([]);
  });
});

describe("the participant's evaluation", () => {
  it("is given once, by the person who attended, about the course they attended", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    expect((await evaluationsToGive(w.me)).map((x) => x.enrolmentId)).toEqual([a.enrolmentId]);
    const e = await evaluateAsParticipant(w.me, a.enrolmentId, { rating: 5, comment: COMMENT });
    expect(e).toMatchObject({ kind: "PARTICIPANT", rating: 5 });
    expect(await evaluationsToGive(w.me)).toEqual([]);
    await expect(evaluateAsParticipant(w.me, a.enrolmentId, { rating: 4 })).rejects.toThrow(/already/i);
  });
  it("is refused for someone else's course, a course not attended, a rating out of range and an over-long comment", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    const other = await w.asEmp(1);
    await expect(evaluateAsParticipant(other, a.enrolmentId, { rating: 3 })).rejects.toThrow(/not found/i);
    const s = await scheduleSession(w.hr, { programmeId: w.prog.id, sessionDate: today(), seats: 5 });
    const enrolled = await enrol(w.hr, s.id, w.g[0].id);
    await expect(evaluateAsParticipant(w.me, enrolled.id, { rating: 3 })).rejects.toThrow(/attended/i);
    await expect(evaluateAsParticipant(w.me, a.enrolmentId, { rating: 6 })).rejects.toThrow(/1 to 5/);
    await expect(evaluateAsParticipant(w.me, a.enrolmentId, { rating: 3, comment: "x".repeat(301) })).rejects.toThrow();
    await expect(evaluateAsParticipant(w.hr, a.enrolmentId, { rating: 3 }), "HR is not the participant").rejects.toThrow(/not found/i);
    const o = await world();
    await expect(evaluateAsParticipant(o.me, a.enrolmentId, { rating: 3 })).rejects.toThrow(/not found/i);
  });
});

describe("the manager's evaluation", () => {
  it("is asked only after the company's number of days, once, about a direct report who attended", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    await expect(evaluateAsManager(w.sup, a.enrolmentId, { rating: 4 })).rejects.toThrow(/not yet/i);
    expect(await evaluationsDue(w.sup)).toEqual([]);
    await w.makeDue(a.sessionId);
    expect((await evaluationsDue(w.sup)).map((x) => x.enrolmentId)).toEqual([a.enrolmentId]);
    expect(await evaluateAsManager(w.sup, a.enrolmentId, { rating: 4, comment: COMMENT })).toMatchObject({ kind: "MANAGER", rating: 4 });
    expect(await evaluationsDue(w.sup)).toEqual([]);
    await expect(evaluateAsManager(w.sup, a.enrolmentId, { rating: 3 })).rejects.toThrow(/already/i);
  });
  it("is refused for someone else's report, for the employee, the auditor and finance, and for a course not attended", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    await expect(evaluateAsManager(w.sup2, a.enrolmentId, { rating: 4 })).rejects.toThrow(/not found/i);
    for (const ctx of [w.me, w.auditor, w.finance]) await expect(evaluateAsManager(ctx, a.enrolmentId, { rating: 4 }), ctx.role).rejects.toThrow(/permission/);
    const s = await scheduleSession(w.hr, { programmeId: w.prog.id, sessionDate: today(), seats: 5 });
    const enrolled = await enrol(w.hr, s.id, w.g[1].id);
    await w.makeDue(s.id);
    await expect(evaluateAsManager(w.sup, enrolled.id, { rating: 4 })).rejects.toThrow(/attended/i);
  });
  it("is switched off when the company sets 0 days, and follows the company's own number of days", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId, 10);
    await expect(evaluateAsManager(w.sup, a.enrolmentId, { rating: 4 })).rejects.toThrow(/not yet/i);
    await updateHrPolicy(w.hr, { trainingEvaluationDays: 7 });
    expect((await evaluateAsManager(w.sup, a.enrolmentId, { rating: 4 })).rating).toBe(4);
    const b = await w.attend(w.g[1]);
    await w.makeDue(b.sessionId, 400);
    await updateHrPolicy(w.hr, { trainingEvaluationDays: 0 });
    await expect(evaluateAsManager(w.sup, b.enrolmentId, { rating: 4 })).rejects.toThrow(/switched off/i);
    expect(await evaluationsDue(w.sup)).toEqual([]);
  });
});

describe("results without picking a person out", () => {
  it("shows no count, no average and no comment for fewer than five answers, and never a name", async () => {
    const w = await world();
    for (const i of [0, 1, 2]) {
      const a = await w.attend(w.g[i]);
      await evaluateAsParticipant(await w.asEmp(i), a.enrolmentId, { rating: 5, comment: COMMENT });
    }
    const r = (await programmeResults(w.hr)).find((x) => x.programmeId === w.prog.id)!;
    expect(r.participant).toEqual({ shown: false, count: null, average: null });
    expect(r.comments).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/SECRET|Eval|Gbenga/);
  });
  it("shows the count, the average and the comments, without names, from five answers", async () => {
    const w = await world();
    const sessionId = (await scheduleSession(w.hr, { programmeId: w.prog.id, sessionDate: today(), seats: 20 })).id;
    for (const [i, rating] of [5, 4, 4, 4, 4].entries()) {
      const a = await w.attend(w.g[i], sessionId);
      await evaluateAsParticipant(await w.asEmp(i), a.enrolmentId, { rating, comment: COMMENT });
    }
    const r = (await programmeResults(w.hr)).find((x) => x.programmeId === w.prog.id)!;
    expect(r.participant).toEqual({ shown: true, count: 5, average: 4.2 });
    expect(r.comments).toHaveLength(5);
    expect(r.comments![0]).toContain("SECRET-COMMENT");
    expect(JSON.stringify(r)).not.toMatch(/Eval|Gbenga|employeeId|byUserId|byName/);
    for (const ctx of [w.me, w.sup]) await expect(programmeResults(ctx), ctx.role).rejects.toThrow(/permission/);
    expect((await programmeResults(w.auditor)).length).toBeGreaterThan(0); // reads HR records
  });
  it("lists the managers' evaluations by name for HR, who may read them", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    await evaluateAsManager(w.sup, a.enrolmentId, { rating: 4, comment: COMMENT });
    const rows = await listManagerEvaluations(w.hr);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: 4, programmeName: "First aid" });
    expect(JSON.stringify(rows)).toContain("EvalOne");
    await expect(listManagerEvaluations(w.me)).rejects.toThrow(/permission/);
  });
});

describe("what the employee reads", () => {
  it("is the manager's evaluation of them, as they read feedback, and never a participant's answer or anyone else's", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    const b = await w.attend(w.g[1]);
    await evaluateAsParticipant(await w.asEmp(1), b.enrolmentId, { rating: 2, comment: "SECRET-OTHER-PARTICIPANT" });
    await w.makeDue(a.sessionId);
    await w.makeDue(b.sessionId);
    await evaluateAsManager(w.sup, a.enrolmentId, { rating: 4, comment: COMMENT });
    await evaluateAsManager(w.sup, b.enrolmentId, { rating: 1, comment: "SECRET-OTHER-MANAGER" });
    const mine = await myTrainingEvaluations(w.me);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ programmeName: "First aid", rating: 4, comment: COMMENT });
    expect(Object.keys(mine[0]).sort()).toEqual(["byName", "comment", "createdAt", "programmeName", "rating"]);
    expect(JSON.stringify(mine)).not.toMatch(/SECRET-OTHER/);
    expect(await myTrainingEvaluations(await login(w.t, "EMPLOYEE"))).toEqual([]);
  });
});

describe("an evaluation changes nothing about the person", () => {
  it("leaves the certificate, the status, the pay and the payroll as they were", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    const snap = async () => ({
      emp: await db.employee.findUniqueOrThrow({ where: { id: w.g[0].id }, select: { categoryId: true, status: true } }),
      certs: await db.employeeTraining.findMany({ where: { employeeId: w.g[0].id }, select: { id: true, status: true, expiryDate: true } }),
      rates: await db.employeePayRate.count({ where: { employeeId: w.g[0].id } }),
      payroll: await db.payrollRecord.count({ where: { employeeId: w.g[0].id } }),
      appraisals: await db.appraisal.count({ where: { employeeId: w.g[0].id } }),
    });
    const before = await snap();
    await evaluateAsParticipant(w.me, a.enrolmentId, { rating: 1, comment: COMMENT });
    await evaluateAsManager(w.sup, a.enrolmentId, { rating: 1, comment: COMMENT });
    expect(await snap()).toEqual(before);
  });
});

describe("the HR digest", () => {
  it("lists evaluations a manager has not given once they are due, and stops when given or switched off", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    const listed = async () => (await buildHrDigest(w.t.org.id)).sections.some((s) => s.key === "training-evaluations-due");
    expect(await listed()).toBe(false);
    await w.makeDue(a.sessionId);
    expect(await listed()).toBe(true);
    await updateHrPolicy(w.hr, { trainingEvaluationDays: 0 });
    expect(await listed()).toBe(false);
    await updateHrPolicy(w.hr, { trainingEvaluationDays: 60 });
    await evaluateAsManager(w.sup, a.enrolmentId, { rating: 4 });
    expect(await listed()).toBe(false);
    expect((await getHrPolicy(w.t.org.id)).trainingEvaluationDays).toBe(60);
  });
});

describe("audit and personal data", () => {
  it("records every step by ids and the kind, never a reason, a rating comment or a note", async () => {
    const w = await world();
    const r = await w.request(w.sup, w.g[0].id);
    await declineRequest(w.boss, r.id, "SECRET-DECLINE not this quarter");
    const a = await w.attend(w.g[1]);
    await w.makeDue(a.sessionId);
    await evaluateAsParticipant(await w.asEmp(1), a.enrolmentId, { rating: 3, comment: COMMENT });
    await evaluateAsManager(w.sup, a.enrolmentId, { rating: 3, comment: COMMENT });
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "TRAINING_" } } });
    expect(rows.map((x) => x.action)).toEqual(expect.arrayContaining(["TRAINING_REQUEST", "TRAINING_REQUEST_DECLINE", "TRAINING_EVALUATE"]));
    expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
  });
  it("puts their own answers, the manager's evaluation of them and an accepted request in the copy of their data, never a declined or undecided request", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    await evaluateAsParticipant(w.me, a.enrolmentId, { rating: 5, comment: COMMENT });
    await evaluateAsManager(w.sup, a.enrolmentId, { rating: 4, comment: "SECRET-MANAGER-LINE" });
    const open = await w.request(w.sup, w.g[1].id);
    const declined = await w.request(w.sup, w.g[2].id);
    await declineRequest(w.boss, declined.id, "SECRET-DECLINE not this quarter");
    const accepted = await w.request(w.sup, w.g[3].id);
    await acceptRequest(w.boss, accepted.id);
    const mine = (await compileEmployeeData(w.t.org.id, w.g[0].id)).sections;
    expect(JSON.stringify(mine.trainingEvaluations.records)).toMatch(/SECRET-COMMENT/);
    expect(JSON.stringify(mine.trainingEvaluations.records)).toMatch(/SECRET-MANAGER-LINE/);
    expect((await compileEmployeeData(w.t.org.id, w.g[1].id)).sections.trainingRequests.records).toEqual([]);
    expect((await compileEmployeeData(w.t.org.id, w.g[2].id)).sections.trainingRequests.records).toEqual([]);
    expect(JSON.stringify((await compileEmployeeData(w.t.org.id, w.g[3].id)).sections.trainingRequests.records)).toMatch(/SECRET-REQUEST-REASON/);
    expect(open.status).toBe("REQUESTED");
  });
  it("erasing an employee removes the words (comments, a request's reason and notes), keeps the shape and the audit log, and touches no one else's", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    const b = await w.attend(w.g[1]);
    await w.makeDue(a.sessionId);
    await evaluateAsParticipant(w.me, a.enrolmentId, { rating: 5, comment: COMMENT });
    await evaluateAsManager(w.sup, a.enrolmentId, { rating: 4, comment: COMMENT });
    await evaluateAsParticipant(await w.asEmp(1), b.enrolmentId, { rating: 5, comment: COMMENT });
    const r = await w.request(w.sup, w.g[0].id);
    await declineRequest(w.boss, r.id, "SECRET-DECLINE not this quarter");
    const auditBefore = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.g[0].id, new Date()));
    expect(counts.trainingEvaluations).toBe(2);
    expect(counts.trainingRequests).toBe(1);
    const evs = await db.trainingEvaluation.findMany({ where: { enrolmentId: a.enrolmentId } });
    expect(evs).toHaveLength(2);
    expect(JSON.stringify(evs)).not.toMatch(/SECRET/);
    expect(evs.map((e) => e.rating).sort()).toEqual([4, 5]);
    const req = await db.trainingRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(`${req.reason}${req.decisionNote ?? ""}`).not.toMatch(/SECRET/);
    expect(req.status).toBe("DECLINED");
    expect((await db.trainingEvaluation.findFirstOrThrow({ where: { enrolmentId: b.enrolmentId } })).comment).toMatch(/SECRET-COMMENT/);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBe(auditBefore);
  });
});

describe("tenant isolation", () => {
  it("another company sees none of it and cannot evaluate or decide anything", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    const o = await world();
    expect(await programmeResults(o.hr)).not.toContainEqual(expect.objectContaining({ programmeId: w.prog.id }));
    await expect(evaluateAsManager(o.sup, a.enrolmentId, { rating: 4 })).rejects.toThrow(/not found/i);
    expect(await listManagerEvaluations(o.hr)).toEqual([]);
    expect(await evaluationsDue(o.sup)).toEqual([]);
  });
});
