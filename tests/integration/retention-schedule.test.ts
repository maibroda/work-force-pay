import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { isolatedOrg } from "../helpers";
import { RETENTION_CATEGORIES } from "@/lib/retention-schedule";
import { createEmployee } from "@/server/services/employees";
import { todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { decideErasure, requestErasure, retentionOverview } from "@/server/services/employee-retention";
import { addCandidate, approveRequisition, createRequisition } from "@/server/services/recruitment";
import { anonymizeStaleCandidates } from "@/server/services/retention";
import { addQuestion, closeSurvey, createSurvey, openSurvey, purgeExpired } from "@/server/services/survey";
import { dueView, getSchedule, placeHold, releaseHold, updateRule, verifyRule } from "@/server/services/retention-schedule";
import { anonymizeEmployee } from "@/server/services/employee-retention";

// Governance step 3a (docs/plans/hr-governance-plan.md, section 2.4): the retention schedule as data (the founder's defaults, UNVERIFIED until the legal adviser has seen them), legal holds
// that block the three deletions that exist, and nothing new that deletes. Audit carries ids and field names, never a reason or a note.

const today = () => iso(todayUtc());
const yearsAgo = (n: number) => iso(addDays(todayUtc(), -Math.round(n * 365.25)));
const future = (days = 60) => iso(addDays(todayUtc(), days));
const REASON = "A tribunal claim is expected from this person.";
const SECRET = "SECRET-HOLD-WORDS the claim concerns the Lekki site";

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const hr2 = t.ctx("HR_ADMIN", null, 2);
  const boss = t.ctx("COMPANY_ADMIN", null, 3);
  const make = (first: string, last: string) =>
    createEmployee(hr, { firstName: first, lastName: last, gender: "FEMALE", dateOfBirth: "1990-05-05", phone: "08031112222", address: "12 Marina, Lagos", employmentDate: "2015-01-10", categoryId: t.guardId });
  const leave = (id: string, yrs: number) => db.employee.update({ where: { id }, data: { status: "RESIGNED", exitDate: new Date(`${yearsAgo(yrs)}T00:00:00Z`) } });
  return { t, hr, hr2, boss, make, leave };
}
type W = Awaited<ReturnType<typeof world>>;

const personHold = (w: W, employeeId: string, over: Record<string, unknown> = {}) => placeHold(w.hr, { scope: "EMPLOYEE", employeeId, reason: REASON, reviewOn: future(), ...over } as never);

