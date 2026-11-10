import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { getHrPolicy, todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { addCareerPath } from "@/server/services/career";
import { addNeed } from "@/server/services/training-plan";
import {
  addNeedFromGap,
  addSkill,
  assessSkill,
  employeeSkills,
  learningPathFor,
  listRoleSkills,
  listSkills,
  myLearningPaths,
  mySkills,
  removeRoleSkill,
  roleGaps,
  setRoleSkill,
  setSkillActive,
  staleAssessments,
} from "@/server/services/skills";
import { isolatedOrg, uid } from "../helpers";

// Skills, skill gaps and learning paths (the founder's go of 2026-11-10; plan docs/plans/skills-gap-plan.md). A skill level is a manager's judgement recorded as a fact:
// append-only, read by the employee, and it changes nothing automatically (no pay, status, appraisal, certificate or career proposal).

const COMMENT = "SECRET-SKILL-COMMENT leads the night handover well";

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@skl.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
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
  for (const n of ["One", "Two", "Three", "Four"]) g.push(await createEmployee(hr, { firstName: "Gbenga", lastName: `Skill${n}`, employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: supEmp.id }));
  const other = await createEmployee(hr, { firstName: "Ife", lastName: "SkillOther", employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: sup2Emp.id });
  const logins = new Map<number, Ctx>();
  const asEmp = async (i: number) => {
    if (!logins.has(i)) logins.set(i, await login(t, "EMPLOYEE", g[i].id));
    return logins.get(i)!;
  };
  const me = await asEmp(0);
  const auditor = await login(t, "AUDITOR");
  const finance = await login(t, "FINANCE");
  const supervision = await addSkill(hr, { name: "Shift supervision", courses: ["Supervisory skills"] });
  const firstAid = await addSkill(hr, { name: "First aid response", courses: ["First Aid"] });
  await setRoleSkill(hr, { categoryId: t.officeId, skillId: supervision.id, requiredLevel: 3 }); // a Site Supervisor needs Shift supervision at 3
  await setRoleSkill(hr, { categoryId: t.guardId, skillId: firstAid.id, requiredLevel: 2 }); // a guard needs First aid response at 2
  const assess = (ctx: Ctx, employeeId: string, skillId: string, level: number, comment?: string) => assessSkill(ctx, { employeeId, skillId, level, comment } as never);
  return { t, hr, supEmp, sup, sup2, g, other, me, asEmp, auditor, finance, supervision, firstAid, assess };
}

describe("the skill library", () => {
  it("is the company's own, set by someone who configures HR, with none provided", async () => {
    const t = await isolatedOrg();
    const hr = await login(t, "HR_ADMIN");
    expect(await listSkills(hr)).toEqual([]);
    const s = await addSkill(hr, { name: "Report writing", description: "Clear incident reports", courses: ["Report writing basics"] });
    expect(s).toMatchObject({ name: "Report writing", active: true, courses: ["Report writing basics"] });
  });
  it("refuses a second skill of the same name however typed, and anyone who does not configure HR", async () => {
    const w = await world();
    await expect(addSkill(w.hr, { name: "  SHIFT   supervision " })).rejects.toThrow(/already/i);
    for (const ctx of [w.sup, w.me, w.auditor, w.finance]) await expect(addSkill(ctx, { name: "Another skill" }), ctx.role).rejects.toThrow(/permission/);
  });
  it("is read by HR and by managers who assess, not by the employee; and can be switched off", async () => {
    const w = await world();
    expect((await listSkills(w.sup)).length).toBe(2);
    expect((await listSkills(w.auditor)).length).toBe(2);
    await expect(listSkills(w.me)).rejects.toThrow(/permission/);
    expect((await setSkillActive(w.hr, w.supervision.id, false)).active).toBe(false);
    await expect(setSkillActive(w.sup, w.supervision.id, true)).rejects.toThrow(/permission/);
  });
});

