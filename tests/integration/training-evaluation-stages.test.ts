import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { getHrPolicy, todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { buildHrDigest } from "@/server/services/reminders";
import { addProgramme, enrol, markAttendance, scheduleSession, updateProgramme } from "@/server/services/training-plan";
import {
  effectivenessDueList,
  effectivenessEvidence,
  evaluateAsParticipant,
  evaluateEffectiveness,
  myEffectivenessEvaluations,
  programmeResults,
} from "@/server/services/training-evaluation";
import { isolatedOrg, uid } from "../helpers";

// Training evaluation in three stages (the founder's approval of 2026-11-14 of the ten recommendations in docs/plans/training-evaluation-stages-plan.md). Stage 1: the participant answers
// relevance, content, facilitator and delivery. Stage 2 (the manager's application evaluation) is unchanged. Stage 3: the manager says whether performance on the work the training targets
// improved, a company-set number of days after the session (120), only for programmes HR marks, once. HR sees results per programme only, from five answers, never by name. Nothing here
// changes pay, a skill, an appraisal or a promotion. The audit log carries ids and the stage, never a comment.

const today = () => iso(todayUtc());
const COMMENT = "SECRET-COMMENT the practical part was the most useful";
const EVIDENCE = "SECRET-EFFECT-NOTE she now leads the first aid drill";

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@tes.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function world() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN");
  const supEmp = await createEmployee(hr, { firstName: "Sade", lastName: "Supervisor", employmentDate: "2020-01-01", categoryId: t.officeId });
  const sup = await login(t, "SUPERVISOR", supEmp.id);
  const sup2Emp = await createEmployee(hr, { firstName: "Tunde", lastName: "Other", employmentDate: "2020-01-01", categoryId: t.officeId });
  const sup2 = await login(t, "SUPERVISOR", sup2Emp.id);
  const g: Awaited<ReturnType<typeof createEmployee>>[] = [];
  for (const n of ["One", "Two", "Three", "Four", "Five", "Six"]) g.push(await createEmployee(hr, { firstName: "Gbenga", lastName: `Stage${n}`, employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: supEmp.id }));
  const other = await createEmployee(hr, { firstName: "Ife", lastName: "StageOther", employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: sup2Emp.id });
  const logins = new Map<number, Ctx>();
  const asEmp = async (i: number) => {
    if (!logins.has(i)) logins.set(i, await login(t, "EMPLOYEE", g[i].id));
    return logins.get(i)!;
  };
  const me = await asEmp(0);
  const auditor = await login(t, "AUDITOR");
  const finance = await login(t, "FINANCE");
  const prog = await addProgramme(hr, { name: "First aid", provider: "Red Cross", validityMonths: 24 });
  const attendIn = async (programmeId: string, emp: { id: string }, sessionId?: string, trainer?: string) => {
    const s = sessionId ? { id: sessionId } : await scheduleSession(hr, { programmeId, sessionDate: today(), seats: 20, trainer } as never);
    const e = await enrol(hr, s.id, emp.id);
    await markAttendance(hr, e.id, { result: "ATTENDED" });
    return { sessionId: s.id, enrolmentId: e.id };
  };
  const attend = (emp: { id: string }, sessionId?: string) => attendIn(prog.id, emp, sessionId);
  /** Moves the session into the past so the question is due (the effectiveness question is asked after 120 days). */
  const makeDue = (sessionId: string, daysAgo = 121) => db.trainingSession.update({ where: { id: sessionId }, data: { sessionDate: addDays(todayUtc(), -daysAgo) } });
  const flag = (programmeId = prog.id, on = true) => updateProgramme(hr, programmeId, { evaluateEffectiveness: on });
  return { t, hr, supEmp, sup, sup2Emp, sup2, g, other, me, asEmp, auditor, finance, prog, attend, attendIn, makeDue, flag };
}
type W = Awaited<ReturnType<typeof world>>;

