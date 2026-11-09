import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createContract, decideProbation, markProbationInformed, myProbationOutcome, probationHistory } from "@/server/services/contracts";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { approveAppraisal, assignReviewer, saveReview, startProbationAppraisal, submitReview } from "@/server/services/appraisals";
import { buildHrDigest } from "@/server/services/reminders";
import { isolatedOrg, uid } from "../helpers";

// Performance management, step (d): the probation review and its decision (the founder's go of 2026-11-09; plan docs/plans/probation-review-plan.md).
// Recommended answers were used: a second person decides, a decision against the appraisal needs a fuller reason (never blocked), a failed probation only prompts
// an exit, an undecided probation is escalated after a number of days, early confirmation stays allowed, the employee sees one line once told.

const day = (n: number) => iso(addDays(todayUtc(), n));

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@probd.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

/** An org with a supervisor who reviews, HR who starts things, a signer of appraisals, a decider, and a guard on probation with a login. */
async function setup() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN");
  const signer = await login(t, "COMPANY_ADMIN"); // signs off the probation appraisal
  const decider = await login(t, "COMPANY_ADMIN"); // decides
  const mgrEmp = await createEmployee(hr, { firstName: "Sade", lastName: "Supervisor", employmentDate: "2022-01-01", categoryId: t.officeId });
  const reviewer = await login(t, "SUPERVISOR", mgrEmp.id);
  const emp = await createEmployee(hr, { firstName: "Gbenga", lastName: "Probation", employmentDate: day(-60), categoryId: t.guardId, reportingManagerId: mgrEmp.id });
  const me = await login(t, "EMPLOYEE", emp.id);
  const contract = await createContract(hr, { employeeId: emp.id, type: "PROBATION", jobTitle: "Guard", startDate: day(-60), probationMonths: 3 });
  return { t, hr, signer, decider, reviewer, emp, me, contract };
}
type S = Awaited<ReturnType<typeof setup>>;

/** Starts the probation appraisal and takes it to signed off with the given rating and recommendation. Returns the appraisal. */
async function appraise(s: S, rating: number, recommendation: string, reviewerCtx: Ctx = s.reviewer, signerCtx: Ctx = s.signer) {
  const { appraisal } = await startProbationAppraisal(s.hr, s.contract.id);
  if (reviewerCtx.userId !== s.reviewer.userId) await assignReviewer(s.hr, appraisal.id, reviewerCtx.userId);
  const a = await db.appraisal.findUniqueOrThrow({ where: { id: appraisal.id }, include: { ratings: true } });
  await saveReview(reviewerCtx, appraisal.id, {
    ratings: a.ratings.map((r) => ({ criterionId: r.criterionId, rating, comment: rating <= 2 || rating >= 5 ? "Evidence on file" : undefined })),
    strengths: "Reliable",
    recommendation: recommendation as never,
  });
  await submitReview(reviewerCtx, appraisal.id);
  await approveAppraisal(signerCtx, appraisal.id);
  return db.appraisal.findUniqueOrThrow({ where: { id: appraisal.id } });
}

