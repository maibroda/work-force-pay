import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { getHrPolicy, updateHrPolicy } from "@/server/services/hr-policy";
import {
  acknowledgePlan,
  addEmployeeComment,
  addObjective,
  approveOutcome,
  approveStart,
  eligibleOwners,
  getPlan,
  listPlans,
  myPlans,
  planAttention,
  planFromAppraisal,
  createPlan,
  proposeOutcome,
  recordReview,
  removeObjective,
  returnOutcome,
  returnPlan,
  submitPlan,
  updatePlan,
  withdrawPlan,
} from "@/server/services/pip";
import { isolatedOrg, uid } from "../helpers";

// Performance management, step (b): the performance improvement plan (the founder's go of 2026-11-07; plan docs/plans/performance-improvement-plan.md).
// Recommended answers were used: HR runs the plans, a second person starts a plan and approves its outcome, the employee sees and answers it.

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const SECRET = "SECRET-CONCERN-TEXT lateness at the post";

/** A real user row, so the plan owner can be chosen and checked. Each call is a different person. */
async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@pip.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

async function world() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN"); // drafts
  const owner = await login(t, "HR_ADMIN"); // owns the plan
  const boss = await login(t, "COMPANY_ADMIN"); // approves
  const boss2 = await login(t, "COMPANY_ADMIN");
  const guard = await createEmployee(hr, { firstName: "Gbenga", lastName: "Plan", employmentDate: "2024-01-05", categoryId: t.guardId });
  const other = await createEmployee(hr, { firstName: "Hauwa", lastName: "Other", employmentDate: "2024-01-05", categoryId: t.guardId });
  const me = await login(t, "EMPLOYEE", guard.id);
  const meOther = await login(t, "EMPLOYEE", other.id);
  const draft = (over: Record<string, unknown> = {}) =>
    createPlan(hr, { employeeId: guard.id, concerns: SECRET, startDate: day(-20), ownerUserId: owner.userId, ...over } as never);
  /** A plan with one objective, submitted. */
  async function submitted(over: Record<string, unknown> = {}) {
    const p = await draft(over);
    const o = await addObjective(hr, p.id, { gap: "Arrives late to post", target: "No late arrival in the last 30 days", support: "Shift swap to a closer post", dueDate: day(30) });
    await submitPlan(hr, p.id);
    return { p, o };
  }
  async function active(over: Record<string, unknown> = {}) {
    const x = await submitted(over);
    await approveStart(boss, x.p.id);
    return x;
  }
  return { t, hr, owner, boss, boss2, guard, other, me, meOther, draft, submitted, active };
}

describe("the company's limits are settings", () => {
  it("start at 60 days, 90 at most, one extension of at most 30 days, a review every 14 days", async () => {
    const t = await isolatedOrg();
    const p = await getHrPolicy(t.org.id);
    expect([p.pipDefaultDays, p.pipMaxDays, p.pipMaxExtensions, p.pipMaxExtensionDays, p.pipReviewIntervalDays]).toEqual([60, 90, 1, 30, 14]);
  });
  it("can be changed by someone who configures HR, and the default can never exceed the longest", async () => {
    const t = await isolatedOrg();
    const hr = await login(t, "HR_ADMIN");
    await updateHrPolicy(hr, { pipMaxDays: 120, pipDefaultDays: 100 });
    expect((await getHrPolicy(t.org.id)).pipMaxDays).toBe(120);
    await expect(updateHrPolicy(hr, { pipDefaultDays: 130 })).rejects.toThrow(/default.*longest|longest.*default/i);
    await expect(updateHrPolicy(hr, { pipMaxDays: 90 })).rejects.toThrow(/default.*longest|longest.*default/i); // the default (100) would then exceed it
  });
});

