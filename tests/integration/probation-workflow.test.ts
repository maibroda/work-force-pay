import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { decideProbation, markProbationInformed } from "@/server/services/contracts";
import { getHrPolicy, todayUtc } from "@/server/services/hr-policy";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import {
  decisionQueue,
  decideReview,
  designateDecider,
  listDeciders,
  markResponseRead,
  myProbationReviews,
  recommendProbation,
  respondToReview,
  reviewQueue,
  reviewRecommendation,
  reviewsForContract,
  revokeDecider,
  teamProbations,
} from "@/server/services/probation-workflow";
import { isolatedOrg, uid } from "../helpers";

// The probation workflow (docs/plans/probation-workflow-plan.md, built on the recommended answers): the reporting manager recommends, a DIFFERENT HR person reviews, an
// independent designated decider decides (never anyone in the chain above), the employee receives documented feedback and may respond once. Behind an HR policy switch that
// defaults OFF. The contract still changes only through the existing decision logic.

const NOTE = "Consistent attendance and good client feedback over the probation.";
const REVIEW_NOTE = "Checked against the policy: nothing outstanding.";
const FEEDBACK = "You met the standard and we are confirming you.";
const BAD = "Targets were missed in three of the last four weeks.";

async function user(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null) {
  return db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}${uid()}@pw.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
}
const ctxOf = (u: { id: string; organizationId: string; role: string; name: string; email: string; employeeId: string | null }): Ctx => ({ userId: u.id, orgId: u.organizationId, role: u.role as Ctx["role"], name: u.name, email: u.email, employeeId: u.employeeId });

async function world(switchOn = true) {
  const t = await isolatedOrg();
  await getHrPolicy(t.org.id);
  await db.hrPolicy.update({ where: { organizationId: t.org.id }, data: { probationWorkflow: switchOn, probationAlertDays: 30, maxProbationMonths: 6 } });
  const hrUser1 = await user(t, "HR_ADMIN");
  const hr1 = ctxOf(hrUser1);
  const hr2 = ctxOf(await user(t, "HR_ADMIN"));
  const bossUser = await user(t, "COMPANY_ADMIN");
  const boss = ctxOf(bossUser);
  const boss2 = ctxOf(await user(t, "COMPANY_ADMIN"));
  const mk = (firstName: string, extra: Record<string, unknown> = {}) => createEmployee(hr1, { firstName, lastName: "Probee", employmentDate: ago(80), categoryId: t.guardId, ...extra } as never);
  const mgrEmp = await mk("Manager", { categoryId: t.officeId });
  const emp = await mk("Employee", { reportingManagerId: mgrEmp.id, departmentId: t.deptId });
  const loner = await mk("Loner", { departmentId: t.deptId }); // no reporting manager
  const mgr = ctxOf(await user(t, "SUPERVISOR", mgrEmp.id));
  const otherMgr = ctxOf(await user(t, "SUPERVISOR", (await mk("Other manager")).id));
  const empUser = await user(t, "EMPLOYEE", emp.id);
  const empCtx = ctxOf(empUser);
  const contractFor = (e: { id: string }, endInDays = 10) =>
    db.employmentContract.create({
      data: {
        organizationId: t.org.id,
        contractNumber: `C-${uid()}${uid()}`,
        employeeId: e.id,
        type: "PROBATION",
        jobTitle: "Guard",
        startDate: new Date(`${ago(80)}T00:00:00Z`),
        probationMonths: 3,
        probationEndDate: addDays(todayUtc(), endInDays),
        probationOutcome: "PENDING",
        createdBy: "test",
      },
    });
  const contract = await contractFor(emp);
  const lonerContract = await contractFor(loner);
  const rec = (c = mgr, contractId = contract.id, recommendation: "CONFIRM" | "EXTEND" | "NOT_CONFIRM" = "CONFIRM", extra: Record<string, unknown> = {}) => recommendProbation(c, contractId, { recommendation, note: NOTE, ...extra } as never);
  const forwarded = async (recommendation: "CONFIRM" | "EXTEND" | "NOT_CONFIRM" = "CONFIRM", extra: Record<string, unknown> = {}) => {
    const r = await rec(mgr, contract.id, recommendation, extra);
    await reviewRecommendation(hr1, r.id, { outcome: "FORWARD", note: REVIEW_NOTE });
    return r;
  };
  return { t, hr1, hr2, hrUser1, boss, boss2, bossUser, mgr, otherMgr, empCtx, empUser, emp, loner, mgrEmp, contract, lonerContract, contractFor, rec, forwarded, mk };
}
function ago(days: number) {
  return iso(addDays(todayUtc(), -days));
}