describe("the schedule", () => {
  it("loads the fifteen founder defaults the first time it is read, all UNVERIFIED, and never twice", async () => {
    const w = await world();
    const s = await getSchedule(w.hr);
    expect(s.rules.map((r) => r.category).sort()).toEqual([...RETENTION_CATEGORIES].sort());
    expect(s.rules.every((r) => !r.verified && r.verifiedOn === null)).toBe(true);
    expect(s.unverified).toBe(15);
    await getSchedule(w.boss);
    expect(await db.retentionRule.count({ where: { organizationId: w.t.org.id } })).toBe(15);
    const emp = s.rules.find((r) => r.category === "EMPLOYEE_FILE")!;
    expect(emp).toMatchObject({ periodMonths: 72, trigger: "AFTER_EXIT", action: "ANONYMISE", label: "Employee file" });
  });

  it("says which three categories the system applies today from the HR policy, with that setting's value, and which it does not", async () => {
    const w = await world();
    await updateHrPolicy(w.hr, { employeeRetentionYears: 7 });
    const s = await getSchedule(w.hr);
    const by = Object.fromEntries(s.rules.map((r) => [r.category, r]));
    expect(by.EMPLOYEE_FILE.applied).toMatchObject({ setting: "employeeRetentionYears", value: 7, unit: "years" });
    expect(by.RAW_SURVEYS.applied).toMatchObject({ setting: "surveyRetentionMonths", value: 24, unit: "months" });
    expect(by.UNSUCCESSFUL_APPLICANTS.applied).toMatchObject({ setting: "candidateRetentionMonths", unit: "months" });
    expect(by.DISCIPLINARY.applied).toBeNull();
    expect(by.AUDIT_LOGS.applied).toBeNull();
  });

  it("can be read by the people who see HR records and by nobody else", async () => {
    const w = await world();
    for (const role of ["HR_ADMIN", "COMPANY_ADMIN", "AUDITOR"] as const) await expect(getSchedule(w.t.ctx(role)), role).resolves.toBeTruthy();
    for (const role of ["EMPLOYEE", "SUPERVISOR"] as const) await expect(getSchedule(w.t.ctx(role)), role).rejects.toThrow(/permission/i);
  });

  it("shows the reason for a hold and the person it covers only to the roles that may see misconduct records (finance sees that a hold exists, not why or about whom)", async () => {
    const w = await world();
    const ada = await w.make("Ada", "Okafor");
    await personHold(w, ada.id, { reason: SECRET });
    for (const role of ["HR_ADMIN", "COMPANY_ADMIN", "AUDITOR"] as const) {
      const h = (await getSchedule(w.t.ctx(role))).holds[0];
      expect(h, role).toMatchObject({ reason: SECRET, employeeId: ada.id, employeeName: "Ada Okafor" });
    }
    const finance = await getSchedule(w.t.ctx("FINANCE"));
    expect(finance.holds).toHaveLength(1);
    expect(finance.holds[0]).toMatchObject({ scope: "EMPLOYEE", reason: null, employeeId: null, employeeName: null, employeeNumber: null });
    expect(JSON.stringify(finance)).not.toContain("SECRET-HOLD-WORDS");
    expect(JSON.stringify(finance)).not.toContain("Okafor");
  });

  it("is changed only by the Company Administrator, with a valid rule, and a change clears the adviser's verification", async () => {
    const w = await world();
    await getSchedule(w.hr);
    const change = { periodMonths: 84, trigger: "AFTER_EXIT", action: "ANONYMISE", note: "Seven years, to match the tax records." } as const;
    for (const role of ["HR_ADMIN", "AUDITOR", "FINANCE", "EMPLOYEE"] as const) await expect(updateRule(w.t.ctx(role), "EMPLOYEE_FILE", change), role).rejects.toThrow(/permission/i);
    await expect(updateRule(w.boss, "EMPLOYEE_FILE", { ...change, periodMonths: 0 })).rejects.toThrow(/at least one month/);
    await expect(updateRule(w.boss, "NOT_A_CATEGORY" as never, change)).rejects.toThrow();
    await verifyRule(w.boss, "EMPLOYEE_FILE", { verifiedBy: "Adaeze Counsel", verifiedOn: today(), note: "Seen on 12 November." });
    expect((await getSchedule(w.boss)).rules.find((r) => r.category === "EMPLOYEE_FILE")!.verified).toBe(true);
    await updateRule(w.boss, "EMPLOYEE_FILE", change);
    const after = (await getSchedule(w.boss)).rules.find((r) => r.category === "EMPLOYEE_FILE")!;
    expect(after).toMatchObject({ periodMonths: 84, verified: false, verifiedOn: null, verifiedBy: null, verifiedNote: null });
  });

  it("records the legal adviser's verification only from the Company Administrator, with the adviser's name, and not for a future day", async () => {
    const w = await world();
    await getSchedule(w.hr);
    await expect(verifyRule(w.hr, "DISCIPLINARY", { verifiedBy: "Adaeze Counsel", verifiedOn: today() })).rejects.toThrow(/permission/i);
    await expect(verifyRule(w.boss, "DISCIPLINARY", { verifiedBy: "", verifiedOn: today() })).rejects.toThrow(/name/i);
    await expect(verifyRule(w.boss, "DISCIPLINARY", { verifiedBy: "Adaeze Counsel", verifiedOn: future(5) })).rejects.toThrow(/future/i);
    await verifyRule(w.boss, "DISCIPLINARY", { verifiedBy: "Adaeze Counsel", verifiedOn: today(), note: "Checked against the Labour Act." });
    const r = (await getSchedule(w.boss)).rules.find((x) => x.category === "DISCIPLINARY")!;
    expect(r).toMatchObject({ verified: true, verifiedBy: "Adaeze Counsel", verifiedOn: today(), verifiedNote: "Checked against the Labour Act." });
    expect((await getSchedule(w.boss)).unverified).toBe(14);
  });

  it("audits a change by category and field names, and a verification by category and day, never the adviser or the note", async () => {
    const w = await world();
    await getSchedule(w.hr);
    await updateRule(w.boss, "TRAINING", { periodMonths: 60, trigger: "AFTER_EXIT", action: "ANONYMISE", note: "SECRET-RULE-NOTE five years is enough." });
    await verifyRule(w.boss, "TRAINING", { verifiedBy: "Adaeze Counsel", verifiedOn: today(), note: "SECRET-VERIFY-NOTE" });
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { in: ["RETENTION_RULE_CHANGE", "RETENTION_RULE_VERIFY"] } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["RETENTION_RULE_CHANGE", "RETENTION_RULE_VERIFY"]);
    const change = rows.find((r) => r.action === "RETENTION_RULE_CHANGE")!;
    expect(JSON.stringify(change.newValue)).toContain("periodMonths");
    expect(JSON.stringify(rows)).not.toContain("SECRET-RULE-NOTE");
    expect(JSON.stringify(rows)).not.toContain("SECRET-VERIFY-NOTE");
    expect(JSON.stringify(rows)).toContain("TRAINING");
  });

  it("is each company's own: one company's change never shows in another", async () => {
    const a = await world();
    const b = await world();
    await getSchedule(a.hr);
    await getSchedule(b.hr);
    await updateRule(a.boss, "SKILLS", { periodMonths: 36, trigger: "AFTER_EXIT", action: "DELETE" });
    expect((await getSchedule(b.boss)).rules.find((r) => r.category === "SKILLS")!.periodMonths).toBe(72);
  });
});