/** Five employees each attend and answer as a participant; returns the enrolments. */
async function fiveParticipants(w: W, answers: Array<{ rating: number; content?: number; facilitator?: number; delivery?: number; comment?: string }>, programmeId = w.prog.id) {
  const out: Array<{ sessionId: string; enrolmentId: string }> = [];
  for (let i = 0; i < answers.length; i++) {
    const a = await w.attendIn(programmeId, w.g[i]);
    await evaluateAsParticipant(await w.asEmp(i), a.enrolmentId, answers[i]);
    out.push(a);
  }
  return out;
}

describe("stage 1: the participant answers four questions", () => {
  it("rates relevance, content, facilitator and delivery, once, for a course they attended; the first is the existing question and keeps its meaning", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    const row = await evaluateAsParticipant(w.me, a.enrolmentId, { rating: 5, content: 4, facilitator: 3, delivery: 2, comment: COMMENT });
    expect(row).toMatchObject({ kind: "PARTICIPANT", rating: 5, contentRating: 4, facilitatorRating: 3, deliveryRating: 2 });
    await expect(evaluateAsParticipant(w.me, a.enrolmentId, { rating: 5 })).rejects.toThrow(/already answered/i);
  });
  it("still accepts the single-rating answer of before, which reads as relevance with the other three left blank", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    const row = await evaluateAsParticipant(w.me, a.enrolmentId, { rating: 4 });
    expect(row).toMatchObject({ rating: 4, contentRating: null, facilitatorRating: null, deliveryRating: null });
  });
  it("refuses a rating outside 1 to 5 in any of the four, and a course not attended, and someone else's course", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    for (const bad of [{ rating: 5, content: 0 }, { rating: 5, facilitator: 6 }, { rating: 5, delivery: 2.5 }, { rating: 9 }]) await expect(evaluateAsParticipant(w.me, a.enrolmentId, bad as never)).rejects.toThrow(/whole number/i);
    const s = await scheduleSession(w.hr, { programmeId: w.prog.id, sessionDate: today(), seats: 5 });
    const e = await enrol(w.hr, s.id, w.g[0].id);
    await expect(evaluateAsParticipant(w.me, e.id, { rating: 3 })).rejects.toThrow(/attended/i);
    await expect(evaluateAsParticipant(await w.asEmp(1), a.enrolmentId, { rating: 3 })).rejects.toThrow(/not found/i);
  });
});

