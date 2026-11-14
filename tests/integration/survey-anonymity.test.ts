import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { todayUtc } from "@/server/services/hr-policy";
import { surveyCodeLimiter } from "@/lib/rate-limit";
import { addQuestion, closeSurvey, createSurvey, getSurvey, hideComment, listSurveys, openSurvey, purgeExpired, results, submitAsEmployee, submitWithCode } from "@/server/services/survey";
import { isolatedOrg, uid } from "../helpers";

// Survey anonymity: a regression suite for the founder's direction of 2026-11-14 ("no identification by HR, managers or others through the application: aggregates, a minimum of five,
// and no leak through comments, metadata or small groups"). It pins what the application stores and what every screen's data can say, so a later change cannot quietly weaken it.
// It adds no behaviour. What it cannot prove (a person with direct database access) is written up in docs/plans/survey-anonymity-review.md, not claimed here.

const today = () => iso(todayUtc());
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@anon.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function world(guards: number) {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN");
  const auditor = await login(t, "AUDITOR");
  const g: Awaited<ReturnType<typeof createEmployee>>[] = [];
  for (let i = 0; i < guards; i++) g.push(await createEmployee(hr, { firstName: "Tunde", lastName: `Anon${i}`, employmentDate: "2023-01-05", categoryId: t.guardId }));
  const logins = new Map<number, Ctx>();
  const asEmp = async (i: number) => {
    if (!logins.has(i)) logins.set(i, await login(t, "EMPLOYEE", g[i].id));
    return logins.get(i)!;
  };
  const draft = async () => {
    const s = await createSurvey(hr, { title: "Anonymity check", opensOn: today(), closesOn: iso(addDays(todayUtc(), 14)) } as never);
    const q1 = await addQuestion(hr, s.id, { kind: "SCALE", text: "I feel safe at my site" });
    const q2 = await addQuestion(hr, s.id, { kind: "SCALE", text: "My supervisor treats me fairly" });
    const q3 = await addQuestion(hr, s.id, { kind: "COMMENT", text: "What would you change?" });
    return { s, q1, q2, q3 };
  };
  const answersOf = (qs: { q1: { id: string }; q2: { id: string }; q3: { id: string } }, v1: number, v2: number, comment?: string) => [
    { questionId: qs.q1.id, value: v1 },
    { questionId: qs.q2.id, value: v2 },
    ...(comment ? [{ questionId: qs.q3.id, comment }] : []),
  ];
  return { t, hr, auditor, g, asEmp, draft, answersOf };
}