describe("drafting a plan", () => {
  it("HR drafts a plan for an active employee: the dates, the owner and who drafted it are recorded, and the end is the start plus the default length", async () => {
    const w = await world();
    const p = await w.draft();
    expect(p).toMatchObject({ status: "DRAFT", employeeId: w.guard.id, ownerUserId: w.owner.userId, draftedByUserId: w.hr.userId, extensionsUsed: 0 });
    expect(p.endDate.toISOString().slice(0, 10)).toBe(new Date(Date.parse(day(-20)) + 60 * 86_400_000).toISOString().slice(0, 10));
  });
  it("takes its length from the request, within the company's longest", async () => {
    const w = await world();
    const p = await w.draft({ days: 45 });
    expect(p.endDate.toISOString().slice(0, 10)).toBe(new Date(Date.parse(day(-20)) + 45 * 86_400_000).toISOString().slice(0, 10));
    const w2 = await world();
    await expect(w2.draft({ days: 91 })).rejects.toThrow(/at most 90/);
    await expect(w2.draft({ days: 0 })).rejects.toThrow(/at least 1/);
  });
  it("needs real concerns, an existing active employee of this company, and an owner who can run plans", async () => {
    const w = await world();
    await expect(w.draft({ concerns: "short" })).rejects.toThrow();
    await expect(w.draft({ employeeId: "does-not-exist" })).rejects.toThrow(/employee not found/i);
    const other = await world();
    await expect(w.draft({ employeeId: other.guard.id })).rejects.toThrow(/employee not found/i); // another company's employee
    const sup = await login(w.t, "SUPERVISOR");
    await expect(w.draft({ ownerUserId: sup.userId })).rejects.toThrow(/owner/i); // a role that cannot run plans
    await expect(w.draft({ ownerUserId: other.owner.userId })).rejects.toThrow(/owner/i); // another company's user
    await expect(w.draft({ ownerUserId: "nobody" })).rejects.toThrow(/owner/i);
    await db.employee.update({ where: { id: w.other.id }, data: { status: "RESIGNED" } });
    await expect(w.draft({ employeeId: w.other.id })).rejects.toThrow(/no longer|left|not active/i);
  });
  it("an employee has only one open plan: a second is refused until the first is closed or withdrawn", async () => {
    const w = await world();
    const first = await w.draft();
    await expect(w.draft()).rejects.toThrow(/already has an open/i);
    await withdrawPlan(w.hr, first.id, "Drafted by mistake");
    await expect(w.draft()).resolves.toMatchObject({ status: "DRAFT" });
  });
  it("only someone who manages plans can draft; the auditor can only read", async () => {
    const w = await world();
    for (const role of ["AUDITOR", "FINANCE", "OPERATIONS", "SUPERVISOR", "EMPLOYEE", "PAYROLL_ADMIN"] as const) {
      const c = await login(w.t, role);
      await expect(createPlan(c, { employeeId: w.guard.id, concerns: SECRET, startDate: day(-1), ownerUserId: w.owner.userId } as never), role).rejects.toThrow(/permission/);
    }
  });
  it("can be edited while a draft, and the owner can be changed to another person who can run plans", async () => {
    const w = await world();
    const p = await w.draft();
    const u = await updatePlan(w.hr, p.id, { concerns: "Now a different and longer set of concerns", days: 30, ownerUserId: w.boss.userId });
    expect(u).toMatchObject({ ownerUserId: w.boss.userId });
    expect(u.endDate.toISOString().slice(0, 10)).toBe(new Date(Date.parse(day(-20)) + 30 * 86_400_000).toISOString().slice(0, 10));
    await submitPlanWithObjective(w, p.id);
    await expect(updatePlan(w.hr, p.id, { concerns: "Changing it after it was submitted" })).rejects.toThrow(/draft/i);
  });
});

async function submitPlanWithObjective(w: Awaited<ReturnType<typeof world>>, planId: string) {
  await addObjective(w.hr, planId, { gap: "Gap one", target: "Target one", dueDate: day(10) });
  await submitPlan(w.hr, planId);
}

describe("objectives", () => {
  it("each has a gap, a measurable target, the support given and a due date inside the plan", async () => {
    const w = await world();
    const p = await w.draft();
    const o = await addObjective(w.hr, p.id, { gap: "Arrives late", target: "No late arrival for 30 days", support: "Shift swap", dueDate: day(10) });
    expect(o).toMatchObject({ gap: "Arrives late", target: "No late arrival for 30 days", support: "Shift swap" });
    await expect(addObjective(w.hr, p.id, { gap: "Too early", target: "Anything at all", dueDate: day(-30) })).rejects.toThrow(/between/i); // before the plan starts
    await expect(addObjective(w.hr, p.id, { gap: "Too late", target: "Anything at all", dueDate: day(200) })).rejects.toThrow(/between/i); // after it ends
    await expect(addObjective(w.hr, p.id, { gap: "x", target: "y", dueDate: day(10) })).rejects.toThrow();
  });
  it("can be removed while a draft, and only then", async () => {
    const w = await world();
    const p = await w.draft();
    const a = await addObjective(w.hr, p.id, { gap: "Gap one", target: "Target one", dueDate: day(10) });
    const b = await addObjective(w.hr, p.id, { gap: "Gap two", target: "Target two", dueDate: day(10) });
    await removeObjective(w.hr, a.id);
    expect((await getPlan(w.hr, p.id)).objectives.map((o) => o.id)).toEqual([b.id]);
    await submitPlan(w.hr, p.id);
    await expect(removeObjective(w.hr, b.id)).rejects.toThrow(/draft/i);
    await expect(addObjective(w.hr, p.id, { gap: "Gap three", target: "Target three", dueDate: day(10) })).rejects.toThrow(/draft/i);
  });
  it("a plan with no objective cannot be submitted", async () => {
    const w = await world();
    const p = await w.draft();
    await expect(submitPlan(w.hr, p.id)).rejects.toThrow(/objective/i);
  });
});