describe("what HR sees of the participants' answers", () => {
  it("is nothing below five answers (no count, no average, no comment), for each of the four ratings", async () => {
    const w = await world();
    await fiveParticipants(w, [1, 2, 3, 4].map((n) => ({ rating: n, content: n, facilitator: n, delivery: n, comment: COMMENT })));
    const r = (await programmeResults(w.hr)).find((p) => p.programmeId === w.prog.id)!;
    for (const k of ["participant", "content", "facilitator", "delivery"] as const) expect(r[k], k).toEqual({ shown: false, count: null, average: null });
    expect(r.comments).toBeNull();
  });
  it("from five answers shows each average and the comments, unnamed and in alphabetical order", async () => {
    const w = await world();
    await fiveParticipants(w, [
      { rating: 5, content: 5, facilitator: 1, delivery: 3, comment: "Zebra comment" },
      { rating: 5, content: 5, facilitator: 1, delivery: 3, comment: "apple comment" },
      { rating: 4, content: 4, facilitator: 2, delivery: 3, comment: "Mango comment" },
      { rating: 4, content: 4, facilitator: 2, delivery: 3 },
      { rating: 4, content: 4, facilitator: 2, delivery: 4 },
    ]);
    const r = (await programmeResults(w.hr)).find((p) => p.programmeId === w.prog.id)!;
    expect(r.participant).toEqual({ shown: true, count: 5, average: 4.4 });
    expect(r.content).toEqual({ shown: true, count: 5, average: 4.4 });
    expect(r.facilitator).toEqual({ shown: true, count: 5, average: 1.6 });
    expect(r.delivery).toEqual({ shown: true, count: 5, average: 3.2 });
    expect(r.comments).toEqual(["apple comment", "Mango comment", "Zebra comment"]);
  });
  it("counts each rating on its own answers: five relevance answers but only four content answers shows relevance and hides content", async () => {
    const w = await world();
    await fiveParticipants(w, [
      { rating: 4, content: 4 },
      { rating: 4, content: 4 },
      { rating: 4, content: 4 },
      { rating: 4, content: 4 },
      { rating: 4 }, // the single-rating answer of before
    ]);
    const r = (await programmeResults(w.hr)).find((p) => p.programmeId === w.prog.id)!;
    expect(r.participant).toMatchObject({ shown: true, count: 5 });
    expect(r.content).toEqual({ shown: false, count: null, average: null });
  });
  it("is per programme across all its sessions, never per session or per trainer, and carries no name and no id of a participant", async () => {
    const w = await world();
    const s1 = await scheduleSession(w.hr, { programmeId: w.prog.id, sessionDate: today(), seats: 20, trainer: "Trainer SECRET-TRAINER" } as never);
    for (let i = 0; i < 3; i++) {
      const a = await w.attend(w.g[i], s1.id);
      await evaluateAsParticipant(await w.asEmp(i), a.enrolmentId, { rating: 4, content: 4, facilitator: 4, delivery: 4 });
    }
    for (let i = 3; i < 5; i++) {
      const a = await w.attend(w.g[i]); // a second session
      await evaluateAsParticipant(await w.asEmp(i), a.enrolmentId, { rating: 4, content: 4, facilitator: 4, delivery: 4 });
    }
    const results = await programmeResults(w.hr);
    const r = results.find((p) => p.programmeId === w.prog.id)!;
    expect(r.facilitator).toMatchObject({ shown: true, count: 5 }); // three plus two: one figure for the programme
    const text = JSON.stringify(results);
    expect(text).not.toMatch(/SECRET-TRAINER|Stage(One|Two|Three|Four|Five)|Gbenga/);
    for (const g of w.g) expect(text).not.toContain(g.id);
    for (const i of [0, 1, 2, 3, 4]) expect(text).not.toContain((await w.asEmp(i)).userId);
  });
  it("is for the people who see HR records only", async () => {
    const w = await world();
    await expect(programmeResults(w.me)).rejects.toThrow(/permission/i);
    await expect(programmeResults(w.sup)).rejects.toThrow(/permission/i);
    await expect(programmeResults(w.auditor)).resolves.toBeTruthy();
  });
});

describe("stage 3: which programmes are evaluated for effectiveness", () => {
  it("is a flag on the programme, off by default, set by HR and recorded by field, never by anything else", async () => {
    const w = await world();
    expect((await db.trainingProgramme.findUniqueOrThrow({ where: { id: w.prog.id } })).evaluateEffectiveness).toBe(false);
    await expect(updateProgramme(w.sup, w.prog.id, { evaluateEffectiveness: true })).rejects.toThrow(/permission/i);
    const u = await updateProgramme(w.hr, w.prog.id, { evaluateEffectiveness: true });
    expect(u.evaluateEffectiveness).toBe(true);
    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "TRAINING_PROGRAMME_UPDATE" } });
    expect(JSON.stringify(audit.map((a) => a.newValue))).toContain("evaluateEffectiveness");
  });
  it("is a company setting of days, 120 by default, 0 meaning never, and nothing else", async () => {
    const w = await world();
    expect((await getHrPolicy(w.t.org.id)).trainingEffectivenessDays).toBe(120);
    await updateHrPolicy(w.hr, { trainingEffectivenessDays: 90 });
    expect((await getHrPolicy(w.t.org.id)).trainingEffectivenessDays).toBe(90);
    await expect(updateHrPolicy(w.hr, { trainingEffectivenessDays: -1 })).rejects.toThrow();
    await expect(updateHrPolicy(w.hr, { trainingEffectivenessDays: 366 })).rejects.toThrow();
  });
});