describe("the policy switch", () => {
  it("is off by default: nothing changes, the workflow refuses, and the HR approver still decides exactly as before", async () => {
    const w = await world(false);
    expect((await getHrPolicy(w.t.org.id)).probationResponseDays).toBe(7);
    await expect(w.rec()).rejects.toThrow(/not switched on|switched off|not turned on/i);
    const done = await decideProbation(w.boss, w.contract.id, { decision: "CONFIRMED" });
    expect(done.contract.probationOutcome).toBe("CONFIRMED");
  });
  it("when on, the old direct decision refuses: the decision goes through the review", async () => {
    const w = await world();
    await expect(decideProbation(w.boss, w.contract.id, { decision: "CONFIRMED" })).rejects.toThrow(/review|recommend/i);
    expect((await db.employmentContract.findUniqueOrThrow({ where: { id: w.contract.id } })).probationOutcome).toBe("PENDING");
  });
});

describe("step 1: the reporting manager recommends", () => {
  it("records one round with a reasoned note, for the manager's own direct report only", async () => {
    const w = await world();
    const r = await w.rec();
    expect(r).toMatchObject({ status: "RECOMMENDED", round: 1, recommendation: "CONFIRM", recordedByHr: false });
    await expect(w.rec(w.otherMgr, w.contract.id)).rejects.toThrow(/not found/i);
    await expect(w.rec(w.empCtx, w.contract.id)).rejects.toThrow(/own probation/i);
  });
  it("needs a note of at least 20 characters, and one open recommendation at a time", async () => {
    const w = await world();
    await expect(recommendProbation(w.mgr, w.contract.id, { recommendation: "CONFIRM", note: "good" })).rejects.toThrow(/reasons|characters/i);
    await w.rec();
    await expect(w.rec()).rejects.toThrow(/already/i);
  });
  it("opens only within the alert window before the end date", async () => {
    const w = await world();
    const far = await w.contractFor(await w.mk("Far", { reportingManagerId: w.mgrEmp.id }), 90);
    await expect(w.rec(w.mgr, far.id)).rejects.toThrow(/not yet|window|too early/i);
  });
  it("an Extend recommendation needs months, within the company's longest probation", async () => {
    const w = await world();
    await expect(w.rec(w.mgr, w.contract.id, "EXTEND")).rejects.toThrow(/months/i);
    await expect(w.rec(w.mgr, w.contract.id, "EXTEND", { months: 4 })).rejects.toThrow(/at most|allows/i); // 3 + 4 = 7 > 6
    expect((await w.rec(w.mgr, w.contract.id, "EXTEND", { months: 2 })).recommendedMonths).toBe(2);
  });
  it("HR may record it only where the employee has no reporting manager, and it is marked", async () => {
    const w = await world();
    await expect(recommendProbation(w.hr1, w.contract.id, { recommendation: "CONFIRM", note: NOTE })).rejects.toThrow(/reporting manager/i);
    const r = await recommendProbation(w.hr1, w.lonerContract.id, { recommendation: "CONFIRM", note: NOTE });
    expect(r.recordedByHr).toBe(true);
  });
  it("is refused for someone's own probation", async () => {
    const w = await world();
    const mgrContract = await w.contractFor(w.mgrEmp);
    await db.employee.update({ where: { id: w.mgrEmp.id }, data: { reportingManagerId: w.mgrEmp.id } });
    await expect(w.rec(w.mgr, mgrContract.id)).rejects.toThrow(/own|not found/i);
  });
});

