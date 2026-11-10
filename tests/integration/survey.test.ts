import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { getHrPolicy, todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { buildHrDigest } from "@/server/services/reminders";
import { surveyCodeLimiter } from "@/lib/rate-limit";
import {
  addQuestion,
  closeSurvey,
  createSurvey,
  getSurvey,
  hideComment,
  listSurveys,
  mySurveys,
  openSurvey,
  publicSurvey,
  purgeExpired,
  reissueCode,
  removeQuestion,
  results,
  setFollowUp,
  startKioskSession,
  submitAsEmployee,
  submitWithCode,
  surveyFormFor,
} from "@/server/services/survey";
import { isolatedOrg, uid } from "../helpers";

// Engagement surveys (the founder's go of 2026-11-10; plan docs/plans/engagement-surveys-plan.md and its revision). Anonymous by design: an answer carries no person, no
// user, no time and a random id; who took part is kept only on the access-code row and no page lists it; nothing is shown below five answers.

const today = () => iso(todayUtc());
const COMMENT = "SECRET-SURVEY-COMMENT the night handover is rushed";

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@svy.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function world(guards = 6) {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN");
  const boss = await login(t, "COMPANY_ADMIN");
  const auditor = await login(t, "AUDITOR");
  const finance = await login(t, "FINANCE");
  const supEmp = await createEmployee(hr, { firstName: "Sade", lastName: "Supervisor", employmentDate: "2020-01-01", categoryId: t.officeId });
  const sup = await login(t, "SUPERVISOR", supEmp.id);
  const g: Awaited<ReturnType<typeof createEmployee>>[] = [];
  for (let i = 0; i < guards; i++) g.push(await createEmployee(hr, { firstName: "Gbenga", lastName: `Svy${i}`, employmentDate: "2023-01-05", categoryId: t.guardId }));
  const logins = new Map<number, Ctx>();
  const asEmp = async (i: number) => {
    if (!logins.has(i)) logins.set(i, await login(t, "EMPLOYEE", g[i].id));
    return logins.get(i)!;
  };
  /** A survey with two scale questions and one comment, in draft. */
  const draft = async (over: Record<string, unknown> = {}) => {
    const s = await createSurvey(hr, { title: "Working here, November", intro: "A few questions", opensOn: today(), closesOn: iso(addDays(todayUtc(), 14)), ...over } as never);
    const q1 = await addQuestion(hr, s.id, { kind: "SCALE", text: "I feel safe at my site" });
    const q2 = await addQuestion(hr, s.id, { kind: "SCALE", text: "My supervisor treats me fairly" });
    const q3 = await addQuestion(hr, s.id, { kind: "COMMENT", text: "What would you change?" });
    return { s, q1, q2, q3 };
  };
  /** The answers of one person: a rating on each scale question and a comment. */
  const answersOf = (qs: { q1: { id: string }; q2: { id: string }; q3: { id: string } }, v1: number, v2: number, comment?: string) => [
    { questionId: qs.q1.id, value: v1 },
    { questionId: qs.q2.id, value: v2 },
    ...(comment ? [{ questionId: qs.q3.id, comment }] : []),
  ];
  return { t, hr, boss, auditor, finance, sup, supEmp, g, asEmp, draft, answersOf };
}
type W = Awaited<ReturnType<typeof world>>;
/** Opens a survey and returns the sheet of codes (plaintext, shown once). */
const open = async (w: W, id: string) => (await openSurvey(w.hr, id)).sheet;
const codeOf = (sheet: Array<{ employeeNumber: string; code: string }>, number: string) => sheet.find((s) => s.employeeNumber === number)!.code;

describe("who runs a survey", () => {
  it("is the HR administrator alone: the administrators, the auditor, finance, a manager and an employee are refused", async () => {
    const w = await world(1);
    for (const ctx of [w.boss, w.auditor, w.finance, w.sup, await w.asEmp(0)]) await expect(createSurvey(ctx, { title: "A survey", opensOn: today(), closesOn: today() } as never), ctx.role).rejects.toThrow(/permission/);
    expect(await createSurvey(w.hr, { title: "A survey", opensOn: today(), closesOn: today() } as never)).toMatchObject({ status: "DRAFT" });
  });
  it("is built in draft: a statement or a comment, at most fifteen questions, none blank, and no change once it is open", async () => {
    const w = await world(1);
    const s = await createSurvey(w.hr, { title: "A survey", opensOn: today(), closesOn: today() } as never);
    await expect(addQuestion(w.hr, s.id, { kind: "SCALE", text: "ab" })).rejects.toThrow();
    for (let i = 0; i < 15; i++) await addQuestion(w.hr, s.id, { kind: "SCALE", text: `Statement number ${i}` });
    await expect(addQuestion(w.hr, s.id, { kind: "SCALE", text: "One too many" })).rejects.toThrow(/at most 15/i);
    const q = await db.surveyQuestion.findFirstOrThrow({ where: { surveyId: s.id } });
    await removeQuestion(w.hr, q.id);
    await openSurvey(w.hr, s.id);
    await expect(addQuestion(w.hr, s.id, { kind: "SCALE", text: "Too late now" })).rejects.toThrow(/draft/i);
  });
  it("cannot end before it starts, and a survey without a question cannot be opened or opened twice", async () => {
    const w = await world(1);
    await expect(createSurvey(w.hr, { title: "A survey", opensOn: today(), closesOn: iso(addDays(todayUtc(), -1)) } as never)).rejects.toThrow(/before/i);
    const empty = await createSurvey(w.hr, { title: "No questions", opensOn: today(), closesOn: today() } as never);
    await expect(openSurvey(w.hr, empty.id)).rejects.toThrow(/question/i);
    const { s } = await w.draft();
    await openSurvey(w.hr, s.id);
    await expect(openSurvey(w.hr, s.id)).rejects.toThrow(/already/i);
  });
});

describe("opening a survey", () => {
  it("gives every invited employee one code, shown once, and stores only a hash", async () => {
    const w = await world(3);
    const { s } = await w.draft();
    const { sheet, survey } = await openSurvey(w.hr, s.id);
    expect(survey.invitedCount).toBe(4); // three guards and the supervisor
    expect(sheet).toHaveLength(4);
    expect(new Set(sheet.map((x) => x.code)).size).toBe(4);
    const rows = await db.surveyAccessCode.findMany({ where: { surveyId: s.id } });
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(sheet[0].code.replace(/-/g, ""));
    expect(JSON.stringify(rows)).not.toContain(sheet[0].code);
  });
  it("invites everyone, one role or one department, and never an employee who has left", async () => {
    const w = await world(3);
    await db.employee.update({ where: { id: w.g[2].id }, data: { status: "EXITED" } });
    const all = await w.draft();
    expect((await openSurvey(w.hr, all.s.id)).sheet).toHaveLength(3);
    const guards = await w.draft({ categoryId: w.t.guardId });
    expect((await openSurvey(w.hr, guards.s.id)).sheet.map((x) => x.employeeNumber).sort()).toEqual([w.g[0].employeeNumber, w.g[1].employeeNumber].sort());
    const o = await isolatedOrg();
    await expect(createSurvey(w.hr, { title: "Another", categoryId: o.guardId, opensOn: today(), closesOn: today() } as never)).rejects.toThrow(/not found/i);
  });
});

describe("taking a survey as an employee with a login", () => {
  it("is done once, by an invited person, and an answer carries no person, no user and no time", async () => {
    const w = await world(3);
    const qs = await w.draft();
    await open(w, qs.s.id);
    const me = await w.asEmp(0);
    expect((await mySurveys(me)).open.map((x) => x.id)).toEqual([qs.s.id]);
    expect((await surveyFormFor(me, qs.s.id)).questions).toHaveLength(3);
    await submitAsEmployee(me, qs.s.id, w.answersOf(qs, 4, 5, COMMENT));
    expect((await mySurveys(me)).open).toEqual([]);
    await expect(submitAsEmployee(me, qs.s.id, w.answersOf(qs, 1, 1))).rejects.toThrow(/already/i);
    const responses = await db.surveyResponse.findMany({ where: { surveyId: qs.s.id } });
    expect(responses).toHaveLength(1);
    expect(Object.keys(responses[0]).sort()).toEqual(["categoryId", "departmentId", "id", "surveyId"]);
    expect(responses[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const answers = await db.surveyAnswer.findMany({ where: { responseId: responses[0].id } });
    expect(answers).toHaveLength(3);
    for (const a of answers) expect(Object.keys(a).sort()).toEqual(["comment", "hidden", "hiddenReason", "id", "questionId", "responseId", "value"]);
    expect(JSON.stringify([responses, answers])).not.toMatch(new RegExp(me.userId));
    expect(JSON.stringify([responses, answers])).not.toMatch(new RegExp(w.g[0].id));
  });
  it("is refused for someone not invited, a draft, an empty submission, a rating out of range and a question of another survey", async () => {
    const w = await world(3);
    const qs = await w.draft({ categoryId: w.t.guardId });
    await expect(surveyFormFor(await w.asEmp(0), qs.s.id), "draft").rejects.toThrow(/not found|not open/i);
    await open(w, qs.s.id);
    await expect(submitAsEmployee(w.sup as Ctx, qs.s.id, w.answersOf(qs, 3, 3)), "the supervisor is not a guard, and has an employee record").rejects.toThrow(/not found|invited/i);
    const me = await w.asEmp(0);
    await expect(submitAsEmployee(me, qs.s.id, [])).rejects.toThrow(/answer at least/i);
    await expect(submitAsEmployee(me, qs.s.id, [{ questionId: qs.q1.id, value: 6 }])).rejects.toThrow();
    const other = await w.draft();
    await expect(submitAsEmployee(me, qs.s.id, [{ questionId: other.q1.id, value: 3 }])).rejects.toThrow(/question/i);
    expect((await mySurveys(me)).open).toHaveLength(1); // none of the refused tries used the code
  });
  it("is refused after the closing day and once closed, and a person without an employee record sees nothing", async () => {
    const w = await world(2);
    const qs = await w.draft();
    await open(w, qs.s.id);
    await db.survey.update({ where: { id: qs.s.id }, data: { closesOn: addDays(todayUtc(), -1) } });
    await expect(submitAsEmployee(await w.asEmp(0), qs.s.id, w.answersOf(qs, 3, 3))).rejects.toThrow(/closed|not open/i);
    expect((await mySurveys(await login(w.t, "EMPLOYEE"))).open).toEqual([]);
  });
});

describe("taking a survey with an access code (a phone, a shared device or an assisted session)", () => {
  it("works once per code, and a wrong, used, cancelled or other survey's code all get the same answer", async () => {
    const w = await world(3);
    const qs = await w.draft();
    const sheet = await open(w, qs.s.id);
    surveyCodeLimiter.reset();
    expect((await publicSurvey(qs.s.id))!.questions).toHaveLength(3);
    const code = codeOf(sheet, w.g[0].employeeNumber);
    expect((await submitWithCode(qs.s.id, code.toLowerCase(), w.answersOf(qs, 3, 4), "ip-1")).status).toBe("ok");
    const used = await submitWithCode(qs.s.id, code, w.answersOf(qs, 3, 4), "ip-1");
    const wrong = await submitWithCode(qs.s.id, "AAAA-BBBB-CCCC", w.answersOf(qs, 3, 4), "ip-1");
    const otherSurvey = await w.draft();
    await open(w, otherSurvey.s.id);
    const cross = await submitWithCode(otherSurvey.s.id, code, w.answersOf(otherSurvey, 3, 4), "ip-1");
    for (const r of [used, wrong, cross]) expect(r).toEqual({ status: "invalid" });
    expect(await db.surveyResponse.count({ where: { surveyId: qs.s.id } })).toBe(1);
  });
  it("slows down a person who keeps guessing", async () => {
    const w = await world(1);
    const qs = await w.draft();
    await open(w, qs.s.id);
    surveyCodeLimiter.reset();
    surveyCodeLimiter.limit = 3;
    try {
      for (let i = 0; i < 3; i++) expect((await submitWithCode(qs.s.id, "AAAA-BBBB-CCCC", w.answersOf(qs, 3, 3), "ip-guesser")).status).toBe("invalid");
      expect((await submitWithCode(qs.s.id, "AAAA-BBBB-CCCC", w.answersOf(qs, 3, 3), "ip-guesser")).status).toBe("slow");
    } finally {
      surveyCodeLimiter.limit = 30;
      surveyCodeLimiter.reset();
    }
  });
  it("is not offered for a survey that is not open", async () => {
    const w = await world(1);
    const qs = await w.draft();
    expect(await publicSurvey(qs.s.id)).toBeNull();
    const sheet = await open(w, qs.s.id);
    await closeSurvey(w.hr, qs.s.id);
    expect(await publicSurvey(qs.s.id)).toBeNull();
    expect(await submitWithCode(qs.s.id, sheet[0].code, w.answersOf(qs, 3, 3), "ip-2")).toEqual({ status: "invalid" });
  });
  it("can be reissued when lost: the old code stops working, and HR cannot tell from the answer whether the person had already taken part", async () => {
    const w = await world(2);
    const qs = await w.draft();
    const sheet = await open(w, qs.s.id);
    surveyCodeLimiter.reset();
    const lost = codeOf(sheet, w.g[0].employeeNumber);
    const fresh = await reissueCode(w.hr, qs.s.id, w.g[0].id);
    expect(fresh.code).not.toBe(lost);
    expect(await submitWithCode(qs.s.id, lost, w.answersOf(qs, 3, 3), "ip-3")).toEqual({ status: "invalid" });
    expect((await submitWithCode(qs.s.id, fresh.code, w.answersOf(qs, 3, 3), "ip-3")).status).toBe("ok");
    // the second person took part by login; asking for a new code for them still returns a code, which does not work
    await submitAsEmployee(await w.asEmp(1), qs.s.id, w.answersOf(qs, 4, 4));
    const spare = await reissueCode(w.hr, qs.s.id, w.g[1].id);
    expect(spare.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(await submitWithCode(qs.s.id, spare.code, w.answersOf(qs, 1, 1), "ip-3")).toEqual({ status: "invalid" });
    expect(await db.surveyResponse.count({ where: { surveyId: qs.s.id } })).toBe(2);
    for (const ctx of [w.sup, w.boss, w.auditor]) await expect(reissueCode(ctx, qs.s.id, w.g[0].id), ctx.role).rejects.toThrow(/permission/);
  });
});

describe("who took part is never shown", () => {
  it("HR sees counts only: no page of results, of the survey or of the list carries a name, an employee id or a code", async () => {
    const w = await world(3);
    const qs = await w.draft();
    const sheet = await open(w, qs.s.id);
    await submitAsEmployee(await w.asEmp(0), qs.s.id, w.answersOf(qs, 4, 4));
    const list = JSON.stringify(await listSurveys(w.hr));
    const detail = JSON.stringify(await getSurvey(w.hr, qs.s.id));
    for (const text of [list, detail]) {
      expect(text).not.toMatch(/Svy\d|Sade|employeeNumber|employeeId/);
      for (const g of w.g) expect(text).not.toContain(g.id);
      for (const s of sheet) expect(text).not.toContain(s.code);
    }
    expect((await getSurvey(w.hr, qs.s.id)).participation).toMatchObject({ invited: 4, took: 1 });
    await closeSurvey(w.hr, qs.s.id);
    expect(JSON.stringify(await results(w.hr, qs.s.id))).not.toMatch(/Svy\d|employeeId/);
  });
  it("does not let anyone but HR read the survey or its counts, though the auditor reads results like other HR records", async () => {
    const w = await world(1);
    const qs = await w.draft();
    await open(w, qs.s.id);
    for (const ctx of [w.sup, await w.asEmp(0)]) await expect(getSurvey(ctx, qs.s.id), ctx.role).rejects.toThrow(/permission/);
    expect((await listSurveys(w.auditor)).length).toBe(1);
  });
});

describe("the results", () => {
  it("are refused while the survey is open, and never shown below five answers", async () => {
    const w = await world(6);
    const qs = await w.draft();
    await open(w, qs.s.id);
    await expect(results(w.hr, qs.s.id)).rejects.toThrow(/closes/i);
    for (const i of [0, 1, 2, 3]) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 5, 5, COMMENT));
    await closeSurvey(w.hr, qs.s.id);
    const r = await results(w.hr, qs.s.id);
    expect(r.responses).toBeNull();
    expect(r.questions[0].summary).toEqual({ shown: false, count: null, average: null, distribution: null });
    expect(r.questions[2].comments).toBeNull();
    expect(JSON.stringify(r)).not.toContain("SECRET-SURVEY-COMMENT");
    expect(r.participation).toMatchObject({ invited: 7, took: 4 });
  });
  it("show the distribution and average from five answers, and the comments unnamed, unlabelled and in alphabetical order", async () => {
    const w = await world(6);
    const qs = await w.draft();
    await open(w, qs.s.id);
    const ratings = [5, 4, 4, 4, 4];
    for (const [i, v] of ratings.entries()) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, v, 3, `${i % 2 ? "B" : "A"}-${COMMENT}`));
    await closeSurvey(w.hr, qs.s.id);
    const r = await results(w.hr, qs.s.id);
    expect(r.responses).toBe(5);
    expect(r.questions[0].summary).toEqual({ shown: true, count: 5, average: 4.2, distribution: { 1: 0, 2: 0, 3: 0, 4: 4, 5: 1 } });
    const texts = r.questions[2].comments!.map((c) => c.text);
    expect(texts).toEqual([...texts].sort((a, b) => a.localeCompare(b)));
    expect(texts).toHaveLength(5);
    expect(JSON.stringify(r.questions[2])).not.toMatch(/categoryId|departmentId|Svy|role/);
    for (const ctx of [w.sup, await w.asEmp(0)]) await expect(results(ctx, qs.s.id), ctx.role).rejects.toThrow(/permission/);
    expect((await results(w.auditor, qs.s.id)).responses).toBe(5);
  });
  it("hide a comment HR chooses to hide, with a recorded reason, and no one is told which comment it was", async () => {
    const w = await world(6);
    const qs = await w.draft();
    await open(w, qs.s.id);
    for (const i of [0, 1, 2, 3, 4]) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 4, 4, i === 0 ? "SECRET-NAMES-A-PERSON Sade is unfair" : COMMENT));
    await closeSurvey(w.hr, qs.s.id);
    const before = await results(w.hr, qs.s.id);
    const bad = before.questions[2].comments!.find((c) => c.text.startsWith("SECRET-NAMES"))!;
    await expect(hideComment(w.hr, bad.id, "no")).rejects.toThrow();
    await hideComment(w.hr, bad.id, "It names a person");
    const after = await results(w.hr, qs.s.id);
    expect(JSON.stringify(after)).not.toContain("SECRET-NAMES");
    expect(after.questions[2].comments).toHaveLength(4);
    await expect(hideComment(w.sup, bad.id, "It names a person")).rejects.toThrow(/permission/);
  });
  it("let a small group take part, but never show it on its own: here the guards and the supervisor are each under ten invited", async () => {
    const w = await world(6);
    const qs = await w.draft();
    await open(w, qs.s.id);
    for (const i of [0, 1, 2, 3, 4]) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 4, 4));
    await submitAsEmployee(w.sup, qs.s.id, w.answersOf(qs, 4, 4));
    await closeSurvey(w.hr, qs.s.id);
    const r = await results(w.hr, qs.s.id);
    expect(r.responses).toBe(6);
    expect(r.questions[0].byRole!.shown).toEqual([]);
    expect(r.questions[0].byRole!.other).toMatchObject({ shown: false });
    expect(JSON.stringify(r.questions[0].byRole)).not.toMatch(/Guard|Office/);
  });
  it("show a group of ten or more with five answers, and hide a second group so the first cannot be found by subtraction", async () => {
    const w = await world(12);
    const qs = await w.draft();
    await open(w, qs.s.id);
    for (let i = 0; i < 12; i++) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 4, 4));
    await submitAsEmployee(w.sup, qs.s.id, w.answersOf(qs, 2, 2));
    await closeSurvey(w.hr, qs.s.id);
    const r = await results(w.hr, qs.s.id);
    // twelve guards qualify; the supervisor alone (one invited) does not and is the only hidden group, so the smallest shown group is hidden too
    expect(r.questions[0].byRole!.shown).toEqual([]);
    expect(r.questions[0].byRole!.other).toMatchObject({ shown: true });
    expect(r.questions[0].summary).toMatchObject({ shown: true, count: 13 });
  });
});