describe("starting a plan: a second person approves", () => {
  it("the plan becomes Active only when someone who is neither its drafter nor its owner approves it", async () => {
    const w = await world();
    const { p } = await w.submitted();
    await expect(approveStart(w.hr, p.id)).rejects.toThrow(/permission/); // the HR administrator has no approve right
    const draftAsApprover = await login(w.t, "COMPANY_ADMIN");
    const own = await createPlan(draftAsApprover, { employeeId: w.other.id, concerns: SECRET, startDate: day(-5), ownerUserId: w.owner.userId } as never);
    await addObjective(draftAsApprover, own.id, { gap: "Gap one", target: "Target one", dueDate: day(10) });
    await submitPlan(draftAsApprover, own.id);
    await expect(approveStart(draftAsApprover, own.id)).rejects.toThrow(/drafted/i); // the drafter, with the right to approve, still cannot
    const asOwner = await login(w.t, "COMPANY_ADMIN");
    const byOwner = await createPlan(w.hr, { employeeId: (await createEmployee(w.hr, { firstName: "Ife", lastName: "Third", employmentDate: "2024-01-05", categoryId: w.t.guardId })).id, concerns: SECRET, startDate: day(-5), ownerUserId: asOwner.userId } as never);
    await addObjective(w.hr, byOwner.id, { gap: "Gap one", target: "Target one", dueDate: day(10) });
    await submitPlan(w.hr, byOwner.id);
    await expect(approveStart(asOwner, byOwner.id)).rejects.toThrow(/owner/i); // the owner cannot start their own plan
    const started = await approveStart(w.boss, p.id, "Evidence reviewed");
    expect(started).toMatchObject({ status: "ACTIVE", activatedByUserId: w.boss.userId });
    expect(started.activatedAt).toBeInstanceOf(Date);
    expect(started.nextReviewDue!.toISOString().slice(0, 10)).toBe(day(-6)); // start (day -20) plus 14 days
  });
  it("cannot approve a draft nobody submitted, or approve twice", async () => {
    const w = await world();
    const p = await w.draft();
    await expect(approveStart(w.boss, p.id)).rejects.toThrow(/awaiting|submitted/i);
    const { p: q } = await w.submitted({ employeeId: w.other.id });
    await approveStart(w.boss, q.id);
    await expect(approveStart(w.boss2, q.id)).rejects.toThrow(/awaiting|already/i);
  });
  it("can be returned to draft with a reason, which makes it editable again", async () => {
    const w = await world();
    const { p } = await w.submitted();
    await expect(returnPlan(w.boss, p.id, "")).rejects.toThrow(/reason|note/i);
    await expect(returnPlan(w.hr, p.id, "Targets are vague")).rejects.toThrow(/permission/);
    const r = await returnPlan(w.boss, p.id, "Targets are vague");
    expect(r).toMatchObject({ status: "DRAFT", returnNote: "Targets are vague" });
    await expect(updatePlan(w.hr, p.id, { concerns: "Concerns rewritten with clearer targets" })).resolves.toBeTruthy();
  });
});