describe("step 2: a different HR person reviews", () => {
  it("forwards or returns it, with the policy checks recorded, and only a person with HR rights", async () => {
    const w = await world();
    const r = await w.rec();
    await expect(reviewRecommendation(w.mgr, r.id, { outcome: "FORWARD", note: REVIEW_NOTE })).rejects.toThrow(/permission/);
    const f = await reviewRecommendation(w.hr1, r.id, { outcome: "FORWARD", note: REVIEW_NOTE });
    expect(f).toMatchObject({ status: "FORWARDED", reviewedByUserId: w.hr1.userId });
    expect(f.withinMaxMonths).toBe(true);
    await expect(reviewRecommendation(w.hr2, r.id, { outcome: "FORWARD", note: REVIEW_NOTE })).rejects.toThrow(/already|forwarded|stage/i);
  });
  it("the HR person who recorded the recommendation cannot review it", async () => {
    const w = await world();
    const r = await recommendProbation(w.hr1, w.lonerContract.id, { recommendation: "CONFIRM", note: NOTE });
    await expect(reviewRecommendation(w.hr1, r.id, { outcome: "FORWARD", note: REVIEW_NOTE })).rejects.toThrow(/recorded|different/i);
    expect((await reviewRecommendation(w.hr2, r.id, { outcome: "FORWARD", note: REVIEW_NOTE })).status).toBe("FORWARDED");
  });
  it("Return sends it back: the first round stays as it was and a new recommendation starts round 2", async () => {
    const w = await world();
    const r1 = await w.rec();
    const back = await reviewRecommendation(w.hr1, r1.id, { outcome: "RETURN", note: "Please add the attendance evidence." });
    expect(back.status).toBe("RETURNED");
    const r2 = await w.rec();
    expect(r2.round).toBe(2);
    expect((await db.probationReview.findUniqueOrThrow({ where: { id: r1.id } })).recommendationNote).toBe(NOTE);
    expect((await reviewsForContract(w.hr1, w.contract.id)).map((x) => x.round)).toEqual([2, 1]);
  });
  it("HR cannot change the recommendation, and cannot decide", async () => {
    const w = await world();
    const r = await w.forwarded();
    await expect(decideReview(w.hr1, r.id, { decision: "CONFIRMED" })).rejects.toThrow(/designated|decide/i);
    await expect(decideReview(w.hr2, r.id, { decision: "CONFIRMED" })).rejects.toThrow(/designated|decide/i);
    expect((await db.probationReview.findUniqueOrThrow({ where: { id: r.id } })).recommendation).toBe("CONFIRM");
  });
});