describe("a legal hold", () => {
  it("is placed by any HR administrator with a real reason and a review day in the future, and by nobody who lacks HR rights", async () => {
    const w = await world();
    const ada = await w.make("Ada", "Okafor");
    await expect(placeHold(w.t.ctx("AUDITOR"), { scope: "COMPANY", reason: REASON, reviewOn: future() } as never)).rejects.toThrow(/permission/i);
    await expect(placeHold(w.t.ctx("FINANCE"), { scope: "COMPANY", reason: REASON, reviewOn: future() } as never)).rejects.toThrow(/permission/i);
    await expect(personHold(w, ada.id, { reason: "short" })).rejects.toThrow(/reason/i);
    await expect(personHold(w, ada.id, { reviewOn: today() })).rejects.toThrow(/after today/);
    await expect(personHold(w, ada.id, { employeeId: null })).rejects.toThrow(/person/i);
    await expect(placeHold(w.hr, { scope: "CATEGORY", reason: REASON, reviewOn: future() } as never)).rejects.toThrow(/category/i);
    const h = await personHold(w, ada.id);
    expect(h).toMatchObject({ scope: "EMPLOYEE", employeeId: ada.id, releasedAt: null });
    await expect(placeHold(w.boss, { scope: "COMPANY", reason: REASON, reviewOn: future() } as never)).resolves.toBeTruthy();
  });

  it("cannot cover a person from another company", async () => {
    const a = await world();
    const b = await world();
    const stranger = await b.make("Bola", "Adeyemi");
    await expect(personHold(a, stranger.id)).rejects.toThrow(/not found/i);
  });

  it("is released only by the Company Administrator, with a reason, once, and the reasons stay out of the audit log", async () => {
    const w = await world();
    const ada = await w.make("Ada", "Okafor");
    const h = await personHold(w, ada.id, { reason: SECRET });
    await expect(releaseHold(w.hr, h.id, "The claim was withdrawn in writing.")).rejects.toThrow(/permission/i);
    await expect(releaseHold(w.hr2, h.id, "The claim was withdrawn in writing.")).rejects.toThrow(/permission/i);
    await expect(releaseHold(w.boss, h.id, "ok")).rejects.toThrow(/reason/i);
    await releaseHold(w.boss, h.id, "SECRET-RELEASE-WORDS the claim was withdrawn in writing.");
    await expect(releaseHold(w.boss, h.id, "Released twice by mistake here.")).rejects.toThrow(/already released/i);
    const row = await db.retentionHold.findUniqueOrThrow({ where: { id: h.id } });
    expect(row).toMatchObject({ releasedByUserId: w.boss.userId });
    expect(row.releasedAt).not.toBeNull();
    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { in: ["RETENTION_HOLD_PLACE", "RETENTION_HOLD_RELEASE"] } } });
    expect(audit.map((a) => a.action).sort()).toEqual(["RETENTION_HOLD_PLACE", "RETENTION_HOLD_RELEASE"]);
    expect(JSON.stringify(audit)).not.toContain("SECRET-HOLD-WORDS");
    expect(JSON.stringify(audit)).not.toContain("SECRET-RELEASE-WORDS");
    expect(JSON.stringify(audit)).toContain(h.id);
  });

  it("cannot be released by another company's administrator", async () => {
    const a = await world();
    const b = await world();
    const ada = await a.make("Ada", "Okafor");
    const h = await personHold(a, ada.id);
    await expect(releaseHold(b.boss, h.id, "Trying to release another company's hold.")).rejects.toThrow(/not found/i);
    expect((await db.retentionHold.findUniqueOrThrow({ where: { id: h.id } })).releasedAt).toBeNull();
  });

  it("shows on the schedule with who placed it, flags it for review on its review day, and hides nothing from the Company Administrator", async () => {
    const w = await world();
    const ada = await w.make("Ada", "Okafor");
    const h = await personHold(w, ada.id);
    const s = await getSchedule(w.boss);
    expect(s.holds).toHaveLength(1);
    expect(s.holds[0]).toMatchObject({ id: h.id, scope: "EMPLOYEE", placedBy: "HR_ADMIN 1", needsReview: false, released: false });
    await db.retentionHold.update({ where: { id: h.id }, data: { reviewOn: new Date(`${today()}T00:00:00Z`) } });
    expect((await getSchedule(w.boss)).holds[0].needsReview).toBe(true);
  });
});