describe("reviews", () => {
  it("are recorded against an active plan, with a result for each objective, and set the next review date", async () => {
    const w = await world();
    const { p, o } = await w.active();
    const r = await recordReview(w.owner, p.id, { reviewedOn: day(-5), summary: "First review: some progress", assessments: [{ objectiveId: o.id, result: "PARTLY_MET", note: "Two late arrivals" }] });
    expect(r.summary).toBe("First review: some progress");
    const plan = await getPlan(w.hr, p.id);
    expect(plan.reviews).toHaveLength(1);
    expect(plan.objectives[0].result).toBe("PARTLY_MET"); // the latest assessment
    expect(plan.nextReviewDue!.toISOString().slice(0, 10)).toBe(day(9)); // review on day -5 plus 14
    await recordReview(w.owner, p.id, { reviewedOn: day(-1), summary: "Second review: now met", assessments: [{ objectiveId: o.id, result: "MET" }] });
    const again = await getPlan(w.hr, p.id);
    expect(again.reviews).toHaveLength(2);
    expect(again.objectives[0].result).toBe("MET");
    expect(again.reviews.map((x) => x.summary)).toEqual(["First review: some progress", "Second review: now met"]); // the first is still there
  });
  it("only for an active plan, with a real date and an objective that belongs to the plan", async () => {
    const w = await world();
    const { p: draft } = await w.submitted();
    await expect(recordReview(w.owner, draft.id, { reviewedOn: day(-1), summary: "Not started yet", assessments: [] })).rejects.toThrow(/active/i);
    const { p, o } = await w.active({ employeeId: w.other.id });
    await expect(recordReview(w.owner, p.id, { reviewedOn: day(3), summary: "Reviewed in the future", assessments: [] })).rejects.toThrow(/future/i);
    await expect(recordReview(w.owner, p.id, { reviewedOn: day(-40), summary: "Before the plan began", assessments: [] })).rejects.toThrow(/before/i);
    await expect(recordReview(w.owner, p.id, { reviewedOn: day(-1), summary: "", assessments: [] })).rejects.toThrow();
    await expect(recordReview(w.owner, p.id, { reviewedOn: day(-1), summary: "Wrong objective", assessments: [{ objectiveId: "other-plan-objective", result: "MET" }] })).rejects.toThrow(/objective/i);
    expect(o.id).toBeTruthy();
  });
  it("cannot be recorded by someone who does not manage plans", async () => {
    const w = await world();
    const { p } = await w.active();
    for (const c of [w.me, await login(w.t, "AUDITOR"), await login(w.t, "FINANCE")]) await expect(recordReview(c, p.id, { reviewedOn: day(-1), summary: "Not allowed at all", assessments: [] })).rejects.toThrow(/permission/);
  });
});