describe("what a role needs", () => {
  it("is a level from 1 to 4 for a skill of this company, replaced when set again, and can be removed", async () => {
    const w = await world();
    await expect(setRoleSkill(w.hr, { categoryId: w.t.guardId, skillId: w.firstAid.id, requiredLevel: 5 })).rejects.toThrow(/1 to 4/);
    await expect(setRoleSkill(w.hr, { categoryId: w.t.guardId, skillId: w.firstAid.id, requiredLevel: 0 })).rejects.toThrow(/1 to 4/);
    const o = await isolatedOrg();
    await expect(setRoleSkill(w.hr, { categoryId: o.guardId, skillId: w.firstAid.id, requiredLevel: 2 })).rejects.toThrow(/not found/i);
    await setRoleSkill(w.hr, { categoryId: w.t.guardId, skillId: w.firstAid.id, requiredLevel: 4 });
    expect((await listRoleSkills(w.hr)).find((r) => r.skillId === w.firstAid.id)).toMatchObject({ requiredLevel: 4 });
    await removeRoleSkill(w.hr, w.t.guardId, w.firstAid.id);
    expect((await listRoleSkills(w.hr)).find((r) => r.skillId === w.firstAid.id)).toBeUndefined();
    await expect(setRoleSkill(w.sup, { categoryId: w.t.guardId, skillId: w.firstAid.id, requiredLevel: 2 })).rejects.toThrow(/permission/);
  });
});

describe("assessing a person", () => {
  it("is done by a manager about a direct report, and by HR about anyone, never about oneself", async () => {
    const w = await world();
    expect(await w.assess(w.sup, w.g[0].id, w.firstAid.id, 2, COMMENT)).toMatchObject({ level: 2, employeeId: w.g[0].id });
    expect(await w.assess(w.hr, w.other.id, w.firstAid.id, 3)).toMatchObject({ level: 3 });
    await expect(w.assess(w.sup, w.other.id, w.firstAid.id, 2), "someone else's report").rejects.toThrow(/employee not found/i);
    const selfEmp = await createEmployee(w.hr, { firstName: "Halima", lastName: "Hr", employmentDate: "2020-01-01", categoryId: w.t.guardId });
    await expect(w.assess(await login(w.t, "HR_ADMIN", selfEmp.id), selfEmp.id, w.firstAid.id, 2)).rejects.toThrow(/yourself/i);
  });
  it("is refused for the employee, the auditor and finance, a level out of range, an over-long comment, a switched-off skill and an employee who has left", async () => {
    const w = await world();
    for (const ctx of [w.me, w.auditor, w.finance]) await expect(w.assess(ctx, w.g[1].id, w.firstAid.id, 2), ctx.role).rejects.toThrow(/permission/);
    await expect(w.assess(w.sup, w.g[1].id, w.firstAid.id, 5)).rejects.toThrow(/1 to 4/);
    await expect(w.assess(w.sup, w.g[1].id, w.firstAid.id, 2, "x".repeat(301))).rejects.toThrow();
    await db.employee.update({ where: { id: w.g[3].id }, data: { status: "EXITED" } });
    await expect(w.assess(w.sup, w.g[3].id, w.firstAid.id, 2)).rejects.toThrow(/no longer active/i);
    await setSkillActive(w.hr, w.firstAid.id, false);
    await expect(w.assess(w.sup, w.g[1].id, w.firstAid.id, 2)).rejects.toThrow(/switched off/i);
  });
  it("is append-only: the latest is the current level and the earlier ones stay as history", async () => {
    const w = await world();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 1);
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 3, COMMENT);
    expect(await db.skillAssessment.count({ where: { employeeId: w.g[0].id, skillId: w.firstAid.id } })).toBe(2);
    const v = await employeeSkills(w.hr, w.g[0].id);
    const row = v.rows.find((r) => r.skillId === w.firstAid.id)!;
    expect(row).toMatchObject({ current: 3, status: "MET" });
    expect(row.history.map((h) => h.level)).toEqual([3, 1]);
  });
});

