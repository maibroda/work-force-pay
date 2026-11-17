import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { addQuestion, closeSurvey, createSurvey, openSurvey, purgeExpired, results, submitAsEmployee } from "@/server/services/survey";
import { isolatedOrg, uid } from "../helpers";

// One breakdown per survey (option A of the founder's choice of 2026-11-17, after the measurement of the role-versus-department leak). HR chooses at creation whether a survey's results are
// broken down by ROLE (the default) or by DEPARTMENT, never both. Showing both let a reader subtract one view from the other and recover a group the rules hide: in the measured case,
// five people in a department of five invited (below the ten-invited rule) were recovered as "all five rated 1". The group labels stored on an answer follow the same choice.

type T = Awaited<ReturnType<typeof isolatedOrg>>;
const today = () => iso(todayUtc());

async function login(orgId: string, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${role.toLowerCase()}-${uid()}@brk.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId };
}

/** 25 guards (20 in Operations rating 4, 5 in Dept C rating 1) and 12 office staff (Dept B, rating 3): the case measured on 2026-11-17. */
async function world() {
  const t: T = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const dB = (await db.department.create({ data: { organizationId: t.org.id, code: "B", name: "Dept B" } })).id;
  const dC = (await db.department.create({ data: { organizationId: t.org.id, code: "C", name: "Dept C" } })).id;
  const groups = [
    { cat: t.guardId, dep: t.deptId, n: 20, rating: 4 },
    { cat: t.guardId, dep: dC, n: 5, rating: 1 },
    { cat: t.officeId, dep: dB, n: 12, rating: 3 },
  ];
  const people: Array<{ ctx: Ctx; rating: number }> = [];
  for (const g of groups)
    for (let i = 0; i < g.n; i++) {
      const e = await createEmployee(hr, { firstName: "Brk", lastName: `P${people.length}`, employmentDate: "2022-01-05", categoryId: g.cat, departmentId: g.dep } as never);
      people.push({ ctx: await login(t.org.id, "EMPLOYEE", e.id), rating: g.rating });
    }
  return { t, hr, people, dC };
}
type W = Awaited<ReturnType<typeof world>>;

async function run(w: W, breakdownBy?: "ROLE" | "DEPARTMENT") {
  const s = await createSurvey(w.hr, { title: "Breakdown check", opensOn: today(), closesOn: iso(addDays(todayUtc(), 7)), ...(breakdownBy ? { breakdownBy } : {}) } as never);
  const q = await addQuestion(w.hr, s.id, { kind: "SCALE", text: "I feel safe at my site" });
  await openSurvey(w.hr, s.id);
  for (const p of w.people) await submitAsEmployee(p.ctx, s.id, [{ questionId: q.id, value: p.rating }]);
  await closeSurvey(w.hr, s.id);
  return { s, q };
}

describe("choosing the breakdown", () => {
  it("is role unless HR chooses the department, and nothing else is accepted", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const base = { title: "A survey", opensOn: today(), closesOn: today() };
    expect((await createSurvey(hr, base as never)).breakdownBy).toBe("ROLE");
    expect((await createSurvey(hr, { ...base, breakdownBy: "DEPARTMENT" } as never)).breakdownBy).toBe("DEPARTMENT");
    await expect(createSurvey(hr, { ...base, breakdownBy: "BOTH" } as never)).rejects.toThrow();
    for (const ctx of [t.ctx("COMPANY_ADMIN"), t.ctx("FINANCE"), t.ctx("AUDITOR")]) await expect(createSurvey(ctx, { ...base, breakdownBy: "DEPARTMENT" } as never), ctx.role).rejects.toThrow(/permission/);
  });
  it("is role for a survey that already existed (the column's default)", async () => {
    const t = await isolatedOrg();
    const old = await db.survey.create({ data: { organizationId: t.org.id, title: "Created before the choice existed", opensOn: new Date(`${today()}T00:00:00Z`), closesOn: new Date(`${today()}T00:00:00Z`), createdBy: "HR" } });
    expect(old.breakdownBy).toBe("ROLE");
  });
});

