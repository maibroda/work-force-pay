import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { getHrPolicy, todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { buildHrDigest } from "@/server/services/reminders";
import { addDays } from "@/lib/dates";
import {
  addCareerPath,
  applyPromotion,
  approvePromotion,
  declinePromotion,
  listCareerPaths,
  listPromotions,
  myCareer,
  promotionEvidence,
  proposePromotion,
  setCareerPathActive,
  withdrawPromotion,
} from "@/server/services/career";
import { isolatedOrg, uid } from "../helpers";

// Career and succession, step 1: promotion proposals and career paths (the founder's go of 2026-11-10; plan docs/plans/career-succession-plan.md).
// A promotion proposal is a record of a decision: approving it changes no category, pay or payroll figure.

const today = () => iso(todayUtc());
const REASON = "SECRET-REASON consistently covered extra shifts and trained two new guards";

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@car.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function world() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN"); // proposes (anyone), configures, applies
  const boss = await login(t, "COMPANY_ADMIN"); // decides
  const supEmp = await createEmployee(hr, { firstName: "Sade", lastName: "Supervisor", employmentDate: "2020-01-01", categoryId: t.officeId });
  const sup = await login(t, "SUPERVISOR", supEmp.id);
  const sup2Emp = await createEmployee(hr, { firstName: "Tunde", lastName: "Other", employmentDate: "2020-01-01", categoryId: t.officeId });
  const sup2 = await login(t, "SUPERVISOR", sup2Emp.id);
  const g1 = await createEmployee(hr, { firstName: "Gbenga", lastName: "One", employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: supEmp.id });
  const g2 = await createEmployee(hr, { firstName: "Hauwa", lastName: "Two", employmentDate: "2023-01-05", categoryId: t.guardId, reportingManagerId: sup2Emp.id });
  const me1 = await login(t, "EMPLOYEE", g1.id);
  const propose = (ctx: Ctx, employeeId: string, over: Record<string, unknown> = {}) =>
    proposePromotion(ctx, { employeeId, toCategoryId: t.officeId, reason: REASON, intendedOn: today(), ...over } as never);
  const auditor = await login(t, "AUDITOR");
  const finance = await login(t, "FINANCE");
  return { t, hr, boss, supEmp, sup, sup2, g1, g2, me1, propose, auditor, finance };
}
type W = Awaited<ReturnType<typeof world>>;
const pathFor = (w: W, over: Record<string, unknown> = {}) => addCareerPath(w.hr, { fromCategoryId: w.t.guardId, toCategoryId: w.t.officeId, minMonths: 24, requiredCourse: "Supervisory skills", ...over } as never);
const holdCourse = (w: W, employeeId: string, course = "Supervisory skills") =>
  db.employeeTraining.create({ data: { organizationId: w.t.org.id, employeeId, courseName: course, issueDate: new Date("2026-01-01"), expiryDate: new Date("2028-01-01"), status: "VALID", recordedBy: "test" } });

describe("career paths", () => {
  it("are the company's own, set by someone who configures HR, and none are provided", async () => {
    const w = await world();
    expect(await listCareerPaths(w.hr)).toEqual([]);
    const p = await pathFor(w);
    expect(p).toMatchObject({ minMonths: 24, requiredCourse: "Supervisory skills", active: true });
    expect((await listCareerPaths(w.hr)).map((x) => x.id)).toEqual([p.id]);
  });
  it("are refused for everyone who does not configure HR", async () => {
    const w = await world();
    for (const ctx of [w.sup, w.me1, w.auditor, w.finance]) await expect(addCareerPath(ctx, { fromCategoryId: w.t.guardId, toCategoryId: w.t.officeId } as never), ctx.role).rejects.toThrow(/permission/);
  });
  it("cannot lead from a role to itself, to a role of another company, or be set twice", async () => {
    const w = await world();
    await expect(addCareerPath(w.hr, { fromCategoryId: w.t.guardId, toCategoryId: w.t.guardId } as never)).rejects.toThrow(/different/i);
    const o = await isolatedOrg();
    await expect(addCareerPath(w.hr, { fromCategoryId: w.t.guardId, toCategoryId: o.officeId } as never)).rejects.toThrow(/not found/i);
    await pathFor(w);
    await expect(pathFor(w)).rejects.toThrow(/already/i);
  });
  it("can be switched off, and a guide for someone who proposes is readable without being able to change it", async () => {
    const w = await world();
    const p = await pathFor(w);
    expect((await setCareerPathActive(w.hr, p.id, false)).active).toBe(false);
    expect(await listCareerPaths(w.sup)).toHaveLength(1);
    await expect(setCareerPathActive(w.sup, p.id, true)).rejects.toThrow(/permission/);
    await expect(listCareerPaths(w.me1)).rejects.toThrow(/permission/);
  });
});

