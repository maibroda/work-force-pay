import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { addCandidate, approveRequisition, createRequisition, getCandidate, getRequisition, hireCandidate, listCandidates, scheduleInterview } from "@/server/services/recruitment";
import { setCriteria, setPanel } from "@/server/services/recruitment-panel";
import { applyInternally, myApplications, openVacancies, publishVacancy, unpublishVacancy, vacancyStatus } from "@/server/services/recruitment-internal";
import { isolatedOrg, uid } from "../helpers";

// Recruitment slice B: internal vacancies (the founder's approval of 2026-11-16 of section 5 of docs/plans/recruitment-depth-1a-plan.md, rules 6 and 7; slice chosen 2026-11-17).
// An approved requisition can be published inside the company with a mandatory deadline; any employee may apply; the system tells nobody (least of all the applicant's manager); an internal
// applicant is seen by HR and the panel only; and an internal applicant is already an employee, so the existing "hire" (which creates an employee) is refused for them.

type T = Awaited<ReturnType<typeof isolatedOrg>>;
const today = () => iso(todayUtc());
const inDays = (n: number) => iso(addDays(todayUtc(), n));
const SUMMARY = "Supervise a team of guards at the new Ikeja site: rota, reporting and client contact.";

async function login(t: T, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@vac.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function setup() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const boss = t.ctx("COMPANY_ADMIN");
  const mk = async (last: string) => {
    const emp = await createEmployee(hr, { firstName: "Vac", lastName: last, employmentDate: "2022-01-05", categoryId: t.officeId });
    return { emp, ctx: await login(t, "EMPLOYEE", emp.id) };
  };
  const applicant = await mk("Applicant");
  const manager = await mk("Manager");
  const other = await mk("Other");
  await db.employee.update({ where: { id: applicant.emp.id }, data: { reportingManagerId: manager.emp.id } });
  const req = await createRequisition(hr, { title: "Site Supervisor", categoryId: t.guardId, departmentId: t.deptId, headcount: 1, employmentType: "PERMANENT", justification: "PRIVATE-JUSTIFICATION replace a leaver quietly", budgetedMonthlyGross: 250000 });
  await approveRequisition(boss, req.id);
  return { t, hr, boss, applicant, manager, other, req };
}
type W = Awaited<ReturnType<typeof setup>>;
const publish = (w: W, deadline = inDays(10)) => publishVacancy(w.hr, w.req.id, { deadline, summary: SUMMARY });

describe("publishing a vacancy inside the company", () => {
  it("is done by HR on an approved requisition, with a mandatory deadline that is not in the past and a summary written for employees", async () => {
    const w = await setup();
    await expect(publishVacancy(w.hr, w.req.id, { deadline: "", summary: SUMMARY })).rejects.toThrow(/deadline/i);
    await expect(publishVacancy(w.hr, w.req.id, { deadline: inDays(-1), summary: SUMMARY })).rejects.toThrow(/past/i);
    await expect(publishVacancy(w.hr, w.req.id, { deadline: inDays(5), summary: "too short" })).rejects.toThrow(/summary/i);
    for (const ctx of [w.t.ctx("FINANCE"), w.t.ctx("AUDITOR"), w.t.ctx("SUPERVISOR"), w.applicant.ctx]) await expect(publish({ ...w, hr: ctx } as W), ctx.role).rejects.toThrow(/permission/);
    const pending = await createRequisition(w.hr, { title: "Driver", categoryId: w.t.guardId, headcount: 1, employmentType: "PERMANENT", justification: "Not approved yet" });
    await expect(publishVacancy(w.hr, pending.id, { deadline: inDays(5), summary: SUMMARY })).rejects.toThrow(/approved/i);
    await publish(w, today());
    expect(await vacancyStatus(w.hr, w.req.id)).toMatchObject({ published: true, open: true, summary: SUMMARY });
  });
  it("can be extended, taken down again, and belongs to the company", async () => {
    const w = await setup();
    await publish(w, inDays(3));
    await publish(w, inDays(20));
    expect((await vacancyStatus(w.hr, w.req.id)).deadline).toBe(inDays(20));
    await unpublishVacancy(w.hr, w.req.id);
    expect(await vacancyStatus(w.hr, w.req.id)).toMatchObject({ published: false, open: false });
    const o = await isolatedOrg();
    await expect(publishVacancy(o.ctx("HR_ADMIN"), w.req.id, { deadline: inDays(5), summary: SUMMARY })).rejects.toThrow(/not found/i);
  });
  it("is audited by ids and the deadline, never the summary", async () => {
    const w = await setup();
    await publish(w);
    await unpublishVacancy(w.hr, w.req.id);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { in: ["VACANCY_PUBLISH", "VACANCY_UNPUBLISH"] } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["VACANCY_PUBLISH", "VACANCY_UNPUBLISH"]);
    expect(JSON.stringify(rows)).not.toContain("Ikeja");
  });
});