describe("the outcome: a second person approves", () => {
  async function reviewed(over: Record<string, unknown> = {}) {
    const x = await createdActive(over);
    await recordReview(x.w.owner, x.p.id, { reviewedOn: day(-1), summary: "Reviewed, the objective is met", assessments: [{ objectiveId: x.o.id, result: "MET" }] });
    return x;
  }
  async function createdActive(over: Record<string, unknown> = {}) {
    const w = await world();
    const { p, o } = await w.active(over);
    return { w, p, o };
  }

  it("a plan can be closed as Successful or Unsuccessful only when someone other than the proposer and the owner approves", async () => {
    const { w, p } = await reviewed();
    const proposed = await proposeOutcome(w.owner, p.id, { outcome: "SUCCESSFUL", note: "Standard met across the plan" });
    expect(proposed).toMatchObject({ status: "OUTCOME_PROPOSED", proposedOutcome: "SUCCESSFUL" });
    await expect(approveOutcome(w.owner, p.id)).rejects.toThrow(/permission|owner|proposed/i);
    const proposerAsApprover = await login(w.t, "COMPANY_ADMIN");
    const p2 = await createdActiveFor(w, proposerAsApprover);
    await expect(approveOutcome(proposerAsApprover, p2)).rejects.toThrow(/proposed/i);
    const closed = await approveOutcome(w.boss, p.id, "Agreed");
    expect(closed).toMatchObject({ status: "CLOSED", outcome: "SUCCESSFUL" });
    expect(closed.closedAt).toBeInstanceOf(Date);
  });
  async function createdActiveFor(w: Awaited<ReturnType<typeof world>>, proposer: Ctx) {
    const emp = await createEmployee(w.hr, { firstName: "Ola", lastName: "Fourth", employmentDate: "2024-01-05", categoryId: w.t.guardId });
    const { p, o } = await w.active({ employeeId: emp.id });
    await recordReview(w.owner, p.id, { reviewedOn: day(-1), summary: "Reviewed, objective not met", assessments: [{ objectiveId: o.id, result: "NOT_MET" }] });
    await proposeOutcome(proposer, p.id, { outcome: "UNSUCCESSFUL", note: "Not met" });
    return p.id;
  }
  it("an Unsuccessful outcome only records the result: nothing else happens to the employee", async () => {
    const { w, p } = await reviewed();
    await proposeOutcome(w.owner, p.id, { outcome: "UNSUCCESSFUL", note: "Targets not met after support" });
    const before = await db.employee.findUniqueOrThrow({ where: { id: w.guard.id } });
    const closed = await approveOutcome(w.boss, p.id);
    expect(closed).toMatchObject({ status: "CLOSED", outcome: "UNSUCCESSFUL" });
    const after = await db.employee.findUniqueOrThrow({ where: { id: w.guard.id } });
    expect(after.status).toBe(before.status);
    expect(await db.disciplinaryRecord.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    expect(await db.exitRecord.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });
  it("needs a review on record first, a note, and the right proposal for each outcome", async () => {
    const { w, p } = await createdActive();
    await expect(proposeOutcome(w.owner, p.id, { outcome: "SUCCESSFUL", note: "No review recorded yet" })).rejects.toThrow(/review/i);
    await recordReview(w.owner, p.id, { reviewedOn: day(-1), summary: "Reviewed", assessments: [] });
    await expect(proposeOutcome(w.owner, p.id, { outcome: "SUCCESSFUL", note: "" })).rejects.toThrow();
    await expect(proposeOutcome(w.owner, p.id, { outcome: "EXTENDED", note: "Needs longer" })).rejects.toThrow(/end date/i); // an extension names the new end
    await expect(proposeOutcome(await login(w.t, "AUDITOR"), p.id, { outcome: "SUCCESSFUL", note: "Not for the auditor" })).rejects.toThrow(/permission/);
  });
  it("an extension keeps the plan Active with the later end date, once, and within the longest extension", async () => {
    const { w, p } = await reviewed();
    const end = p.endDate.toISOString().slice(0, 10);
    const extendBy = (n: number) => new Date(Date.parse(end) + n * 86_400_000).toISOString().slice(0, 10);
    await expect(proposeOutcome(w.owner, p.id, { outcome: "EXTENDED", note: "Too long", newEndDate: extendBy(31) })).rejects.toThrow(/at most 30/);
    await expect(proposeOutcome(w.owner, p.id, { outcome: "EXTENDED", note: "Not later", newEndDate: end })).rejects.toThrow(/later/);
    await proposeOutcome(w.owner, p.id, { outcome: "EXTENDED", note: "Good progress, more time", newEndDate: extendBy(30) });
    const extended = await approveOutcome(w.boss, p.id);
    expect(extended).toMatchObject({ status: "ACTIVE", extensionsUsed: 1, outcome: null });
    expect(extended.endDate.toISOString().slice(0, 10)).toBe(extendBy(30));
    await expect(proposeOutcome(w.owner, p.id, { outcome: "EXTENDED", note: "A second extension", newEndDate: extendBy(40) })).rejects.toThrow(/already been extended|no further/i);
  });
  it("an outcome can be returned, and the plan is Active again", async () => {
    const { w, p } = await reviewed();
    await proposeOutcome(w.owner, p.id, { outcome: "SUCCESSFUL", note: "Looks met" });
    await expect(returnOutcome(w.boss, p.id, "")).rejects.toThrow(/reason|note/i);
    const r = await returnOutcome(w.boss, p.id, "One objective is still open");
    expect(r).toMatchObject({ status: "ACTIVE", proposedOutcome: null });
  });
  it("a closed plan stays closed: no more reviews, no new outcome, no withdrawal; a new plan may then be drafted", async () => {
    const { w, p } = await reviewed();
    await proposeOutcome(w.owner, p.id, { outcome: "SUCCESSFUL", note: "Standard met" });
    await approveOutcome(w.boss, p.id);
    await expect(recordReview(w.owner, p.id, { reviewedOn: day(-1), summary: "After closing", assessments: [] })).rejects.toThrow(/active/i);
    await expect(proposeOutcome(w.owner, p.id, { outcome: "UNSUCCESSFUL", note: "Changed my mind" })).rejects.toThrow(/active/i);
    await expect(withdrawPlan(w.boss, p.id, "Withdrawing a closed plan")).rejects.toThrow(/closed|open/i);
    await expect(w.draft()).resolves.toMatchObject({ status: "DRAFT" });
  });
});

describe("withdrawing", () => {
  it("HR can withdraw a draft or a plan awaiting approval with a reason; an active plan needs the approve right", async () => {
    const w = await world();
    const d = await w.draft();
    await expect(withdrawPlan(w.hr, d.id, "")).rejects.toThrow(/reason/i);
    await expect(withdrawPlan(w.hr, d.id, "No longer needed")).resolves.toMatchObject({ status: "WITHDRAWN" });
    const { p } = await w.active({ employeeId: w.other.id });
    await expect(withdrawPlan(w.hr, p.id, "Employee has resigned")).rejects.toThrow(/permission/);
    await expect(withdrawPlan(w.boss, p.id, "Employee has resigned")).resolves.toMatchObject({ status: "WITHDRAWN", withdrawReason: "Employee has resigned" });
  });
});

describe("the employee's own view", () => {
  it("sees nothing until the plan has started, then the plan, its objectives and reviews (not drafts or an unapproved outcome)", async () => {
    const w = await world();
    const { p } = await w.submitted();
    expect(await myPlans(w.me)).toEqual([]); // submitted, not yet started
    await approveStart(w.boss, p.id);
    const mine = await myPlans(w.me);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: p.id, status: "ACTIVE", concerns: SECRET });
    expect(mine[0].objectives).toHaveLength(1);
    expect(mine[0].ownerName).toBeTruthy();
    expect(await myPlans(w.meOther)).toEqual([]); // not another employee's
    expect(await myPlans(await login(w.t, "FINANCE"))).toEqual([]); // no employee record
  });
  it("does not see the outcome until it is approved", async () => {
    const w = await world();
    const { p, o } = await w.active();
    await recordReview(w.owner, p.id, { reviewedOn: day(-1), summary: "Reviewed", assessments: [{ objectiveId: o.id, result: "MET" }] });
    await proposeOutcome(w.owner, p.id, { outcome: "UNSUCCESSFUL", note: "Internal note not yet approved" });
    const seen = (await myPlans(w.me))[0];
    expect(seen.status).toBe("OUTCOME_PROPOSED");
    expect(seen.outcome).toBeNull();
    expect(JSON.stringify(seen)).not.toContain("Internal note not yet approved");
    expect(JSON.stringify(seen)).not.toContain("UNSUCCESSFUL");
  });
  it("a plan withdrawn before it started was never shown, and one withdrawn after is", async () => {
    const w = await world();
    const d = await w.draft();
    await withdrawPlan(w.hr, d.id, "Drafted in error");
    expect(await myPlans(w.me)).toEqual([]);
    const { p } = await w.active();
    await withdrawPlan(w.boss, p.id, "Employee transferred");
    expect((await myPlans(w.me)).map((x) => x.status)).toEqual(["WITHDRAWN"]);
  });
  it("acknowledges once: Agree, or Disagree with a reason; no one else can answer for them; a disagreement does not stop the plan", async () => {
    const w = await world();
    const { p } = await w.submitted();
    await expect(acknowledgePlan(w.me, p.id, { agree: true })).rejects.toThrow(/not found|started/i); // not started: it does not exist for the employee
    await approveStart(w.boss, p.id);
    await expect(acknowledgePlan(w.meOther, p.id, { agree: true })).rejects.toThrow(/not found/i);
    await expect(acknowledgePlan(w.hr, p.id, { agree: true })).rejects.toThrow(/not found|only the employee/i);
    await expect(acknowledgePlan(w.me, p.id, { agree: false })).rejects.toThrow(/say why/i);
    await expect(acknowledgePlan(w.me, p.id, { agree: false, comment: "I did not receive the shift swap" })).resolves.toMatchObject({ employeeAgreed: false, employeeResponse: "I did not receive the shift swap", status: "ACTIVE" });
    await expect(acknowledgePlan(w.me, p.id, { agree: true })).rejects.toThrow(/already/i);
  });
  it("can add one comment to each review, only on their own plan", async () => {
    const w = await world();
    const { p, o } = await w.active();
    const r = await recordReview(w.owner, p.id, { reviewedOn: day(-1), summary: "Reviewed", assessments: [{ objectiveId: o.id, result: "PARTLY_MET" }] });
    await expect(addEmployeeComment(w.meOther, r.id, "I was not told about this")).rejects.toThrow(/not found/i);
    await expect(addEmployeeComment(w.me, r.id, "")).rejects.toThrow();
    const c = await addEmployeeComment(w.me, r.id, "I had no transport on two of those days");
    expect(c.employeeComment).toBe("I had no transport on two of those days");
    await expect(addEmployeeComment(w.me, r.id, "Changing my comment later")).rejects.toThrow(/already/i);
    expect((await getPlan(w.hr, p.id)).reviews[0].employeeComment).toBe("I had no transport on two of those days");
  });
  it("the employee cannot read plans through the HR screens or change anything", async () => {
    const w = await world();
    const { p } = await w.active();
    await expect(getPlan(w.me, p.id)).rejects.toThrow(/permission/);
    await expect(listPlans(w.me, {})).rejects.toThrow(/permission/);
    await expect(updatePlan(w.me, p.id, { concerns: "Rewriting my own concerns" })).rejects.toThrow(/permission/);
  });
});