const columnsOf = async (table: string) => (await db.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name::text AS column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY column_name`, table)).map((r) => r.column_name);

describe("what is stored for an answer", () => {
  it("has exactly these columns: nothing that names a person or a user, and no time", async () => {
    // A new column on either table would be a decision about anonymity, so it fails here until someone reads this test and decides on purpose.
    expect(await columnsOf("SurveyResponse")).toEqual(["categoryId", "departmentId", "id", "surveyId"]);
    expect(await columnsOf("SurveyAnswer")).toEqual(["comment", "hidden", "hiddenReason", "id", "questionId", "responseId", "value"]);
  });
  it("is not linked from the row that records who took part: the access code row has no response and no answer", async () => {
    const cols = await columnsOf("SurveyAccessCode");
    expect(cols.filter((c) => /response|answer/i.test(c))).toEqual([]);
    // the only time on it is a day (a date column), not a moment
    const [{ data_type }] = await db.$queryRawUnsafe<Array<{ data_type: string }>>(`SELECT data_type::text AS data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'SurveyAccessCode' AND column_name = 'usedOn'`);
    expect(data_type).toBe("date");
  });
  it("gives every response and answer a random identifier, not one that follows the order of submission", async () => {
    const w = await world(8);
    const qs = await w.draft();
    await openSurvey(w.hr, qs.s.id);
    for (let i = 0; i < 8; i++) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 3, 3, `comment ${i}`));
    const responses = await db.surveyResponse.findMany({ where: { surveyId: qs.s.id } });
    const answers = await db.surveyAnswer.findMany({ where: { responseId: { in: responses.map((r) => r.id) } } });
    expect(responses).toHaveLength(8);
    for (const r of responses) expect(r.id).toMatch(UUID_V4);
    for (const a of answers) expect(a.id).toMatch(UUID_V4);
  });
  it("is written the same way whichever door the person used: a login or an access code leave rows with the same shape", async () => {
    const w = await world(2);
    const qs = await w.draft();
    const { sheet } = await openSurvey(w.hr, qs.s.id);
    surveyCodeLimiter.reset();
    await submitAsEmployee(await w.asEmp(0), qs.s.id, w.answersOf(qs, 4, 4, "by login"));
    const code = sheet.find((s) => s.employeeNumber === w.g[1].employeeNumber)!.code;
    await submitWithCode(qs.s.id, code, w.answersOf(qs, 4, 4, "by code"), "ip-anon-1");
    const responses = await db.surveyResponse.findMany({ where: { surveyId: qs.s.id } });
    expect(responses).toHaveLength(2);
    expect(Object.keys(responses[0]).sort()).toEqual(Object.keys(responses[1]).sort());
    expect(JSON.stringify(responses)).not.toMatch(/ip-anon|userId/);
  });
});

describe("what nobody can read from a submission being made", () => {
  it("writes nothing to the audit log, so the log cannot say who answered or when", async () => {
    const w = await world(2);
    const qs = await w.draft();
    const { sheet } = await openSurvey(w.hr, qs.s.id);
    surveyCodeLimiter.reset();
    const before = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    await submitAsEmployee(await w.asEmp(0), qs.s.id, w.answersOf(qs, 5, 5, "audit probe comment"));
    await submitWithCode(qs.s.id, sheet.find((s) => s.employeeNumber === w.g[1].employeeNumber)!.code, w.answersOf(qs, 5, 5), "ip-anon-2");
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBe(before);
  });
  it("is not in the employee's own copy of their data except as the survey and the day they took part", async () => {
    const w = await world(1);
    const qs = await w.draft();
    await openSurvey(w.hr, qs.s.id);
    await submitAsEmployee(await w.asEmp(0), qs.s.id, w.answersOf(qs, 2, 1, "private words"));
    const text = JSON.stringify((await compileEmployeeData(w.t.org.id, w.g[0].id)).sections.surveys);
    expect(text).not.toContain("private words");
    expect(text).not.toMatch(/"value"|rating|answer/i);
  });
});

describe("what HR and the auditor can read", () => {
  it("never carries a name, an employee number, an employee id, a user id or a code, on any page of data, before or after the survey closes", async () => {
    const w = await world(12);
    const qs = await w.draft();
    const { sheet } = await openSurvey(w.hr, qs.s.id);
    for (let i = 0; i < 12; i++) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, (i % 5) + 1, 3, `words number ${i}`));
    const forbid = [...w.g.flatMap((e) => [e.id, e.employeeNumber, e.lastName]), ...sheet.map((s) => s.code), ...(await Promise.all(w.g.map(async (_, i) => (await w.asEmp(i)).userId)))];
    const open = JSON.stringify([await listSurveys(w.hr), await getSurvey(w.hr, qs.s.id), await listSurveys(w.auditor)]);
    await closeSurvey(w.hr, qs.s.id);
    const closed = JSON.stringify([await results(w.hr, qs.s.id), await results(w.auditor, qs.s.id), await getSurvey(w.hr, qs.s.id)]);
    for (const text of [open, closed]) for (const f of forbid) expect(text, `leaked ${f}`).not.toContain(f);
  });
  it("says nothing about the answers while the survey is open, only how many people took part", async () => {
    const w = await world(3);
    const qs = await w.draft();
    await openSurvey(w.hr, qs.s.id);
    await submitAsEmployee(await w.asEmp(0), qs.s.id, w.answersOf(qs, 1, 1, "open-time words"));
    await expect(results(w.hr, qs.s.id)).rejects.toThrow(/once the survey closes/i);
    const detail = JSON.stringify(await getSurvey(w.hr, qs.s.id));
    expect(detail).not.toContain("open-time words");
    expect((await getSurvey(w.hr, qs.s.id)).participation).toMatchObject({ invited: 3, took: 1 });
  });
  it("shows no figure, no count and no comment while fewer than five people answered, even to the one who wants to see a single answer", async () => {
    const w = await world(5);
    const qs = await w.draft();
    await openSurvey(w.hr, qs.s.id);
    for (const i of [0, 1, 2, 3]) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 1, 5, `four people ${i}`));
    await closeSurvey(w.hr, qs.s.id);
    for (const ctx of [w.hr, w.auditor]) {
      const r = await results(ctx, qs.s.id);
      expect(r.responses).toBeNull();
      expect(r.questions[0].summary).toEqual({ shown: false, count: null, average: null, distribution: null });
      expect(r.questions[0].byRole).toBeNull();
      expect(r.questions[0].byDepartment).toBeNull();
      expect(r.questions[2].comments).toBeNull();
      expect(JSON.stringify(r)).not.toMatch(/four people/);
    }
  });
  it("shows comments from five answers with no link to a role, a department, a rating or an order of submission", async () => {
    const w = await world(6);
    const qs = await w.draft();
    await openSurvey(w.hr, qs.s.id);
    // submitted in the reverse of alphabetical order, with ratings that would give the person away if the comment carried them
    const words = ["E last", "D fourth", "C third", "B second", "A first"];
    for (const [i, text] of words.entries()) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, i + 1, 1, text));
    await closeSurvey(w.hr, qs.s.id);
    const r = await results(w.hr, qs.s.id);
    expect(r.questions[2].comments!.map((c) => c.text)).toEqual(["A first", "B second", "C third", "D fourth", "E last"]);
    for (const c of r.questions[2].comments!) expect(Object.keys(c).sort()).toEqual(["id", "text"]);
  });
  it("keeps a comment that HR hid out of the result for everyone, and out of the kept anonymised result after the answers are deleted", async () => {
    const w = await world(6);
    const qs = await w.draft();
    await openSurvey(w.hr, qs.s.id);
    for (const i of [0, 1, 2, 3, 4]) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 4, 4, i === 0 ? "NAMES-A-COLLEAGUE here" : `fine ${i}`));
    await closeSurvey(w.hr, qs.s.id);
    const bad = (await results(w.hr, qs.s.id)).questions[2].comments!.find((c) => c.text.startsWith("NAMES"))!;
    await hideComment(w.hr, bad.id, "It names a person");
    expect(JSON.stringify(await results(w.auditor, qs.s.id))).not.toContain("NAMES-A-COLLEAGUE");
    // the hidden comment's own record keeps the reason, never shown in the results
    expect(JSON.stringify(await results(w.hr, qs.s.id))).not.toContain("It names a person");
    await db.survey.update({ where: { id: qs.s.id }, data: { closedAt: addDays(todayUtc(), -800) } });
    await purgeExpired(w.hr);
    const kept = JSON.stringify(await results(w.hr, qs.s.id));
    expect(kept).not.toMatch(/NAMES-A-COLLEAGUE|fine \d/);
    expect(await db.surveyAnswer.count({ where: { question: { surveyId: qs.s.id } } })).toBe(0);
  });
});

describe("what a small group can and cannot reveal", () => {
  it("shows no group of fewer than ten invited, however many of them answered, and no rating from a group of fewer than five answers", async () => {
    const w = await world(9);
    const qs = await w.draft();
    await openSurvey(w.hr, qs.s.id);
    for (let i = 0; i < 9; i++) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, i < 4 ? 1 : 5, 3));
    await closeSurvey(w.hr, qs.s.id);
    const r = await results(w.hr, qs.s.id);
    // nine invited in one role: the whole survey is shown, the role on its own is not (it would be the same nine people, but the rule is the rule)
    expect(r.questions[0].summary).toMatchObject({ shown: true, count: 9 });
    expect(r.questions[0].byRole!.shown).toEqual([]);
    expect(JSON.stringify(r.questions[0].byRole)).not.toMatch(/distribution|average/);
  });
  it("hides every group when only one group is small, so the hidden group cannot be found by subtraction", async () => {
    const w = await world(11);
    // one office person joins before the survey opens, so they are invited: a second, small group next to eleven guards
    const office = await createEmployee(w.hr, { firstName: "Ola", lastName: "OfficeAnon", employmentDate: "2022-01-01", categoryId: w.t.officeId });
    const qs = await w.draft();
    await openSurvey(w.hr, qs.s.id);
    for (let i = 0; i < 11; i++) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 4, 4));
    await submitAsEmployee(await login(w.t, "EMPLOYEE", office.id), qs.s.id, w.answersOf(qs, 1, 1));
    await closeSurvey(w.hr, qs.s.id);
    const r = await results(w.hr, qs.s.id);
    // the guards qualify alone, the office person does not; hiding only the office person would let the guards' figure be subtracted from the total, so both are combined
    expect(r.questions[0].byRole!.shown).toEqual([]);
    expect(JSON.stringify(r.questions[0].byRole)).not.toMatch(/OfficeAnon|Guard|Office/);
  });
  it("never shows, even for a group it does show, the name of a person: a group is a role or a department, as a label", async () => {
    const w = await world(12);
    const qs = await w.draft();
    await openSurvey(w.hr, qs.s.id);
    for (let i = 0; i < 12; i++) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 4, 4));
    await closeSurvey(w.hr, qs.s.id);
    const text = JSON.stringify(await results(w.hr, qs.s.id));
    for (const e of w.g) expect(text).not.toContain(e.lastName);
  });
});

describe("what comes out when a survey's data is removed", () => {
  it("leaves the survey's counts and anonymised figures but not one answer, one comment or one code", async () => {
    const w = await world(6);
    const qs = await w.draft();
    await openSurvey(w.hr, qs.s.id);
    for (let i = 0; i < 6; i++) await submitAsEmployee(await w.asEmp(i), qs.s.id, w.answersOf(qs, 4, 4, `to be removed ${i}`));
    await closeSurvey(w.hr, qs.s.id);
    await db.survey.update({ where: { id: qs.s.id }, data: { closedAt: addDays(todayUtc(), -800) } });
    await purgeExpired(w.hr);
    expect(await db.surveyResponse.count({ where: { surveyId: qs.s.id } })).toBe(0);
    expect(await db.surveyAnswer.count({ where: { question: { surveyId: qs.s.id } } })).toBe(0);
    expect(await db.surveyAccessCode.count({ where: { surveyId: qs.s.id } })).toBe(0);
    const kept = await results(w.hr, qs.s.id);
    expect(kept.purged).toBe(true);
    expect(JSON.stringify(kept)).not.toMatch(/to be removed/);
  });
});