describe("the follow-up note", () => {
  it("is written by HR once the survey has closed, and is read by the invited employees only", async () => {
    const w = await world(2);
    const qs = await w.draft({ categoryId: w.t.guardId });
    await open(w, qs.s.id);
    await expect(setFollowUp(w.hr, qs.s.id, "We are changing the night handover")).rejects.toThrow(/closed/i);
    await closeSurvey(w.hr, qs.s.id);
    await setFollowUp(w.hr, qs.s.id, "We are changing the night handover");
    expect((await mySurveys(await w.asEmp(0))).closed).toEqual([expect.objectContaining({ id: qs.s.id, followUp: "We are changing the night handover" })]);
    expect((await mySurveys(w.sup)).closed).toEqual([]); // the supervisor was not invited
    await expect(setFollowUp(w.sup, qs.s.id, "Not mine to write")).rejects.toThrow(/permission/);
  });
});

describe("an assisted session", () => {
  it("is run by someone with the assist right, is recorded without who took part, and never by a manager", async () => {
    const w = await world(1);
    const qs = await w.draft();
    await open(w, qs.s.id);
    const s = await startKioskSession(w.hr, qs.s.id, "Tablet, Ikeja gate");
    expect(s.path).toBe(`/survey/${qs.s.id}`);
    const rows = await db.surveyKioskSession.findMany({ where: { surveyId: qs.s.id } });
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["createdAt", "day", "deviceLabel", "id", "organizationId", "startedByUserId", "surveyId"]);
    for (const ctx of [w.sup, w.boss, w.auditor, await w.asEmp(0)]) await expect(startKioskSession(ctx, qs.s.id, "A device"), ctx.role).rejects.toThrow(/permission/);
  });
});

