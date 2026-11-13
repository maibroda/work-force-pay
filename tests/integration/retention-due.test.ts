import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { isolatedOrg, uid } from "../helpers";
import { createEmployee } from "@/server/services/employees";
import { todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { buildHrDigest } from "@/server/services/reminders";
import { dueView, placeHold, releaseHold, retentionNotices, updateRule } from "@/server/services/retention-schedule";

// Governance step 3b-1 (docs/plans/hr-governance-plan.md, section 2.4): MEASURING what is past or near the end of its period, in every category the system can work out, and telling HR.
// Nothing here deletes anything. Counts only: no name, no id of a person.

const day = (n: number) => addDays(todayUtc(), n);
const yearsAgo = (n: number) => day(-Math.round(n * 365.25));
const future = (days = 60) => iso(addDays(todayUtc(), days));
const REASON = "A tribunal claim is expected from this person.";

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const boss = t.ctx("COMPANY_ADMIN", null, 3);
  const make = (first: string, last: string) =>
    createEmployee(hr, { firstName: first, lastName: last, gender: "FEMALE", dateOfBirth: "1990-05-05", phone: "08031112222", address: "12 Marina, Lagos", employmentDate: "2010-01-10", categoryId: t.guardId });
  /** Someone who left `yrs` years ago. */
  const leaver = async (first: string, last: string, yrs: number) => {
    const e = await make(first, last);
    await db.employee.update({ where: { id: e.id }, data: { status: "RESIGNED", exitDate: yearsAgo(yrs) } });
    return e;
  };
  return { t, hr, boss, make, leaver };
}
type W = Awaited<ReturnType<typeof world>>;

const cat = async (w: W, name: string, ctx = w.hr) => (await dueView(ctx)).categories.find((c) => c.category === name)!;

/** One record of the kind, for one person. */
const give = {
  async disciplinary(w: W, employeeId: string) {
    await db.disciplinaryRecord.create({ data: { organizationId: w.t.org.id, employeeId, type: "QUERY", incidentDate: day(-3000), description: "SECRET-DISC-WORDS", issuedBy: "HR" } });
  },
  async feedback(w: W, employeeId: string) {
    await db.performanceFeedback.create({ data: { organizationId: w.t.org.id, employeeId, authorUserId: "u1", authorName: "Obi", kind: "RECOGNITION", body: "Well done", relatesOn: day(-3000) } });
  },
  async plan(w: W, employeeId: string) {
    await db.performanceImprovementPlan.create({ data: { organizationId: w.t.org.id, employeeId, concerns: "Lateness", startDate: day(-3000), endDate: day(-2900), originalEndDate: day(-2900), ownerUserId: "u1", ownerName: "Obi", draftedByUserId: "u1", draftedBy: "Obi" } });
  },
  async appraisal(w: W, employeeId: string) {
    const cycle = await db.appraisalCycle.create({ data: { organizationId: w.t.org.id, name: `Cycle ${uid()}`, periodStart: day(-3100), periodEnd: day(-3000), dueDate: day(-2990), createdBy: "u1" } });
    await db.appraisal.create({ data: { organizationId: w.t.org.id, cycleId: cycle.id, employeeId } });
  },
  async probation(w: W, employeeId: string) {
    const contract = await db.employmentContract.create({ data: { organizationId: w.t.org.id, contractNumber: `C-${uid()}`, employeeId, type: "PERMANENT", jobTitle: "Guard", startDate: day(-3000), createdBy: "u1" } });
    await db.probationDecision.create({ data: { organizationId: w.t.org.id, employeeId, contractId: contract.id, decision: "CONFIRMED", decidedByUserId: "u1", decidedBy: "Obi" } });
  },
  async skill(w: W, employeeId: string) {
    const skill = await db.skill.create({ data: { organizationId: w.t.org.id, name: `Skill ${uid()}`, createdBy: "u1" } });
    await db.skillAssessment.create({ data: { organizationId: w.t.org.id, employeeId, skillId: skill.id, level: 3, assessedOn: day(-3000), assessedByUserId: "u1", assessedBy: "Obi" } });
  },
  async trainingNeed(w: W, employeeId: string) {
    await db.trainingNeed.create({ data: { organizationId: w.t.org.id, employeeId, courseName: "First aid", source: "COMPLIANCE", createdBy: "u1" } });
  },
  async trainingEnrolment(w: W, employeeId: string) {
    const programme = await db.trainingProgramme.create({ data: { organizationId: w.t.org.id, name: `Programme ${uid()}`, createdBy: "u1" } });
    const session = await db.trainingSession.create({ data: { organizationId: w.t.org.id, programmeId: programme.id, sessionDate: day(-3000), seats: 10, createdBy: "u1" } });
    await db.trainingEnrolment.create({ data: { organizationId: w.t.org.id, sessionId: session.id, employeeId, enrolledBy: "u1" } });
  },
  async welfare(w: W, employeeId: string, closedYearsAgo: number) {
    await db.relationsCase.create({
      data: { organizationId: w.t.org.id, caseNumber: `W-${uid()}`, employeeId, type: "WELFARE", status: "CLOSED", closedAt: yearsAgo(closedYearsAgo), summary: "SECRET-WELFARE-WORDS", description: "x", raisedBy: "HR", raisedByUserId: "u1" },
    });
  },
  async succession(w: W, employeeId: string, reviewedMonthsAgo: number) {
    const role = (await db.successionRole.findFirst({ where: { organizationId: w.t.org.id } })) ?? (await db.successionRole.create({ data: { organizationId: w.t.org.id, categoryId: w.t.guardId, createdBy: "u1" } }));
    await db.successionCandidate.create({ data: { organizationId: w.t.org.id, roleId: role.id, employeeId, readiness: "READY_NOW", createdBy: "u1", updatedAt: addDays(todayUtc(), -Math.round(reviewedMonthsAgo * 30.5)) } });
  },
};