describe("who can read plans", () => {
  it("HR, the company administrator and the auditor can; finance, operations, supervisors and payroll cannot", async () => {
    const w = await world();
    const { p } = await w.active();
    for (const c of [w.hr, w.boss, await login(w.t, "AUDITOR")]) expect((await getPlan(c, p.id)).id, c.role).toBe(p.id);
    for (const role of ["FINANCE", "OPERATIONS", "SUPERVISOR", "PAYROLL_ADMIN"] as const) {
      const c = await login(w.t, role);
      await expect(getPlan(c, p.id), role).rejects.toThrow(/permission/);
      await expect(listPlans(c, {}), role).rejects.toThrow(/permission/);
    }
  });
  it("the list can be narrowed by status and employee", async () => {
    const w = await world();
    await w.active();
    const d = await w.draft({ employeeId: w.other.id });
    expect((await listPlans(w.hr, {})).map((x) => x.id)).toContain(d.id);
    expect((await listPlans(w.hr, { status: "DRAFT" })).map((x) => x.id)).toEqual([d.id]);
    expect((await listPlans(w.hr, { employeeId: w.guard.id })).every((x) => x.employeeId === w.guard.id)).toBe(true);
  });
  it("the owners to choose from are only the active people in this company who can run plans", async () => {
    const w = await world();
    await login(w.t, "FINANCE");
    const sup = await login(w.t, "SUPERVISOR");
    const owners = (await eligibleOwners(w.hr)).map((u) => u.id);
    expect(owners).toEqual(expect.arrayContaining([w.hr.userId, w.owner.userId, w.boss.userId]));
    expect(owners).not.toContain(sup.userId);
    await db.user.update({ where: { id: w.boss2.userId }, data: { active: false } });
    expect((await eligibleOwners(w.hr)).map((u) => u.id)).not.toContain(w.boss2.userId);
  });
});