describe("stage 3: the manager says whether performance improved", () => {
  async function due(w: W, i = 0) {
    await w.flag();
    const a = await w.attend(w.g[i]);
    await w.makeDue(a.sessionId);
    return a;
  }
  it("is given by the manager of a direct report who attended, for a marked programme, after the company's days, once", async () => {
    const w = await world();
    const a = await due(w);
    const row = await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "SOMEWHAT_IMPROVED", comment: EVIDENCE });
    expect(row).toMatchObject({ outcome: "SOMEWHAT_IMPROVED", enrolmentId: a.enrolmentId });
    await expect(evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "CLEARLY_IMPROVED" })).rejects.toThrow(/already/i);
  });
  it("is refused for a programme HR has not marked, and when the company has switched the question off", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    await expect(evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "CLEARLY_IMPROVED" })).rejects.toThrow(/not marked/i);
    await w.flag();
    await updateHrPolicy(w.hr, { trainingEffectivenessDays: 0 });
    await expect(evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "CLEARLY_IMPROVED" })).rejects.toThrow(/switched off/i);
  });
  it("is refused before the days have passed, with the number of days, and for a course not attended", async () => {
    const w = await world();
    await w.flag();
    const early = await w.attend(w.g[0]);
    await w.makeDue(early.sessionId, 100);
    await expect(evaluateEffectiveness(w.sup, early.enrolmentId, { outcome: "CLEARLY_IMPROVED" })).rejects.toThrow(/120 days/);
    const s = await scheduleSession(w.hr, { programmeId: w.prog.id, sessionDate: today(), seats: 5 });
    const e = await enrol(w.hr, s.id, w.g[1].id);
    await w.makeDue(s.id);
    await expect(evaluateEffectiveness(w.sup, e.id, { outcome: "CLEARLY_IMPROVED" })).rejects.toThrow(/attended/i);
  });
  it("is the manager's alone: another manager gets 'not found', a person cannot evaluate themselves, and the employee, the auditor and finance have no right", async () => {
    const w = await world();
    const a = await due(w);
    await expect(evaluateEffectiveness(w.sup2, a.enrolmentId, { outcome: "CLEARLY_IMPROVED" })).rejects.toThrow(/not found/i);
    for (const ctx of [w.me, w.auditor, w.finance]) await expect(evaluateEffectiveness(ctx, a.enrolmentId, { outcome: "CLEARLY_IMPROVED" }), ctx.role).rejects.toThrow(/permission/i);
    const selfSup = await createEmployee(w.hr, { firstName: "Ngozi", lastName: "Self", employmentDate: "2020-01-01", categoryId: w.t.officeId, reportingManagerId: w.supEmp.id });
    const own = await w.attend(selfSup);
    await w.makeDue(own.sessionId);
    await expect(evaluateEffectiveness(await login(w.t, "SUPERVISOR", selfSup.id), own.enrolmentId, { outcome: "CLEARLY_IMPROVED" })).rejects.toThrow(/own training/i);
  });
  it("takes one of four outcomes, an optional comment of at most 300 characters, and 'not yet visible' is a legitimate answer", async () => {
    const w = await world();
    const a = await due(w);
    await expect(evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "FANTASTIC" as never })).rejects.toThrow();
    await expect(evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "CLEARLY_IMPROVED", comment: "x".repeat(301) })).rejects.toThrow(/300/);
    expect(await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "NOT_YET_VISIBLE" })).toMatchObject({ outcome: "NOT_YET_VISIBLE", comment: null });
  });
  it("is separate from attendance and from the other stages: attending, a certificate or a good participant score never fills it in", async () => {
    const w = await world();
    const a = await due(w);
    await evaluateAsParticipant(w.me, a.enrolmentId, { rating: 5, content: 5, facilitator: 5, delivery: 5 });
    expect(await db.trainingEffectiveness.count({ where: { enrolmentId: a.enrolmentId } })).toBe(0);
  });
  it("changes no pay, no skill, no appraisal and no promotion", async () => {
    const w = await world();
    const a = await due(w);
    const before = {
      skills: await db.skillAssessment.count({ where: { organizationId: w.t.org.id } }),
      appraisals: await db.appraisal.count({ where: { organizationId: w.t.org.id } }),
      promotions: await db.promotionProposal.count({ where: { organizationId: w.t.org.id } }),
      rates: await db.employeePayRate.count({ where: { organizationId: w.t.org.id } }),
      employee: JSON.stringify(await db.employee.findUniqueOrThrow({ where: { id: w.g[0].id } })),
    };
    await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "CLEARLY_IMPROVED", comment: EVIDENCE });
    expect({
      skills: await db.skillAssessment.count({ where: { organizationId: w.t.org.id } }),
      appraisals: await db.appraisal.count({ where: { organizationId: w.t.org.id } }),
      promotions: await db.promotionProposal.count({ where: { organizationId: w.t.org.id } }),
      rates: await db.employeePayRate.count({ where: { organizationId: w.t.org.id } }),
      employee: JSON.stringify(await db.employee.findUniqueOrThrow({ where: { id: w.g[0].id } })),
    }).toEqual(before);
  });
});