describe("what an employee sees of a vacancy", () => {
  it("is the title, role, department, type, target start, deadline and the summary: never the justification, the budget, the hiring manager or who raised it", async () => {
    const w = await setup();
    await publish(w);
    const list = await openVacancies(w.other.ctx);
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(["applicationDeadline", "applied", "category", "department", "employmentType", "requisitionId", "summary", "targetStartDate", "title"]);
    expect(JSON.stringify(list)).not.toMatch(/PRIVATE-JUSTIFICATION|250000|budget|hiringManager|requestedBy/);
    expect(list[0]).toMatchObject({ title: "Site Supervisor", summary: SUMMARY, applied: false });
  });
  it("lists only vacancies that are published, approved, not past their deadline and of this company", async () => {
    const w = await setup();
    expect(await openVacancies(w.other.ctx)).toEqual([]);
    await publish(w);
    expect(await openVacancies(w.other.ctx)).toHaveLength(1);
    await db.jobRequisition.update({ where: { id: w.req.id }, data: { applicationDeadline: new Date(`${inDays(-1)}T00:00:00Z`) } });
    expect(await openVacancies(w.other.ctx)).toEqual([]);
    await db.jobRequisition.update({ where: { id: w.req.id }, data: { applicationDeadline: new Date(`${today()}T00:00:00Z`) } });
    expect(await openVacancies(w.other.ctx)).toHaveLength(1);
    await db.jobRequisition.update({ where: { id: w.req.id }, data: { status: "ON_HOLD" } });
    expect(await openVacancies(w.other.ctx)).toEqual([]);
    await db.jobRequisition.update({ where: { id: w.req.id }, data: { status: "APPROVED" } });
    const o = await isolatedOrg();
    const e = await createEmployee(o.ctx("HR_ADMIN"), { firstName: "Else", lastName: "Where", employmentDate: "2022-01-05", categoryId: o.officeId });
    expect(await openVacancies(await login(o, "EMPLOYEE", e.id))).toEqual([]);
  });
});

describe("applying inside the company", () => {
  it("is open to any employee of a vacancy that is open, once, and records an internal candidate with their name and the source INTERNAL", async () => {
    const w = await setup();
    await publish(w);
    const c = await applyInternally(w.applicant.ctx, w.req.id, "I have run a site team for two years");
    const row = await db.candidate.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ source: "INTERNAL", stage: "APPLIED", applicantEmployeeId: w.applicant.emp.id, firstName: "Vac", lastName: "Applicant", employeeId: null });
    expect((await openVacancies(w.applicant.ctx))[0].applied).toBe(true);
    await expect(applyInternally(w.applicant.ctx, w.req.id)).rejects.toThrow(/already applied/i);
  });
  it("is refused for a closed or taken-down vacancy, an unlinked login, a person no longer employed, and the hiring manager of the vacancy", async () => {
    const w = await setup();
    await expect(applyInternally(w.applicant.ctx, w.req.id)).rejects.toThrow(/isn't open/i);
    await publish(w);
    await expect(applyInternally(await login(w.t, "EMPLOYEE", null), w.req.id)).rejects.toThrow(/employee record/i);
    await db.jobRequisition.update({ where: { id: w.req.id }, data: { hiringManagerId: w.manager.emp.id } });
    await expect(applyInternally(w.manager.ctx, w.req.id)).rejects.toThrow(/hiring manager/i);
    await db.employee.update({ where: { id: w.other.emp.id }, data: { status: "EXITED" } });
    await expect(applyInternally(w.other.ctx, w.req.id)).rejects.toThrow(/no longer/i);
    await unpublishVacancy(w.hr, w.req.id);
    await expect(applyInternally(w.applicant.ctx, w.req.id)).rejects.toThrow(/isn't open/i);
  });
  it("tells nobody: no one is told, and the audit entry holds ids only, not the applicant's name or note", async () => {
    const w = await setup();
    await publish(w);
    await applyInternally(w.applicant.ctx, w.req.id, "PRIVATE-NOTE I want to leave my manager's team");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "INTERNAL_APPLY" } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE-NOTE|Applicant/);
    // the manager sees nothing of it: no page, no list, no record that carries the application
    expect(await myApplications(w.manager.ctx)).toEqual([]);
  });
  it("is seen by the applicant as their own: the vacancy, the stage and the date, and nothing HR recorded about them", async () => {
    const w = await setup();
    await publish(w);
    await applyInternally(w.applicant.ctx, w.req.id);
    const mine = await myApplications(w.applicant.ctx);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]).sort()).toEqual(["appliedOn", "candidateId", "stage", "title"]);
    expect(mine[0]).toMatchObject({ title: "Site Supervisor", stage: "APPLIED" });
    expect(await myApplications(w.other.ctx)).toEqual([]);
  });
});