describe("step 3: the independent decision", () => {
  it("the Company Administrator decides through the existing decision: the contract changes and the review is completed, in one step", async () => {
    const w = await world();
    const r = await w.forwarded();
    const out = await decideReview(w.boss, r.id, { decision: "CONFIRMED", feedback: FEEDBACK });
    expect(out.review).toMatchObject({ status: "DECIDED", decidedAgainstRecommendation: false });
    expect((await db.employmentContract.findUniqueOrThrow({ where: { id: w.contract.id } })).probationOutcome).toBe("CONFIRMED");
    const dec = await db.probationDecision.findFirstOrThrow({ where: { contractId: w.contract.id } });
    expect(dec).toMatchObject({ reviewId: r.id, decidedByUserId: w.boss.userId, decision: "CONFIRMED" });
    await expect(decideReview(w.boss2, r.id, { decision: "CONFIRMED" })).rejects.toThrow(/forwarded|stage|already/i);
  });
  it("never the recommender, the HR reviewer, or the employee, even when designated", async () => {
    const w = await world();
    const r = await w.forwarded();
    // the HR reviewer is a Company Administrator here: they reviewed it, so someone else decides
    const asReviewer = await w.rec(w.mgr, (await w.contractFor(await w.mk("Second", { reportingManagerId: w.mgrEmp.id }))).id);
    await reviewRecommendation(w.boss, asReviewer.id, { outcome: "FORWARD", note: REVIEW_NOTE });
    await expect(decideReview(w.boss, asReviewer.id, { decision: "CONFIRMED" })).rejects.toThrow(/reviewed/i);
    expect((await decideReview(w.boss2, asReviewer.id, { decision: "CONFIRMED" })).review.status).toBe("DECIDED");
    // a manager designated as a decider is still the recommender of this one
    await designateDecider(w.boss, { userId: w.mgr.userId, reason: "Department head" });
    await expect(decideReview(w.mgr, r.id, { decision: "CONFIRMED" })).rejects.toThrow(/recommend/i);
    // the employee's own login, designated, cannot decide their own probation
    await designateDecider(w.boss, { userId: w.empCtx.userId, reason: "Mistake" });
    await expect(decideReview(w.empCtx, r.id, { decision: "CONFIRMED" })).rejects.toThrow(/own probation|permission|designated/i);
  });
  it("a designated department head can decide for their department only, and revoking takes effect at once", async () => {
    const w = await world();
    const head = await user(w.t, "SUPERVISOR");
    const other = await db.department.create({ data: { organizationId: w.t.org.id, code: "OTH", name: "Other" } });
    const d1 = await designateDecider(w.boss, { userId: head.id, departmentId: other.id, reason: "Head of Other" });
    const r = await w.forwarded();
    await expect(decideReview(ctxOf(head), r.id, { decision: "CONFIRMED" })).rejects.toThrow(/designated|department/i);
    await revokeDecider(w.boss, d1.id, "Wrong department");
    await designateDecider(w.boss, { userId: head.id, departmentId: w.t.deptId, reason: "Head of Operations" });
    const dec = (await listDeciders(w.boss)).find((x) => x.userId === head.id && !x.revokedAt)!;
    expect((await decideReview(ctxOf(head), r.id, { decision: "CONFIRMED" })).review.status).toBe("DECIDED");
    await revokeDecider(w.boss, dec.id, "No longer head");
    const r2 = await (async () => {
      const c = await w.contractFor(await w.mk("Third", { reportingManagerId: w.mgrEmp.id, departmentId: w.t.deptId }));
      const x = await w.rec(w.mgr, c.id);
      await reviewRecommendation(w.hr1, x.id, { outcome: "FORWARD", note: REVIEW_NOTE });
      return x;
    })();
    await expect(decideReview(ctxOf(head), r2.id, { decision: "CONFIRMED" })).rejects.toThrow(/designated/i);
  });
  it("a decision other than the one recommended needs a fuller reason and is marked, never blocked", async () => {
    const w = await world();
    const r = await w.forwarded("CONFIRM");
    await expect(decideReview(w.boss, r.id, { decision: "FAILED", note: "no", feedback: BAD })).rejects.toThrow(/characters|fuller/i);
    const out = await decideReview(w.boss, r.id, { decision: "FAILED", note: "The client reported two serious lapses after the recommendation.", feedback: BAD });
    expect(out.review.decidedAgainstRecommendation).toBe(true);
    expect((await db.employmentContract.findUniqueOrThrow({ where: { id: w.contract.id } })).probationOutcome).toBe("FAILED");
  });
  it("feedback to the employee is required for Extend and Not confirmed, optional for Confirm", async () => {
    const w = await world();
    const r = await w.forwarded("EXTEND", { months: 2 });
    await expect(decideReview(w.boss, r.id, { decision: "EXTENDED", extensionMonths: 2, note: "Needs more time on the targets." })).rejects.toThrow(/feedback/i);
    const out = await decideReview(w.boss, r.id, { decision: "EXTENDED", extensionMonths: 2, note: "Needs more time on the targets.", feedback: "We are extending your probation by two months to meet the targets." });
    expect(out.review.status).toBe("DECIDED");
    const w2 = await world();
    const r2 = await w2.forwarded();
    expect((await decideReview(w2.boss, r2.id, { decision: "CONFIRMED" })).review.feedbackText).toBeNull();
  });
  it("a failed probation starts no exit by itself", async () => {
    const w = await world();
    const r = await w.forwarded("NOT_CONFIRM");
    await decideReview(w.boss, r.id, { decision: "FAILED", note: "Did not meet the standard after support.", feedback: BAD });
    expect(await db.exitRecord.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });
});

describe("step 4 and 5: the feedback and the employee's one response", () => {
  async function decided(w: Awaited<ReturnType<typeof world>>) {
    const r = await w.forwarded();
    await decideReview(w.boss, r.id, { decision: "CONFIRMED", feedback: FEEDBACK });
    return r;
  }
  it("the employee sees nothing until HR marks them told, then reads the feedback and not the internal reasons", async () => {
    const w = await world();
    const r = await decided(w);
    expect(await myProbationReviews(w.empCtx)).toEqual([]);
    const dec = await db.probationDecision.findFirstOrThrow({ where: { reviewId: r.id } });
    await markProbationInformed(w.hr1, dec.id);
    const mine = await myProbationReviews(w.empCtx);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ decision: "CONFIRMED", feedback: FEEDBACK, canRespond: true, response: null });
    expect(JSON.stringify(mine)).not.toMatch(/Consistent attendance|Checked against the policy|recommendationNote|reviewNote/);
    expect(await myProbationReviews(w.hr1)).toEqual([]); // it is about the signed-in employee only
  });
  it("one response only, inside the window; disagreeing needs a sentence; nobody else can respond", async () => {
    const w = await world();
    const r = await decided(w);
    const dec = await db.probationDecision.findFirstOrThrow({ where: { reviewId: r.id } });
    await expect(respondToReview(w.empCtx, r.id, { agree: true })).rejects.toThrow(/told|not found/i); // not told yet
    await markProbationInformed(w.hr1, dec.id);
    await expect(respondToReview(w.empCtx, r.id, { agree: false, comment: "no" })).rejects.toThrow(/say why|sentence/i);
    await expect(respondToReview(w.mgr, r.id, { agree: true })).rejects.toThrow(/not found|your own/i);
    const done = await respondToReview(w.empCtx, r.id, { agree: false, comment: "I was never given the targets in writing." });
    expect(done).toMatchObject({ responseAgreed: false });
    await expect(respondToReview(w.empCtx, r.id, { agree: true })).rejects.toThrow(/already/i);
    // the response changes nothing by itself
    expect((await db.employmentContract.findUniqueOrThrow({ where: { id: w.contract.id } })).probationOutcome).toBe("CONFIRMED");
  });
  it("closes after the company's days counted from the day HR told them, and 0 means no limit", async () => {
    const w = await world();
    const r = await decided(w);
    const dec = await db.probationDecision.findFirstOrThrow({ where: { reviewId: r.id } });
    await markProbationInformed(w.hr1, dec.id);
    await db.probationDecision.update({ where: { id: dec.id }, data: { informedAt: new Date(Date.now() - 9 * 86_400_000) } });
    await expect(respondToReview(w.empCtx, r.id, { agree: true })).rejects.toThrow(/window|days/i);
    expect((await myProbationReviews(w.empCtx))[0].canRespond).toBe(false);
    await db.hrPolicy.update({ where: { organizationId: w.t.org.id }, data: { probationResponseDays: 0 } });
    expect((await respondToReview(w.empCtx, r.id, { agree: true })).responseAgreed).toBe(true);
  });
  it("an unread response stays in the decider's queue until they record that they read it", async () => {
    const w = await world();
    const r = await decided(w);
    const dec = await db.probationDecision.findFirstOrThrow({ where: { reviewId: r.id } });
    await markProbationInformed(w.hr1, dec.id);
    await respondToReview(w.empCtx, r.id, { agree: false, comment: "I disagree with the assessment of my attendance." });
    expect((await decisionQueue(w.boss)).unreadResponses.map((x) => x.id)).toEqual([r.id]);
    await expect(markResponseRead(w.hr2, r.id)).rejects.toThrow(/designated|decide/i);
    await markResponseRead(w.boss, r.id);
    expect((await decisionQueue(w.boss)).unreadResponses).toEqual([]);
    await expect(markResponseRead(w.boss, r.id)).rejects.toThrow(/already/i);
  });
});