describe("what is past its period, by category", () => {
  it("counts the former employees past the period who still hold a record of each kind, once each, for every category tied to leaving", async () => {
    const w = await world();
    const ada = await w.leaver("Ada", "Okafor", 7);
    for (const make of [give.disciplinary, give.feedback, give.plan, give.appraisal, give.probation, give.skill, give.trainingNeed]) await make(w, ada.id);
    await give.disciplinary(w, ada.id); // two of one kind still make one person
    for (const c of ["DISCIPLINARY", "FEEDBACK", "IMPROVEMENT_PLANS", "APPRAISALS", "PROBATION", "SKILLS", "TRAINING"]) {
      expect(await cat(w, c), c).toMatchObject({ measured: true, due: 1, soon: 0, held: 0, unit: "people" });
    }
    expect(await cat(w, "WELFARE_CASES")).toMatchObject({ measured: true, due: 0 });
  });

  it("counts a training enrolment, a request and a need as training", async () => {
    const w = await world();
    const a = await w.leaver("Ada", "Okafor", 7);
    const b = await w.leaver("Bola", "Adeyemi", 7);
    await give.trainingEnrolment(w, a.id);
    await give.trainingNeed(w, b.id);
    expect(await cat(w, "TRAINING")).toMatchObject({ due: 2, unit: "people" });
  });

  it("does not count someone still employed, someone who left within the period, someone with nothing of that kind, or someone already erased", async () => {
    const w = await world();
    const current = await w.make("Chidi", "Eze");
    const recent = await w.leaver("Bola", "Adeyemi", 3);
    const bare = await w.leaver("Dayo", "Bello", 8); // left long ago but holds no disciplinary record
    const erased = await w.leaver("Efe", "Ojo", 9);
    await db.employee.update({ where: { id: erased.id }, data: { anonymizedAt: new Date() } });
    for (const e of [current, recent, erased]) await give.disciplinary(w, e.id);
    await give.feedback(w, bare.id);
    expect(await cat(w, "DISCIPLINARY")).toMatchObject({ due: 0, soon: 0 });
    expect(await cat(w, "FEEDBACK")).toMatchObject({ due: 1 });
  });

  it("separates what is past from what expires within 90 days from what is later", async () => {
    const w = await world();
    const past = await w.make("Ada", "Okafor");
    const soon = await w.make("Bola", "Adeyemi");
    const later = await w.make("Chidi", "Eze");
    const exit = (id: string, d: Date) => db.employee.update({ where: { id }, data: { status: "TERMINATED", exitDate: d } });
    await exit(past.id, addDays(yearsAgo(6), -1)); // six years and a day ago
    await exit(soon.id, addDays(yearsAgo(6), 30)); // six years end in 30 days
    await exit(later.id, addDays(yearsAgo(6), 200));
    for (const e of [past, soon, later]) await give.disciplinary(w, e.id);
    expect(await cat(w, "DISCIPLINARY")).toMatchObject({ due: 1, soon: 1 });
  });

  it("follows the rule as edited: a shorter period brings more into scope, and the Company Administrator's change is what is measured", async () => {
    const w = await world();
    const ada = await w.leaver("Ada", "Okafor", 3);
    await give.disciplinary(w, ada.id);
    expect(await cat(w, "DISCIPLINARY")).toMatchObject({ due: 0 });
    await updateRule(w.boss, "DISCIPLINARY", { periodMonths: 24, trigger: "AFTER_EXIT", action: "ANONYMISE" });
    expect(await cat(w, "DISCIPLINARY")).toMatchObject({ due: 1 });
  });

  it("counts welfare cases from the day they were closed, even for someone still employed, and an open case never", async () => {
    const w = await world();
    const current = await w.make("Chidi", "Eze");
    await give.welfare(w, current.id, 7);
    await give.welfare(w, current.id, 2);
    await db.relationsCase.create({ data: { organizationId: w.t.org.id, caseNumber: `W-${uid()}`, employeeId: current.id, type: "WELFARE", status: "OPEN", summary: "x", description: "x", raisedBy: "HR", raisedByUserId: "u1" } });
    expect(await cat(w, "WELFARE_CASES")).toMatchObject({ measured: true, due: 1, unit: "records" });
  });

  it("counts a succession entry not reviewed within its 12 months as due for REVIEW, never as something to delete", async () => {
    const w = await world();
    const a = await w.make("Ada", "Okafor");
    const b = await w.make("Bola", "Adeyemi");
    await give.succession(w, a.id, 14);
    await give.succession(w, b.id, 3);
    const c = await cat(w, "SUCCESSION");
    expect(c).toMatchObject({ measured: true, due: 1, unit: "records", action: "REVIEW" });
  });

  it("counts audit log entries past their period for review, and the application deletes none", async () => {
    const w = await world();
    const before = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    for (const y of [8, 7, 1]) await db.auditLog.create({ data: { organizationId: w.t.org.id, userName: "System", action: "TEST_OLD_ENTRY", entity: "Test", createdAt: yearsAgo(y) } });
    const c = await cat(w, "AUDIT_LOGS");
    expect(c).toMatchObject({ measured: true, due: 2, unit: "records", action: "REVIEW" });
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id } })).toBeGreaterThanOrEqual(before + 3);
  });

  it("says plainly which categories it cannot measure (the access logs, the reports that are kept) and why", async () => {
    const w = await world();
    for (const name of ["ACCESS_LOGS", "SURVEY_REPORTS"]) {
      const c = await cat(w, name);
      expect(c.measured, name).toBe(false);
      expect(c.reason, name).toBeTruthy();
    }
  });

  it("does not guess when a rule names a trigger the system cannot work out for that category", async () => {
    const w = await world();
    const ada = await w.leaver("Ada", "Okafor", 9);
    await give.disciplinary(w, ada.id);
    await updateRule(w.boss, "DISCIPLINARY", { periodMonths: 72, trigger: "AFTER_CLOSURE", action: "ANONYMISE" });
    const c = await cat(w, "DISCIPLINARY");
    expect(c).toMatchObject({ measured: false, due: 0 });
    expect(c.reason).toMatch(/closed|counted from/i);
  });

  it("measures a KEEP rule as nothing to do", async () => {
    const w = await world();
    const ada = await w.leaver("Ada", "Okafor", 20);
    await give.disciplinary(w, ada.id);
    await updateRule(w.boss, "DISCIPLINARY", { periodMonths: 0, trigger: "AFTER_EXIT", action: "KEEP" });
    expect(await cat(w, "DISCIPLINARY")).toMatchObject({ due: 0, soon: 0, off: true });
  });
});