describe("who sees an internal applicant", () => {
  async function applied() {
    const w = await setup();
    await publish(w);
    const c = await applyInternally(w.applicant.ctx, w.req.id);
    const outside = await addCandidate(w.hr, { requisitionId: w.req.id, firstName: "Outside", lastName: "Person", source: "WALK_IN" });
    return { w, c, outside };
  }
  it("is HR (the right to assess candidates) and the panel: other roles with HR access do not see them in a list, a requisition or on their page", async () => {
    const { w, c, outside } = await applied();
    expect((await listCandidates(w.hr)).map((x) => x.id).sort()).toEqual([c.id, outside.id].sort());
    expect((await getRequisition(w.hr, w.req.id))!.candidates).toHaveLength(2);
    expect(await getCandidate(w.hr, c.id)).not.toBeNull();
    for (const role of ["COMPANY_ADMIN", "SUPER_ADMIN", "FINANCE", "AUDITOR"] as const) {
      const ctx = w.t.ctx(role);
      expect((await listCandidates(ctx)).map((x) => x.id), role).toEqual([outside.id]);
      expect((await getRequisition(ctx, w.req.id))!.candidates.map((x) => x.id), role).toEqual([outside.id]);
      expect(await getCandidate(ctx, c.id), role).toBeNull();
      expect(await getCandidate(ctx, outside.id), role).not.toBeNull();
    }
  });
  // CHANGED 2026-11-17 on purpose (docs/plans/internal-selection-plan.md, S3, approved as recommended): an internal applicant gets no offer, so the approver exception an offer once gave is gone.
  // It used to say an approver sees an internal applicant once an offer exists; now even a recorded offer shows them to HR and the panel only.
  it("is not visible to an approver even if an offer was somehow recorded: an internal applicant is read by HR and the panel only", async () => {
    const { w, c } = await applied();
    await db.jobOffer.create({ data: { organizationId: w.t.org.id, offerNumber: `OFR-T${uid()}`, candidateId: c.id, jobTitle: "Site Supervisor", monthlyGross: 250000, startDate: new Date(`${inDays(30)}T00:00:00Z`), validUntil: new Date(`${inDays(20)}T00:00:00Z`), createdBy: "HR", createdById: "hr" } });
    expect(await getCandidate(w.boss, c.id)).toBeNull();
    expect((await listCandidates(w.boss)).map((x) => x.id)).not.toContain(c.id);
    expect(await getCandidate(w.hr, c.id)).not.toBeNull();
  });
});

describe("an internal applicant on an interview panel", () => {
  it("never has the applicant or their line manager sitting on it", async () => {
    const w = await setup();
    await publish(w);
    const c = await applyInternally(w.applicant.ctx, w.req.id);
    await setCriteria(w.hr, w.req.id, ["Experience", "Communication", "Reliability"]);
    const iv = await scheduleInterview(w.hr, { candidateId: c.id, scheduledAt: inDays(3), interviewer: "Panel" });
    const third = await createEmployee(w.hr, { firstName: "Vac", lastName: "Third", employmentDate: "2022-01-05", categoryId: w.t.officeId });
    await login(w.t, "EMPLOYEE", third.id);
    await expect(setPanel(w.hr, iv.id, { chairEmployeeId: w.other.emp.id, memberEmployeeIds: [w.manager.emp.id] })).rejects.toThrow(/line manager/i);
    await expect(setPanel(w.hr, iv.id, { chairEmployeeId: w.other.emp.id, memberEmployeeIds: [w.applicant.emp.id] })).rejects.toThrow(/applicant/i);
    await setPanel(w.hr, iv.id, { chairEmployeeId: w.other.emp.id, memberEmployeeIds: [third.id] });
    expect(await db.interviewPanelMember.count({ where: { interviewId: iv.id } })).toBe(2);
  });
});

describe("hiring an internal applicant", () => {
  it("is refused by the existing hire (it would create a second employee record for someone already on staff)", async () => {
    const w = await setup();
    await publish(w);
    const c = await applyInternally(w.applicant.ctx, w.req.id);
    await db.candidate.update({ where: { id: c.id }, data: { stage: "OFFER" } });
    const offer = await db.jobOffer.create({
      data: { organizationId: w.t.org.id, offerNumber: `OFR-T${uid()}`, candidateId: c.id, jobTitle: "Site Supervisor", monthlyGross: 250000, status: "ACCEPTED", startDate: new Date(`${inDays(30)}T00:00:00Z`), validUntil: new Date(`${inDays(20)}T00:00:00Z`), createdBy: "HR", createdById: "hr" },
    });
    await expect(hireCandidate(w.hr, { offerId: offer.id } as never)).rejects.toThrow(/already an employee|internal/i);
    expect(await db.employee.count({ where: { organizationId: w.t.org.id } })).toBe(3);
  });
});
