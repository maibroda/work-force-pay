import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { addQuestion, closeSurvey, createSurvey, openSurvey, results, submitAsEmployee } from "@/server/services/survey";
import { isolatedOrg, uid } from "../helpers";

// Survey hardening (decisions S1 and S2 of the founder's review, 2026-11-14).
// S1: a response carries its role and department ONLY when that group had ten or more people invited, so a person in a small group can no longer be matched to their answer by anyone
//     who reads the tables directly. The results must come out exactly as before: a small group's answers still fall into the combined "other" row.
// S2: the words of the comments are read by the HR administrator (who can also hide them) and by no other role; everyone else who may read results sees the figures only.

const today = () => iso(todayUtc());
const COMMENT = "HARDENING-COMMENT the rota is unfair";

type T = Awaited<ReturnType<typeof isolatedOrg>>;
async function login(t: T, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@hard.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

/** People in named groups: { category, department, count }. Returns the people with a login each. */
async function people(t: T, hr: Ctx, groups: Array<{ categoryId: string; departmentId?: string | null; count: number }>) {
  const out: Array<{ emp: Awaited<ReturnType<typeof createEmployee>>; ctx: Ctx; categoryId: string; departmentId: string | null }> = [];
  for (const g of groups)
    for (let i = 0; i < g.count; i++) {
      const emp = await createEmployee(hr, { firstName: "Hard", lastName: `P${out.length}`, employmentDate: "2023-01-05", categoryId: g.categoryId, departmentId: g.departmentId ?? undefined } as never);
      out.push({ emp, ctx: await login(t, "EMPLOYEE", emp.id), categoryId: g.categoryId, departmentId: g.departmentId ?? null });
    }
  return out;
}
async function survey(hr: Ctx) {
  const s = await createSurvey(hr, { title: "Hardening check", opensOn: today(), closesOn: iso(addDays(todayUtc(), 14)) } as never);
  const q1 = await addQuestion(hr, s.id, { kind: "SCALE", text: "I feel safe at my site" });
  const q2 = await addQuestion(hr, s.id, { kind: "COMMENT", text: "What would you change?" });
  return { s, q1, q2 };
}
const answer = (qs: { q1: { id: string }; q2: { id: string } }, v: number, comment?: string) => [{ questionId: qs.q1.id, value: v }, ...(comment ? [{ questionId: qs.q2.id, comment }] : [])];

describe("S1: a response carries its group only when the group is large enough to be shown", () => {
  it("stores the role of a group of ten invited and none for a group of nine", async () => {
    for (const [n, expected] of [[10, true], [9, false]] as const) {
      const t = await isolatedOrg();
      const hr = await login(t, "HR_ADMIN");
      const ppl = await people(t, hr, [{ categoryId: t.guardId, count: n }]);
      const qs = await survey(hr);
      await openSurvey(hr, qs.s.id);
      for (const p of ppl) await submitAsEmployee(p.ctx, qs.s.id, answer(qs, 4));
      const rows = await db.surveyResponse.findMany({ where: { surveyId: qs.s.id } });
      expect(rows).toHaveLength(n);
      for (const r of rows) expect(r.categoryId, `${n} invited`).toBe(expected ? t.guardId : null);
    }
  });
  it("stores a group's role and department independently: a large role with a small department keeps the role only", async () => {
    const t = await isolatedOrg();
    const hr = await login(t, "HR_ADMIN");
    const small = await db.department.create({ data: { organizationId: t.org.id, code: "SMALL", name: "Small department" } });
    const ppl = await people(t, hr, [
      { categoryId: t.guardId, departmentId: t.deptId, count: 10 },
      { categoryId: t.guardId, departmentId: small.id, count: 2 },
    ]);
    const qs = await survey(hr);
    await openSurvey(hr, qs.s.id);
    for (const p of ppl) await submitAsEmployee(p.ctx, qs.s.id, answer(qs, 3));
    const rows = await db.surveyResponse.findMany({ where: { surveyId: qs.s.id } });
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.categoryId === t.guardId)).toBe(true); // twelve guards invited
    expect(rows.filter((r) => r.departmentId === t.deptId)).toHaveLength(10);
    expect(rows.filter((r) => r.departmentId === null)).toHaveLength(2); // the department of two people is not stored
    expect(rows.some((r) => r.departmentId === small.id)).toBe(false);
  });
  it("leaves the access-code rows as they are (they still hold the group: the invited counts come from them)", async () => {
    const t = await isolatedOrg();
    const hr = await login(t, "HR_ADMIN");
    await people(t, hr, [{ categoryId: t.guardId, count: 3 }]);
    const qs = await survey(hr);
    await openSurvey(hr, qs.s.id);
    const codes = await db.surveyAccessCode.findMany({ where: { surveyId: qs.s.id } });
    expect(codes).toHaveLength(3);
    for (const c of codes) expect(c.categoryId).toBe(t.guardId);
  });
});