describe("legal holds in the count", () => {
  it("counts a held person's records as held, a category hold as held for everyone in that category, and the company hold for all", async () => {
    const w = await world();
    const ada = await w.leaver("Ada", "Okafor", 7);
    const bola = await w.leaver("Bola", "Adeyemi", 7);
    for (const e of [ada, bola]) {
      await give.disciplinary(w, e.id);
      await give.feedback(w, e.id);
    }
    const person = await placeHold(w.hr, { scope: "EMPLOYEE", employeeId: ada.id, reason: REASON, reviewOn: future() });
    expect(await cat(w, "DISCIPLINARY")).toMatchObject({ due: 2, held: 1 });
    const one = await placeHold(w.hr, { scope: "CATEGORY", category: "FEEDBACK", reason: REASON, reviewOn: future() });
    expect(await cat(w, "FEEDBACK")).toMatchObject({ due: 2, held: 2 });
    expect(await cat(w, "DISCIPLINARY")).toMatchObject({ due: 2, held: 1 });
    await releaseHold(w.boss, person.id, "The claim was withdrawn in writing.");
    await releaseHold(w.boss, one.id, "The review of the whole category is finished.");
    const all = await placeHold(w.boss, { scope: "COMPANY", reason: REASON, reviewOn: future() });
    expect(await cat(w, "DISCIPLINARY")).toMatchObject({ due: 2, held: 2 });
    await releaseHold(w.boss, all.id, "The matter is closed for the whole company.");
    expect(await cat(w, "DISCIPLINARY")).toMatchObject({ held: 0 });
  });

  it("treats a held welfare case as held, by the person it is about", async () => {
    const w = await world();
    const ada = await w.make("Ada", "Okafor");
    const bola = await w.make("Bola", "Adeyemi");
    await give.welfare(w, ada.id, 7);
    await give.welfare(w, bola.id, 7);
    await placeHold(w.hr, { scope: "EMPLOYEE", employeeId: ada.id, reason: REASON, reviewOn: future() });
    expect(await cat(w, "WELFARE_CASES")).toMatchObject({ due: 2, held: 1 });
  });
});

