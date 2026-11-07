import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isolatedOrg, uid } from "../helpers";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { approveAppraisal, getAppraisal, launchCycle, returnReview, saveReview, submitReview } from "@/server/services/appraisals";
import {
  activateJobDescription,
  addKpi,
  createJobDescription,
  discardDraft,
  getJobDescription,
  getKpiBands,
  listJobDescriptions,
  removeKpi,
  updateJobDescription,
  updateKpi,
  updateKpiBands,
} from "@/server/services/performance";
import { DEFAULT_KPI_BANDS } from "@/lib/performance";

// Job descriptions and KPIs feed the appraisal (the founder, 2026-11-06; docs/plans/performance-management-phase1.md).

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const cycleInput = (over: Record<string, unknown> = {}) => ({ name: `Cycle ${uid()}`, kind: "ANNUAL" as const, periodStart: "2025-01-01", periodEnd: "2026-06-30", dueDate: day(30), ...over });

async function setup() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const approver = t.ctx("HR_ADMIN", null, 2);
  const mgr = await createEmployee(hr, { firstName: "Sup", lastName: "Ervisor", employmentDate: "2022-01-01", categoryId: t.officeId });
  const user = await db.user.create({ data: { organizationId: t.org.id, email: `sup-${uid()}@kpi.test`.toLowerCase(), name: "Sup Ervisor", role: "SUPERVISOR", passwordHash: "x", employeeId: mgr.id } });
  const reviewer: Ctx = { ...t.ctx("SUPERVISOR", mgr.id), userId: user.id, name: user.name };
  const g1 = await createEmployee(hr, { firstName: "Guard", lastName: "One", employmentDate: "2023-01-01", categoryId: t.guardId, reportingManagerId: mgr.id });
  const clerk = await createEmployee(hr, { firstName: "Clerk", lastName: "Office", employmentDate: "2023-01-01", categoryId: t.officeId, reportingManagerId: mgr.id });
  return { t, hr, approver, mgr, reviewer, g1, clerk };
}
type World = Awaited<ReturnType<typeof setup>>;

/** The guards' job description, with the founder's worked example: two KPIs, made active by a second person. */
async function activeGuardJd(w: World, kpis = [
  { name: "Shifts covered without a late arrival", unit: "PERCENT" as const, direction: "HIGHER_IS_BETTER" as const, target: "95", weight: 60 },
  { name: "Incident reports filed the same day", unit: "PERCENT" as const, direction: "HIGHER_IS_BETTER" as const, target: "100", weight: 40 },
]) {
  const jd = await createJobDescription(w.hr, { categoryId: w.t.guardId, title: "Security Guard", purpose: "Protect people and property at the post" });
  for (const k of kpis) await addKpi(w.hr, jd.id, k);
  return activateJobDescription(w.approver, jd.id);
}

async function launch(w: World, over: Record<string, unknown> = {}) {
  const r = await launchCycle(w.hr, cycleInput({ categoryIds: [w.t.guardId], ...over }));
  const appraisal = await db.appraisal.findFirstOrThrow({ where: { cycleId: r.cycle.id, employeeId: w.g1.id }, include: { ratings: true, kpis: { orderBy: { sortOrder: "asc" } } } });
  return { ...r, appraisal };
}

async function rateAll(ctx: Ctx, id: string, rating: number, kpis: Array<{ kpiId: string; actual?: string; comment?: string }> = []) {
  const a = await db.appraisal.findUniqueOrThrow({ where: { id }, include: { ratings: true } });
  await saveReview(ctx, id, {
    ratings: a.ratings.map((r) => ({ criterionId: r.criterionId, rating, comment: rating <= 2 || rating >= 5 ? "Because of the evidence" : undefined })),
    strengths: "Reliable",
    recommendation: "NONE",
    kpis,
  } as never);
}