describe("each decision is a record", () => {
  it("a confirmation records who, when, the note, the permanent-from date and a snapshot of the supporting appraisal; the contract converts as before", async () => {
    const s = await setup();
    const a = await appraise(s, 4, "CONFIRM_EMPLOYMENT");
    const r = await decideProbation(s.decider, s.contract.id, { decision: "CONFIRMED", note: "Strong first quarter", effectiveDate: day(1) });
    expect(r.contract.probationOutcome).toBe("CONFIRMED");
    expect(r.next).toMatchObject({ type: "PERMANENT" }); // unchanged behaviour
    const rows = await db.probationDecision.findMany({ where: { contractId: s.contract.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: "CONFIRMED", decidedByUserId: s.decider.userId, employeeId: s.emp.id, appraisalId: a.id, appraisalRecommendation: "CONFIRM_EMPLOYMENT", againstRecommendation: false, note: "Strong first quarter" });
    expect(rows[0].appraisalScore).toBe(Math.round(Number(a.overallScore) * 100)); // hundredths: 4.00 is 400
    expect(iso(rows[0].effectiveDate)).toBe(day(1));
    expect(rows[0].decidedAt).toBeInstanceOf(Date);
  });
  it("an extension records the extension and the new probation end; a failure records the reason", async () => {
    const s = await setup();
    const ext = await decideProbation(s.decider, s.contract.id, { decision: "EXTENDED", extensionMonths: 2, note: "More time on night shifts" });
    const row = await db.probationDecision.findFirstOrThrow({ where: { contractId: s.contract.id, decision: "EXTENDED" } });
    expect(row).toMatchObject({ extensionMonths: 2, note: "More time on night shifts", appraisalId: null });
    expect(iso(row.effectiveDate)).toBe(iso(ext.contract.probationEndDate)); // the new end
    const failed = await decideProbation(s.decider, s.contract.id, { decision: "FAILED", note: "Absent without leave twice" });
    expect(failed.contract.probationOutcome).toBe("FAILED");
    expect((await db.probationDecision.findMany({ where: { contractId: s.contract.id }, orderBy: { decidedAt: "asc" } })).map((x) => x.decision)).toEqual(["EXTENDED", "FAILED"]); // history, not overwritten
  });
  it("a refused decision leaves no record", async () => {
    const s = await setup();
    await expect(decideProbation(s.decider, s.contract.id, { decision: "FAILED" })).rejects.toThrow(/reason/);
    await expect(decideProbation(await login(s.t, "OPERATIONS"), s.contract.id, { decision: "CONFIRMED" })).rejects.toThrow(/permission/);
    expect(await db.probationDecision.count({ where: { organizationId: s.t.org.id } })).toBe(0);
  });
});

describe("a decision against the appraisal's recommendation", () => {
  it("needs a fuller reason and is marked, but is never blocked", async () => {
    const s = await setup();
    await appraise(s, 2, "PERFORMANCE_PLAN");
    await expect(decideProbation(s.decider, s.contract.id, { decision: "CONFIRMED", note: "Giving a chance" })).rejects.toThrow(/at least 20/);
    await expect(decideProbation(s.decider, s.contract.id, { decision: "CONFIRMED" })).rejects.toThrow(/at least 20/);
    await decideProbation(s.decider, s.contract.id, { decision: "CONFIRMED", note: "Client asked for him by name and the supervisor agrees" });
    expect(await db.probationDecision.findFirstOrThrow({ where: { contractId: s.contract.id } })).toMatchObject({ decision: "CONFIRMED", againstRecommendation: true, appraisalRecommendation: "PERFORMANCE_PLAN" });
  });
  it("failing someone whose appraisal recommended confirmation also needs it", async () => {
    const s = await setup();
    await appraise(s, 4, "CONFIRM_EMPLOYMENT");
    await expect(decideProbation(s.decider, s.contract.id, { decision: "FAILED", note: "Not suitable" })).rejects.toThrow(/at least 20/);
    await decideProbation(s.decider, s.contract.id, { decision: "FAILED", note: "A serious incident after the appraisal was written" });
    expect((await db.probationDecision.findFirstOrThrow({ where: { contractId: s.contract.id } })).againstRecommendation).toBe(true);
  });
  it("a decision in line with the recommendation, or with no appraisal at all, needs nothing extra and is not marked", async () => {
    const s = await setup();
    await appraise(s, 4, "CONFIRM_EMPLOYMENT");
    await decideProbation(s.decider, s.contract.id, { decision: "CONFIRMED" });
    expect((await db.probationDecision.findFirstOrThrow({ where: { contractId: s.contract.id } })).againstRecommendation).toBe(false);
    const s2 = await setup();
    await decideProbation(s2.decider, s2.contract.id, { decision: "EXTENDED", extensionMonths: 1, note: "More time needed" });
    expect((await db.probationDecision.findFirstOrThrow({ where: { contractId: s2.contract.id } }))).toMatchObject({ againstRecommendation: false, appraisalId: null });
  });
});

describe("a second person decides", () => {
  it("the reviewer and the person who signed off the probation appraisal are refused; anyone else with the right may decide", async () => {
    const s = await setup();
    const hrReviewer = await login(s.t, "COMPANY_ADMIN"); // holds the approve right and is also the appraisal's reviewer
    await appraise(s, 4, "CONFIRM_EMPLOYMENT", hrReviewer, s.signer);
    await expect(decideProbation(hrReviewer, s.contract.id, { decision: "CONFIRMED" })).rejects.toThrow(/reviewed this probation appraisal/i);
    await expect(decideProbation(s.signer, s.contract.id, { decision: "CONFIRMED" })).rejects.toThrow(/signed off this probation appraisal/i);
    expect(await db.probationDecision.count({ where: { organizationId: s.t.org.id } })).toBe(0);
    await expect(decideProbation(s.decider, s.contract.id, { decision: "CONFIRMED" })).resolves.toBeTruthy();
  });
  it("applies to extending and failing as well, and does not apply when there is no probation appraisal", async () => {
    const s = await setup();
    await expect(decideProbation(s.signer, s.contract.id, { decision: "EXTENDED", extensionMonths: 1, note: "More time needed" })).resolves.toBeTruthy(); // no appraisal: nobody is conflicted
    const s2 = await setup();
    await appraise(s2, 3, "NONE");
    await expect(decideProbation(s2.signer, s2.contract.id, { decision: "FAILED", note: "Did not meet the standard" })).rejects.toThrow(/signed off/i);
  });
});

describe("reading the history", () => {
  it("anyone who can read contracts reads a contract's decisions, newest first; another company and the employee through this page cannot", async () => {
    const s = await setup();
    await decideProbation(s.decider, s.contract.id, { decision: "EXTENDED", extensionMonths: 1, note: "More time needed" });
    await decideProbation(s.decider, s.contract.id, { decision: "FAILED", note: "Did not improve" });
    const rows = await probationHistory(s.hr, s.contract.id);
    expect(rows.map((r) => r.decision)).toEqual(["FAILED", "EXTENDED"]);
    expect(rows[0].decidedBy).toBe(s.decider.name);
    await expect(probationHistory((await setup()).hr, s.contract.id)).rejects.toThrow(/not found/i);
    await expect(probationHistory(s.me, s.contract.id)).rejects.toThrow(/permission/);
  });
});

describe("what the employee sees", () => {
  it("nothing until HR marks them as told, then one line and never the reasons", async () => {
    const s = await setup();
    await decideProbation(s.decider, s.contract.id, { decision: "EXTENDED", extensionMonths: 2, note: "SECRET-REASON more time on nights" });
    expect(await myProbationOutcome(s.me)).toBeNull(); // decided, not yet told
    const row = await db.probationDecision.findFirstOrThrow({ where: { contractId: s.contract.id } });
    await expect(markProbationInformed(s.me, row.id)).rejects.toThrow(/permission/); // not for the employee
    await markProbationInformed(s.hr, row.id);
    const seen = await myProbationOutcome(s.me);
    expect(seen?.line).toMatch(/^Probation extended to \d{2} \w{3} \d{4}\.$/);
    expect(JSON.stringify(seen)).not.toContain("SECRET-REASON");
    await expect(markProbationInformed(s.hr, row.id)).rejects.toThrow(/already/i);
  });
  it("shows the latest decision only, only their own, and nothing to someone with no employee record", async () => {
    const s = await setup();
    await decideProbation(s.decider, s.contract.id, { decision: "EXTENDED", extensionMonths: 1, note: "More time needed" });
    await decideProbation(s.decider, s.contract.id, { decision: "FAILED", note: "Did not improve" });
    for (const r of await db.probationDecision.findMany({ where: { contractId: s.contract.id } })) await markProbationInformed(s.hr, r.id);
    expect((await myProbationOutcome(s.me))?.line).toBe("Probation not confirmed.");
    const other = await setup();
    expect(await myProbationOutcome(other.me)).toBeNull();
    expect(await myProbationOutcome(await login(s.t, "FINANCE"))).toBeNull();
  });
  it("another company cannot mark a decision as told", async () => {
    const s = await setup();
    await decideProbation(s.decider, s.contract.id, { decision: "FAILED", note: "Did not meet the standard" });
    const row = await db.probationDecision.findFirstOrThrow({ where: { contractId: s.contract.id } });
    await expect(markProbationInformed((await setup()).hr, row.id)).rejects.toThrow(/not found/i);
  });
});

describe("a probation that ends with no decision, and one that failed", () => {
  const setEnd = (s: S, n: number) => db.employmentContract.update({ where: { id: s.contract.id }, data: { probationEndDate: new Date(`${day(n)}T00:00:00.000Z`) } });
  const approvals = async (s: S) => (await buildHrDigest(s.t.org.id)).sections.find((x) => x.key === "approvals")?.items.map((i) => i.text) ?? [];

  it("is listed with the days overdue, and moves to the approvals list once it has been overdue for the company's days (7 by default)", async () => {
    const s = await setup();
    expect((await db.hrPolicy.upsert({ where: { organizationId: s.t.org.id }, create: { organizationId: s.t.org.id }, update: {} })).probationEscalationDays).toBe(7);
    await setEnd(s, -3);
    const digest = await buildHrDigest(s.t.org.id);
    expect(digest.sections.find((x) => x.key === "probation")!.items[0].text).toMatch(/\(3 days ago\) — overdue/);
    expect((await approvals(s)).some((t) => /probation/i.test(t))).toBe(false); // not yet escalated
    await setEnd(s, -7);
    expect((await approvals(s)).some((t) => /Probation decision overdue 7 days/.test(t))).toBe(true);
    await setEnd(s, -40);
    expect((await approvals(s)).some((t) => /overdue 40 days/.test(t))).toBe(true);
  });
  it("follows the company's own number of days, and zero switches escalation off; once decided it is no longer listed", async () => {
    const s = await setup();
    await setEnd(s, -5);
    await updateHrPolicy(s.hr, { probationEscalationDays: 5 });
    expect((await approvals(s)).some((t) => /Probation decision overdue 5 days/.test(t))).toBe(true);
    await updateHrPolicy(s.hr, { probationEscalationDays: 0 });
    expect((await approvals(s)).some((t) => /probation/i.test(t))).toBe(false);
    await updateHrPolicy(s.hr, { probationEscalationDays: 5 });
    await decideProbation(s.decider, s.contract.id, { decision: "CONFIRMED" });
    expect((await approvals(s)).some((t) => /probation/i.test(t))).toBe(false);
  });
  it("another company's undecided probations never appear", async () => {
    const s = await setup();
    await setEnd(s, -30);
    const other = await isolatedOrg();
    expect((await buildHrDigest(other.org.id)).sections.some((x) => x.key === "probation" || x.key === "probation-failed")).toBe(false);
  });
  it("a failed probation with no exit started is listed until an exit is raised", async () => {
    const s = await setup();
    await decideProbation(s.decider, s.contract.id, { decision: "FAILED", note: "Did not meet the standard" });
    const listed = async () => (await buildHrDigest(s.t.org.id)).sections.find((x) => x.key === "probation-failed")?.items ?? [];
    const first = await listed();
    expect(first).toHaveLength(1);
    expect(first[0].text).toMatch(/not confirmed.*no exit started/i);
    expect(first[0].path).toBe(`/employees/${s.emp.id}?tab=lifecycle`);
    await db.exitRecord.create({ data: { organizationId: s.t.org.id, employeeId: s.emp.id, exitType: "TERMINATION", noticeDate: new Date(), lastWorkingDate: new Date(), status: "PENDING", initiatedBy: "test", reason: "Probation not confirmed" } as never });
    expect(await listed()).toHaveLength(0);
  });
});

describe("personal data: the employee's copy and erasure", () => {
  it("a decision, its date and its reason are in the copy of their data they can ask for, and no one else's", async () => {
    const s = await setup();
    await decideProbation(s.decider, s.contract.id, { decision: "EXTENDED", extensionMonths: 1, note: "SECRET-REASON more time on nights" });
    const other = await setup();
    await decideProbation(other.decider, other.contract.id, { decision: "FAILED", note: "OTHER-REASON not suitable" });
    const section = (await compileEmployeeData(s.t.org.id, s.emp.id)).sections.probationDecisions;
    expect(section.records).toHaveLength(1);
    expect(JSON.stringify(section.records)).toContain("SECRET-REASON");
    expect(JSON.stringify(section.records)).not.toContain("OTHER-REASON");
  });
  it("erasing an employee removes the words in every decision and keeps the shape and the audit log", async () => {
    const s = await setup();
    await decideProbation(s.decider, s.contract.id, { decision: "EXTENDED", extensionMonths: 1, note: "SECRET-REASON more time on nights" });
    const auditBefore = await db.auditLog.count({ where: { organizationId: s.t.org.id } });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, s.t.org.id, s.emp.id, new Date()));
    expect(counts.probationDecisions).toBe(1);
    const row = await db.probationDecision.findFirstOrThrow({ where: { contractId: s.contract.id } });
    expect(JSON.stringify(row)).not.toContain("SECRET-REASON");
    expect(row).toMatchObject({ decision: "EXTENDED", extensionMonths: 1 }); // the shape stays
    expect((await db.employmentContract.findUniqueOrThrow({ where: { id: s.contract.id } })).notes).toBeNull(); // the same words written into the contract's notes
    expect(await db.auditLog.count({ where: { organizationId: s.t.org.id } })).toBe(auditBefore);
  });
});

describe("the audit trail", () => {
  it("marking a decision as told is recorded by ids, and never what the reason says", async () => {
    const s = await setup();
    await decideProbation(s.decider, s.contract.id, { decision: "FAILED", note: "SECRET-REASON did not meet the standard" });
    const row = await db.probationDecision.findFirstOrThrow({ where: { contractId: s.contract.id } });
    await markProbationInformed(s.hr, row.id);
    const told = await db.auditLog.findFirstOrThrow({ where: { organizationId: s.t.org.id, action: "PROBATION_INFORMED" } });
    expect(told).toMatchObject({ entity: "ProbationDecision", entityId: row.id, userId: s.hr.userId });
    expect(JSON.stringify(told)).not.toContain("SECRET-REASON");
  });
});