describe("proposing a promotion", () => {
  it("is done by HR about anyone, and by a manager about their own direct reports only", async () => {
    const w = await world();
    expect(await w.propose(w.hr, w.g1.id)).toMatchObject({ status: "PROPOSED", employeeId: w.g1.id, fromCategoryId: w.t.guardId, toCategoryId: w.t.officeId });
    expect(await w.propose(w.sup2, w.g2.id)).toMatchObject({ status: "PROPOSED" });
    await expect(w.propose(w.sup, w.g2.id), "someone else's report").rejects.toThrow(/employee not found/i);
  });
  it("is never about oneself", async () => {
    const w = await world();
    await expect(w.propose(w.hr, w.supEmp.id, { toCategoryId: w.t.guardId })).resolves.toBeDefined(); // HR is not an employee here
    const hrEmp = await createEmployee(w.hr, { firstName: "Halima", lastName: "Hr", employmentDate: "2020-01-01", categoryId: w.t.guardId });
    const hrSelf = await login(w.t, "HR_ADMIN", hrEmp.id);
    await expect(w.propose(hrSelf, hrEmp.id)).rejects.toThrow(/yourself/i);
  });
  it("is refused for the employee, the auditor and finance", async () => {
    const w = await world();
    for (const ctx of [w.me1, w.auditor, w.finance]) await expect(w.propose(ctx, w.g1.id), ctx.role).rejects.toThrow(/permission/);
  });
  it("needs a real reason, a different role of this company, an intended date that is not past, and an employee still here", async () => {
    const w = await world();
    await expect(w.propose(w.hr, w.g1.id, { reason: "good" })).rejects.toThrow();
    await expect(w.propose(w.hr, w.g1.id, { toCategoryId: w.t.guardId })).rejects.toThrow(/different/i);
    const o = await isolatedOrg();
    await expect(w.propose(w.hr, w.g1.id, { toCategoryId: o.officeId })).rejects.toThrow(/not found/i);
    await expect(w.propose(w.hr, w.g1.id, { intendedOn: "2020-01-01" })).rejects.toThrow(/past/i);
    await db.employee.update({ where: { id: w.g2.id }, data: { status: "EXITED" } });
    await expect(w.propose(w.hr, w.g2.id)).rejects.toThrow(/no longer active/i);
  });
  it("is refused while an earlier proposal for the same person is open, and allowed again once it is decided", async () => {
    const w = await world();
    const a = await w.propose(w.hr, w.g1.id);
    await expect(w.propose(w.hr, w.g1.id)).rejects.toThrow(/already/i);
    await declinePromotion(w.boss, a.id, "Not this year, please wait");
    await expect(w.propose(w.hr, w.g1.id)).resolves.toBeDefined();
  });
  it("records the warnings that applied, in codes, and never blocks", async () => {
    const w = await world();
    expect((await w.propose(w.hr, w.g1.id)).warnings).toEqual(["NO_PATH"]);
    await db.promotionProposal.deleteMany({ where: { organizationId: w.t.org.id } });
    await pathFor(w);
    expect((await w.propose(w.hr, w.g1.id)).warnings).toEqual(["COURSE_NOT_VALID"]);
    await db.promotionProposal.deleteMany({ where: { organizationId: w.t.org.id } });
    await holdCourse(w, w.g1.id);
    expect((await w.propose(w.hr, w.g1.id)).warnings).toEqual([]);
  });
  it("warns when the time in the role is short (a person moved here recently), counting from the last applied promotion", async () => {
    const w = await world();
    await pathFor(w, { requiredCourse: undefined, minMonths: 60 });
    const p = await w.propose(w.hr, w.g1.id);
    expect(p.warnings).toEqual(["BELOW_MIN_SERVICE"]);
    const ev = await promotionEvidence(w.hr, w.g1.id);
    expect(ev.monthsInRole).toBeGreaterThanOrEqual(45);
  });
  it("warns of an open disciplinary case and an open improvement plan", async () => {
    const w = await world();
    await db.relationsCase.create({
      data: { organizationId: w.t.org.id, caseNumber: "ER-90001", employeeId: w.g1.id, type: "MISCONDUCT", summary: "A case", description: "Details", raisedBy: "HR", raisedByUserId: w.hr.userId, status: "INVESTIGATING" },
    });
    expect((await w.propose(w.hr, w.g1.id)).warnings).toEqual(["NO_PATH", "OPEN_DISCIPLINE"]);
    expect((await promotionEvidence(w.hr, w.g1.id)).openDiscipline).toBe(true);
    await expect(promotionEvidence(w.sup, w.g1.id)).rejects.toThrow(/permission/);
  });
});