describe("the gap view", () => {
  it("shows what the role needs against the current level, with Not assessed apart from a gap", async () => {
    const w = await world();
    let v = await employeeSkills(w.hr, w.g[0].id);
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0]).toMatchObject({ name: "First aid response", requiredLevel: 2, current: null, status: "NOT_ASSESSED", gap: 0 });
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 1);
    v = await employeeSkills(w.hr, w.g[0].id);
    expect(v.rows[0]).toMatchObject({ current: 1, status: "BELOW", gap: 1 });
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 2);
    expect((await employeeSkills(w.hr, w.g[0].id)).rows[0]).toMatchObject({ status: "MET", gap: 0 });
  });
  it("agrees between HR, the person's manager and the person, and a manager sees only their own reports", async () => {
    const w = await world();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 1, COMMENT);
    const strip = (rows: Array<{ name: string; requiredLevel: number; current: number | null; status: string; gap: number }>) => rows.map((r) => [r.name, r.requiredLevel, r.current, r.status, r.gap]);
    const hrView = strip((await employeeSkills(w.hr, w.g[0].id)).rows);
    expect(strip((await employeeSkills(w.sup, w.g[0].id)).rows)).toEqual(hrView);
    expect(strip((await mySkills(w.me)).rows)).toEqual(hrView);
    await expect(employeeSkills(w.sup2, w.g[0].id)).rejects.toThrow(/employee not found/i);
    await expect(employeeSkills(w.me, w.g[1].id)).rejects.toThrow(/permission/);
  });
  it("counts a role's skill across its people: at or above, below and not assessed, with the named list below", async () => {
    const w = await world();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 2);
    await w.assess(w.sup, w.g[1].id, w.firstAid.id, 1);
    await w.assess(w.sup, w.g[2].id, w.firstAid.id, 4);
    const r = (await roleGaps(w.hr)).find((x) => x.categoryId === w.t.guardId)!;
    const s = r.skills.find((x) => x.skillId === w.firstAid.id)!;
    expect(s).toMatchObject({ met: 2, below: 1, notAssessed: 2, total: 5 }); // g[3] and `other` are not assessed
    expect(s.belowPeople.map((p) => p.lastName)).toEqual(["SkillTwo"]);
    for (const ctx of [w.sup, w.me]) await expect(roleGaps(ctx), ctx.role).rejects.toThrow(/permission/);
    expect((await roleGaps(w.auditor)).length).toBeGreaterThan(0);
  });
});

describe("the learning path to a role", () => {
  it("lists the skills of the target role the person is below or not yet assessed on, with the courses that build them, never the ones they meet", async () => {
    const w = await world();
    await addCareerPath(w.hr, { fromCategoryId: w.t.guardId, toCategoryId: w.t.officeId, requiredCourse: "Supervisory skills" } as never);
    await setRoleSkill(w.hr, { categoryId: w.t.officeId, skillId: w.firstAid.id, requiredLevel: 2 });
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 3); // meets First aid response for the office role
    const paths = await myLearningPaths(w.me);
    expect(paths).toHaveLength(1);
    expect(paths[0].requiredCourse).toBe("Supervisory skills");
    expect(paths[0].skills.map((s) => [s.name, s.status])).toEqual([["Shift supervision", "NOT_ASSESSED"]]);
    expect(paths[0].skills[0].courses).toEqual(["Supervisory skills"]);
    await w.assess(w.sup, w.g[0].id, w.supervision.id, 2);
    expect((await myLearningPaths(w.me))[0].skills.map((s) => [s.name, s.status, s.gap])).toEqual([["Shift supervision", "BELOW", 1]]);
    await w.assess(w.sup, w.g[0].id, w.supervision.id, 3);
    expect((await myLearningPaths(w.me))[0].skills).toEqual([]);
    expect((await learningPathFor(w.sup, w.g[0].id))[0].skills).toEqual([]);
    await expect(learningPathFor(w.sup2, w.g[0].id)).rejects.toThrow(/employee not found/i);
  });
  it("is empty when no career path is set from the person's role, and for an employee without a record", async () => {
    const w = await world();
    expect(await myLearningPaths(w.me)).toEqual([]);
    expect(await myLearningPaths(await login(w.t, "EMPLOYEE"))).toEqual([]);
  });
});