describe("S1: the results come out as they did, with a small group's answers in the combined row", () => {
  it("shows the largest group, hides the next-smallest with the small one, and counts every hidden answer in the combined row", async () => {
    const t = await isolatedOrg();
    const hr = await login(t, "HR_ADMIN");
    const sup = await db.employeeCategory.create({ data: { organizationId: t.org.id, code: "SUP", name: "Supervisor grade" } });
    const ppl = await people(t, hr, [
      { categoryId: t.guardId, count: 13 },
      { categoryId: t.officeId, count: 12 },
      { categoryId: sup.id, count: 2 },
    ]);
    const qs = await survey(hr);
    await openSurvey(hr, qs.s.id);
    for (const p of ppl) await submitAsEmployee(p.ctx, qs.s.id, answer(qs, p.categoryId === t.guardId ? 5 : 3));
    await closeSurvey(hr, qs.s.id);
    const r = await results(hr, qs.s.id);
    const q = r.questions[0].byRole!;
    // one group is hidden (two people), so the next-smallest shown group (the office, 12) is hidden with it, and the combined row is 12 + 2
    expect(q.shown.map((g) => g.label)).toEqual(["Security Guard"]);
    expect(q.other).toMatchObject({ invited: 14, answers: 14, shown: true });
    expect(q.other!.summary).toMatchObject({ shown: true, count: 14 });
    expect(JSON.stringify(q)).not.toMatch(/Supervisor grade|Office Staff/);
  });
  it("counts answers stored before this change, which still carry a small group, in the same combined row", async () => {
    const t = await isolatedOrg();
    const hr = await login(t, "HR_ADMIN");
    const sup = await db.employeeCategory.create({ data: { organizationId: t.org.id, code: "SUP", name: "Supervisor grade" } });
    const ppl = await people(t, hr, [
      { categoryId: t.guardId, count: 13 },
      { categoryId: t.officeId, count: 12 },
      { categoryId: sup.id, count: 2 },
    ]);
    const qs = await survey(hr);
    await openSurvey(hr, qs.s.id);
    for (const p of ppl.filter((x) => x.categoryId !== sup.id)) await submitAsEmployee(p.ctx, qs.s.id, answer(qs, 4));
    // two answers written the way the old code wrote them: with the small group attached
    for (const v of [2, 2]) {
      const resp = await db.surveyResponse.create({ data: { surveyId: qs.s.id, categoryId: sup.id } });
      await db.surveyAnswer.create({ data: { responseId: resp.id, questionId: qs.q1.id, value: v } });
    }
    await closeSurvey(hr, qs.s.id);
    const q = (await results(hr, qs.s.id)).questions[0].byRole!;
    expect(q.shown.map((g) => g.label)).toEqual(["Security Guard"]);
    expect(q.other).toMatchObject({ invited: 14, answers: 14, shown: true });
  });
  it("keeps a survey where every group is small exactly as before: nothing shown on its own, the whole survey shown from five", async () => {
    const t = await isolatedOrg();
    const hr = await login(t, "HR_ADMIN");
    const ppl = await people(t, hr, [
      { categoryId: t.guardId, count: 6 },
      { categoryId: t.officeId, count: 3 },
    ]);
    const qs = await survey(hr);
    await openSurvey(hr, qs.s.id);
    for (const p of ppl) await submitAsEmployee(p.ctx, qs.s.id, answer(qs, 4));
    await closeSurvey(hr, qs.s.id);
    const r = await results(hr, qs.s.id);
    expect(r.questions[0].summary).toMatchObject({ shown: true, count: 9 });
    expect(r.questions[0].byRole!.shown).toEqual([]);
    expect(r.questions[0].byRole!.other).toMatchObject({ invited: 9, answers: null, shown: false });
    expect(await db.surveyResponse.count({ where: { surveyId: qs.s.id, categoryId: { not: null } } })).toBe(0);
  });
});

