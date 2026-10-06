import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { isolatedOrg, uid } from "../helpers";
import type { Ctx } from "@/lib/auth/context";
import { createContract, decideProbation } from "@/server/services/contracts";
import { createEmployee } from "@/server/services/employees";
import { todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { approveAppraisal, assertProbationAppraisalAllows, launchCycle, probationAppraisalFor, saveReview, startProbationAppraisal, submitReview } from "@/server/services/appraisals";
import { buildHrDigest } from "@/server/services/reminders";

/** An org with a supervisor (a login that can review) and a guard on probation reporting to them. */
async function setup(opts: { probationStartedDaysAgo?: number } = {}) {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const mgr = await createEmployee(hr, { firstName: "Sup", lastName: "Ervisor", employmentDate: "2022-01-01", categoryId: t.officeId });
  const user = await db.user.create({ data: { organizationId: t.org.id, email: `sup-${uid()}@prob.test`.toLowerCase(), name: "Sup Ervisor", role: "SUPERVISOR", passwordHash: "x", employeeId: mgr.id } });
  const reviewer: Ctx = { ...t.ctx("SUPERVISOR", mgr.id), userId: user.id, name: user.name };
  const startedAgo = opts.probationStartedDaysAgo ?? 60;
  const emp = await createEmployee(hr, { firstName: "On", lastName: "Probation", employmentDate: iso(addDays(todayUtc(), -startedAgo)), categoryId: t.guardId, reportingManagerId: mgr.id });
  const contract = await createContract(hr, { employeeId: emp.id, type: "PROBATION", jobTitle: "Guard", startDate: iso(addDays(todayUtc(), -startedAgo)), probationMonths: 3 });
  return { t, hr, reviewer, emp, contract, approver: t.ctx("HR_ADMIN", null, 2), mgr };
}
type S = Awaited<ReturnType<typeof setup>>;

/** Rates every criterion `rating` and takes the appraisal as far as `upTo`. */
async function takeTo(s: S, appraisalId: string, rating: number, upTo: "draft" | "submitted" | "approved") {
  const a = await db.appraisal.findUniqueOrThrow({ where: { id: appraisalId }, include: { ratings: true } });
  if (upTo === "draft") return;
  await saveReview(s.reviewer, appraisalId, {
    ratings: a.ratings.map((r) => ({ criterionId: r.criterionId, rating, comment: rating <= 2 || rating >= 5 ? "Evidence on file" : undefined })),
    strengths: "Reliable",
    recommendation: rating >= 3 ? "CONFIRM_EMPLOYMENT" : "PERFORMANCE_PLAN",
  });
  await submitReview(s.reviewer, appraisalId);
  if (upTo === "approved") await approveAppraisal(s.approver, appraisalId);
}

describe("starting a probation appraisal", () => {
  it("creates a one-person review over the probation period, reviewed by the manager", async () => {
    const s = await setup();
    const { appraisal, unassigned } = await startProbationAppraisal(s.hr, s.contract.id);
    expect(unassigned).toBe(0);
    expect(appraisal).toMatchObject({ employeeId: s.emp.id, status: "DRAFT", reviewerName: "Sup Ervisor" });
    const cycle = await db.appraisalCycle.findUniqueOrThrow({ where: { id: appraisal.cycleId } });
    expect(cycle.kind).toBe("PROBATION");
    expect(cycle.name).toMatch(/^Probation review — EMP-\d+ On Probation — EC-/);
    expect(iso(cycle.periodStart)).toBe(iso(s.contract.startDate));
    expect(iso(cycle.periodEnd)).toBe(iso(s.contract.probationEndDate!));
    expect(await db.appraisal.count({ where: { cycleId: cycle.id } })).toBe(1);
    expect((await probationAppraisalFor(s.t.org.id, s.contract))!.id).toBe(appraisal.id);
  });

  it("is refused for the wrong people and the wrong contracts, and can't be started twice at once", async () => {
    const s = await setup();
    await expect(startProbationAppraisal(s.reviewer, s.contract.id)).rejects.toThrow(); // review permission isn't manage
    await expect(startProbationAppraisal(s.t.ctx("AUDITOR"), s.contract.id)).rejects.toThrow();
    await expect(startProbationAppraisal(s.hr, "ghost")).rejects.toThrow(/not found/);
    const other = await isolatedOrg();
    await expect(startProbationAppraisal(other.ctx("HR_ADMIN"), s.contract.id)).rejects.toThrow(/not found/);

    const perm = await createContract(s.hr, { employeeId: (await createEmployee(s.hr, { firstName: "Perm", lastName: "Anent", employmentDate: "2023-01-01", categoryId: s.t.guardId })).id, type: "PERMANENT", jobTitle: "Guard", startDate: "2023-01-01" });
    await expect(startProbationAppraisal(s.hr, perm.id)).rejects.toThrow(/probation still under review/);

    const first = await startProbationAppraisal(s.hr, s.contract.id);
    await expect(startProbationAppraisal(s.hr, s.contract.id)).rejects.toThrow(/already under way/);
    await takeTo(s, first.appraisal.id, 3, "submitted");
    await expect(startProbationAppraisal(s.hr, s.contract.id)).rejects.toThrow(/already awaiting sign-off/);
    await approveAppraisal(s.approver, first.appraisal.id);
    // once signed off a further round can be started (e.g. after an extension), and is named so
    const second = await startProbationAppraisal(s.hr, s.contract.id);
    expect((await db.appraisalCycle.findUniqueOrThrow({ where: { id: second.appraisal.cycleId } })).name).toMatch(/\(round 2\)$/);
    expect((await probationAppraisalFor(s.t.org.id, s.contract))!.id).toBe(second.appraisal.id); // the newest one counts
  });

  it("flags when nobody can be assigned automatically", async () => {
    const s = await setup();
    const orphan = await createEmployee(s.hr, { firstName: "No", lastName: "Boss", employmentDate: iso(addDays(todayUtc(), -30)), categoryId: s.t.guardId });
    const c = await createContract(s.hr, { employeeId: orphan.id, type: "PROBATION", jobTitle: "Guard", startDate: iso(addDays(todayUtc(), -30)), probationMonths: 3 });
    expect((await startProbationAppraisal(s.hr, c.id)).unassigned).toBe(1);
  });
});

describe("confirming probation", () => {
  it("doesn't need an appraisal unless the policy says so", async () => {
    const s = await setup();
    const r = await decideProbation(s.approver, s.contract.id, { decision: "CONFIRMED" });
    expect(r.contract.probationOutcome).toBe("CONFIRMED");
  });

  it("waits for a signed-off appraisal when the policy requires one", async () => {
    const s = await setup();
    await updateHrPolicy(s.hr, { probationRequiresAppraisal: true });
    await expect(decideProbation(s.approver, s.contract.id, { decision: "CONFIRMED" })).rejects.toThrow(/none has been started/);

    const { appraisal } = await startProbationAppraisal(s.hr, s.contract.id);
    await expect(decideProbation(s.approver, s.contract.id, { decision: "CONFIRMED" })).rejects.toThrow(/still being written/);
    await takeTo(s, appraisal.id, 4, "submitted");
    await expect(decideProbation(s.approver, s.contract.id, { decision: "CONFIRMED" })).rejects.toThrow(/awaiting sign-off/);
    await approveAppraisal(s.approver, appraisal.id);

    const r = await decideProbation(s.approver, s.contract.id, { decision: "CONFIRMED" });
    expect(r.contract.probationOutcome).toBe("CONFIRMED");
    expect(r.next).not.toBeNull(); // the permanent contract still follows
  });

  it("can set a minimum score, and never blocks extending or failing", async () => {
    const s = await setup();
    await updateHrPolicy(s.hr, { probationRequiresAppraisal: true, probationMinScore: 3.5 });
    const { appraisal } = await startProbationAppraisal(s.hr, s.contract.id);
    await takeTo(s, appraisal.id, 3, "approved"); // scores 3.00
    await expect(decideProbation(s.approver, s.contract.id, { decision: "CONFIRMED" })).rejects.toThrow(/scored 3\.00, below the minimum of 3\.50/);
    // extending isn't blocked, and a better appraisal after the extension lets confirmation through
    const ext = await decideProbation(s.approver, s.contract.id, { decision: "EXTENDED", extensionMonths: 1, note: "Needs more time on nights" });
    expect(ext.contract.probationOutcome).toBe("EXTENDED");
    const again = await startProbationAppraisal(s.hr, s.contract.id);
    await takeTo(s, again.appraisal.id, 4, "approved");
    expect((await decideProbation(s.approver, s.contract.id, { decision: "CONFIRMED" })).contract.probationOutcome).toBe("CONFIRMED");

    // failing is never gated
    const s2 = await setup();
    await updateHrPolicy(s2.hr, { probationRequiresAppraisal: true, probationMinScore: 4.5 });
    expect((await decideProbation(s2.approver, s2.contract.id, { decision: "FAILED", note: "Absent without leave twice" })).contract.probationOutcome).toBe("FAILED");

    await expect(updateHrPolicy(s.hr, { probationMinScore: 6 })).rejects.toThrow();
    await expect(updateHrPolicy(s.hr, { probationMinScore: -1 })).rejects.toThrow();
  });

  it("ignores a probation appraisal from a different period", async () => {
    const s = await setup();
    await updateHrPolicy(s.hr, { probationRequiresAppraisal: true });
    // an old, signed-off probation appraisal for the same person, long before this probation began
    const old = await launchCycle(s.hr, { name: `Old probation ${uid()}`, kind: "PROBATION", periodStart: "2020-01-01", periodEnd: "2020-03-31", dueDate: "2020-04-15", employeeIds: [s.emp.id] });
    const oa = await db.appraisal.findFirstOrThrow({ where: { cycleId: old.cycle.id } });
    await takeTo(s, oa.id, 5, "approved");
    expect(await probationAppraisalFor(s.t.org.id, s.contract)).toBeNull();
    await expect(assertProbationAppraisalAllows(s.t.org.id, s.contract)).rejects.toThrow(/none has been started/);
    await expect(decideProbation(s.approver, s.contract.id, { decision: "CONFIRMED" })).rejects.toThrow(/none has been started/);
    // an annual appraisal over the same dates isn't a probation appraisal either
    const annual = await launchCycle(s.hr, { name: `Annual ${uid()}`, kind: "ANNUAL", periodStart: iso(s.contract.startDate), periodEnd: iso(addDays(todayUtc(), 5)), dueDate: iso(addDays(todayUtc(), 20)), employeeIds: [s.emp.id] });
    expect(annual.created).toBe(1);
    expect(await probationAppraisalFor(s.t.org.id, s.contract)).toBeNull();
  });
});

describe("HR digest", () => {
  it("says where each probation's appraisal stands", async () => {
    const s = await setup({ probationStartedDaysAgo: 120 }); // ended weeks ago: overdue
    await db.user.create({ data: { organizationId: s.t.org.id, email: `hr-${uid()}@prob.test`.toLowerCase(), name: "HR", role: "HR_ADMIN", passwordHash: "x" } });
    const note = async () => (await buildHrDigest(s.t.org.id)).sections.find((x) => x.key === "probation")!.items[0].text;

    expect(await note()).toMatch(/probation ended .* — overdue$/); // no policy, no appraisal: nothing extra
    await updateHrPolicy(s.hr, { probationRequiresAppraisal: true });
    expect(await note()).toMatch(/overdue · no probation appraisal yet$/);
    const { appraisal } = await startProbationAppraisal(s.hr, s.contract.id);
    expect(await note()).toMatch(/probation appraisal in progress$/);
    await takeTo(s, appraisal.id, 3, "submitted");
    expect(await note()).toMatch(/probation appraisal awaiting sign-off$/);
    await approveAppraisal(s.approver, appraisal.id);
    expect(await note()).toMatch(/probation appraisal signed off$/);
  });
});