describe("deciding", () => {
  it("is done by someone with the approve right who did not propose it", async () => {
    const w = await world();
    const p = await w.propose(w.hr, w.g1.id);
    await expect(approvePromotion(w.hr, p.id, "ok to go ahead")).rejects.toThrow(/someone else/i);
    await expect(declinePromotion(w.hr, p.id, "no thanks really")).rejects.toThrow(/someone else/i);
    for (const ctx of [w.sup, w.auditor, w.finance, w.me1]) await expect(approvePromotion(ctx, p.id, "yes of course"), ctx.role).rejects.toThrow(/permission/);
    // HR is the proposer; the approving administrator is another person
    const approved = await approvePromotion(w.boss, p.id, "Reviewed and agreed");
    expect(approved).toMatchObject({ status: "APPROVED", decidedByUserId: w.boss.userId });
  });
  it("needs a reason only when a warning applied, and a decline always needs one", async () => {
    const w = await world();
    await pathFor(w);
    await holdCourse(w, w.g1.id);
    const clean = await w.propose(w.hr, w.g1.id);
    expect((await approvePromotion(w.boss, clean.id)).status).toBe("APPROVED");
    const warned = await w.propose(w.hr, w.g2.id); // no course
    expect(warned.warnings).toEqual(["COURSE_NOT_VALID"]);
    await expect(approvePromotion(w.boss, warned.id)).rejects.toThrow(/reason/i);
    await expect(declinePromotion(w.boss, warned.id, "no")).rejects.toThrow();
    expect((await declinePromotion(w.boss, warned.id, "The course must be done first")).status).toBe("DECLINED");
  });
  it("is not decided twice, and is refused when the employee's role has changed since it was proposed", async () => {
    const w = await world();
    const p = await w.propose(w.hr, w.g1.id);
    await approvePromotion(w.boss, p.id, "Reviewed and agreed");
    await expect(approvePromotion(w.boss, p.id, "Reviewed and agreed")).rejects.toThrow(/already/i);
    await expect(declinePromotion(w.boss, p.id, "Changed my mind about it")).rejects.toThrow(/already/i);
    const q = await w.propose(w.hr, w.g2.id);
    await db.employee.update({ where: { id: w.g2.id }, data: { categoryId: w.t.officeId } });
    await expect(approvePromotion(w.boss, q.id, "Reviewed and agreed")).rejects.toThrow(/changed/i);
  });
  it("changes nothing in the employee's role, pay or payroll: it is a record of a decision", async () => {
    const w = await world();
    const snap = async () => ({
      emp: await db.employee.findUniqueOrThrow({ where: { id: w.g1.id }, select: { categoryId: true, status: true, currentClientId: true, currentBeatId: true } }),
      rates: await db.employeePayRate.count({ where: { employeeId: w.g1.id } }),
      proposals: await db.payRateProposal.count({ where: { employeeId: w.g1.id } }),
      payroll: await db.payrollRecord.count({ where: { employeeId: w.g1.id } }),
      arrears: await db.arrears.count({ where: { employeeId: w.g1.id } }),
    });
    const before = await snap();
    const p = await w.propose(w.hr, w.g1.id);
    await approvePromotion(w.boss, p.id, "Reviewed and agreed");
    expect(await snap()).toEqual(before);
  });
  it("another company cannot see or decide it", async () => {
    const w = await world();
    const p = await w.propose(w.hr, w.g1.id);
    const o = await world();
    await expect(approvePromotion(o.boss, p.id, "Reviewed and agreed")).rejects.toThrow(/not found/i);
    expect(await listPromotions(o.hr)).toEqual([]);
  });
});