describe("S2: who reads the words of a comment", () => {
  async function closedWithComments() {
    const t = await isolatedOrg();
    const hr = await login(t, "HR_ADMIN");
    const ppl = await people(t, hr, [{ categoryId: t.guardId, count: 6 }]);
    const qs = await survey(hr);
    await openSurvey(hr, qs.s.id);
    for (const [i, p] of ppl.entries()) await submitAsEmployee(p.ctx, qs.s.id, answer(qs, 4, `${COMMENT} ${i}`));
    await closeSurvey(hr, qs.s.id);
    return { t, hr, qs };
  }
  it("shows the comments to the HR administrator, who can also hide them", async () => {
    const { hr, qs } = await closedWithComments();
    const r = await results(hr, qs.s.id);
    expect(r.commentsVisible).toBe(true);
    expect(r.questions[1].comments).toHaveLength(6);
  });
  it("shows the figures but no comment to the auditor, finance, the company administrator and the super administrator", async () => {
    const { t, hr, qs } = await closedWithComments();
    for (const role of ["AUDITOR", "FINANCE", "COMPANY_ADMIN", "SUPER_ADMIN"] as const) {
      const ctx = await login(t, role);
      let r;
      try {
        r = await results(ctx, qs.s.id);
      } catch (e) {
        // a role with no right to read results at all is refused, which is the stronger answer
        expect(String(e), role).toMatch(/permission/);
        continue;
      }
      expect(r.commentsVisible, role).toBe(false);
      expect(r.questions[1].comments, role).toBeNull();
      expect(JSON.stringify(r), role).not.toContain("HARDENING-COMMENT");
      expect(r.questions[0].summary, role).toMatchObject({ shown: true, count: 6 });
    }
    expect((await results(hr, qs.s.id)).commentsVisible).toBe(true);
  });
  it("is the same after the raw answers are deleted: no comment is kept, and no one is told otherwise", async () => {
    const { hr, qs } = await closedWithComments();
    await db.survey.update({ where: { id: qs.s.id }, data: { closedAt: addDays(todayUtc(), -800) } });
    const { purgeExpired } = await import("@/server/services/survey");
    await purgeExpired(hr);
    const r = await results(hr, qs.s.id);
    expect(r.purged).toBe(true);
    expect(r.questions[1].comments).toBeNull();
    expect(JSON.stringify(r)).not.toContain("HARDENING-COMMENT");
  });
});

describe("the finding of 2026-11-16: two hidden small groups cannot be found by subtraction", () => {
  it("combines the shown group with them when they are together still too small, through the real results", async () => {
    const t = await isolatedOrg();
    const hr = await login(t, "HR_ADMIN");
    const sup = await db.employeeCategory.create({ data: { organizationId: t.org.id, code: "SUP", name: "Supervisor grade" } });
    // twelve guards (large enough to be shown), three office staff and four supervisors (each too small, and seven together still too small)
    const ppl = await people(t, hr, [
      { categoryId: t.guardId, count: 12 },
      { categoryId: t.officeId, count: 3 },
      { categoryId: sup.id, count: 4 },
    ]);
    const qs = await survey(hr);
    await openSurvey(hr, qs.s.id);
    for (const p of ppl) await submitAsEmployee(p.ctx, qs.s.id, answer(qs, p.categoryId === t.guardId ? 5 : p.categoryId === t.officeId ? 1 : 2));
    await closeSurvey(hr, qs.s.id);
    const r = await results(hr, qs.s.id);
    const q = r.questions[0];
    // before the fix the guards were shown and the combined row of seven was "not shown", so the seven's ratings were the whole survey minus the guards
    expect(q.byRole!.shown).toEqual([]);
    expect(q.byRole!.other).toMatchObject({ invited: 19, answers: 19, shown: true });
    expect(q.byRole!.other!.summary).toMatchObject({ shown: true, count: 19 });
    expect(q.summary).toMatchObject({ shown: true, count: 19 });
    expect(JSON.stringify(q.byRole)).not.toMatch(/Security Guard|Office Staff|Supervisor grade/);
  });
});