describe("a hold stops the deletions that exist", () => {
  it("stops erasing a former employee, whether asked for or approved, and says a hold is the reason without giving it", async () => {
    const w = await world();
    await updateHrPolicy(w.hr, { employeeRetentionYears: 6 });
    const ada = await w.make("Ada", "Okafor");
    await w.leave(ada.id, 9);
    const h = await personHold(w, ada.id, { reason: SECRET });
    await expect(requestErasure(w.hr, ada.id, "RETENTION", "The retention period is over and nothing is outstanding.")).rejects.toThrow(/legal hold/i);
    await expect(requestErasure(w.hr, ada.id, "RETENTION", "The retention period is over and nothing is outstanding.")).rejects.not.toThrow(/SECRET-HOLD-WORDS/);
    const due = (await retentionOverview(w.hr)).due.find((d) => d.id === ada.id)!;
    expect(due.blockers.join(" ")).toMatch(/legal hold/i);
    expect(JSON.stringify(due)).not.toContain("SECRET-HOLD-WORDS");
    await releaseHold(w.boss, h.id, "The claim was withdrawn in writing.");
    const req = await requestErasure(w.hr, ada.id, "RETENTION", "The retention period is over and nothing is outstanding.");
    expect(req.status).toBe("PENDING");
  });

  it("stops an approval when a hold is placed after the request was made, and the person's details stay", async () => {
    const w = await world();
    await updateHrPolicy(w.hr, { employeeRetentionYears: 6 });
    const ada = await w.make("Ada", "Okafor");
    await w.leave(ada.id, 9);
    const req = await requestErasure(w.hr, ada.id, "RETENTION", "The retention period is over and nothing is outstanding.");
    const h = await placeHold(w.hr, { scope: "CATEGORY", category: "DISCIPLINARY", reason: REASON, reviewOn: future() } as never);
    await expect(decideErasure(w.boss, req.id, true)).rejects.toThrow(/legal hold/i);
    expect((await db.employee.findUniqueOrThrow({ where: { id: ada.id } })).firstName).toBe("Ada");
    expect((await db.employeeErasure.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PENDING");
    await releaseHold(w.boss, h.id, "The review of the whole category is finished.");
    await expect(decideErasure(w.boss, req.id, true)).resolves.toMatchObject({ status: "EXECUTED" });
  });

  it("is not stopped by a hold on someone else, or on a category that is not about people", async () => {
    const w = await world();
    await updateHrPolicy(w.hr, { employeeRetentionYears: 6 });
    const ada = await w.make("Ada", "Okafor");
    const bola = await w.make("Bola", "Adeyemi");
    await w.leave(ada.id, 9);
    await personHold(w, bola.id);
    await placeHold(w.hr, { scope: "CATEGORY", category: "RAW_SURVEYS", reason: REASON, reviewOn: future() } as never);
    await expect(requestErasure(w.hr, ada.id, "RETENTION", "The retention period is over and nothing is outstanding.")).resolves.toBeTruthy();
  });

  it("is stopped by a company-wide hold for everyone", async () => {
    const w = await world();
    await updateHrPolicy(w.hr, { employeeRetentionYears: 6 });
    const ada = await w.make("Ada", "Okafor");
    await w.leave(ada.id, 9);
    await placeHold(w.boss, { scope: "COMPANY", reason: REASON, reviewOn: future() } as never);
    await expect(requestErasure(w.hr, ada.id, "RETENTION", "The retention period is over and nothing is outstanding.")).rejects.toThrow(/legal hold/i);
  });

  it("stops anonymising old unsuccessful applicants while a hold covers them, then lets it run once released", async () => {
    const w = await world();
    await updateHrPolicy(w.hr, { candidateRetentionMonths: 24 });
    const req = await createRequisition(w.hr, { title: "Guard", categoryId: w.t.guardId, departmentId: w.t.deptId, headcount: 5, employmentType: "PERMANENT", justification: "Hold test" });
    await approveRequisition(w.boss, req.id);
    const c = await addCandidate(w.hr, { requisitionId: req.id, firstName: "Chinedu", lastName: "Applicant", phone: "08055550000", email: "chinedu@mail.test", notes: "Strong", resumeReference: "cv/c.pdf" });
    await db.candidate.update({ where: { id: c.id }, data: { stage: "REJECTED", stageChangedAt: addDays(todayUtc(), -900), rejectionReason: "Not a fit for the role" } });
    const h = await placeHold(w.hr, { scope: "CATEGORY", category: "UNSUCCESSFUL_APPLICANTS", reason: REASON, reviewOn: future() } as never);
    const held = await anonymizeStaleCandidates(w.t.org.id);
    expect(held).toMatchObject({ anonymized: 0 });
    expect(held.skipped).toMatch(/legal hold/i);
    expect((await db.candidate.findUniqueOrThrow({ where: { id: c.id } })).firstName).toBe("Chinedu");
    await releaseHold(w.boss, h.id, "The claim from an applicant was settled.");
    expect(await anonymizeStaleCandidates(w.t.org.id)).toMatchObject({ anonymized: 1 });
    expect((await db.candidate.findUniqueOrThrow({ where: { id: c.id } })).firstName).toBe("Anonymised");
  });

  it("stops purging old raw survey answers while a hold covers them, and a hold on a person does not", async () => {
    const w = await world();
    for (let i = 0; i < 6; i++) await w.make("Gbenga", `Svy${i}`);
    const s = await createSurvey(w.hr, { title: "Working here, November", intro: "A few questions", opensOn: today(), closesOn: future(14) } as never);
    await addQuestion(w.hr, s.id, { kind: "SCALE", text: "I feel safe at my site" });
    await openSurvey(w.hr, s.id);
    await closeSurvey(w.hr, s.id);
    await db.survey.update({ where: { id: s.id }, data: { closedAt: addDays(todayUtc(), -800) } });
    const ada = await w.make("Ada", "Okafor");
    await personHold(w, ada.id);
    const h = await placeHold(w.hr, { scope: "CATEGORY", category: "RAW_SURVEYS", reason: REASON, reviewOn: future() } as never);
    expect(await purgeExpired(w.hr)).toMatchObject({ surveys: 0, responses: 0, held: true });
    expect((await db.survey.findUniqueOrThrow({ where: { id: s.id } })).rawDeletedAt).toBeNull();
    await releaseHold(w.boss, h.id, "The survey is no longer part of the dispute.");
    expect(await purgeExpired(w.hr)).toMatchObject({ surveys: 1 });
  });

  it("is each company's own: a hold in one company never stops another company's deletions", async () => {
    const a = await world();
    const b = await world();
    await updateHrPolicy(b.hr, { employeeRetentionYears: 6 });
    await placeHold(a.boss, { scope: "COMPANY", reason: REASON, reviewOn: future() } as never);
    const ada = await b.make("Ada", "Okafor");
    await b.leave(ada.id, 9);
    await expect(requestErasure(b.hr, ada.id, "RETENTION", "The retention period is over and nothing is outstanding.")).resolves.toBeTruthy();
  });

  it("scrubs the words of a hold about a person when that person is later erased (the hold itself stays as a record that one existed)", async () => {
    const w = await world();
    const ada = await w.make("Ada", "Okafor");
    const h = await personHold(w, ada.id, { reason: SECRET });
    await releaseHold(w.boss, h.id, "SECRET-RELEASE-WORDS the claim was withdrawn in writing.");
    await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, ada.id, new Date()));
    const row = await db.retentionHold.findUniqueOrThrow({ where: { id: h.id } });
    expect(row.reason).toBe("[removed]");
    expect(row.releaseReason).toBeNull();
    expect(row).toMatchObject({ scope: "EMPLOYEE", employeeId: ada.id });
  });
});