describe("applying", () => {
  it("is HR's act, and only once the employee's role really is the new one", async () => {
    const w = await world();
    const p = await w.propose(w.hr, w.g1.id);
    await expect(applyPromotion(w.hr, p.id), "not approved").rejects.toThrow(/approved/i);
    await approvePromotion(w.boss, p.id, "Reviewed and agreed");
    await expect(applyPromotion(w.hr, p.id), "role not changed").rejects.toThrow(/change the employee/i);
    await expect(applyPromotion(w.sup, p.id)).rejects.toThrow(/permission/);
    await db.employee.update({ where: { id: w.g1.id }, data: { categoryId: w.t.officeId } });
    expect(await applyPromotion(w.hr, p.id)).toMatchObject({ status: "APPLIED", appliedByUserId: w.hr.userId });
    await expect(applyPromotion(w.hr, p.id)).rejects.toThrow(/already|approved/i);
  });
  it("counts the time in the new role from the day it was applied", async () => {
    const w = await world();
    const p = await w.propose(w.hr, w.g1.id);
    await approvePromotion(w.boss, p.id, "Reviewed and agreed");
    await db.employee.update({ where: { id: w.g1.id }, data: { categoryId: w.t.officeId } });
    await applyPromotion(w.hr, p.id);
    expect((await promotionEvidence(w.hr, w.g1.id)).monthsInRole).toBe(0);
  });
});

describe("withdrawing", () => {
  it("is done by the proposer while undecided, and after approval only by the approve right, always with a reason", async () => {
    const w = await world();
    const p = await w.propose(w.sup, w.g1.id);
    await expect(withdrawPromotion(w.sup, p.id, "no")).rejects.toThrow();
    await expect(withdrawPromotion(w.sup2, p.id, "Not mine to withdraw")).rejects.toThrow(/permission|not found/i);
    expect((await withdrawPromotion(w.sup, p.id, "I proposed the wrong person")).status).toBe("WITHDRAWN");
    const q = await w.propose(w.sup, w.g1.id);
    await approvePromotion(w.boss, q.id, "Reviewed and agreed");
    await expect(withdrawPromotion(w.sup, q.id, "Changed my mind about it")).rejects.toThrow(/permission/);
    expect((await withdrawPromotion(w.boss, q.id, "Budget is not agreed yet")).status).toBe("WITHDRAWN");
  });
});

describe("who sees what", () => {
  it("HR reads every proposal with its warnings; a manager reads only the ones they made, without the warnings", async () => {
    const w = await world();
    await w.propose(w.hr, w.g2.id);
    const mine = await w.propose(w.sup, w.g1.id);
    const hrList = await listPromotions(w.hr);
    expect(hrList).toHaveLength(2);
    expect(hrList[0]).toHaveProperty("warnings");
    const supList = await listPromotions(w.sup);
    expect(supList.map((x) => x.id)).toEqual([mine.id]);
    expect(supList[0]).not.toHaveProperty("warnings");
    await expect(listPromotions(w.me1)).rejects.toThrow(/permission/);
    expect(await listPromotions(w.auditor)).toHaveLength(2); // reads HR records
  });
  it("shows the employee only their own approved or applied promotion, never one being considered or declined", async () => {
    const w = await world();
    const p = await w.propose(w.hr, w.g1.id);
    expect((await myCareer(w.me1)).promotion).toBeNull();
    await declinePromotion(w.boss, p.id, "Not this year, please wait");
    expect((await myCareer(w.me1)).promotion).toBeNull();
    const q = await w.propose(w.hr, w.g1.id);
    expect((await myCareer(w.me1)).promotion).toBeNull();
    await approvePromotion(w.boss, q.id, "Reviewed and agreed");
    expect((await myCareer(w.me1)).promotion).toMatchObject({ toRole: expect.any(String), status: "APPROVED" });
    // exactly these fields and nothing else: never the reason, a note, a user id or a warning
    expect(Object.keys((await myCareer(w.me1)).promotion!).sort()).toEqual(["appliedAt", "intendedOn", "status", "toRole"]);
    expect(JSON.stringify(await myCareer(w.me1))).not.toMatch(/SECRET/);
    const other = await login(w.t, "EMPLOYEE", w.g2.id);
    expect((await myCareer(other)).promotion).toBeNull();
    expect(await myCareer(await login(w.t, "EMPLOYEE"))).toMatchObject({ promotion: null, paths: [] });
  });
  it("shows the employee their own progress against the paths from their role", async () => {
    const w = await world();
    await pathFor(w);
    const c = await myCareer(w.me1);
    expect(c.paths).toHaveLength(1);
    expect(c.paths[0]).toMatchObject({ toRole: expect.any(String), minMonths: 24, requiredCourse: "Supervisory skills", courseValid: false, serviceMet: true });
    await holdCourse(w, w.g1.id);
    expect((await myCareer(w.me1)).paths[0].courseValid).toBe(true);
  });
});