describe("a job description and its KPIs", () => {
  it("HR drafts one per category, with KPIs that have an exact target above zero and a weight", async () => {
    const w = await setup();
    const jd = await createJobDescription(w.hr, { categoryId: w.t.guardId, title: "Security Guard", purpose: "Protect the post", responsibilities: "Patrol, log, report" });
    expect(jd).toMatchObject({ status: "DRAFT", version: 1, title: "Security Guard" });
    const k = await addKpi(w.hr, jd.id, { name: "Patrol rounds completed", unit: "PERCENT", direction: "HIGHER_IS_BETTER", target: "95.5", weight: 30 });
    expect(String(k.target)).toBe("95.5");
    await expect(addKpi(w.hr, jd.id, { name: "patrol ROUNDS completed", unit: "COUNT", direction: "HIGHER_IS_BETTER", target: "5", weight: 10 })).rejects.toThrow(/already/i);
    for (const bad of ["0", "-5", "abc", "1.00001", "1,000", ""]) await expect(addKpi(w.hr, jd.id, { name: `K ${bad}`, unit: "COUNT", direction: "HIGHER_IS_BETTER", target: bad, weight: 10 }), bad).rejects.toThrow();
    await expect(addKpi(w.hr, jd.id, { name: "Zero weight", unit: "COUNT", direction: "HIGHER_IS_BETTER", target: "5", weight: 0 })).rejects.toThrow();
    await expect(createJobDescription(w.hr, { categoryId: w.t.guardId, title: "A second draft" })).rejects.toThrow(/already a draft/i);
    expect((await updateKpi(w.hr, k.id, { weight: 45 })).weight).toBe(45);
    await removeKpi(w.hr, k.id);
    expect((await getJobDescription(w.hr, jd.id)).kpis).toEqual([]);
  });

  it("only people who manage appraisals can draft; an auditor reads; another company sees nothing", async () => {
    const w = await setup();
    await expect(createJobDescription(w.t.ctx("AUDITOR"), { categoryId: w.t.guardId, title: "Nope here" })).rejects.toThrow(/permission/);
    await expect(createJobDescription(w.t.ctx("FINANCE"), { categoryId: w.t.guardId, title: "Nope here" })).rejects.toThrow(/permission/);
    const jd = await createJobDescription(w.hr, { categoryId: w.t.guardId, title: "Security Guard" });
    await expect(getJobDescription(w.t.ctx("AUDITOR"), jd.id)).resolves.toBeTruthy();
    const other = await isolatedOrg();
    await expect(getJobDescription(other.ctx("HR_ADMIN"), jd.id)).rejects.toThrow(/not found/i);
    expect(await listJobDescriptions(other.ctx("HR_ADMIN"))).toEqual([]);
    await expect(createJobDescription(other.ctx("HR_ADMIN"), { categoryId: w.t.guardId, title: "Cross company" })).rejects.toThrow(/categor/i);
    const kpi = await addKpi(w.hr, jd.id, { name: "Cross-company probe", unit: "COUNT", direction: "HIGHER_IS_BETTER", target: "1", weight: 1 });
    await expect(updateKpi(other.ctx("HR_ADMIN"), kpi.id, { weight: 5 })).rejects.toThrow(/not found/i);
  });

  it("a second person makes it active, never the one who drafted it; the previous version is retired", async () => {
    const w = await setup();
    const v1 = await createJobDescription(w.hr, { categoryId: w.t.guardId, title: "Security Guard" });
    await addKpi(w.hr, v1.id, { name: "Attendance", unit: "PERCENT", direction: "HIGHER_IS_BETTER", target: "95", weight: 10 });
    await expect(activateJobDescription(w.hr, v1.id)).rejects.toThrow(/someone else/i);
    await expect(activateJobDescription(w.t.ctx("AUDITOR"), v1.id)).rejects.toThrow(/permission/);
    expect((await activateJobDescription(w.approver, v1.id)).status).toBe("ACTIVE");
    // an active version is never edited: a change is a new draft that starts as a copy
    await expect(updateJobDescription(w.hr, v1.id, { title: "Changed" })).rejects.toThrow(/draft/i);
    await expect(addKpi(w.hr, v1.id, { name: "Late KPI", unit: "COUNT", direction: "HIGHER_IS_BETTER", target: "1", weight: 1 })).rejects.toThrow(/draft/i);
    const v2 = await createJobDescription(w.hr, { categoryId: w.t.guardId, title: "Security Guard (2027)" });
    expect(v2.version).toBe(2);
    expect((await getJobDescription(w.hr, v2.id)).kpis.map((k) => k.name)).toEqual(["Attendance"]); // copied from the active version
    await activateJobDescription(w.approver, v2.id);
    const all = await listJobDescriptions(w.hr, { categoryId: w.t.guardId });
    expect(all.map((j) => [j.version, j.status])).toEqual([[2, "ACTIVE"], [1, "RETIRED"]]);
    expect(await db.jobDescription.count({ where: { organizationId: w.t.org.id, categoryId: w.t.guardId, status: "ACTIVE" } })).toBe(1);
  });

  it("a draft can be discarded; an active version cannot", async () => {
    const w = await setup();
    const jd = await createJobDescription(w.hr, { categoryId: w.t.guardId, title: "Draft to drop" });
    await discardDraft(w.hr, jd.id);
    await expect(getJobDescription(w.hr, jd.id)).rejects.toThrow(/not found/i);
    const active = await activeGuardJd(w);
    await expect(discardDraft(w.hr, active.id)).rejects.toThrow(/draft/i);
  });

  it("is audited by ids and field names, never the text of the description", async () => {
    const w = await setup();
    const jd = await createJobDescription(w.hr, { categoryId: w.t.guardId, title: "Security Guard", purpose: "A private sentence about the role" });
    await activateJobDescription(w.approver, jd.id);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, entity: "JobDescription", entityId: jd.id } });
    expect(rows.map((r) => r.action).sort()).toEqual(["JOB_DESCRIPTION_ACTIVATE", "JOB_DESCRIPTION_DRAFT"]);
    expect(JSON.stringify(rows)).not.toContain("A private sentence");
  });
});