describe("who sees what in the queues", () => {
  it("a manager sees their own direct reports inside the window; HR sees recommendations awaiting review; only a designated decider sees what is forwarded", async () => {
    const w = await world();
    expect((await teamProbations(w.mgr)).map((x) => x.contractId)).toEqual([w.contract.id]);
    expect(await teamProbations(w.otherMgr)).toEqual([]);
    expect(await reviewQueue(w.hr1)).toEqual([]);
    const r = await w.rec();
    expect((await reviewQueue(w.hr1)).map((x) => x.id)).toEqual([r.id]);
    await expect(reviewQueue(w.mgr)).rejects.toThrow(/permission/);
    expect((await decisionQueue(w.boss)).toDecide).toEqual([]);
    await reviewRecommendation(w.hr1, r.id, { outcome: "FORWARD", note: REVIEW_NOTE });
    expect((await decisionQueue(w.boss)).toDecide.map((x) => x.id)).toEqual([r.id]);
    expect((await decisionQueue(w.hr2)).toDecide).toEqual([]);
    expect((await decisionQueue(w.hr1)).toDecide).toEqual([]); // the reviewer is excluded from deciding
  });
});

describe("designating deciders", () => {
  it("only the Company Administrator may, never the HR administrator; the person must belong to this company; every change is audited by ids", async () => {
    const w = await world();
    const head = await user(w.t, "SUPERVISOR");
    await expect(designateDecider(w.hr1, { userId: head.id, reason: "I would like to" })).rejects.toThrow(/permission/);
    const other = await world();
    await expect(designateDecider(other.boss, { userId: head.id, reason: "Not my company" })).rejects.toThrow(/not found/i);
    const d = await designateDecider(w.boss, { userId: head.id, reason: "SECRET-REASON head of the department" });
    await revokeDecider(w.boss, d.id, "SECRET-REVOKE no longer head");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "PROBATION_DECIDER" } } });
    expect(rows.map((x) => x.action).sort()).toEqual(["PROBATION_DECIDER_DESIGNATE", "PROBATION_DECIDER_REVOKE"]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
    await expect(listDeciders(w.hr1)).rejects.toThrow(/permission/);
  });
});

