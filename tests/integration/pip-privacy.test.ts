import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { acknowledgePlan, addEmployeeComment, addObjective, approveOutcome, approveStart, createPlan, proposeOutcome, recordReview, submitPlan, withdrawPlan } from "@/server/services/pip";
import { isolatedOrg, uid } from "../helpers";

// A performance improvement plan is personal data about the employee: it is included in the copy of their data they can ask for, and the words in it are
// removed when they are erased (the audit log carries ids only, so it is untouched). Added after review of the first build, which missed both.

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@pipp.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function world() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN");
  const owner = await login(t, "HR_ADMIN");
  const boss = await login(t, "COMPANY_ADMIN");
  const emp = await createEmployee(hr, { firstName: "Ngozi", lastName: "Privacy", employmentDate: "2024-01-05", categoryId: t.guardId });
  const me = await login(t, "EMPLOYEE", emp.id);
  const draft = await createPlan(hr, { employeeId: emp.id, concerns: "PRIVATE-CONCERN arrives late to post", startDate: day(-20), ownerUserId: owner.userId } as never);
  const o = await addObjective(hr, draft.id, { gap: "PRIVATE-GAP late arrivals", target: "PRIVATE-TARGET none for 30 days", support: "PRIVATE-SUPPORT shift swap", dueDate: day(10) });
  await submitPlan(hr, draft.id);
  return { t, hr, owner, boss, emp, me, draft, o };
}

describe("the copy of their data an employee can ask for", () => {
  it("includes their started plan: the concerns, objectives, reviews, their own response and comment, but not a draft", async () => {
    const w = await world();
    const before = await compileEmployeeData(w.t.org.id, w.emp.id);
    expect(before.sections.improvementPlans?.records ?? []).toEqual([]); // awaiting approval: not yet shown to the employee, so not in their copy
    await approveStart(w.boss, w.draft.id);
    const r = await recordReview(w.owner, w.draft.id, { reviewedOn: day(-1), summary: "PRIVATE-REVIEW first review", assessments: [{ objectiveId: w.o.id, result: "PARTLY_MET", note: "PRIVATE-NOTE" }] });
    await addEmployeeComment(w.me, r.id, "PRIVATE-REPLY my comment");
    await acknowledgePlan(w.me, w.draft.id, { agree: false, comment: "PRIVATE-DISAGREE my reason" });
    const data = await compileEmployeeData(w.t.org.id, w.emp.id);
    const section = data.sections.improvementPlans;
    expect(section.title).toMatch(/improvement plan/i);
    expect(section.records).toHaveLength(1);
    const text = JSON.stringify(section.records);
    for (const s of ["PRIVATE-CONCERN", "PRIVATE-GAP", "PRIVATE-TARGET", "PRIVATE-SUPPORT", "PRIVATE-REVIEW", "PRIVATE-REPLY", "PRIVATE-DISAGREE"]) expect(text, s).toContain(s);
  });
  it("leaves out an outcome that has not been approved, as the employee's own page does", async () => {
    const w = await world();
    await approveStart(w.boss, w.draft.id);
    await recordReview(w.owner, w.draft.id, { reviewedOn: day(-1), summary: "Reviewed", assessments: [] });
    await proposeOutcome(w.owner, w.draft.id, { outcome: "UNSUCCESSFUL", note: "PRIVATE-OUTCOME-NOTE not yet approved" });
    const text = JSON.stringify((await compileEmployeeData(w.t.org.id, w.emp.id)).sections.improvementPlans.records);
    expect(text).not.toContain("PRIVATE-OUTCOME-NOTE");
    expect(text).not.toContain("UNSUCCESSFUL");
    await approveOutcome(w.boss, w.draft.id);
    const after = JSON.stringify((await compileEmployeeData(w.t.org.id, w.emp.id)).sections.improvementPlans.records);
    expect(after.toLowerCase()).toContain("unsuccessful");
  });
  it("leaves out a plan withdrawn before it ever started, and shows one withdrawn after", async () => {
    const w = await world();
    await withdrawPlan(w.hr, w.draft.id, "Drafted by mistake");
    expect((await compileEmployeeData(w.t.org.id, w.emp.id)).sections.improvementPlans.records).toEqual([]);
    const w2 = await world();
    await approveStart(w2.boss, w2.draft.id);
    await withdrawPlan(w2.boss, w2.draft.id, "Employee transferred");
    expect((await compileEmployeeData(w2.t.org.id, w2.emp.id)).sections.improvementPlans.records).toHaveLength(1);
  });
  it("never includes another employee's plan", async () => {
    const w = await world();
    await approveStart(w.boss, w.draft.id);
    const other = await createEmployee(w.hr, { firstName: "Ife", lastName: "Other", employmentDate: "2024-01-05", categoryId: w.t.guardId });
    expect((await compileEmployeeData(w.t.org.id, other.id)).sections.improvementPlans.records).toEqual([]);
  });
});

describe("erasing an employee", () => {
  it("removes the words in every plan, objective, review, note and response, and keeps the structure and the audit log", async () => {
    const w = await world();
    await approveStart(w.boss, w.draft.id, "PRIVATE-START-NOTE");
    const r = await recordReview(w.owner, w.draft.id, { reviewedOn: day(-1), summary: "PRIVATE-REVIEW first review", assessments: [{ objectiveId: w.o.id, result: "MET", note: "PRIVATE-NOTE" }] });
    await addEmployeeComment(w.me, r.id, "PRIVATE-REPLY my comment");
    await acknowledgePlan(w.me, w.draft.id, { agree: false, comment: "PRIVATE-DISAGREE my reason" });
    await proposeOutcome(w.owner, w.draft.id, { outcome: "SUCCESSFUL", note: "PRIVATE-OUTCOME-NOTE met" });
    await approveOutcome(w.boss, w.draft.id, "PRIVATE-APPROVAL-NOTE");
    const auditBefore = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.emp.id, new Date()));
    expect(counts.improvementPlans).toBe(1);
    const plan = await db.performanceImprovementPlan.findUniqueOrThrow({ where: { id: w.draft.id }, include: { objectives: true, reviews: { include: { assessments: true } } } });
    const everything = JSON.stringify(plan);
    for (const s of ["PRIVATE-CONCERN", "PRIVATE-GAP", "PRIVATE-TARGET", "PRIVATE-SUPPORT", "PRIVATE-REVIEW", "PRIVATE-NOTE", "PRIVATE-REPLY", "PRIVATE-DISAGREE", "PRIVATE-OUTCOME", "PRIVATE-APPROVAL", "PRIVATE-START"]) expect(everything, s).not.toContain(s);
    expect(plan).toMatchObject({ status: "CLOSED", outcome: "SUCCESSFUL", employeeAgreed: false }); // the structure stays: a count of plans and how they ended
    expect(plan.objectives).toHaveLength(1);
    expect(plan.reviews).toHaveLength(1);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBe(auditBefore); // the audit log is untouched
  });
  it("touches no other employee's plan", async () => {
    const w = await world();
    const other = await createEmployee(w.hr, { firstName: "Ife", lastName: "Other", employmentDate: "2024-01-05", categoryId: w.t.guardId });
    const p = await createPlan(w.hr, { employeeId: other.id, concerns: "OTHER-CONCERN stays as written", startDate: day(-5), ownerUserId: w.owner.userId } as never);
    await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.emp.id, new Date()));
    expect((await db.performanceImprovementPlan.findUniqueOrThrow({ where: { id: p.id } })).concerns).toBe("OTHER-CONCERN stays as written");
  });
});
