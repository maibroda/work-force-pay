import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ctxFor, isolatedOrg, uid } from "../helpers";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import {
  acknowledgeAppraisal,
  addCriterion,
  appraisalAttention,
  approveAppraisal,
  assignReviewer,
  closeCycle,
  eligibleReviewers,
  getAppraisal,
  getCycle,
  launchCycle,
  listCriteria,
  listCycles,
  myAppraisals,
  myQueue,
  returnReview,
  saveReview,
  saveSelfAssessment,
  submitReview,
  updateCriterion,
} from "@/server/services/appraisals";
import { buildHrDigest } from "@/server/services/reminders";

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const cycleInput = (over: Record<string, unknown> = {}) => ({ name: `Cycle ${uid()}`, kind: "ANNUAL" as const, periodStart: "2025-01-01", periodEnd: "2026-06-30", dueDate: day(30), ...over });

/** An org with a supervisor (a login, so they can review) managing two guards. */
async function setup() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const mgr = await createEmployee(hr, { firstName: "Sup", lastName: "Ervisor", employmentDate: "2022-01-01", categoryId: t.officeId });
  const user = await db.user.create({ data: { organizationId: t.org.id, email: `sup-${uid()}@appr.test`.toLowerCase(), name: "Sup Ervisor", role: "SUPERVISOR", passwordHash: "x", employeeId: mgr.id } });
  const reviewer: Ctx = { ...t.ctx("SUPERVISOR", mgr.id), userId: user.id, name: user.name };
  const g1 = await createEmployee(hr, { firstName: "Guard", lastName: "One", employmentDate: "2023-01-01", categoryId: t.guardId, reportingManagerId: mgr.id });
  const g2 = await createEmployee(hr, { firstName: "Guard", lastName: "Two", employmentDate: "2023-03-01", categoryId: t.guardId, reportingManagerId: mgr.id });
  return { t, hr, mgr, reviewer, g1, g2, approver: t.ctx("HR_ADMIN", null, 2), fin: t.ctx("FINANCE") };
}

async function launch(s: Awaited<ReturnType<typeof setup>>, over: Record<string, unknown> = {}) {
  const r = await launchCycle(s.hr, cycleInput({ categoryIds: [s.t.guardId], ...over }));
  const appraisals = await db.appraisal.findMany({ where: { cycleId: r.cycle.id }, orderBy: { employee: { employeeNumber: "asc" } } });
  return { ...r, appraisals };
}

async function rateAll(ctx: Ctx, id: string, rating = 3, extra: Record<string, unknown> = {}) {
  const a = await db.appraisal.findUniqueOrThrow({ where: { id }, include: { ratings: true } });
  await saveReview(ctx, id, { ratings: a.ratings.map((r) => ({ criterionId: r.criterionId, rating, comment: rating <= 2 || rating >= 5 ? "Because of the evidence" : undefined })), strengths: "Reliable", recommendation: "NONE", ...extra });
}

describe("criteria", () => {
  it("starts with defaults, can be added to, renamed and switched off, but never emptied", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const first = await listCriteria(hr);
    expect(first.length).toBeGreaterThanOrEqual(5);
    const added = await addCriterion(hr, { name: "Customer care", weight: 12, description: "Courtesy at the post" });
    await expect(addCriterion(hr, { name: "customer CARE", weight: 5 })).rejects.toThrow(/already a criterion/);
    await expect(addCriterion(hr, { name: "Zero", weight: 0 })).rejects.toThrow();
    await expect(addCriterion(t.ctx("AUDITOR"), { name: "Nope here", weight: 5 })).rejects.toThrow();
    expect((await updateCriterion(hr, added.id, { weight: 15 })).weight).toBe(15);
    await expect(updateCriterion(hr, added.id, { name: first[0].name })).rejects.toThrow(/already a criterion/);
    for (const c of first.slice(1)) await updateCriterion(hr, c.id, { active: false });
    await updateCriterion(hr, added.id, { active: false });
    await expect(updateCriterion(hr, first[0].id, { active: false })).rejects.toThrow(/At least one/);
  });
});