describe("what the results show", () => {
  it("by role, a survey shows the role figures and NO department figures, so the department cannot be subtracted from them", async () => {
    const w = await world();
    const { s } = await run(w);
    const r = await results(w.hr, s.id);
    expect(r.breakdownBy).toBe("ROLE");
    const q = r.questions[0];
    expect(q.byDepartment).toBeNull();
    expect(q.byRole!.shown.map((g) => [g.label, g.invited])).toEqual(expect.arrayContaining([["Security Guard", 25], ["Office Staff", 12]]));
    // nothing in the results names a department or carries its figures
    expect(JSON.stringify(r)).not.toMatch(/Dept B|Dept C|Operations/);
  });
  it("by department, a survey shows the department figures and NO role figures", async () => {
    const w = await world();
    const { s } = await run(w, "DEPARTMENT");
    const r = await results(w.hr, s.id);
    expect(r.breakdownBy).toBe("DEPARTMENT");
    const q = r.questions[0];
    expect(q.byRole).toBeNull();
    expect(q.byDepartment).not.toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/Security Guard|Office Staff/);
  });
  it("never shows both, whatever the survey and the answers", async () => {
    const w = await world();
    for (const by of ["ROLE", "DEPARTMENT"] as const) {
      const { s } = await run(w, by);
      const q = (await results(w.hr, s.id)).questions[0];
      expect(q.byRole === null || q.byDepartment === null, by).toBe(true);
      expect(q.byRole === null && q.byDepartment === null, by).toBe(false);
    }
  });
  it("shows no breakdown at all below five answers, whichever was chosen", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await createEmployee(hr, { firstName: "Brk", lastName: "Solo", employmentDate: "2022-01-05", categoryId: t.guardId, departmentId: t.deptId } as never);
    const me = await login(t.org.id, "EMPLOYEE", e.id);
    for (const by of ["ROLE", "DEPARTMENT"] as const) {
      const s = await createSurvey(hr, { title: "Tiny", opensOn: today(), closesOn: iso(addDays(todayUtc(), 3)), breakdownBy: by } as never);
      const q = await addQuestion(hr, s.id, { kind: "SCALE", text: "I feel safe at my site" });
      await openSurvey(hr, s.id);
      await submitAsEmployee(me, s.id, [{ questionId: q.id, value: 4 }]);
      await closeSurvey(hr, s.id);
      const x = (await results(hr, s.id)).questions[0];
      expect(x.byRole, by).toBeNull();
      expect(x.byDepartment, by).toBeNull();
    }
  });
  it("keeps only the chosen breakdown in the anonymised result kept after the raw answers are deleted", async () => {
    const w = await world();
    const { s } = await run(w);
    await db.survey.update({ where: { id: s.id }, data: { closedAt: addDays(todayUtc(), -800) } });
    await purgeExpired(w.hr);
    const kept = await results(w.hr, s.id);
    expect(kept.purged).toBe(true);
    expect(kept.questions[0].byDepartment).toBeNull();
    expect(kept.questions[0].byRole).not.toBeNull();
    expect(JSON.stringify(kept)).not.toMatch(/Dept B|Dept C|Operations/);
  });
});

describe("what is stored on an answer", () => {
  it("is the role only for a role survey, and the department only for a department survey (and only for a group of ten or more invited)", async () => {
    const w = await world();
    const byRole = await run(w, "ROLE");
    const roleRows = await db.surveyResponse.findMany({ where: { surveyId: byRole.s.id } });
    expect(roleRows).toHaveLength(37);
    expect(roleRows.every((r) => r.departmentId === null)).toBe(true);
    expect(roleRows.filter((r) => r.categoryId !== null)).toHaveLength(37); // guards 25 and office 12 are both ten or more
    const byDept = await run(w, "DEPARTMENT");
    const deptRows = await db.surveyResponse.findMany({ where: { surveyId: byDept.s.id } });
    expect(deptRows.every((r) => r.categoryId === null)).toBe(true);
    expect(deptRows.filter((r) => r.departmentId === w.t.deptId)).toHaveLength(20); // Operations: 20 invited
    expect(deptRows.some((r) => r.departmentId === w.dC)).toBe(false); // Dept C: 5 invited, never stored
  });
});