describe("the count is private and belongs to one company", () => {
  it("carries no name, no id of a person and no record text", async () => {
    const w = await world();
    const ada = await w.leaver("Ada", "Okafor", 7);
    await give.disciplinary(w, ada.id);
    await give.welfare(w, ada.id, 7);
    const text = JSON.stringify(await dueView(w.hr));
    expect(text).not.toContain("Okafor");
    expect(text).not.toContain(ada.id);
    expect(text).not.toContain("SECRET-DISC-WORDS");
    expect(text).not.toContain("SECRET-WELFARE-WORDS");
  });

  it("never counts another company's records", async () => {
    const a = await world();
    const b = await world();
    const ada = await b.leaver("Ada", "Okafor", 9);
    await give.disciplinary(b, ada.id);
    await give.welfare(b, ada.id, 9);
    expect(await cat(a, "DISCIPLINARY")).toMatchObject({ due: 0 });
    expect(await cat(a, "WELFARE_CASES")).toMatchObject({ due: 0 });
    expect(await cat(b, "DISCIPLINARY")).toMatchObject({ due: 1 });
  });

  it("is for the people who see HR records only", async () => {
    const w = await world();
    await expect(dueView(w.t.ctx("EMPLOYEE"))).rejects.toThrow(/permission/i);
  });
});

describe("telling HR", () => {
  it("summarises, without a category or a name, how many kinds of record have something past the period or expiring within 90 days, and how many holds need a look", async () => {
    const w = await world();
    const ada = await w.leaver("Ada", "Okafor", 7);
    await give.disciplinary(w, ada.id);
    await give.feedback(w, ada.id);
    const h = await placeHold(w.hr, { scope: "COMPANY", reason: REASON, reviewOn: future(5) });
    await db.retentionHold.update({ where: { id: h.id }, data: { reviewOn: todayUtc() } });
    const n = await retentionNotices(w.t.org.id, todayUtc());
    expect(n.pastCategories).toBe(2);
    expect(n.holdsToReview).toBe(1);
    expect(JSON.stringify(n)).not.toContain("Okafor");
  });

  it("puts one line in the HR digest for each, and nothing when there is nothing to say", async () => {
    const quiet = await world();
    const d0 = await buildHrDigest(quiet.t.org.id, todayUtc());
    expect(JSON.stringify(d0)).not.toMatch(/retention period/i);
    const w = await world();
    await updateHrPolicy(w.hr, { employeeRetentionYears: 0 });
    const ada = await w.leaver("Ada", "Okafor", 7);
    await give.disciplinary(w, ada.id);
    const h = await placeHold(w.hr, { scope: "COMPANY", reason: REASON, reviewOn: future(5) });
    await db.retentionHold.update({ where: { id: h.id }, data: { reviewOn: todayUtc() } });
    const digest = await buildHrDigest(w.t.org.id, todayUtc());
    // the retention section carries the counts and nobody's name (other sections of the digest, such as kit still held by leavers, name people as they always did)
    const lines = JSON.stringify(digest.sections.find((x) => x.key === "retention"));
    expect(lines).toMatch(/kind\(s\) of record .*retention period/i);
    expect(lines).toMatch(/legal hold\(s\) .*review/i);
    expect(lines).not.toContain("Okafor");
  });
});