describe("another company", () => {
  it("cannot see, change or approve a plan, and its lists are empty", async () => {
    const w = await world();
    const { p } = await w.active();
    const o = await world();
    await expect(getPlan(o.hr, p.id)).rejects.toThrow(/not found/i);
    await expect(updatePlan(o.hr, p.id, { concerns: "Another company editing this" })).rejects.toThrow(/not found/i);
    await expect(approveOutcome(o.boss, p.id)).rejects.toThrow(/not found/i);
    await expect(withdrawPlan(o.boss, p.id, "Another company's plan")).rejects.toThrow(/not found/i);
    expect(await listPlans(o.hr, {})).toEqual([]);
    expect(await myPlans(o.me)).toEqual([]);
  });
});

describe("starting from an appraisal", () => {
  async function appraisalFor(w: Awaited<ReturnType<typeof world>>, over: Record<string, unknown> = {}) {
    const cycle = await db.appraisalCycle.create({ data: { organizationId: w.t.org.id, name: `Cycle ${uid()}`, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-06-30"), dueDate: new Date("2026-07-15"), createdBy: "test" } });
    return db.appraisal.create({
      data: { organizationId: w.t.org.id, cycleId: cycle.id, employeeId: w.guard.id, status: "APPROVED", recommendation: "PERFORMANCE_PLAN", improvements: "Arrives late to post; incident reports incomplete", ...over },
    });
  }
  it("copies the improvement text into a draft, links the appraisal, and changes nothing on the appraisal", async () => {
    const w = await world();
    const a = await appraisalFor(w);
    const p = await planFromAppraisal(w.hr, a.id, { startDate: day(-3), ownerUserId: w.owner.userId });
    expect(p).toMatchObject({ status: "DRAFT", appraisalId: a.id, employeeId: w.guard.id });
    expect(p.concerns).toContain("Arrives late to post");
    expect(await db.appraisal.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: "APPROVED", recommendation: "PERFORMANCE_PLAN" });
  });
  it("only from an approved appraisal that recommended a plan, never automatically, and only by someone who manages plans", async () => {
    const w = await world();
    const none = await appraisalFor(w, { recommendation: "TRAINING" });
    await expect(planFromAppraisal(w.hr, none.id, { startDate: day(-3), ownerUserId: w.owner.userId })).rejects.toThrow(/recommend/i);
    const drafted = await appraisalFor(w, { status: "DRAFT" });
    await expect(planFromAppraisal(w.hr, drafted.id, { startDate: day(-3), ownerUserId: w.owner.userId })).rejects.toThrow(/approved/i);
    const ok = await appraisalFor(w);
    await expect(planFromAppraisal(await login(w.t, "AUDITOR"), ok.id, { startDate: day(-3), ownerUserId: w.owner.userId })).rejects.toThrow(/permission/);
    expect(await db.performanceImprovementPlan.count({ where: { organizationId: w.t.org.id } })).toBe(0); // approving an appraisal started nothing
    const o = await world();
    await expect(planFromAppraisal(o.hr, ok.id, { startDate: day(-3), ownerUserId: o.owner.userId })).rejects.toThrow(/not found/i);
  });
});

describe("reminders", () => {
  it("lists plans awaiting approval, reviews due and overdue, plans past their end date, and open plans of leavers", async () => {
    const w = await world();
    const { p } = await w.active(); // started 20 days ago: first review was due 6 days ago
    const awaiting = await w.submitted({ employeeId: w.other.id });
    const a = await planAttention(w.t.org.id, new Date(day(0)));
    expect(a.reviewOverdue.map((x) => x.id)).toContain(p.id);
    expect(a.awaitingApproval.map((x) => x.id)).toContain(awaiting.p.id);
    expect(a.reviewOverdue.map((x) => x.id)).not.toContain(awaiting.p.id);
    await db.employee.update({ where: { id: w.guard.id }, data: { status: "RESIGNED" } });
    expect((await planAttention(w.t.org.id, new Date(day(0)))).leavers.map((x) => x.id)).toContain(p.id);
    await db.performanceImprovementPlan.update({ where: { id: p.id }, data: { endDate: new Date(day(-1)) } });
    expect((await planAttention(w.t.org.id, new Date(day(0)))).pastEnd.map((x) => x.id)).toContain(p.id);
  });
  it("another company's plans never appear", async () => {
    const w = await world();
    await w.active();
    const o = await isolatedOrg();
    const a = await planAttention(o.org.id, new Date(day(0)));
    expect([a.reviewOverdue, a.awaitingApproval, a.leavers, a.pastEnd].every((l) => l.length === 0)).toBe(true);
  });
});

describe("the audit trail", () => {
  it("records every step by ids and field names, and never what the concerns, notes or comments say", async () => {
    const w = await world();
    const { p, o } = await w.active();
    const r = await recordReview(w.owner, p.id, { reviewedOn: day(-1), summary: "SECRET-REVIEW-SUMMARY", assessments: [{ objectiveId: o.id, result: "MET", note: "SECRET-ASSESSMENT-NOTE" }] });
    await addEmployeeComment(w.me, r.id, "SECRET-EMPLOYEE-COMMENT here");
    await acknowledgePlan(w.me, p.id, { agree: false, comment: "SECRET-DISAGREE-REASON given" });
    await proposeOutcome(w.owner, p.id, { outcome: "SUCCESSFUL", note: "SECRET-OUTCOME-NOTE" });
    await returnOutcome(w.boss, p.id, "SECRET-RETURN-REASON");
    await proposeOutcome(w.owner, p.id, { outcome: "SUCCESSFUL", note: "SECRET-OUTCOME-NOTE-2" });
    await approveOutcome(w.boss, p.id, "SECRET-APPROVAL-NOTE");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "PIP_" } }, orderBy: { createdAt: "asc" } });
    const actions = new Set(rows.map((x) => x.action));
    for (const a of ["PIP_CREATE", "PIP_OBJECTIVE_ADD", "PIP_SUBMIT", "PIP_START", "PIP_REVIEW", "PIP_EMPLOYEE_COMMENT", "PIP_ACKNOWLEDGE", "PIP_OUTCOME_PROPOSE", "PIP_OUTCOME_RETURN", "PIP_OUTCOME_APPROVE"]) expect(actions.has(a), a).toBe(true);
    const text = JSON.stringify(rows);
    for (const secret of ["SECRET-CONCERN", "SECRET-REVIEW", "SECRET-ASSESSMENT", "SECRET-EMPLOYEE", "SECRET-DISAGREE", "SECRET-OUTCOME", "SECRET-RETURN", "SECRET-APPROVAL"]) expect(text, secret).not.toContain(secret);
    expect(rows.every((x) => x.entity === "PerformanceImprovementPlan" || x.entity === "PipObjective" || x.entity === "PipReview")).toBe(true);
    expect(rows.find((x) => x.action === "PIP_START")?.userId).toBe(w.boss.userId);
  });
});