describe("keeping the answers for a limited time", () => {
  it("deletes the raw answers and the codes 24 months after the survey closed, keeps the anonymised result and records the deletion", async () => {
    const w = await world(6);
    expect((await getHrPolicy(w.t.org.id)).surveyRetentionMonths).toBe(24);
    const qs = await w.draft();
    await open(w, qs.s.id);
    for (const i of [0, 1, 2, 3, 4]) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 4, 5, COMMENT));
    await closeSurvey(w.hr, qs.s.id);
    expect(await purgeExpired(w.hr)).toEqual({ surveys: 0, responses: 0 });
    const before = await results(w.hr, qs.s.id);
    await db.survey.update({ where: { id: qs.s.id }, data: { closedAt: addDays(todayUtc(), -800) } });
    expect(await purgeExpired(w.hr)).toEqual({ surveys: 1, responses: 5 });
    expect(await db.surveyResponse.count({ where: { surveyId: qs.s.id } })).toBe(0);
    expect(await db.surveyAnswer.count({ where: { question: { surveyId: qs.s.id } } })).toBe(0);
    expect(await db.surveyAccessCode.count({ where: { surveyId: qs.s.id } })).toBe(0);
    const after = await results(w.hr, qs.s.id);
    expect(after.purged).toBe(true);
    expect(after.questions[0].summary).toEqual(before.questions[0].summary);
    expect(JSON.stringify(after)).not.toContain("SECRET-SURVEY-COMMENT");
    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SURVEY_RETENTION_RUN" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/SECRET/);
    expect(await purgeExpired(w.hr)).toEqual({ surveys: 0, responses: 0 });
    await expect(purgeExpired(w.sup)).rejects.toThrow(/permission/);
  });
  it("deletes nothing when the company sets 0 months", async () => {
    const w = await world(1);
    const qs = await w.draft();
    await open(w, qs.s.id);
    await closeSurvey(w.hr, qs.s.id);
    await db.survey.update({ where: { id: qs.s.id }, data: { closedAt: addDays(todayUtc(), -3000) } });
    await updateHrPolicy(w.hr, { surveyRetentionMonths: 0 });
    expect(await purgeExpired(w.hr)).toEqual({ surveys: 0, responses: 0 });
  });
});