describe("audit and personal data", () => {
  it("records every step by ids and codes, never the reason or a note", async () => {
    const w = await world();
    const p = await w.propose(w.hr, w.g1.id);
    await approvePromotion(w.boss, p.id, "SECRET-NOTE agreed after review");
    await db.employee.update({ where: { id: w.g1.id }, data: { categoryId: w.t.officeId } });
    await applyPromotion(w.hr, p.id);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "PROMOTION_" } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["PROMOTION_APPLY", "PROMOTION_APPROVE", "PROMOTION_PROPOSE"]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
  });
  it("puts an approved or applied promotion in the copy of their data, never one being considered or declined, and no one else's", async () => {
    const w = await world();
    const p = await w.propose(w.hr, w.g1.id);
    expect((await compileEmployeeData(w.t.org.id, w.g1.id)).sections.promotions.records).toEqual([]);
    await approvePromotion(w.boss, p.id, "Reviewed and agreed");
    expect(JSON.stringify((await compileEmployeeData(w.t.org.id, w.g1.id)).sections.promotions.records)).toMatch(/SECRET-REASON/);
    expect((await compileEmployeeData(w.t.org.id, w.g2.id)).sections.promotions.records).toEqual([]);
  });
  it("erasing an employee removes the words (the reason and every note), keeps the shape and the audit log, and touches no one else's", async () => {
    const w = await world();
    const p = await w.propose(w.hr, w.g1.id);
    await declinePromotion(w.boss, p.id, "SECRET-DECLINE not this year");
    const q = await w.propose(w.hr, w.g2.id);
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.g1.id, new Date()));
    expect(counts.promotionProposals).toBe(1);
    const gone = await db.promotionProposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(gone.reason).not.toMatch(/SECRET/);
    expect(gone.decisionNote ?? "").not.toMatch(/SECRET/);
    expect(gone.status).toBe("DECLINED");
    expect((await db.promotionProposal.findUniqueOrThrow({ where: { id: q.id } })).reason).toMatch(/SECRET-REASON/);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "PROMOTION_PROPOSE" } })).toBe(2);
  });
});

describe("the company's setting and the HR digest", () => {
  it("flags an approved promotion not yet applied after 14 days unless the company says otherwise", async () => {
    const w = await world();
    expect((await getHrPolicy(w.t.org.id)).promotionApplyAlertDays).toBe(14);
    const p = await w.propose(w.hr, w.g1.id);
    await approvePromotion(w.boss, p.id, "Reviewed and agreed");
    const flagged = async () => (await buildHrDigest(w.t.org.id)).sections.some((s) => s.key === "promotions-unapplied");
    expect(await flagged()).toBe(false);
    await db.promotionProposal.update({ where: { id: p.id }, data: { decidedAt: addDays(todayUtc(), -15) } });
    expect(await flagged()).toBe(true);
    await updateHrPolicy(w.hr, { promotionApplyAlertDays: 0 });
    expect(await flagged()).toBe(false);
    await updateHrPolicy(w.hr, { promotionApplyAlertDays: 30 });
    expect(await flagged()).toBe(false);
  });
  it("stops flagging once it is applied", async () => {
    const w = await world();
    const p = await w.propose(w.hr, w.g1.id);
    await approvePromotion(w.boss, p.id, "Reviewed and agreed");
    await db.promotionProposal.update({ where: { id: p.id }, data: { decidedAt: addDays(todayUtc(), -20) } });
    await db.employee.update({ where: { id: w.g1.id }, data: { categoryId: w.t.officeId } });
    await applyPromotion(w.hr, p.id);
    expect((await buildHrDigest(w.t.org.id)).sections.some((s) => s.key === "promotions-unapplied")).toBe(false);
  });
});