describe("what is due, and the skill evidence beside it", () => {
  it("lists the effectiveness evaluations a manager has been asked for (their direct reports', for a marked programme, once due), and HR everyone's; none once given", async () => {
    const w = await world();
    await w.flag();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    const notDue = await w.attend(w.g[1]);
    await w.makeDue(notDue.sessionId, 30);
    const otherA = await w.attend(w.other);
    await w.makeDue(otherA.sessionId);
    expect((await effectivenessDueList(w.sup)).map((x) => x.enrolmentId)).toEqual([a.enrolmentId]);
    expect((await effectivenessDueList(w.hr)).map((x) => x.enrolmentId).sort()).toEqual([a.enrolmentId, otherA.enrolmentId].sort());
    await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "SOMEWHAT_IMPROVED" });
    expect((await effectivenessDueList(w.sup)).map((x) => x.enrolmentId)).toEqual([]);
  });
  it("lists nothing for a programme that is not marked, or when the setting is 0", async () => {
    const w = await world();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    expect(await effectivenessDueList(w.sup)).toEqual([]);
    await w.flag();
    expect(await effectivenessDueList(w.sup)).toHaveLength(1);
    await updateHrPolicy(w.hr, { trainingEffectivenessDays: 0 });
    expect(await effectivenessDueList(w.sup)).toEqual([]);
  });
  it("shows, read-only, the assessments of the skill the course builds before and after the session, with 'not assessed' shown as such", async () => {
    const w = await world();
    await w.flag();
    const skill = await db.skill.create({ data: { organizationId: w.t.org.id, name: "First aid skill", courses: ["First aid"], createdBy: "t" } });
    const unrelated = await db.skill.create({ data: { organizationId: w.t.org.id, name: "Radio", courses: ["Radio course"], createdBy: "t" } });
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId); // the session was 121 days ago
    const at = (daysAgo: number, level: number, skillId = skill.id) =>
      db.skillAssessment.create({ data: { organizationId: w.t.org.id, employeeId: w.g[0].id, skillId, level, assessedOn: addDays(todayUtc(), -daysAgo), assessedByUserId: "u", assessedBy: "Assessor" } });
    await at(200, 2);
    await at(130, 3); // the latest before the session
    await at(60, 4);
    await at(10, 5); // the latest after
    await at(10, 5, unrelated.id);
    const before = await db.skillAssessment.count({ where: { organizationId: w.t.org.id } });
    const ev = await effectivenessEvidence(w.sup, a.enrolmentId);
    expect(ev.skills).toHaveLength(1);
    expect(ev.skills[0]).toMatchObject({ skillName: "First aid skill", before: { level: 3 }, after: { level: 5 } });
    expect(await db.skillAssessment.count({ where: { organizationId: w.t.org.id } })).toBe(before); // read only
    const b = await w.attend(w.g[1]);
    await w.makeDue(b.sessionId);
    expect((await effectivenessEvidence(w.sup, b.enrolmentId)).skills[0]).toMatchObject({ before: null, after: null });
  });
  it("is shown only to the person who may give the answer: another manager, the employee and finance get 'not found' or no right", async () => {
    const w = await world();
    await w.flag();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    await expect(effectivenessEvidence(w.sup2, a.enrolmentId)).rejects.toThrow(/not found/i);
    await expect(effectivenessEvidence(w.me, a.enrolmentId)).rejects.toThrow(/permission/i);
    await expect(effectivenessEvidence(w.finance, a.enrolmentId)).rejects.toThrow(/permission/i);
    await expect(effectivenessEvidence(w.hr, a.enrolmentId)).resolves.toBeTruthy();
  });
});