describe("what is due", () => {
  it("counts the former employees past the period, the applicants and the surveys past theirs, names the categories not measured yet, and counts held items", async () => {
    const w = await world();
    await updateHrPolicy(w.hr, { employeeRetentionYears: 6, candidateRetentionMonths: 24 });
    const ada = await w.make("Ada", "Okafor");
    const bola = await w.make("Bola", "Adeyemi");
    await w.leave(ada.id, 9);
    await w.leave(bola.id, 8);
    await personHold(w, bola.id);
    const d = await dueView(w.hr);
    const by = Object.fromEntries(d.categories.map((c) => [c.category, c]));
    expect(by.EMPLOYEE_FILE).toMatchObject({ measured: true, due: 2, held: 1 });
    expect(by.UNSUCCESSFUL_APPLICANTS).toMatchObject({ measured: true, due: 0 });
    expect(by.RAW_SURVEYS).toMatchObject({ measured: true, due: 0 });
    // step 3b-1 measures the rest; only the two that cannot be worked out say "not measured"
    for (const c of ["APPRAISALS", "DISCIPLINARY", "WELFARE_CASES", "AUDIT_LOGS", "SUCCESSION"] as const) expect(by[c], c).toMatchObject({ measured: true });
    for (const c of ["ACCESS_LOGS", "SURVEY_REPORTS"] as const) expect(by[c], c).toMatchObject({ measured: false });
    expect(d.categories).toHaveLength(15);
    expect(JSON.stringify(d)).not.toContain("Okafor");
  });

  it("is for the people who see HR records only", async () => {
    const w = await world();
    await expect(dueView(w.t.ctx("EMPLOYEE"))).rejects.toThrow(/permission/i);
    await expect(dueView(w.t.ctx("AUDITOR"))).resolves.toBeTruthy();
  });
});