describe("the achievement bands", () => {
  it("start as the defaults, can be replaced by someone who configures HR, and are checked", async () => {
    const w = await setup();
    expect(await getKpiBands(w.t.org.id)).toEqual(DEFAULT_KPI_BANDS);
    const own = [{ fromBp: 0, score: 1 }, { fromBp: 9000, score: 3 }, { fromBp: 9500, score: 5 }];
    await expect(updateKpiBands(w.t.ctx("FINANCE"), own)).rejects.toThrow(/permission/);
    await expect(updateKpiBands(w.hr, [{ fromBp: 500, score: 1 }])).rejects.toThrow(/start at 0/i);
    await updateKpiBands(w.hr, own);
    expect(await getKpiBands(w.t.org.id)).toEqual(own);
    const row = await db.auditLog.findFirst({ where: { organizationId: w.t.org.id, action: "KPI_BANDS_UPDATE" } });
    expect(row).toBeTruthy();
  });
});

describe("launching a cycle with a KPI share", () => {
  it("snapshots the active job description and its KPIs onto each appraisal", async () => {
    const w = await setup();
    const jd = await activeGuardJd(w);
    const { appraisal } = await launch(w, { kpiSharePct: 40 });
    expect(appraisal.jobDescriptionId).toBe(jd.id);
    expect(appraisal.kpis.map((k) => [k.kpiName, String(k.target), k.weight, k.actual])).toEqual([
      ["Shifts covered without a late arrival", "95", 60, null],
      ["Incident reports filed the same day", "100", 40, null],
    ]);
    const cycle = await db.appraisalCycle.findFirstOrThrow({ where: { id: appraisal.cycleId } });
    expect(cycle.kpiSharePct).toBe(40);
  });

  it("with a 0% share (the default) nothing changes: the job description is noted but no KPI is asked for", async () => {
    const w = await setup();
    const jd = await activeGuardJd(w);
    const { appraisal, cycle } = await launch(w);
    expect(cycle.kpiSharePct).toBe(0);
    expect(appraisal.jobDescriptionId).toBe(jd.id);
    expect(appraisal.kpis).toEqual([]);
  });

  it("leaves out, and says so, an employee whose category has no active KPIs, when KPIs count", async () => {
    const w = await setup();
    await activeGuardJd(w);
    const r = await launchCycle(w.hr, cycleInput({ kpiSharePct: 40 })); // guards and office staff
    expect(await db.appraisal.count({ where: { cycleId: r.cycle.id, employeeId: w.clerk.id } })).toBe(0);
    expect(r.skipped.some((s) => /KPI/i.test(s.reason) && s.employee.includes("Office"))).toBe(true);
  });

  it("refuses a share outside 0 to 100", async () => {
    const w = await setup();
    await activeGuardJd(w);
    for (const bad of [-1, 101, 12.5]) await expect(launchCycle(w.hr, cycleInput({ categoryIds: [w.t.guardId], kpiSharePct: bad }))).rejects.toThrow();
  });

  it("a later change to the job description does not change a review under way", async () => {
    const w = await setup();
    await activeGuardJd(w);
    const { appraisal } = await launch(w, { kpiSharePct: 40 });
    const v2 = await createJobDescription(w.hr, { categoryId: w.t.guardId, title: "Security Guard v2" });
    const first = (await getJobDescription(w.hr, v2.id)).kpis[0];
    await updateKpi(w.hr, first.id, { target: "99" });
    await activateJobDescription(w.approver, v2.id);
    const again = await db.appraisalKpi.findMany({ where: { appraisalId: appraisal.id }, orderBy: { sortOrder: "asc" } });
    expect(again.map((k) => String(k.target))).toEqual(["95", "100"]);
  });
});