describe("launching a cycle", () => {
  it("creates an appraisal per eligible employee with the criteria copied, and finds the reviewer", async () => {
    const s = await setup();
    const r = await launch(s);
    expect(r.created).toBe(2); // the two guards; the supervisor is office staff
    expect(r.unassigned).toBe(0);
    for (const a of r.appraisals) {
      expect(a.reviewerName).toBe("Sup Ervisor");
      expect(a.status).toBe("DRAFT");
      const ratings = await db.appraisalRating.findMany({ where: { appraisalId: a.id } });
      expect(ratings.length).toBeGreaterThanOrEqual(5);
      expect(ratings.every((x) => x.criterionName && x.weight > 0 && x.rating === null)).toBe(true);
    }
    // a later change to the criteria doesn't touch it
    const crit = (await listCriteria(s.hr))[0];
    await updateCriterion(s.hr, crit.id, { weight: 99, name: "Renamed completely" });
    const again = await db.appraisalRating.findFirstOrThrow({ where: { appraisalId: r.appraisals[0].id, criterionId: crit.id } });
    expect(again.weight).not.toBe(99);
    expect(again.criterionName).not.toBe("Renamed completely");
  });

  it("skips short service, leaves reviewer blank when the manager can't review, and validates", async () => {
    const s = await setup();
    const { t, hr } = s;
    await createEmployee(hr, { firstName: "New", lastName: "Joiner", employmentDate: "2026-05-01", categoryId: t.guardId, reportingManagerId: s.mgr.id });
    const orphan = await createEmployee(hr, { firstName: "No", lastName: "Manager", employmentDate: "2023-01-01", categoryId: t.guardId });
    const r = await launch(s);
    expect(r.created).toBe(3); // g1, g2, orphan
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toMatch(/under 90 days/);
    expect(r.unassigned).toBe(1);
    expect((await db.appraisal.findFirstOrThrow({ where: { cycleId: r.cycle.id, employeeId: orphan.id } })).reviewerUserId).toBeNull();

    await expect(launchCycle(hr, cycleInput({ name: r.cycle.name }))).rejects.toThrow(/already a cycle/);
    await expect(launchCycle(hr, cycleInput({ periodEnd: "2024-01-01" }))).rejects.toThrow(/can't end before/);
    await expect(launchCycle(hr, cycleInput({ dueDate: "2024-01-01" }))).rejects.toThrow(/due date/);
    await expect(launchCycle(hr, cycleInput({ categoryIds: ["nope"] }))).rejects.toThrow(/No employee is eligible/);
    await expect(launchCycle(s.reviewer, cycleInput())).rejects.toThrow();
    await expect(launchCycle(t.ctx("AUDITOR"), cycleInput())).rejects.toThrow();

    // a specific employee can be reviewed regardless of their service length (e.g. a probation review)
    const probation = await launchCycle(hr, cycleInput({ kind: "PROBATION", employeeIds: [(await db.employee.findFirstOrThrow({ where: { organizationId: t.org.id, firstName: "New" } })).id] }));
    expect(probation.created).toBe(1);
  });

  it("makes the policy's minimum service adjustable", async () => {
    const s = await setup();
    await updateHrPolicy(s.hr, { appraisalMinServiceDays: 1500 });
    await expect(launch(s)).rejects.toThrow(/No employee is eligible/);
    await updateHrPolicy(s.hr, { appraisalMinServiceDays: 0 });
    expect((await launch(s)).created).toBe(2);
  });
});

describe("the review workflow", () => {
  it("runs self-assessment → review → sign-off → acknowledgement, with scores and the audit trail", async () => {
    const s = await setup();
    const r = await launch(s);
    const a = r.appraisals[0];
    const me = s.t.ctx("EMPLOYEE", a.employeeId);

    // the employee rates themselves; the reviewer can see it
    const full = await db.appraisal.findUniqueOrThrow({ where: { id: a.id }, include: { ratings: true } });
    await saveSelfAssessment(me, a.id, { ratings: full.ratings.map((x) => ({ criterionId: x.criterionId, rating: 5, comment: "I did well" })), comment: "A good year" });
    expect((await getAppraisal(s.reviewer, a.id)).selfGap).toBeNull(); // no reviewer ratings yet

    // rate: weights come from the snapshot
    await expect(submitReview(s.reviewer, a.id)).rejects.toThrow(/Rate every criterion/);
    await rateAll(s.reviewer, a.id, 4, { recommendation: "INCREMENT", goals: "Lead a night shift" });
    const submitted = await submitReview(s.reviewer, a.id);
    expect(Number(submitted.overallScore)).toBe(4);
    expect(submitted.overallBand).toBe("Exceeds expectations");
    expect(submitted.status).toBe("SUBMITTED");
    expect((await getAppraisal(s.reviewer, a.id)).selfGap).toBe(1); // 5 − 4

    // sign-off needs someone else
    await expect(approveAppraisal(s.reviewer, a.id)).rejects.toThrow(); // no permission
    await expect(approveAppraisal(s.t.ctx("OPERATIONS"), a.id)).rejects.toThrow();
    const approved = await approveAppraisal(s.approver, a.id, "Fair");
    expect(approved).toMatchObject({ status: "APPROVED", approvedBy: s.approver.name });
    await expect(approveAppraisal(s.approver, a.id)).rejects.toThrow(/already approved/);

    // the employee responds
    await expect(acknowledgeAppraisal(s.approver, a.id, { agree: true })).rejects.toThrow(/Only the employee/);
    const ack = await acknowledgeAppraisal(me, a.id, { agree: true });
    expect(ack).toMatchObject({ status: "ACKNOWLEDGED", employeeAgreed: true });
    await expect(acknowledgeAppraisal(me, a.id, { agree: true })).rejects.toThrow(/already responded/);

    const trail = await db.auditLog.findMany({ where: { organizationId: s.t.org.id, entity: "Appraisal", entityId: a.id }, orderBy: { createdAt: "asc" } });
    expect(trail.map((x) => x.action)).toEqual(["APPRAISAL_SELF", "APPRAISAL_SUBMIT", "APPRAISAL_APPROVE", "APPRAISAL_ACKNOWLEDGE"]);
  });

  it("only the assigned reviewer can rate, nobody reviews or approves their own, and low/high ratings need a comment", async () => {
    const s = await setup();
    const r = await launch(s);
    const [a, b] = r.appraisals;
    const other = s.t.ctx("SUPERVISOR", null, 2);
    await expect(saveReview(other, a.id, { ratings: [] })).rejects.toThrow(/assigned to Sup Ervisor/);
    await expect(saveReview(s.t.ctx("AUDITOR"), a.id, { ratings: [] })).rejects.toThrow();
    await expect(saveReview(s.t.ctx("EMPLOYEE", a.employeeId), a.id, { ratings: [] })).rejects.toThrow();

    // the reviewer reviewing themselves
    const mgrAppraisal = await launchCycle(s.hr, cycleInput({ name: `Mgr ${uid()}`, employeeIds: [s.mgr.id] }));
    const own = await db.appraisal.findFirstOrThrow({ where: { cycleId: mgrAppraisal.cycle.id } });
    expect(own.reviewerUserId).toBeNull(); // their manager isn't set, so nobody is assigned
    await expect(assignReviewer(s.hr, own.id, s.reviewer.userId)).rejects.toThrow(/review their own/);

    const full = await db.appraisal.findUniqueOrThrow({ where: { id: a.id }, include: { ratings: true } });
    await expect(saveReview(s.reviewer, a.id, { ratings: [{ criterionId: full.ratings[0].criterionId, rating: 2 }] })).rejects.toThrow(/Explain the 2/);
    await expect(saveReview(s.reviewer, a.id, { ratings: [{ criterionId: full.ratings[0].criterionId, rating: 5 }] })).rejects.toThrow(/Explain the 5/);
    await expect(saveReview(s.reviewer, a.id, { ratings: [{ criterionId: full.ratings[0].criterionId, rating: 6 }] })).rejects.toThrow();
    await expect(saveReview(s.reviewer, a.id, { ratings: [{ criterionId: "nope", rating: 3 }] })).rejects.toThrow(/isn't for a criterion/);
    await expect(saveReview(s.reviewer, a.id, { ratings: [{ criterionId: full.ratings[0].criterionId, rating: 3 }, { criterionId: full.ratings[0].criterionId, rating: 4 }] })).rejects.toThrow(/rated twice/);
    await saveReview(s.reviewer, a.id, { ratings: [{ criterionId: full.ratings[0].criterionId, rating: 2, comment: "Late on three occasions" }] });

    // the policy can relax that rule
    await updateHrPolicy(s.hr, { appraisalCommentAtOrBelow: 0, appraisalCommentAtOrAbove: 0 });
    await saveReview(s.reviewer, b.id, { ratings: [{ criterionId: (await db.appraisalRating.findFirstOrThrow({ where: { appraisalId: b.id } })).criterionId, rating: 5 }] });

    // an approver who is also the employee can't approve themselves
    await rateAll(s.reviewer, a.id, 3);
    await submitReview(s.reviewer, a.id);
    const hrEmp = await createEmployee(s.hr, { firstName: "Hr", lastName: "Person", employmentDate: "2022-01-01", categoryId: s.t.officeId });
    await db.appraisal.update({ where: { id: a.id }, data: { employeeId: hrEmp.id } });
    await expect(approveAppraisal(s.t.ctx("HR_ADMIN", hrEmp.id, 3), a.id)).rejects.toThrow(/own appraisal/);
    await expect(returnReview(s.t.ctx("HR_ADMIN", hrEmp.id, 3), a.id, "Look again please")).rejects.toThrow(/own appraisal/);
  });

  it("can be returned for rework, and the reviewer can't approve what they wrote", async () => {
    const s = await setup();
    const a = (await launch(s)).appraisals[0];
    await rateAll(s.reviewer, a.id, 3);
    await submitReview(s.reviewer, a.id);
    await expect(returnReview(s.approver, a.id, "no")).rejects.toThrow(/Say what/);
    // a reviewer who also holds the approve permission still can't sign off their own review
    const superApprover: Ctx = { ...s.t.ctx("COMPANY_ADMIN"), userId: s.reviewer.userId };
    await expect(approveAppraisal(superApprover, a.id)).rejects.toThrow(/someone else has to sign it off/);
    await expect(returnReview(superApprover, a.id, "Please recheck this one")).rejects.toThrow(/someone else/);

    const back = await returnReview(s.approver, a.id, "The attendance rating doesn't match the register");
    expect(back).toMatchObject({ status: "DRAFT", overallScore: null, returnNote: "The attendance rating doesn't match the register" });
    expect((await getAppraisal(s.reviewer, a.id)).can.review).toBe(true);
    await rateAll(s.reviewer, a.id, 3);
    const again = await submitReview(s.reviewer, a.id);
    expect(again.returnNote).toBeNull();
    await expect(submitReview(s.reviewer, a.id)).rejects.toThrow(/already been submitted/);
  });

  it("records a disagreement with its reason", async () => {
    const s = await setup();
    const a = (await launch(s)).appraisals[0];
    const me = s.t.ctx("EMPLOYEE", a.employeeId);
    await rateAll(s.reviewer, a.id, 2);
    await submitReview(s.reviewer, a.id);
    await expect(acknowledgeAppraisal(me, a.id, { agree: false, comment: "unfair" })).rejects.toThrow(/hasn't been signed off/);
    await approveAppraisal(s.approver, a.id);
    await expect(acknowledgeAppraisal(me, a.id, { agree: false })).rejects.toThrow(/say why/);
    await expect(acknowledgeAppraisal(me, a.id, { agree: false, comment: "no" })).rejects.toThrow(/say why/);
    const u = await acknowledgeAppraisal(me, a.id, { agree: false, comment: "I was on approved leave for two of those dates" });
    expect(u).toMatchObject({ employeeAgreed: false, status: "ACKNOWLEDGED" });
    expect((await getCycle(s.hr, a.cycleId))!.appraisals.find((x) => x.id === a.id)!.employeeAgreed).toBe(false);
    expect(await db.auditLog.count({ where: { organizationId: s.t.org.id, action: "APPRAISAL_DISPUTE" } })).toBe(1);
  });
});

describe("what the employee can see", () => {
  it("hides the reviewer's work until it is signed off", async () => {
    const s = await setup();
    const a = (await launch(s)).appraisals[0];
    const me = s.t.ctx("EMPLOYEE", a.employeeId);
    const full = await db.appraisal.findUniqueOrThrow({ where: { id: a.id }, include: { ratings: true } });
    await saveSelfAssessment(me, a.id, { ratings: [{ criterionId: full.ratings[0].criterionId, rating: 4 }], comment: "My view" });
    await rateAll(s.reviewer, a.id, 2, { strengths: "Punctual", improvements: "Paperwork", reviewerComment: "Needs to improve" });

    for (const stage of ["DRAFT", "SUBMITTED"] as const) {
      if (stage === "SUBMITTED") await submitReview(s.reviewer, a.id);
      const v = await getAppraisal(me, a.id);
      expect(v.redacted).toBe(true);
      expect(v.ratings.every((r) => r.rating === null && r.comment === null)).toBe(true);
      expect(v).toMatchObject({ overallScore: null, overallBand: null, strengths: null, improvements: null, reviewerComment: null, recommendation: "NONE" });
      expect(v.ratings[0].selfRating).toBe(4); // their own is still theirs
      expect(v.employeeSelfComment).toBe("My view");
      expect((await myAppraisals(me))[0].overallScore).toBeNull();
    }
    // even an HR admin looking at their own appraisal gets the employee's view
    const hrSelf = s.t.ctx("HR_ADMIN", a.employeeId, 5);
    expect((await getAppraisal(hrSelf, a.id)).redacted).toBe(true);
    // while HR and the reviewer see everything
    expect((await getAppraisal(s.hr, a.id)).ratings[0].rating).toBe(2);
    expect((await getAppraisal(s.reviewer, a.id)).strengths).toBe("Punctual");

    await approveAppraisal(s.approver, a.id);
    const released = await getAppraisal(me, a.id);
    expect(released.redacted).toBe(false);
    expect(released).toMatchObject({ strengths: "Punctual", overallBand: "Needs improvement" });
    expect(Number((await myAppraisals(me))[0].overallScore)).toBe(2);
  });

  it("keeps appraisals private from other employees, other organizations, and unrelated staff", async () => {
    const s = await setup();
    const a = (await launch(s)).appraisals[0];
    const colleague = s.t.ctx("EMPLOYEE", s.g2.id);
    await expect(getAppraisal(colleague, a.id)).rejects.toThrow(/not found/);
    await expect(getAppraisal(s.t.ctx("SUPERVISOR", null, 9), a.id)).rejects.toThrow(/not found/);
    expect((await getAppraisal(s.t.ctx("AUDITOR"), a.id)).id).toBe(a.id);
    const other = await isolatedOrg();
    await expect(getAppraisal(other.ctx("HR_ADMIN"), a.id)).rejects.toThrow(/not found/);
    await expect(saveSelfAssessment(colleague, a.id, { ratings: [] })).rejects.toThrow(/only assess yourself/);
    expect(await myAppraisals(s.t.ctx("EMPLOYEE"))).toEqual([]); // an unlinked login has none
  });

  it("can have self-assessment switched off, and closes once the manager submits", async () => {
    const s = await setup();
    const [a, b] = (await launch(s)).appraisals;
    const me = s.t.ctx("EMPLOYEE", a.employeeId);
    await rateAll(s.reviewer, a.id, 3);
    await submitReview(s.reviewer, a.id);
    await expect(saveSelfAssessment(me, a.id, { ratings: [] })).rejects.toThrow(/already submitted/);
    await updateHrPolicy(s.hr, { appraisalSelfAssessment: false });
    await expect(saveSelfAssessment(s.t.ctx("EMPLOYEE", b.employeeId), b.id, { ratings: [] })).rejects.toThrow(/isn't switched on/);
    expect((await getAppraisal(s.t.ctx("EMPLOYEE", b.employeeId), b.id)).can.selfAssess).toBe(false);
  });
});

describe("assigning, queues and closing", () => {
  it("lets HR assign a reviewer, builds each person's queue, and closes the cycle", async () => {
    const s = await setup();
    const orphan = await createEmployee(s.hr, { firstName: "No", lastName: "Boss", employmentDate: "2023-01-01", categoryId: s.t.guardId });
    const r = await launch(s);
    const a = r.appraisals.find((x) => x.employeeId === orphan.id)!;
    expect(a.reviewerUserId).toBeNull();
    await expect(submitReview(s.reviewer, a.id)).rejects.toThrow(/No reviewer has been assigned/);

    expect((await eligibleReviewers(s.hr)).map((u) => u.id)).toContain(s.reviewer.userId);
    const clerk = await db.user.create({ data: { organizationId: s.t.org.id, email: `clerk-${uid()}@appr.test`.toLowerCase(), name: "A Clerk", role: "EMPLOYEE", passwordHash: "x" } });
    await expect(assignReviewer(s.hr, a.id, clerk.id)).rejects.toThrow(/can't review/);
    await expect(assignReviewer(s.hr, a.id, "ghost")).rejects.toThrow(/can't review/);
    await expect(assignReviewer(s.reviewer, a.id, s.reviewer.userId)).rejects.toThrow();
    await assignReviewer(s.hr, a.id, s.reviewer.userId);

    const q = await myQueue(s.reviewer);
    expect(q.toReview).toHaveLength(3);
    expect(q.toApprove).toHaveLength(0);
    await rateAll(s.reviewer, a.id, 3);
    await submitReview(s.reviewer, a.id);
    expect((await myQueue(s.reviewer)).toReview).toHaveLength(2);
    expect((await myQueue(s.approver)).toApprove.map((x) => x.id)).toEqual([a.id]);
    await expect(assignReviewer(s.hr, a.id, s.reviewer.userId)).rejects.toThrow(/submitted/);

    const list = await listCycles(s.hr);
    expect(list.find((c) => c.id === r.cycle.id)).toMatchObject({ total: 3, completed: 0, counts: { SUBMITTED: 1, DRAFT: 2 } });
    await approveAppraisal(s.approver, a.id);
    const detail = (await getCycle(s.hr, r.cycle.id))!;
    expect(detail.average).toBe(3);
    expect(detail.bands).toEqual([{ band: "Meets expectations", count: 1 }]);
    expect(detail.unassigned).toBe(0);

    const closed = await closeCycle(s.hr, r.cycle.id);
    expect(closed.stillOpen).toBe(2);
    await expect(closeCycle(s.hr, r.cycle.id)).rejects.toThrow(/already closed/);
    const b = r.appraisals.find((x) => x.id !== a.id)!;
    await expect(saveReview(s.reviewer, b.id, { ratings: [] })).rejects.toThrow(/cycle is closed/);
    await expect(saveSelfAssessment(s.t.ctx("EMPLOYEE", b.employeeId), b.id, { ratings: [] })).rejects.toThrow(/cycle is closed/);
    expect((await myQueue(s.reviewer)).toReview).toHaveLength(0); // closed cycles drop out
  });

  it("flags overdue reviews and waiting sign-offs in the HR digest", async () => {
    const s = await setup();
    await db.user.create({ data: { organizationId: s.t.org.id, email: `hr-${uid()}@appr.test`.toLowerCase(), name: "HR", role: "HR_ADMIN", passwordHash: "x" } });
    const r = await launch(s);
    const [a, b] = r.appraisals;
    let d = await buildHrDigest(s.t.org.id);
    expect(d.sections.find((x) => x.key === "appraisals")).toBeUndefined(); // not due yet

    await db.appraisalCycle.update({ where: { id: r.cycle.id }, data: { dueDate: new Date(Date.now() - 3 * 86_400_000) } });
    d = await buildHrDigest(s.t.org.id);
    expect(d.sections.find((x) => x.key === "appraisals")!.count).toBe(2);
    expect(d.sections.find((x) => x.key === "appraisals")!.items[0].text).toMatch(/was due/);

    await rateAll(s.reviewer, a.id, 3);
    await submitReview(s.reviewer, a.id);
    const att = await appraisalAttention(s.t.org.id, todayUtc());
    expect(att.overdue.map((x) => x.id)).toEqual([b.id]);
    expect(att.awaiting.map((x) => x.id)).toEqual([a.id]);
    d = await buildHrDigest(s.t.org.id);
    expect(d.sections.find((x) => x.key === "approvals")!.items.some((i) => /Appraisal —/.test(i.text))).toBe(true);
  });

  it("leaves leavers out of the overdue list", async () => {
    const s = await setup();
    const r = await launch(s);
    await db.appraisalCycle.update({ where: { id: r.cycle.id }, data: { dueDate: new Date(Date.now() - 3 * 86_400_000) } });
    await db.employee.update({ where: { id: s.g1.id }, data: { status: "RESIGNED" } });
    const att = await appraisalAttention(s.t.org.id, todayUtc());
    expect(att.overdue.map((x) => x.employeeId)).toEqual([s.g2.id]);
    await expect(saveReview(s.reviewer, r.appraisals.find((x) => x.employeeId === s.g1.id)!.id, { ratings: [] })).rejects.toThrow(/has left/);
  });
});

describe("demo data", () => {
  it("seeds a mid-year cycle with appraisals in every state", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const c = (await listCycles(hr)).find((x) => x.name === "2026 mid-year review")!;
    expect(c).toBeDefined();
    expect(c.counts).toMatchObject({ APPROVED: 1, SUBMITTED: 1 });
    expect(c.counts.DRAFT).toBeGreaterThanOrEqual(2);
    const detail = (await getCycle(hr, c.id))!;
    expect(detail.unassigned).toBe(0);
    expect(detail.appraisals.some((a) => a.selfSubmittedAt && a.status === "DRAFT")).toBe(true);
  });
});