describe("from a gap to a need, by a person", () => {
  it("adds exactly one training need, for a course linked to the skill, and nothing else", async () => {
    const w = await world();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 1);
    const before = { enrol: await db.trainingEnrolment.count({ where: { organizationId: w.t.org.id } }), certs: await db.employeeTraining.count({ where: { organizationId: w.t.org.id } }) };
    const n = await addNeedFromGap(w.hr, w.g[0].id, w.firstAid.id, "First Aid");
    expect(n).toMatchObject({ source: "OTHER", status: "OPEN", courseName: "First Aid" });
    expect(n.note).toBe("Skill gap: First aid response");
    expect(await db.trainingNeed.count({ where: { employeeId: w.g[0].id } })).toBe(1);
    expect(await db.trainingEnrolment.count({ where: { organizationId: w.t.org.id } })).toBe(before.enrol);
    expect(await db.employeeTraining.count({ where: { organizationId: w.t.org.id } })).toBe(before.certs);
  });
  it("is refused for a course the skill is not linked to, a person with no gap, a second open need, and anyone but HR", async () => {
    const w = await world();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 1);
    await expect(addNeedFromGap(w.hr, w.g[0].id, w.firstAid.id, "Something else")).rejects.toThrow(/linked/i);
    await w.assess(w.sup, w.g[1].id, w.firstAid.id, 3);
    await expect(addNeedFromGap(w.hr, w.g[1].id, w.firstAid.id, "First Aid")).rejects.toThrow(/no gap/i);
    await expect(addNeedFromGap(w.hr, w.g[2].id, w.firstAid.id, "First Aid"), "not assessed is not a gap").rejects.toThrow(/no gap/i);
    await addNeed(w.hr, { employeeId: w.g[0].id, courseName: "First Aid", source: "OTHER" });
    await expect(addNeedFromGap(w.hr, w.g[0].id, w.firstAid.id, "First Aid")).rejects.toThrow(/already/i);
    for (const ctx of [w.sup, w.me, w.auditor]) await expect(addNeedFromGap(ctx, w.g[0].id, w.firstAid.id, "First Aid"), ctx.role).rejects.toThrow(/permission/);
  });
});

describe("a skill level changes nothing about the person", () => {
  it("leaves the role, status, pay, payroll, certificates, appraisals and career proposals as they were", async () => {
    const w = await world();
    const snap = async () => ({
      emp: await db.employee.findUniqueOrThrow({ where: { id: w.g[0].id }, select: { categoryId: true, status: true } }),
      certs: await db.employeeTraining.count({ where: { employeeId: w.g[0].id } }),
      rates: await db.employeePayRate.count({ where: { employeeId: w.g[0].id } }),
      payroll: await db.payrollRecord.count({ where: { employeeId: w.g[0].id } }),
      appraisals: await db.appraisal.count({ where: { employeeId: w.g[0].id } }),
      proposals: await db.promotionProposal.count({ where: { employeeId: w.g[0].id } }),
      needs: await db.trainingNeed.count({ where: { employeeId: w.g[0].id } }),
    });
    const before = await snap();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 1, COMMENT);
    await w.assess(w.sup, w.g[0].id, w.supervision.id, 4);
    expect(await snap()).toEqual(before);
  });
});

describe("what the employee reads", () => {
  it("is their own requirements and the whole history of their assessments, and nothing about anyone else", async () => {
    const w = await world();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 1, COMMENT);
    await w.assess(w.sup, w.g[1].id, w.firstAid.id, 4, "SECRET-OTHER-PERSON");
    const mine = await mySkills(w.me);
    expect(Object.keys(mine).sort()).toEqual(["role", "rows"]);
    expect(Object.keys(mine.rows[0]).sort()).toEqual(["current", "gap", "history", "name", "requiredLevel", "skillId", "status"]);
    expect(Object.keys(mine.rows[0].history[0]).sort()).toEqual(["assessedBy", "assessedOn", "comment", "level"]);
    expect(JSON.stringify(mine)).toContain("SECRET-SKILL-COMMENT");
    expect(JSON.stringify(mine)).not.toMatch(/SECRET-OTHER/);
    expect((await mySkills(await login(w.t, "EMPLOYEE"))).rows).toEqual([]);
  });
});