describe("what HR sees of the effectiveness answers", () => {
  async function answered(w: W, outcomes: Array<"CLEARLY_IMPROVED" | "SOMEWHAT_IMPROVED" | "NO_VISIBLE_CHANGE" | "NOT_YET_VISIBLE">) {
    await w.flag();
    for (let i = 0; i < outcomes.length; i++) {
      const a = await w.attend(w.g[i]);
      await w.makeDue(a.sessionId);
      await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: outcomes[i], comment: EVIDENCE });
    }
  }
  it("is nothing below five answers, and from five the spread per programme with 'not yet visible' counted apart", async () => {
    const w = await world();
    await answered(w, ["CLEARLY_IMPROVED", "SOMEWHAT_IMPROVED", "NO_VISIBLE_CHANGE", "NOT_YET_VISIBLE"]);
    expect((await programmeResults(w.hr)).find((p) => p.programmeId === w.prog.id)!.effectiveness).toEqual({ shown: false, count: null, counts: null, judged: null });
    const w2 = await world();
    await answered(w2, ["CLEARLY_IMPROVED", "SOMEWHAT_IMPROVED", "NO_VISIBLE_CHANGE", "NOT_YET_VISIBLE", "NOT_YET_VISIBLE"]);
    const r = (await programmeResults(w2.hr)).find((p) => p.programmeId === w2.prog.id)!;
    expect(r.evaluateEffectiveness).toBe(true);
    expect(r.effectiveness).toEqual({ shown: true, count: 5, counts: { CLEARLY_IMPROVED: 1, SOMEWHAT_IMPROVED: 1, NO_VISIBLE_CHANGE: 1, NOT_YET_VISIBLE: 2 }, judged: 3 });
  });
  it("never lists who was evaluated or what the manager wrote: no name, no id, no comment", async () => {
    const w = await world();
    await answered(w, ["CLEARLY_IMPROVED", "SOMEWHAT_IMPROVED", "NO_VISIBLE_CHANGE", "NOT_YET_VISIBLE", "NOT_YET_VISIBLE"]);
    const text = JSON.stringify(await programmeResults(w.hr));
    expect(text).not.toMatch(/SECRET|Stage(One|Two|Three|Four|Five)|Gbenga|Sade|Supervisor/);
    for (const g of w.g) expect(text).not.toContain(g.id);
    expect(text).not.toContain(w.sup.userId);
  });
});