describe("the review with KPIs", () => {
  it("the worked example: criteria 4.00, KPIs 3.40, a 40% share = an overall score of 3.76", async () => {
    const w = await setup();
    await activeGuardJd(w);
    const { appraisal } = await launch(w, { kpiSharePct: 40 });
    await db.appraisal.update({ where: { id: appraisal.id }, data: { reviewerUserId: w.reviewer.userId, reviewerName: "Sup Ervisor" } });
    const [k1, k2] = appraisal.kpis;
    await rateAll(w.reviewer, appraisal.id, 4, [{ kpiId: k1.kpiId, actual: "90" }, { kpiId: k2.kpiId, actual: "100", comment: "All reported" }]);
    await submitReview(w.reviewer, appraisal.id);
    const done = await db.appraisal.findUniqueOrThrow({ where: { id: appraisal.id }, include: { kpis: { orderBy: { sortOrder: "asc" } } } });
    expect(done.kpis.map((k) => [k.achievementBp, k.score])).toEqual([[9474, 3], [10000, 4]]);
    expect(done.kpiScore).toBe(340);
    expect(Number(done.criteriaScore)).toBe(4);
    expect(Number(done.overallScore)).toBe(3.76);
    expect(done.overallBand).toBe("Exceeds expectations");
  });

  it("cannot be submitted until every KPI has an actual result, and an actual must be an exact number", async () => {
    const w = await setup();
    await activeGuardJd(w);
    const { appraisal } = await launch(w, { kpiSharePct: 40 });
    await db.appraisal.update({ where: { id: appraisal.id }, data: { reviewerUserId: w.reviewer.userId, reviewerName: "Sup Ervisor" } });
    const [k1, k2] = appraisal.kpis;
    await expect(rateAll(w.reviewer, appraisal.id, 4, [{ kpiId: k1.kpiId, actual: "ninety" }])).rejects.toThrow(/figure|number/i);
    await expect(rateAll(w.reviewer, appraisal.id, 4, [{ kpiId: "not-a-kpi", actual: "90" }])).rejects.toThrow(/KPI/i);
    await rateAll(w.reviewer, appraisal.id, 4, [{ kpiId: k1.kpiId, actual: "90" }]);
    await expect(submitReview(w.reviewer, appraisal.id)).rejects.toThrow(/Incident reports filed the same day/);
    await rateAll(w.reviewer, appraisal.id, 4, [{ kpiId: k1.kpiId, actual: "90" }, { kpiId: k2.kpiId, actual: "100" }]);
    await expect(submitReview(w.reviewer, appraisal.id)).resolves.toBeTruthy();
  });

  it("with a 0% share the overall score is exactly the criteria score, as before KPIs existed", async () => {
    const w = await setup();
    await activeGuardJd(w);
    const { appraisal } = await launch(w);
    await db.appraisal.update({ where: { id: appraisal.id }, data: { reviewerUserId: w.reviewer.userId, reviewerName: "Sup Ervisor" } });
    await rateAll(w.reviewer, appraisal.id, 3);
    await submitReview(w.reviewer, appraisal.id);
    const done = await db.appraisal.findUniqueOrThrow({ where: { id: appraisal.id } });
    expect(Number(done.overallScore)).toBe(3);
    expect(done.kpiScore).toBeNull();
  });

  it("uses the company's own bands, and sending it back clears the worked-out figures so a resubmission recalculates", async () => {
    const w = await setup();
    await activeGuardJd(w);
    await updateKpiBands(w.hr, [{ fromBp: 0, score: 1 }, { fromBp: 9000, score: 3 }, { fromBp: 9500, score: 5 }]);
    const { appraisal } = await launch(w, { kpiSharePct: 100 });
    await db.appraisal.update({ where: { id: appraisal.id }, data: { reviewerUserId: w.reviewer.userId, reviewerName: "Sup Ervisor" } });
    const [k1, k2] = appraisal.kpis;
    await rateAll(w.reviewer, appraisal.id, 3, [{ kpiId: k1.kpiId, actual: "90" }, { kpiId: k2.kpiId, actual: "100", comment: "Full" }]);
    await submitReview(w.reviewer, appraisal.id);
    let done = await db.appraisal.findUniqueOrThrow({ where: { id: appraisal.id }, include: { kpis: { orderBy: { sortOrder: "asc" } } } });
    expect(done.kpis.map((k) => k.score)).toEqual([3, 5]); // 94.74% is in the band that starts at 90%, below the one that starts at 95%
    expect(Number(done.overallScore)).toBe(3.8); // (3 x 60 + 5 x 40) / 100 = 3.80 with a 100% share
    await returnReview(w.approver, appraisal.id, "Please recheck the first figure");
    done = await db.appraisal.findUniqueOrThrow({ where: { id: appraisal.id }, include: { kpis: { orderBy: { sortOrder: "asc" } } } });
    expect([done.overallScore, done.kpiScore, done.criteriaScore, ...done.kpis.map((k) => k.score)]).toEqual([null, null, null, null, null]);
    expect(done.kpis[0].actual).not.toBeNull(); // the reviewer's work in progress is kept
    await rateAll(w.reviewer, appraisal.id, 3, [{ kpiId: k1.kpiId, actual: "96" }]);
    await submitReview(w.reviewer, appraisal.id);
    done = await db.appraisal.findUniqueOrThrow({ where: { id: appraisal.id }, include: { kpis: { orderBy: { sortOrder: "asc" } } } });
    expect(done.kpis.map((k) => k.score)).toEqual([5, 5]);
  });

  it("the employee sees no KPI result or score until the appraisal is signed off", async () => {
    const w = await setup();
    await activeGuardJd(w);
    const { appraisal } = await launch(w, { kpiSharePct: 40 });
    await db.appraisal.update({ where: { id: appraisal.id }, data: { reviewerUserId: w.reviewer.userId, reviewerName: "Sup Ervisor" } });
    const [k1, k2] = appraisal.kpis;
    await rateAll(w.reviewer, appraisal.id, 4, [{ kpiId: k1.kpiId, actual: "90" }, { kpiId: k2.kpiId, actual: "100" }]);
    await submitReview(w.reviewer, appraisal.id);
    const self = w.t.ctx("EMPLOYEE", w.g1.id);
    const before = await getAppraisal(self, appraisal.id);
    expect(before.kpis.map((k) => [k.kpiName, k.actual, k.score, k.achievementBp])).toEqual([
      ["Shifts covered without a late arrival", null, null, null],
      ["Incident reports filed the same day", null, null, null],
    ]);
    expect(before.kpiScore).toBeNull();
    expect(before.criteriaScore).toBeNull();
    const reviewerView = await getAppraisal(w.reviewer, appraisal.id);
    expect(reviewerView.kpis[0].actual).not.toBeNull();
    await approveAppraisal(w.approver, appraisal.id);
    const after = await getAppraisal(self, appraisal.id);
    expect(after.kpis.map((k) => k.score)).toEqual([3, 4]);
    expect(after.kpiScore).toBe(340);
  });

  it("only the assigned reviewer enters actuals", async () => {
    const w = await setup();
    await activeGuardJd(w);
    const { appraisal } = await launch(w, { kpiSharePct: 40 });
    await db.appraisal.update({ where: { id: appraisal.id }, data: { reviewerUserId: w.reviewer.userId, reviewerName: "Sup Ervisor" } });
    await expect(saveReview(w.t.ctx("HR_ADMIN", null, 3), appraisal.id, { ratings: [], kpis: [{ kpiId: appraisal.kpis[0].kpiId, actual: "90" }] } as never)).rejects.toThrow();
    await expect(saveReview(w.t.ctx("EMPLOYEE", w.g1.id), appraisal.id, { ratings: [], kpis: [{ kpiId: appraisal.kpis[0].kpiId, actual: "90" }] } as never)).rejects.toThrow();
  });
});