describe("stale assessments", () => {
  it("lists the current assessments older than the company's number of days, and none when the company sets 0", async () => {
    const w = await world();
    expect((await getHrPolicy(w.t.org.id)).skillReassessDays).toBe(365);
    const a = await w.assess(w.sup, w.g[0].id, w.firstAid.id, 2);
    await w.assess(w.sup, w.g[1].id, w.firstAid.id, 2);
    expect(await staleAssessments(w.hr)).toEqual([]);
    await db.skillAssessment.update({ where: { id: a.id }, data: { assessedOn: addDays(todayUtc(), -400) } });
    const stale = await staleAssessments(w.hr);
    expect(stale.map((s) => s.employee.lastName)).toEqual(["SkillOne"]);
    // a newer assessment of the same skill makes it current again
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 3);
    expect(await staleAssessments(w.hr)).toEqual([]);
    await db.skillAssessment.updateMany({ where: { employeeId: w.g[1].id }, data: { assessedOn: addDays(todayUtc(), -400) } });
    expect(await staleAssessments(w.hr)).toHaveLength(1);
    await updateHrPolicy(w.hr, { skillReassessDays: 0 });
    expect(await staleAssessments(w.hr)).toEqual([]);
    await expect(staleAssessments(w.me)).rejects.toThrow(/permission/);
  });
});

describe("audit and personal data", () => {
  it("records every step by ids, the skill and the level, never a comment", async () => {
    const w = await world();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 2, COMMENT);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SKILL_" } } });
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["SKILL_ADD", "SKILL_ASSESS"]));
    expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
  });
  it("puts the person's assessments in the copy of their data, and no one else's", async () => {
    const w = await world();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 2, COMMENT);
    await w.assess(w.sup, w.g[1].id, w.firstAid.id, 2, "SECRET-OTHER-PERSON");
    const data = (await compileEmployeeData(w.t.org.id, w.g[0].id)).sections.skillAssessments.records;
    expect(JSON.stringify(data)).toContain("SECRET-SKILL-COMMENT");
    expect(JSON.stringify(data)).not.toMatch(/SECRET-OTHER/);
    expect((await compileEmployeeData(w.t.org.id, w.g[2].id)).sections.skillAssessments.records).toEqual([]);
  });
  it("erasing an employee removes the comments, keeps the levels, dates and the audit log, and touches no one else's", async () => {
    const w = await world();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 2, COMMENT);
    await w.assess(w.sup, w.g[1].id, w.firstAid.id, 3, COMMENT);
    const auditBefore = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.g[0].id, new Date()));
    expect(counts.skillAssessments).toBe(1);
    const mine = await db.skillAssessment.findFirstOrThrow({ where: { employeeId: w.g[0].id } });
    expect(mine.comment).toBeNull();
    expect(mine.level).toBe(2);
    expect((await db.skillAssessment.findFirstOrThrow({ where: { employeeId: w.g[1].id } })).comment).toMatch(/SECRET-SKILL-COMMENT/);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBe(auditBefore);
  });
});

describe("tenant isolation", () => {
  it("another company sees none of it and cannot assess anyone", async () => {
    const w = await world();
    await w.assess(w.sup, w.g[0].id, w.firstAid.id, 2);
    const o = await world();
    await expect(assessSkill(o.hr, { employeeId: w.g[0].id, skillId: o.firstAid.id, level: 2 } as never)).rejects.toThrow(/employee not found/i);
    await expect(assessSkill(o.hr, { employeeId: o.g[0].id, skillId: w.firstAid.id, level: 2 } as never)).rejects.toThrow(/skill not found/i);
    expect((await listSkills(o.hr)).map((s) => s.id)).not.toContain(w.firstAid.id);
    await expect(employeeSkills(o.hr, w.g[0].id)).rejects.toThrow(/not found/i);
  });
});