describe("what the employee reads", () => {
  it("is the manager's effectiveness answer about them, with the comment and who gave it, and nobody else's", async () => {
    const w = await world();
    await w.flag();
    const a = await w.attend(w.g[0]);
    const b = await w.attend(w.g[1]);
    await w.makeDue(a.sessionId);
    await w.makeDue(b.sessionId);
    await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "CLEARLY_IMPROVED", comment: EVIDENCE });
    await evaluateEffectiveness(w.sup, b.enrolmentId, { outcome: "NO_VISIBLE_CHANGE" });
    const mine = await myEffectivenessEvaluations(w.me);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ programmeName: "First aid", outcome: "CLEARLY_IMPROVED", comment: EVIDENCE, byName: w.sup.name });
    expect(await myEffectivenessEvaluations(await w.asEmp(2))).toEqual([]);
    expect(await myEffectivenessEvaluations(w.hr)).toEqual([]); // a login with no employee record
  });
});

describe("the digest", () => {
  it("has a line for effectiveness evaluations the manager has not given, only when one is due for a marked programme, and not once it is given or when the company switches it off", async () => {
    const w = await world();
    const listed = async () => (await buildHrDigest(w.t.org.id)).sections.some((s) => s.key === "effectiveness-due");
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    expect(await listed(), "programme not marked").toBe(false);
    await w.flag();
    expect(await listed(), "marked and due").toBe(true);
    await updateHrPolicy(w.hr, { trainingEffectivenessDays: 0 });
    expect(await listed(), "switched off").toBe(false);
    await updateHrPolicy(w.hr, { trainingEffectivenessDays: 120 });
    await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "SOMEWHAT_IMPROVED" });
    expect(await listed(), "given").toBe(false);
    const section = (await buildHrDigest(w.t.org.id)).sections;
    expect(JSON.stringify(section)).not.toMatch(/SECRET/);
  });
});

describe("the employee's own copy of their data, and erasure", () => {
  it("includes their four ratings and the manager's effectiveness answer about them, never another person's", async () => {
    const w = await world();
    await w.flag();
    const a = await w.attend(w.g[0]);
    const b = await w.attend(w.g[1]);
    await w.makeDue(a.sessionId);
    await w.makeDue(b.sessionId);
    await evaluateAsParticipant(w.me, a.enrolmentId, { rating: 5, content: 4, facilitator: 3, delivery: 2, comment: COMMENT });
    await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "CLEARLY_IMPROVED", comment: EVIDENCE });
    await evaluateEffectiveness(w.sup, b.enrolmentId, { outcome: "NO_VISIBLE_CHANGE", comment: "SECRET-OTHER-PERSON" });
    const mine = (await compileEmployeeData(w.t.org.id, w.g[0].id)).sections;
    expect(JSON.stringify(mine.trainingEvaluations.records)).toMatch(/"content":4/);
    expect(JSON.stringify(mine.trainingEffectiveness.records)).toMatch(/SECRET-EFFECT-NOTE/);
    expect(JSON.stringify(mine)).not.toMatch(/SECRET-OTHER-PERSON/);
  });
  it("erasing an employee removes the comments (the ratings, the outcome, the shape and the audit log stay) and touches no one else's", async () => {
    const w = await world();
    await w.flag();
    const a = await w.attend(w.g[0]);
    const b = await w.attend(w.g[1]);
    for (const x of [a, b]) await w.makeDue(x.sessionId);
    await evaluateAsParticipant(w.me, a.enrolmentId, { rating: 5, content: 4, facilitator: 3, delivery: 2, comment: COMMENT });
    await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "CLEARLY_IMPROVED", comment: EVIDENCE });
    await evaluateEffectiveness(w.sup, b.enrolmentId, { outcome: "NO_VISIBLE_CHANGE", comment: EVIDENCE });
    const auditBefore = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.g[0].id, new Date()));
    expect(counts.trainingEffectiveness).toBe(1);
    const eff = await db.trainingEffectiveness.findUniqueOrThrow({ where: { enrolmentId: a.enrolmentId } });
    expect(eff).toMatchObject({ outcome: "CLEARLY_IMPROVED", comment: null });
    const part = await db.trainingEvaluation.findFirstOrThrow({ where: { enrolmentId: a.enrolmentId, kind: "PARTICIPANT" } });
    expect(part).toMatchObject({ rating: 5, contentRating: 4, facilitatorRating: 3, deliveryRating: 2, comment: null });
    expect((await db.trainingEffectiveness.findUniqueOrThrow({ where: { enrolmentId: b.enrolmentId } })).comment).toMatch(/SECRET-EFFECT-NOTE/);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBe(auditBefore);
  });
});