describe("privacy", () => {
  it("the audit log carries ids and the step, never the notes, the feedback or the response", async () => {
    const w = await world();
    const r = await w.rec(w.mgr, w.contract.id, "CONFIRM", { note: "SECRET-REC the manager's reasons in full sentences" });
    await reviewRecommendation(w.hr1, r.id, { outcome: "FORWARD", note: "SECRET-REVIEW the HR notes" });
    await decideReview(w.boss, r.id, { decision: "CONFIRMED", feedback: "SECRET-FEEDBACK what the employee is told" });
    const dec = await db.probationDecision.findFirstOrThrow({ where: { reviewId: r.id } });
    await markProbationInformed(w.hr1, dec.id);
    await respondToReview(w.empCtx, r.id, { agree: false, comment: "SECRET-RESPONSE my reply" });
    await markResponseRead(w.boss, r.id);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "PROBATION_" } } });
    expect(rows.length).toBeGreaterThan(4);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
  });
  it("the employee's copy of their data holds the texts, and erasure removes them and keeps the shape", async () => {
    const w = await world();
    const r = await w.rec(w.mgr, w.contract.id, "CONFIRM", { note: "SECRET-REC the manager's reasons in full sentences" });
    await reviewRecommendation(w.hr1, r.id, { outcome: "FORWARD", note: "SECRET-REVIEW the HR notes" });
    await decideReview(w.boss, r.id, { decision: "CONFIRMED", feedback: "SECRET-FEEDBACK what the employee is told" });
    const dec = await db.probationDecision.findFirstOrThrow({ where: { reviewId: r.id } });
    await markProbationInformed(w.hr1, dec.id);
    await respondToReview(w.empCtx, r.id, { agree: false, comment: "SECRET-RESPONSE my reply" });
    const copy = JSON.stringify((await compileEmployeeData(w.t.org.id, w.emp.id)).sections.probationReviews);
    for (const m of ["SECRET-REC", "SECRET-REVIEW", "SECRET-FEEDBACK", "SECRET-RESPONSE"]) expect(copy).toContain(m);
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.emp.id, new Date()));
    expect(counts.probationReviews).toBe(1);
    const after = await db.probationReview.findUniqueOrThrow({ where: { id: r.id } });
    expect(JSON.stringify(after)).not.toMatch(/SECRET/);
    expect(after).toMatchObject({ status: "DECIDED", recommendation: "CONFIRM", responseAgreed: false }); // the shape stays
  });
});

describe("tenant isolation", () => {
  it("another company's people cannot recommend, review, decide, respond or see the queues", async () => {
    const w = await world();
    const o = await world();
    const r = await w.forwarded();
    await expect(o.rec(o.mgr, w.contract.id)).rejects.toThrow(/not found/i);
    await expect(reviewRecommendation(o.hr1, r.id, { outcome: "RETURN", note: "Not my company at all." })).rejects.toThrow(/not found/i);
    await expect(decideReview(o.boss, r.id, { decision: "CONFIRMED" })).rejects.toThrow(/not found/i);
    await expect(respondToReview(o.empCtx, r.id, { agree: true })).rejects.toThrow(/not found/i);
    expect((await decisionQueue(o.boss)).toDecide).toEqual([]);
    expect(await reviewQueue(o.hr1)).toEqual([]);
  });
});
