import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { addCandidate, approveRequisition, createOffer, createRequisition, getCandidate, hireCandidate, moveCandidate, scheduleInterview } from "@/server/services/recruitment";
import { applyInternally, internalMove, publishVacancy, startInternalMove } from "@/server/services/recruitment-internal";
import { applyPromotion, approvePromotion, listPromotions, myCareer, withdrawPromotion } from "@/server/services/career";
import { isolatedOrg, uid } from "../helpers";

// Recruitment slice B, part 2: what "selected" means for an internal applicant (the founder's approval of 2026-11-17 of docs/plans/internal-selection-plan.md, S1 to S6 as recommended).
// Selecting an internal applicant starts a PROMOTION PROPOSAL through the existing process, and nothing else: no new employee, no offer, no pay. The existing rules (a different HR person
// approves, warnings need a reason, the employee sees it only once approved) apply unchanged, and nobody is told by the system.

type T = Awaited<ReturnType<typeof isolatedOrg>>;
const inDays = (n: number) => iso(addDays(todayUtc(), n));
const REASON = "Strong supervisory record and the vacancy needs someone who knows the site.";

async function login(t: T, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@move.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

/** An applicant in the OFFICE category applies to a published vacancy for a GUARD-category role: a change of role, as the promotion process needs. */
async function setup(opts: { headcount?: number } = {}) {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const hr2 = t.ctx("HR_ADMIN", null, 2);
  const boss = t.ctx("COMPANY_ADMIN");
  const mk = async (last: string, categoryId = t.officeId) => {
    const emp = await createEmployee(hr, { firstName: "Move", lastName: last, employmentDate: "2022-01-05", categoryId });
    return { emp, ctx: await login(t, "EMPLOYEE", emp.id) };
  };
  const applicant = await mk("Applicant");
  const manager = await mk("Manager");
  const other = await mk("Other");
  await db.employee.update({ where: { id: applicant.emp.id }, data: { reportingManagerId: manager.emp.id } });
  const req = await createRequisition(hr, { title: "Site Supervisor", categoryId: t.guardId, departmentId: t.deptId, headcount: opts.headcount ?? 1, employmentType: "PERMANENT", justification: "Replace a leaver", budgetedMonthlyGross: 250000 } as never);
  await approveRequisition(boss, req.id);
  await publishVacancy(hr, req.id, { deadline: inDays(10), summary: "Supervise a team of guards at the new Ikeja site: rota, reporting and client contact." });
  const cand = await applyInternally(applicant.ctx, req.id);
  // through the pipeline to the offer stage (the stage an offer would be raised from)
  await db.candidate.update({ where: { id: cand.id }, data: { stage: "OFFER" } });
  return { t, hr, hr2, boss, applicant, manager, other, req, cand };
}
type W = Awaited<ReturnType<typeof setup>>;
const start = (w: W, over: Record<string, unknown> = {}, ctx: Ctx = w.hr) => startInternalMove(ctx, w.cand.id, { intendedOn: inDays(14), reason: REASON, ...over } as never);

describe("starting the move (S1, S5)", () => {
  it("creates a promotion proposal for that employee to the requisition's role, written by HR and linked to the candidate; the candidate stays where they are", async () => {
    const w = await setup();
    const p = await start(w);
    expect(p).toMatchObject({ employeeId: w.applicant.emp.id, fromCategoryId: w.t.officeId, toCategoryId: w.t.guardId, status: "PROPOSED", reason: REASON, candidateId: w.cand.id });
    expect(iso(p.intendedOn)).toBe(inDays(14));
    expect((await db.candidate.findUniqueOrThrow({ where: { id: w.cand.id } })).stage).toBe("OFFER");
    expect(await db.employee.count({ where: { organizationId: w.t.org.id } })).toBe(3); // no new employee: only the applicant, the manager and the other person the helper made
  });

  it("copies nothing from the interviews: the reason is HR's own words, and the audit entry holds ids only", async () => {
    const w = await setup();
    await db.interview.create({ data: { organizationId: w.t.org.id, candidateId: w.cand.id, round: 1, scheduledAt: new Date(), interviewer: "Panel", feedback: "SECRET-FEEDBACK very strong on rota planning", completedAt: new Date(), createdBy: "HR" } as never });
    const p = await start(w);
    expect(JSON.stringify(p)).not.toContain("SECRET-FEEDBACK");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "INTERNAL_MOVE_START" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe(w.cand.id);
    const text = JSON.stringify(rows);
    expect(text).toContain(p.id);
    expect(text).not.toMatch(/SECRET-FEEDBACK|Strong supervisory record/);
  });

  it("is for the HR administrator alone: no other role, the applicant, their manager or another employee can start it", async () => {
    const w = await setup();
    for (const ctx of [w.boss, w.t.ctx("FINANCE"), w.t.ctx("AUDITOR"), w.t.ctx("SUPERVISOR"), w.t.ctx("PAYROLL_ADMIN"), w.applicant.ctx, w.manager.ctx, w.other.ctx])
      await expect(start(w, {}, ctx), ctx.role).rejects.toThrow(/permission|not found/i);
    expect(await db.promotionProposal.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });

  it("is for an internal applicant who has reached the offer stage, not an outside candidate or one earlier in the pipeline, and belongs to the company", async () => {
    const w = await setup();
    const outside = await addCandidate(w.hr, { requisitionId: w.req.id, firstName: "Outside", lastName: "Person", source: "WALK_IN" } as never);
    await db.candidate.update({ where: { id: outside.id }, data: { stage: "OFFER" } });
    await expect(startInternalMove(w.hr, outside.id, { intendedOn: inDays(14), reason: REASON } as never)).rejects.toThrow(/internal/i);
    await db.candidate.update({ where: { id: w.cand.id }, data: { stage: "INTERVIEW" } });
    await expect(start(w)).rejects.toThrow(/offer stage/i);
    await db.candidate.update({ where: { id: w.cand.id }, data: { stage: "OFFER" } });
    const o = await isolatedOrg();
    await expect(startInternalMove(o.ctx("HR_ADMIN"), w.cand.id, { intendedOn: inDays(14), reason: REASON } as never)).rejects.toThrow(/not found/i);
  });

  it("wants a real reason and a date that is not in the past, and the employee must still be active", async () => {
    const w = await setup();
    await expect(start(w, { reason: "ok" })).rejects.toThrow();
    await expect(start(w, { intendedOn: inDays(-1) })).rejects.toThrow(/past/i);
    await expect(start(w, { intendedOn: "soon" })).rejects.toThrow();
    await db.employee.update({ where: { id: w.applicant.emp.id }, data: { status: "RESIGNED" } });
    await expect(start(w)).rejects.toThrow(/no longer/i);
    expect(await db.promotionProposal.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });

  it("is refused for a move to the role they already hold, pointing to the employee screens for a lateral move (S2)", async () => {
    const w = await setup();
    await db.employee.update({ where: { id: w.applicant.emp.id }, data: { categoryId: w.t.guardId } });
    await expect(start(w)).rejects.toThrow(/lateral|same role|employee screens/i);
  });

  it("follows the panel rule for an offer: a candidate a panel interviewed needs the chair's recommendation and a second person's approval first", async () => {
    const w = await setup();
    const iv = await scheduleInterview(w.hr, { candidateId: w.cand.id, scheduledAt: inDays(3), interviewer: "Panel" } as never);
    await db.interviewPanelMember.create({ data: { organizationId: w.t.org.id, interviewId: iv.id, employeeId: w.other.emp.id, isChair: true } });
    await expect(start(w)).rejects.toThrow(/recommend/i);
    await db.candidateSelection.create({ data: { organizationId: w.t.org.id, candidateId: w.cand.id, status: "PENDING", recommendedById: "u1", recommendedBy: "Chair", note: "Recommended" } });
    await expect(start(w)).rejects.toThrow(/not been approved/i);
    await db.candidateSelection.update({ where: { candidateId: w.cand.id }, data: { status: "APPROVED", decidedById: "u2", decidedBy: "Second" } });
    await expect(start(w)).resolves.toBeTruthy();
  });

  it("only one live proposal at a time for a candidate, and a position taken by a live move is not offered to a second", async () => {
    const w = await setup();
    await start(w);
    await expect(start(w)).rejects.toThrow(/already/i);
    const second = await login(w.t, "EMPLOYEE", (await createEmployee(w.hr, { firstName: "Move", lastName: "Second", employmentDate: "2022-01-05", categoryId: w.t.officeId })).id);
    const c2 = await applyInternally(second, w.req.id);
    await db.candidate.update({ where: { id: c2.id }, data: { stage: "OFFER" } });
    await expect(startInternalMove(w.hr, c2.id, { intendedOn: inDays(14), reason: REASON } as never)).rejects.toThrow(/filled|position/i);
  });
});

describe("the existing promotion rules apply unchanged", () => {
  it("a different HR person approves, never the one who started it; the system's warning needs a written reason", async () => {
    const w = await setup();
    const p = await start(w);
    expect(p.warnings.length).toBeGreaterThan(0); // no career path is set for this move, so there is a warning
    await expect(approvePromotion(w.hr, p.id, "Approved on the evidence")).rejects.toThrow();
    await expect(approvePromotion(w.hr2, p.id)).rejects.toThrow(/reason/i);
    expect(await approvePromotion(w.hr2, p.id, "Approved: no career path set, role is needed now")).toMatchObject({ status: "APPROVED" });
  });

  it("the employee sees nothing until it is approved, and their manager sees nothing at all", async () => {
    const w = await setup();
    const p = await start(w);
    expect((await myCareer(w.applicant.ctx)).promotion).toBeNull();
    expect((await myCareer(w.manager.ctx)).promotion).toBeNull();
    await expect(listPromotions(w.manager.ctx)).rejects.toThrow(/permission/);
    await approvePromotion(w.hr2, p.id, "Approved: no career path set, role is needed now");
    expect((await myCareer(w.applicant.ctx)).promotion).toMatchObject({ status: "APPROVED" });
    expect((await myCareer(w.manager.ctx)).promotion).toBeNull();
  });
});

describe("applying it, and counting (S6)", () => {
  async function approved(w: W) {
    const p = await start(w);
    await approvePromotion(w.hr2, p.id, "Approved: no career path set, role is needed now");
    return p;
  }

  it("when HR has changed the role and marks it applied, the candidate is 'moved internally' and the vacancy is filled; until then neither", async () => {
    const w = await setup();
    const p = await approved(w);
    expect((await db.candidate.findUniqueOrThrow({ where: { id: w.cand.id } })).stage).toBe("OFFER");
    expect((await db.jobRequisition.findUniqueOrThrow({ where: { id: w.req.id } })).status).toBe("APPROVED");
    await expect(applyPromotion(w.hr, p.id)).rejects.toThrow(/role/i); // the role has not been changed yet
    await db.employee.update({ where: { id: w.applicant.emp.id }, data: { categoryId: w.t.guardId } });
    await applyPromotion(w.hr, p.id);
    expect(await db.candidate.findUniqueOrThrow({ where: { id: w.cand.id } })).toMatchObject({ stage: "MOVED", employeeId: null });
    expect((await db.jobRequisition.findUniqueOrThrow({ where: { id: w.req.id } })).status).toBe("FILLED");
    expect(await internalMove(w.hr, w.cand.id)).toMatchObject({ proposalId: p.id, status: "APPLIED" });
  });

  it("an internal move is not a hire: no candidate is counted as hired, and a vacancy for two posts is part filled by one move", async () => {
    const w = await setup({ headcount: 2 });
    const p = await approved(w);
    await db.employee.update({ where: { id: w.applicant.emp.id }, data: { categoryId: w.t.guardId } });
    await applyPromotion(w.hr, p.id);
    expect(await db.candidate.count({ where: { requisitionId: w.req.id, stage: "HIRED" } })).toBe(0);
    expect((await db.jobRequisition.findUniqueOrThrow({ where: { id: w.req.id } })).status).toBe("APPROVED"); // one of two posts is still open
  });

  it("a live move holds its position against an outside hire, and a declined or withdrawn one gives it back", async () => {
    const w = await setup();
    const p = await start(w);
    const outside = await addCandidate(w.hr, { requisitionId: w.req.id, firstName: "Outside", lastName: "Hire", source: "WALK_IN", email: `o${uid()}@x.test` } as never);
    await db.candidate.update({ where: { id: outside.id }, data: { stage: "OFFER" } });
    const offer = await db.jobOffer.create({ data: { organizationId: w.t.org.id, offerNumber: `OFR-T${uid()}`, candidateId: outside.id, jobTitle: "Site Supervisor", monthlyGross: 250000, status: "ACCEPTED", startDate: new Date(`${inDays(30)}T00:00:00Z`), validUntil: new Date(`${inDays(20)}T00:00:00Z`), createdBy: "HR", createdById: "hr" } as never });
    await expect(hireCandidate(w.hr, { offerId: offer.id } as never)).rejects.toThrow(/filled|position/i);
    await withdrawPromotion(w.hr, p.id, "Withdrawn: the move is off");
    await expect(start(w)).resolves.toBeTruthy(); // the position is free again, so the move can be started again
  });
});

describe("no offer for an internal applicant (S3), and no exception for an approver", () => {
  it("an offer cannot be raised for an internal applicant: the approved promotion replaces it", async () => {
    const w = await setup();
    await expect(createOffer(w.hr, { candidateId: w.cand.id, jobTitle: "Site Supervisor", monthlyGross: 250000, employmentType: "PERMANENT", startDate: inDays(30) } as never)).rejects.toThrow(/internal|promotion/i);
  });

  it("an internal applicant is read by HR and the panel only, even if an offer was somehow recorded", async () => {
    const w = await setup();
    await db.jobOffer.create({ data: { organizationId: w.t.org.id, offerNumber: `OFR-T${uid()}`, candidateId: w.cand.id, jobTitle: "Site Supervisor", monthlyGross: 250000, startDate: new Date(`${inDays(30)}T00:00:00Z`), validUntil: new Date(`${inDays(20)}T00:00:00Z`), createdBy: "HR", createdById: "hr" } as never });
    expect(await getCandidate(w.boss, w.cand.id)).toBeNull();
    expect(await getCandidate(w.hr, w.cand.id)).not.toBeNull();
  });
});

describe("closing an internal applicant who has a live move", () => {
  it("is refused until the promotion proposal is withdrawn; and a candidate already moved cannot be moved again", async () => {
    const w = await setup();
    const p = await start(w);
    await expect(moveCandidate(w.hr, w.cand.id, "REJECTED", "Not selected after all")).rejects.toThrow(/promotion/i);
    await withdrawPromotion(w.hr, p.id, "Withdrawn: the move is off");
    await expect(moveCandidate(w.hr, w.cand.id, "REJECTED", "Not selected after all")).resolves.toBeTruthy();
    await expect(moveCandidate(w.hr, w.cand.id, "OFFER")).rejects.toThrow(/already/i);
    await db.candidate.update({ where: { id: w.cand.id }, data: { stage: "MOVED" } });
    await expect(moveCandidate(w.hr, w.cand.id, "OFFER")).rejects.toThrow(/already moved/i);
  });
});

describe("erasing a former employee who applied internally", () => {
  it("clears their application too (name, note, interview words), found through the applicant link, and touches no one else's", async () => {
    const w = await setup();
    await db.candidate.update({ where: { id: w.cand.id }, data: { notes: "SECRET-NOTE I want to leave my manager's team" } });
    await db.interview.create({ data: { organizationId: w.t.org.id, candidateId: w.cand.id, round: 1, scheduledAt: new Date(), interviewer: "Panel", feedback: "SECRET-FEEDBACK strong", completedAt: new Date(), createdBy: "HR" } as never });
    const other = await applyInternally(w.other.ctx, w.req.id, "OTHER-STAYS note about another applicant");
    const { anonymizeEmployee } = await import("@/server/services/employee-retention");
    await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.applicant.emp.id, new Date()));
    const mine = await db.candidate.findUniqueOrThrow({ where: { id: w.cand.id } });
    expect(JSON.stringify(mine)).not.toMatch(/SECRET-NOTE|Applicant/);
    expect(mine.anonymizedAt).not.toBeNull();
    expect(JSON.stringify(await db.interview.findMany({ where: { candidateId: w.cand.id } }))).not.toContain("SECRET-FEEDBACK");
    expect((await db.candidate.findUniqueOrThrow({ where: { id: other.id } })).notes).toContain("OTHER-STAYS");
  });
});