describe("the audit log and other companies", () => {
  it("carries ids, the stage and the outcome, never a comment", async () => {
    const w = await world();
    await w.flag();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    await evaluateAsParticipant(w.me, a.enrolmentId, { rating: 5, content: 4, facilitator: 3, delivery: 2, comment: COMMENT });
    await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "CLEARLY_IMPROVED", comment: EVIDENCE });
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { in: ["TRAINING_EVALUATE", "TRAINING_EFFECTIVENESS"] } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["TRAINING_EFFECTIVENESS", "TRAINING_EVALUATE"]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
    expect(JSON.stringify(rows.find((r) => r.action === "TRAINING_EFFECTIVENESS")!.newValue)).toMatch(/CLEARLY_IMPROVED/);
  });
  it("another company sees none of it and cannot evaluate anything", async () => {
    const w = await world();
    await w.flag();
    const a = await w.attend(w.g[0]);
    await w.makeDue(a.sessionId);
    await evaluateEffectiveness(w.sup, a.enrolmentId, { outcome: "SOMEWHAT_IMPROVED", comment: EVIDENCE });
    const o = await world();
    expect(await programmeResults(o.hr)).not.toContainEqual(expect.objectContaining({ programmeId: w.prog.id }));
    await expect(evaluateEffectiveness(o.sup, a.enrolmentId, { outcome: "CLEARLY_IMPROVED" })).rejects.toThrow(/not found/i);
    await expect(effectivenessEvidence(o.hr, a.enrolmentId)).rejects.toThrow(/not found/i);
    expect(await effectivenessDueList(o.hr)).toEqual([]);
    expect(await myEffectivenessEvaluations(o.me)).toEqual([]);
  });
});

// Found in the browser check: a company that has never had an HR policy row gets one on first read; the evaluations page reads the policy twice at the same moment (the application
// evaluation and the effectiveness one), and two simultaneous first reads raced to create it, so one failed with a unique-constraint error and the page returned a 500.
describe("the company's HR policy is created once, even when it is first read twice at the same moment", () => {
  it("never fails and never creates two", async () => {
    const t = await isolatedOrg();
    expect(await db.hrPolicy.count({ where: { organizationId: t.org.id } })).toBe(0);
    const reads = await Promise.all(Array.from({ length: 12 }, () => getHrPolicy(t.org.id)));
    expect(new Set(reads.map((p) => p.id)).size).toBe(1);
    expect(await db.hrPolicy.count({ where: { organizationId: t.org.id } })).toBe(1);
    expect(reads[0].trainingEffectivenessDays).toBe(120);
  });
  it("also works inside a transaction", async () => {
    const t = await isolatedOrg();
    const p = await db.$transaction(async (tx) => {
      const a = await getHrPolicy(t.org.id, tx);
      const b = await getHrPolicy(t.org.id, tx);
      return [a, b];
    });
    expect(p[0].id).toBe(p[1].id);
  });
  it("the evaluations page's reads together (the application list and the effectiveness list) work for a company with no policy yet", async () => {
    const w = await world();
    expect(await db.hrPolicy.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    const [a, b] = await Promise.all([effectivenessDueList(w.hr), effectivenessDueList(w.hr)]);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });
});