describe("the employee's own data and the audit log", () => {
  it("puts in their copy only the surveys they took part in and the day: never an answer", async () => {
    const w = await world(2);
    const qs = await w.draft();
    await open(w, qs.s.id);
    await submitAsEmployee(await w.asEmp(0), qs.s.id, w.answersOf(qs, 4, 4, COMMENT));
    const mine = (await compileEmployeeData(w.t.org.id, w.g[0].id)).sections.surveys.records;
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).toContain("Working here, November");
    expect(JSON.stringify(mine)).not.toMatch(/SECRET|rating|value/);
    expect((await compileEmployeeData(w.t.org.id, w.g[1].id)).sections.surveys.records).toEqual([]);
  });
  it("records every step by ids and counts, never a code, an answer or a comment", async () => {
    const w = await world(2);
    const qs = await w.draft();
    const sheet = await open(w, qs.s.id);
    surveyCodeLimiter.reset();
    await submitWithCode(qs.s.id, codeOf(sheet, w.g[0].employeeNumber), w.answersOf(qs, 4, 4, COMMENT), "ip-4");
    await submitAsEmployee(await w.asEmp(1), qs.s.id, w.answersOf(qs, 4, 4, COMMENT));
    await closeSurvey(w.hr, qs.s.id);
    await reissueCode(w.hr, qs.s.id, w.g[0].id).catch(() => null);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SURVEY_" } } });
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["SURVEY_CREATE", "SURVEY_OPEN", "SURVEY_CLOSE"]));
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/SECRET/);
    for (const s of sheet) expect(text).not.toContain(s.code);
    // nothing in the audit log says that a given person submitted an answer
    expect(rows.map((r) => r.action)).not.toContain("SURVEY_SUBMIT");
  });
});

describe("the HR digest", () => {
  it("lists a survey while it is open, with the counts, and not afterwards", async () => {
    const w = await world(2);
    const qs = await w.draft();
    await open(w, qs.s.id);
    const listed = async () => (await buildHrDigest(w.t.org.id)).sections.find((x) => x.key === "surveys-open");
    expect(await listed()).toBeDefined();
    expect(JSON.stringify(await listed())).not.toMatch(/Svy/);
    await closeSurvey(w.hr, qs.s.id);
    expect(await listed()).toBeUndefined();
  });
});

describe("tenant isolation", () => {
  it("another company sees none of it and cannot answer, close or read anything", async () => {
    const w = await world(2);
    const qs = await w.draft();
    const sheet = await open(w, qs.s.id);
    surveyCodeLimiter.reset();
    const o = await world(1);
    expect(await listSurveys(o.hr)).toEqual([]);
    await expect(getSurvey(o.hr, qs.s.id)).rejects.toThrow(/not found/i);
    await expect(closeSurvey(o.hr, qs.s.id)).rejects.toThrow(/not found/i);
    await expect(submitAsEmployee(await o.asEmp(0), qs.s.id, w.answersOf(qs, 3, 3))).rejects.toThrow(/not found|invited/i);
    // a code is only valid for the survey it was issued for, whoever types it
    expect((await submitWithCode(qs.s.id, sheet[0].code, w.answersOf(qs, 3, 3), "ip-5")).status).toBe("ok");
  });
});
