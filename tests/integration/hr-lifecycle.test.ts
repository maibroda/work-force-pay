import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { createEmployee } from "@/server/services/employees";
import {
  addTemplateItem,
  getHrPolicy,
  listChecklistTemplates,
  todayUtc,
  updateHrPolicy,
  updateTemplateItem,
} from "@/server/services/hr-policy";
import {
  contractAlerts,
  createContract,
  decideProbation,
  listContracts,
  processExpiredContracts,
  renewContract,
} from "@/server/services/contracts";
import {
  addCandidate,
  addCheck,
  addStandardChecks,
  approveOffer,
  approveRequisition,
  createOffer,
  createRequisition,
  hireCandidate,
  markOfferSent,
  moveCandidate,
  recordInterviewFeedback,
  recordOfferResponse,
  rejectRequisition,
  scheduleInterview,
  updateCheck,
  withdrawOffer,
} from "@/server/services/recruitment";
import {
  addCaseNote,
  closeCase,
  getCase,
  issueSanctionFromCase,
  listCases,
  myCases,
  raiseCase,
  reopenCase,
  resolveCase,
  setCaseStatus,
} from "@/server/services/relations";
import {
  approveExit,
  completeExitTask,
  initiateExit,
  markTaskNotApplicable,
  recordExitInterview,
} from "@/server/services/hr";
import {
  addManualLine,
  approveSettlement,
  cancelSettlement,
  getSettlement,
  prepareSettlement,
  releaseSettlement,
  removeManualLine,
  returnSettlement,
  submitSettlement,
} from "@/server/services/settlements";
import { employeeTimeline, getExitDetail, hrOverview } from "@/server/services/hr-overview";
import { createFixedAsset } from "@/server/services/fixed-assets";
import { isolatedOrg } from "../helpers";

const today = () => todayUtc();
const inDays = (n: number) => iso(addDays(today(), n));

async function hire(t: Awaited<ReturnType<typeof isolatedOrg>>, name: string, employmentDate = "2024-01-01", categoryId = t.guardId) {
  return createEmployee(t.ctx("HR_ADMIN"), { firstName: name, lastName: "Lifecycle", employmentDate, categoryId });
}

describe("HR policy & checklist templates", () => {
  it("seeds the default checklists, and an edit changes what the next hire gets", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const first = await hire(t, "First");
    const defaults = await db.onboardingTask.count({ where: { employeeId: first.id } });
    expect(defaults).toBeGreaterThanOrEqual(9);

    const extra = await addTemplateItem(hr, {
      kind: "ONBOARDING",
      taskName: "Sign data-protection notice",
      dueOffsetDays: 5,
      responsibleRole: "HR",
      mandatory: true,
      blocksSettlement: true,
    });
    const items = await listChecklistTemplates(hr, "ONBOARDING");
    const medical = items.find((i) => i.taskName === "Medical examination")!;
    await updateTemplateItem(hr, medical.id, { active: false });

    const second = await hire(t, "Second", "2027-02-01");
    const tasks = await db.onboardingTask.findMany({ where: { employeeId: second.id }, orderBy: { sortOrder: "asc" } });
    expect(tasks).toHaveLength(defaults); // +1 added, −1 switched off
    expect(tasks.some((x) => x.taskName === "Medical examination")).toBe(false);
    const added = tasks.find((x) => x.taskName === extra.taskName)!;
    expect(iso(added.dueDate!)).toBe("2027-02-06"); // start date + 5 days
    expect(added.responsibleRole).toBe("HR");
  });

  it("limits a step to one employee category, and rejects duplicate step names", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    await addTemplateItem(hr, { kind: "ONBOARDING", taskName: "Firearm proficiency test", categoryId: t.guardId, mandatory: true, blocksSettlement: false });
    await expect(addTemplateItem(hr, { kind: "ONBOARDING", taskName: "Firearm proficiency test", mandatory: true, blocksSettlement: false })).rejects.toThrow(/already a step/);
    const guard = await hire(t, "Guard");
    const clerk = await hire(t, "Clerk", "2024-01-01", t.officeId);
    const has = async (id: string) => (await db.onboardingTask.count({ where: { employeeId: id, taskName: "Firearm proficiency test" } })) === 1;
    expect(await has(guard.id)).toBe(true);
    expect(await has(clerk.id)).toBe(false);
  });

  it("requires hr.configure and validates the policy", async () => {
    const t = await isolatedOrg();
    await expect(updateHrPolicy(t.ctx("AUDITOR"), { defaultNoticeDays: 10 })).rejects.toThrow();
    await expect(updateHrPolicy(t.ctx("EMPLOYEE"), { defaultNoticeDays: 10 })).rejects.toThrow();
    const hr = t.ctx("HR_ADMIN");
    await expect(updateHrPolicy(hr, { defaultProbationMonths: 9, maxProbationMonths: 6 })).rejects.toThrow(/can't be longer/);
    const p = await updateHrPolicy(hr, { defaultNoticeDays: 60, gratuityEnabled: true });
    expect(p.defaultNoticeDays).toBe(60);
    expect((await getHrPolicy(t.org.id)).gratuityEnabled).toBe(true);
    const audit = await db.auditLog.findFirst({ where: { organizationId: t.org.id, action: "HR_POLICY_UPDATE" } });
    expect(audit).toBeTruthy();
  });
});

describe("employment contracts", () => {
  it("applies the type rules and allows only one active contract", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await hire(t, "Terms");
    const base = { employeeId: e.id, jobTitle: "Guard", startDate: "2026-01-01" };
    await expect(createContract(hr, { ...base, type: "PERMANENT", endDate: "2027-01-01" })).rejects.toThrow(/no end date/);
    await expect(createContract(hr, { ...base, type: "FIXED_TERM" })).rejects.toThrow(/needs an end date/);
    await expect(createContract(hr, { ...base, type: "FIXED_TERM", endDate: "2025-12-01" })).rejects.toThrow(/after the start/);
    await expect(createContract(hr, { ...base, type: "PERMANENT", probationMonths: 12 })).rejects.toThrow(/Probation can't be longer/);
    await expect(createContract(t.ctx("AUDITOR"), { ...base, type: "PERMANENT" })).rejects.toThrow();

    const c = await createContract(hr, { ...base, type: "PERMANENT", probationMonths: 3 });
    expect(c.contractNumber).toMatch(/^EC-/);
    expect(iso(c.probationEndDate!)).toBe("2026-03-31");
    expect(c.probationOutcome).toBe("PENDING");
    expect(c.noticePeriodDays).toBe(30); // policy default
    await expect(createContract(hr, { ...base, type: "PERMANENT" })).rejects.toThrow(/already has an active contract/);
  });

  it("renews into a chain, closing the old contract the day before", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await hire(t, "Renew");
    const first = await createContract(hr, { employeeId: e.id, type: "FIXED_TERM", jobTitle: "Guard", startDate: "2026-01-01", endDate: "2026-12-31" });
    const next = await renewContract(hr, first.id, { endDate: "2027-12-31", noticePeriodDays: 14 });
    expect(iso(next.startDate)).toBe("2027-01-01"); // day after the old end
    expect(next.previousContractId).toBe(first.id);
    expect(next.noticePeriodDays).toBe(14);
    const old = await db.employmentContract.findUniqueOrThrow({ where: { id: first.id } });
    expect(old.status).toBe("SUPERSEDED");
    await expect(renewContract(hr, first.id, { endDate: "2028-12-31" })).rejects.toThrow(/Only the active contract/);
    const active = (await listContracts(hr, { status: "ACTIVE" })).filter((c) => c.employeeId === e.id);
    expect(active).toHaveLength(1);
  });

  it("confirming a probationary contract converts it to permanent; failing and extending are recorded", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const a = await hire(t, "Confirm");
    const c = await createContract(hr, { employeeId: a.id, type: "PROBATION", jobTitle: "Guard", startDate: "2026-04-01" });
    expect(c.probationMonths).toBe(3);
    expect(c.endDate).toBeNull();
    await expect(decideProbation(t.ctx("OPERATIONS"), c.id, { decision: "CONFIRMED" })).rejects.toThrow();
    const res = await decideProbation(hr, c.id, { decision: "CONFIRMED", note: "Strong" });
    expect(res.next?.type).toBe("PERMANENT");
    expect(iso(res.next!.startDate)).toBe("2026-07-01"); // day after probation ended
    expect(res.next!.previousContractId).toBe(c.id);
    expect((await db.employmentContract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("SUPERSEDED");
    await expect(decideProbation(hr, c.id, { decision: "CONFIRMED" })).rejects.toThrow(/Only an active contract/);

    const b = await hire(t, "Extend");
    const pc = await createContract(hr, { employeeId: b.id, type: "PROBATION", jobTitle: "Guard", startDate: "2026-04-01" });
    await expect(decideProbation(hr, pc.id, { decision: "EXTENDED", extensionMonths: 2 })).rejects.toThrow(/reason/);
    await expect(decideProbation(hr, pc.id, { decision: "EXTENDED", extensionMonths: 4, note: "Needs more time" })).rejects.toThrow(/at most 6/);
    const ext = await decideProbation(hr, pc.id, { decision: "EXTENDED", extensionMonths: 3, note: "Needs more time" });
    expect(ext.contract.probationMonths).toBe(6);
    expect(iso(ext.contract.probationEndDate!)).toBe("2026-09-30");
    expect(ext.contract.probationOutcome).toBe("EXTENDED");
    const failed = await decideProbation(hr, pc.id, { decision: "FAILED", note: "Did not meet standard" });
    expect(failed.contract.probationOutcome).toBe("FAILED");
    await expect(decideProbation(hr, pc.id, { decision: "CONFIRMED" })).rejects.toThrow(/already failed/);
  });

  it("raises alerts for expiring contracts, due probations and staff with no contract", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const soon = await hire(t, "Soon");
    const past = await hire(t, "Past");
    const probation = await hire(t, "Probation");
    const nobody = await hire(t, "Nobody");
    await createContract(hr, { employeeId: soon.id, type: "FIXED_TERM", jobTitle: "Guard", startDate: inDays(-300), endDate: inDays(20) });
    await createContract(hr, { employeeId: past.id, type: "FIXED_TERM", jobTitle: "Guard", startDate: inDays(-300), endDate: inDays(-5) });
    await createContract(hr, { employeeId: probation.id, type: "PROBATION", jobTitle: "Guard", startDate: inDays(-80), probationMonths: 3 });

    const a = await contractAlerts(hr);
    expect(a.ending.find((c) => c.employeeId === soon.id)?.overdue).toBe(false);
    expect(a.ending.find((c) => c.employeeId === past.id)?.overdue).toBe(true);
    expect(a.probation.find((c) => c.employeeId === probation.id)).toBeTruthy();
    expect(a.noContract.map((e) => e.id)).toContain(nobody.id);
    expect(a.noContract.map((e) => e.id)).not.toContain(soon.id);

    expect(await processExpiredContracts(hr)).toBe(1);
    expect((await db.employmentContract.findFirstOrThrow({ where: { employeeId: past.id } })).status).toBe("EXPIRED");
  });
});

describe("recruitment", () => {
  async function openRequisition(t: Awaited<ReturnType<typeof isolatedOrg>>, headcount = 1) {
    const hr = t.ctx("HR_ADMIN");
    const req = await createRequisition(hr, {
      title: "Site Supervisor",
      categoryId: t.guardId,
      departmentId: t.deptId,
      headcount,
      employmentType: "PERMANENT",
      justification: "New client site going live",
    });
    await approveRequisition(t.ctx("COMPANY_ADMIN"), req.id);
    return req;
  }
  async function candidateAtOffer(t: Awaited<ReturnType<typeof isolatedOrg>>, reqId: string, first: string, phone?: string) {
    const hr = t.ctx("HR_ADMIN");
    const c = await addCandidate(hr, { requisitionId: reqId, firstName: first, lastName: "Applicant", phone, source: "REFERRAL" });
    const iv = await scheduleInterview(hr, { candidateId: c.id, scheduledAt: inDays(1), interviewer: "Ada", mode: "IN_PERSON" });
    await recordInterviewFeedback(hr, iv.id, { score: 4, recommendation: "HIRE", feedback: "Solid interview" });
    await moveCandidate(hr, c.id, "OFFER");
    return c;
  }

  it("enforces maker/checker on requisitions and gates candidates on approval", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const req = await createRequisition(hr, { title: "Driver", categoryId: t.guardId, justification: "Replace a leaver", headcount: 1, employmentType: "PERMANENT" });
    expect(req.requisitionNumber).toMatch(/^REQ-/);
    expect(req.status).toBe("PENDING_APPROVAL");
    await expect(addCandidate(hr, { requisitionId: req.id, firstName: "Too", lastName: "Early", source: "OTHER" })).rejects.toThrow(/hasn't been approved/);
    await expect(approveRequisition(hr, req.id)).rejects.toThrow(/you raised/);
    await expect(approveRequisition(t.ctx("OPERATIONS"), req.id)).rejects.toThrow();
    await expect(rejectRequisition(t.ctx("COMPANY_ADMIN"), req.id, "")).rejects.toThrow(/reason/);
    const ok = await approveRequisition(t.ctx("COMPANY_ADMIN"), req.id, "Budgeted");
    expect(ok.status).toBe("APPROVED");
    await expect(approveRequisition(t.ctx("COMPANY_ADMIN"), req.id)).rejects.toThrow(/already approved/);
  });

  it("blocks duplicates, requires an interview before an offer, and enforces offer maker/checker", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const req = await openRequisition(t);
    const c = await addCandidate(hr, { requisitionId: req.id, firstName: "Dup", lastName: "Applicant", phone: "08030001111", source: "WALK_IN" });
    await expect(addCandidate(hr, { requisitionId: req.id, firstName: "Dup", lastName: "Again", phone: "08030001111", source: "WALK_IN" })).rejects.toThrow(/already in this requisition/);
    await expect(moveCandidate(hr, c.id, "OFFER")).rejects.toThrow(/completed interview/);
    const iv = await scheduleInterview(hr, { candidateId: c.id, scheduledAt: inDays(2), interviewer: "Ada" });
    expect((await db.candidate.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("INTERVIEW");
    await expect(recordInterviewFeedback(hr, iv.id, { score: 9, recommendation: "HIRE", feedback: "x".repeat(10) })).rejects.toThrow();
    await recordInterviewFeedback(hr, iv.id, { score: 5, recommendation: "STRONG_HIRE", feedback: "Excellent communicator" });
    await expect(recordInterviewFeedback(hr, iv.id, { score: 5, recommendation: "HIRE", feedback: "Again twice" })).rejects.toThrow(/already been recorded/);
    await moveCandidate(hr, c.id, "OFFER");

    const offer = await createOffer(hr, { candidateId: c.id, jobTitle: "Site Supervisor", monthlyGross: 250000, employmentType: "PERMANENT", startDate: inDays(30), setPayRate: true });
    expect(offer.offerNumber).toMatch(/^OFR-/);
    await expect(createOffer(hr, { candidateId: c.id, jobTitle: "x1", monthlyGross: 1, employmentType: "PERMANENT", startDate: inDays(30), setPayRate: true })).rejects.toThrow(/already an open offer/);
    await expect(approveOffer(hr, offer.id)).rejects.toThrow(/you raised/);
    await expect(markOfferSent(hr, offer.id)).rejects.toThrow(/approved offer/);
    await approveOffer(t.ctx("COMPANY_ADMIN"), offer.id);
    await expect(recordOfferResponse(hr, offer.id, "ACCEPTED")).rejects.toThrow(/Send the offer/);
    await markOfferSent(hr, offer.id);
    await expect(moveCandidate(hr, c.id, "REJECTED", "Changed our minds")).rejects.toThrow(/open offer/);
    await withdrawOffer(hr, offer.id, "Budget frozen");
    await moveCandidate(hr, c.id, "REJECTED", "Budget frozen");
    expect((await db.candidate.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("REJECTED");
  });

  it("hires an accepted candidate into an employee, contract, pay rate and onboarding checklist — atomically", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const req = await openRequisition(t, 1);
    const c = await candidateAtOffer(t, req.id, "Hired", "08030002222");
    const offer = await createOffer(hr, { candidateId: c.id, jobTitle: "Site Supervisor", monthlyGross: 250000, employmentType: "PERMANENT", probationMonths: 3, noticePeriodDays: 45, startDate: inDays(14), setPayRate: true });
    await approveOffer(t.ctx("COMPANY_ADMIN"), offer.id);
    await markOfferSent(hr, offer.id);

    await expect(hireCandidate(hr, { offerId: offer.id })).rejects.toThrow(/accepted the offer/);
    await recordOfferResponse(hr, offer.id, "ACCEPTED");

    // vetting gates the hire
    await addStandardChecks(hr, c.id);
    await expect(hireCandidate(hr, { offerId: offer.id })).rejects.toThrow(/Vetting isn't complete/);
    const checks = await db.candidateCheck.findMany({ where: { candidateId: c.id } });
    expect(checks).toHaveLength(4);
    await expect(updateCheck(hr, checks[0].id, "FAILED")).rejects.toThrow(/what the check found/);
    for (const k of checks) await updateCheck(hr, k.id, "CLEARED", "Verified");
    await expect(addCheck(hr, { candidateId: c.id, checkType: "REFERENCE" })).rejects.toThrow(/already on this candidate/);

    const { employee, contract } = await hireCandidate(hr, { offerId: offer.id });
    expect(employee.categoryId).toBe(t.guardId);
    expect(employee.departmentId).toBe(t.deptId);
    expect(employee.phone).toBe("08030002222");
    expect(iso(employee.employmentDate)).toBe(inDays(14));
    expect(contract.type).toBe("PERMANENT");
    expect(contract.noticePeriodDays).toBe(45);
    expect(contract.probationMonths).toBe(3);
    const rate = await db.employeePayRate.findFirstOrThrow({ where: { employeeId: employee.id } });
    expect(Number(rate.monthlyGross)).toBe(250000);
    expect(await db.onboardingTask.count({ where: { employeeId: employee.id } })).toBeGreaterThanOrEqual(9);
    expect((await db.candidate.findUniqueOrThrow({ where: { id: c.id } })).stage).toBe("HIRED");
    expect((await db.jobRequisition.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("FILLED");
    await expect(hireCandidate(hr, { offerId: offer.id })).rejects.toThrow(/already been hired/);

    const tl = await employeeTimeline(hr, employee.id);
    expect(tl.some((e) => e.kind === "Joined" && /recruitment/.test(e.detail ?? ""))).toBe(true);
  });

  it("won't over-fill a requisition, hire someone already on staff, or rehire a flagged leaver", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const fin = t.ctx("COMPANY_ADMIN");
    const req = await openRequisition(t, 1);

    // already on staff with the same phone
    const staff = await createEmployee(hr, { firstName: "On", lastName: "Staff", employmentDate: "2024-01-01", categoryId: t.guardId, phone: "08031112222" });
    const dupe = await candidateAtOffer(t, req.id, "Dupe", "08031112222");
    const o1 = await createOffer(hr, { candidateId: dupe.id, jobTitle: "Guard", monthlyGross: 100000, employmentType: "PERMANENT", startDate: inDays(7), setPayRate: false });
    await approveOffer(fin, o1.id);
    await markOfferSent(hr, o1.id);
    await recordOfferResponse(hr, o1.id, "ACCEPTED");
    await expect(hireCandidate(hr, { offerId: o1.id })).rejects.toThrow(new RegExp(staff.employeeNumber));

    // …and once that person leaves flagged "not eligible for rehire", the hire is still barred
    const exit = await initiateExit(hr, { employeeId: staff.id, exitType: "TERMINATION", noticeDate: "2026-01-01", lastWorkingDate: "2026-01-31", reason: "Gross misconduct", summaryDismissal: true });
    await approveExit(hr, exit.id);
    await recordExitInterview(hr, { exitRecordId: exit.id, interviewDate: "2026-01-30", notes: "Declined to comment", eligibleForRehire: false });
    await expect(hireCandidate(hr, { offerId: o1.id })).rejects.toThrow(/NOT eligible for rehire/);
  });
});

describe("employee relations", () => {
  it("lets an employee raise their own confidential concern but not misconduct about anyone", async () => {
    const t = await isolatedOrg();
    const emp = await hire(t, "Speaker");
    const self = t.ctx("EMPLOYEE", emp.id);
    await expect(raiseCase(self, { type: "MISCONDUCT", summary: "Colleague was late", description: "Repeatedly late on shift" })).rejects.toThrow(/grievance, a harassment/);
    const c = await raiseCase(self, { type: "HARASSMENT", severity: "HIGH", summary: "Inappropriate comments", description: "A supervisor made repeated comments." });
    expect(c.employeeId).toBe(emp.id);
    expect(c.selfRaised).toBe(true);
    expect(c.confidential).toBe(true); // harassment is always confidential
    expect(c.caseNumber).toMatch(/^ER-/);
    expect(c.dueDate).toBeTruthy();

    const mine = await myCases(self);
    expect(mine).toHaveLength(1);
    expect(mine[0]).not.toHaveProperty("description"); // status only
    await expect(raiseCase(t.ctx("EMPLOYEE", null, 2), { type: "GRIEVANCE", summary: "No linked account", description: "Trying with no employee id" })).rejects.toThrow(/isn't linked/);
  });

  it("hides confidential content from read-only HR viewers but not from HR managers", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const emp = await hire(t, "Subject");
    const c = await raiseCase(hr, { employeeId: emp.id, type: "WHISTLEBLOWING", summary: "Possible fraud in stores", description: "Stock is being diverted from the stores." });
    await addCaseNote(hr, c.id, { kind: "EVIDENCE", note: "Stock sheets attached to the file" });

    const asAuditor = await getCase(t.ctx("AUDITOR"), c.id);
    expect(asAuditor.redacted).toBe(true);
    expect(asAuditor.summary).toBe("Confidential case");
    expect(asAuditor.notes).toHaveLength(0);
    const listed = (await listCases(t.ctx("AUDITOR"))).find((x) => x.id === c.id)!;
    expect(listed.summary).toBe("Confidential case");

    const asHr = await getCase(hr, c.id);
    expect(asHr.redacted).toBe(false);
    expect(asHr.notes).toHaveLength(1);
    await expect(getCase(t.ctx("EMPLOYEE"), c.id)).rejects.toThrow();
  });

  it("runs a misconduct case from investigation to a linked sanction, and re-opens on appeal", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const boss = t.ctx("COMPANY_ADMIN");
    const emp = await hire(t, "Accused");
    const c = await raiseCase(hr, { employeeId: emp.id, type: "MISCONDUCT", severity: "MEDIUM", summary: "Slept on duty", description: "Found asleep at the gate at 2am." });

    await expect(setCaseStatus(hr, c.id, "HEARING")).rejects.toThrow(/can't move/);
    await setCaseStatus(hr, c.id, "INVESTIGATING");
    await setCaseStatus(hr, c.id, "HEARING");
    await expect(issueSanctionFromCase(hr, c.id, { type: "WRITTEN_WARNING", actionTaken: "Written warning" })).rejects.toThrow(/substantiated/);
    await expect(closeCase(boss, c.id)).rejects.toThrow(/Resolve the case/);
    await resolveCase(hr, c.id, { outcome: "SUBSTANTIATED", resolution: "CCTV and witness confirm the allegation." });
    await expect(addCaseNote(hr, c.id, { kind: "NOTE", note: "Late note" })).resolves.toBeTruthy(); // still RESOLVED → allowed

    const sanction = await issueSanctionFromCase(hr, c.id, { type: "WRITTEN_WARNING", actionTaken: "Written warning issued" });
    expect(sanction.status).toBe("PENDING"); // maker/checker still applies
    expect(sanction.caseId).toBe(c.id);

    await expect(closeCase(t.ctx("OPERATIONS"), c.id)).rejects.toThrow();
    await closeCase(boss, c.id);
    await expect(addCaseNote(hr, c.id, { kind: "NOTE", note: "After close" })).rejects.toThrow(/closed/);
    const re = await reopenCase(boss, c.id, "Employee lodged an appeal with new evidence");
    expect(re.status).toBe("INVESTIGATING");
    expect(re.outcome).toBeNull();
    const file = await getCase(hr, c.id);
    expect(file.notes.some((n) => n.kind === "APPEAL")).toBe(true);
    expect(file.notes.length).toBeGreaterThanOrEqual(5); // append-only: nothing was lost
  });

  it("won't sanction an employee over their own grievance", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const emp = await hire(t, "Complainant");
    const c = await raiseCase(t.ctx("EMPLOYEE", emp.id), { type: "GRIEVANCE", summary: "Unpaid overtime", description: "Three weeks of overtime were never paid." });
    await resolveCase(hr, c.id, { outcome: "SUBSTANTIATED", resolution: "Overtime was missed and will be paid." });
    await expect(issueSanctionFromCase(hr, c.id, { type: "QUERY", actionTaken: "Query" })).rejects.toThrow(/own complaint/);
  });
});

describe("exit interview & clearance", () => {
  it("records the exit interview, ticks the clearance step, and lets a step be waived with a reason", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await hire(t, "Leaver");
    await createContract(hr, { employeeId: e.id, type: "PERMANENT", jobTitle: "Guard", startDate: "2024-01-01", noticePeriodDays: 14 });
    await createFixedAsset(t.ctx("PAYROLL_ADMIN"), {
      name: "Patrol radio",
      category: "RADIO_COMMS",
      assignedToEmployeeId: e.id,
      acquisitionDate: "2025-01-01",
      cost: 90000,
      usefulLifeMonths: 36,
      salvageValue: 0,
    });
    const exit = await initiateExit(hr, { employeeId: e.id, exitType: "RESIGNATION", noticeDate: "2027-01-01", lastWorkingDate: "2027-01-31", reason: "Relocating abroad", reasonCategory: "RELOCATION" });
    expect(exit.noticePeriodDays).toBe(14); // frozen from the contract
    const detail = await getExitDetail(hr, exit.id);
    expect(detail!.employee.assignedFixedAssets.map((a) => a.name)).toEqual(["Patrol radio"]); // clearance sees what's still held
    await approveExit(hr, exit.id);
    expect((await db.employmentContract.findFirstOrThrow({ where: { employeeId: e.id } })).status).toBe("TERMINATED");

    const tasks = await db.exitTask.findMany({ where: { exitRecordId: exit.id }, orderBy: { sortOrder: "asc" } });
    expect(tasks.find((x) => x.systemKey === "FINAL_SETTLEMENT")?.blocksSettlement).toBe(false);
    expect(iso(tasks.find((x) => x.taskName === "Handover of duties")!.dueDate!)).toBe("2027-01-28"); // LWD − 3 days

    await recordExitInterview(hr, { exitRecordId: exit.id, interviewDate: "2027-01-29", notes: "Leaving for family reasons", eligibleForRehire: true });
    const interview = tasks.find((x) => /exit interview/i.test(x.taskName))!;
    expect((await db.exitTask.findUniqueOrThrow({ where: { id: interview.id } })).status).toBe("DONE");
    const firearm = tasks.find((x) => x.taskName === "Return of uniform & kit")!;
    await expect(markTaskNotApplicable(hr, "exit", firearm.id, "")).rejects.toThrow(/reason/);
    const waived = await markTaskNotApplicable(hr, "exit", firearm.id, "Never issued a uniform");
    expect(waived.status).toBe("NOT_APPLICABLE");
    await expect(markTaskNotApplicable(hr, "exit", firearm.id, "Again")).rejects.toThrow(/pending/);
  });
});

describe("end-of-service settlement", () => {
  // Resigned 31 Mar 2027 after 6y 9m, having given 10 of the 30 days' notice required.
  async function resignedEmployee() {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const emp = await createEmployee(hr, { firstName: "Settle", lastName: "Me", employmentDate: "2020-07-01", categoryId: t.officeId });
    await db.employeePayRate.create({
      data: { organizationId: t.org.id, employeeId: emp.id, monthlyGross: 300000, reason: "Test", approvedBy: "Test", effectiveFrom: d("2026-01-01") },
    });
    await updateHrPolicy(hr, { gratuityEnabled: true, gratuityMinYears: 5, gratuityDaysPerYear: 15, gratuityBasis: "GROSS" });
    const exit = await initiateExit(hr, { employeeId: emp.id, exitType: "RESIGNATION", noticeDate: "2027-03-21", lastWorkingDate: "2027-03-31", reason: "Better offer elsewhere", reasonCategory: "BETTER_PAY" });
    await approveExit(hr, exit.id);
    const period = await db.payrollPeriod.create({
      data: { organizationId: t.org.id, name: "March 2027", year: 2027, month: 3, startDate: d("2027-03-01"), endDate: d("2027-03-31") },
    });
    return { t, hr, emp, exit, period, prep: t.ctx("PAYROLL_ADMIN"), fin: t.ctx("FINANCE") };
  }
  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const clearEverything = async (hr: Awaited<ReturnType<typeof resignedEmployee>>["hr"], exitId: string) => {
    for (const task of await db.exitTask.findMany({ where: { exitRecordId: exitId, status: "PENDING", blocksSettlement: true } }))
      await completeExitTask(hr, task.id);
  };

  it("computes leave, gratuity and notice recovery from the policy, and totals them with manual lines", async () => {
    const { prep, exit, emp } = await resignedEmployee();
    const s = await prepareSettlement(prep, exit.id);
    expect(s.settlementNumber).toMatch(/^EOS-/);
    expect(s.status).toBe("DRAFT");
    expect(Number(s.monthlyGross)).toBe(300000);
    expect(s.payBasisSource).toMatch(/pay rate/i);
    expect(s.noticeRequiredDays).toBe(30);
    expect(s.noticeServedDays).toBe(10);
    expect(s.noticeShortfallDays).toBe(20);
    expect(Number(s.leavePayableDays)).toBe(17.51);

    const lines = await db.exitSettlementLine.findMany({ where: { settlementId: s.id }, orderBy: { sortOrder: "asc" } });
    const by = (code: string) => lines.find((l) => l.code === code)!;
    expect(Number(by("LEAVE_ENCASHMENT").amount)).toBe(175100); // 17.51 d × 300,000 ÷ 30
    expect(Number(by("GRATUITY").amount)).toBe(900000); // 6 completed years × 15 d × 10,000
    expect(by("NOTICE_RECOVERY").kind).toBe("DEDUCTION");
    expect(Number(by("NOTICE_RECOVERY").amount)).toBe(200000); // 20 d × 10,000
    expect(Number(s.netSettlement)).toBe(875100);

    const withLoan = await addManualLine(prep, s.id, { kind: "DEDUCTION", code: "LOAN", description: "Outstanding staff loan balance", amount: 50000, taxable: false });
    expect(withLoan.manual).toBe(true);
    await expect(addManualLine(prep, s.id, { kind: "DEDUCTION", code: "BONUS", description: "Not a recovery type", amount: 1, taxable: false })).rejects.toThrow(/must be one of/);
    const after = await db.exitSettlement.findUniqueOrThrow({ where: { id: s.id } });
    expect(Number(after.netSettlement)).toBe(825100);

    // recompute keeps the manual line and rebuilds the policy lines
    const again = await prepareSettlement(prep, exit.id);
    expect(again.id).toBe(s.id);
    expect(Number(again.netSettlement)).toBe(825100);
    const rebuilt = await db.exitSettlementLine.findMany({ where: { settlementId: s.id } });
    expect(rebuilt.filter((l) => !l.manual)).toHaveLength(3); // rebuilt, not duplicated
    await expect(removeManualLine(prep, rebuilt.find((l) => l.code === "GRATUITY")!.id)).rejects.toThrow(/Policy-calculated/);
    await removeManualLine(prep, withLoan.id);
    expect(Number((await db.exitSettlement.findUniqueOrThrow({ where: { id: s.id } })).netSettlement)).toBe(875100);
    expect(emp.id).toBe(again.employeeId);
  });

  it("respects permissions and an unapproved exit", async () => {
    const { t, hr, exit, emp } = await resignedEmployee();
    await expect(prepareSettlement(t.ctx("AUDITOR"), exit.id)).rejects.toThrow();
    await expect(prepareSettlement(t.ctx("FINANCE"), exit.id)).rejects.toThrow(); // finance approves, doesn't prepare
    const pending = await initiateExit(hr, { employeeId: (await createEmployee(hr, { firstName: "P", lastName: "Ending", employmentDate: "2024-01-01", categoryId: t.officeId })).id, exitType: "RESIGNATION", noticeDate: "2027-01-01", lastWorkingDate: "2027-01-31", reason: "Not yet approved" });
    await expect(prepareSettlement(t.ctx("PAYROLL_ADMIN"), pending.id)).rejects.toThrow(/Approve the exit/);
    expect(emp.id).toBeTruthy();
  });

  it("needs a different approver, finished clearance, and then releases approved inputs into the right period", async () => {
    const { t, hr, exit, emp, period, prep, fin } = await resignedEmployee();
    const s = await prepareSettlement(prep, exit.id);
    await addManualLine(prep, s.id, { kind: "DEDUCTION", code: "LOAN", description: "Outstanding staff loan balance", amount: 50000, taxable: false });
    await addManualLine(prep, s.id, { kind: "EARNING", code: "EX_GRATIA", description: "Long-service goodwill", amount: 20000, taxable: false });
    await expect(approveSettlement(fin, s.id)).rejects.toThrow(/awaiting approval/);
    await submitSettlement(prep, s.id);
    await expect(prepareSettlement(prep, exit.id)).rejects.toThrow(/can't be recomputed/);
    await expect(addManualLine(prep, s.id, { kind: "EARNING", description: "Too late to add", amount: 5, taxable: true })).rejects.toThrow(/draft/);

    // preparer can't approve their own work (a PAYROLL_ADMIN lacks the permission; use a second HR/finance identity)
    await expect(approveSettlement(prep, s.id)).rejects.toThrow();
    const sameUserFinance = { ...fin, userId: prep.userId };
    await expect(approveSettlement(sameUserFinance, s.id)).rejects.toThrow(/someone else/);
    await expect(approveSettlement(fin, s.id)).rejects.toThrow(/Clearance isn't finished/);

    await clearEverything(hr, exit.id);
    await approveSettlement(fin, s.id);
    const done = await db.exitTask.findFirstOrThrow({ where: { exitRecordId: exit.id, systemKey: "FINAL_SETTLEMENT" } });
    expect(done.status).toBe("DONE"); // system ticks "Final settlement computed"

    const other = await db.payrollPeriod.create({
      data: { organizationId: t.org.id, name: "April 2027", year: 2027, month: 4, startDate: d("2027-04-01"), endDate: d("2027-04-30") },
    });
    await expect(releaseSettlement(fin, s.id, other.id)).rejects.toThrow(/last working day/);
    await expect(releaseSettlement(prep, s.id, period.id)).rejects.toThrow(); // payroll admin can't release

    const r = await releaseSettlement(fin, s.id, period.id);
    expect(r.route).toBe("regular");
    expect(r.settlement.status).toBe("RELEASED");
    await expect(releaseSettlement(fin, s.id, period.id)).rejects.toThrow(/approved settlement/);
    await expect(cancelSettlement(fin, s.id, "Changed my mind")).rejects.toThrow(/already been released/);

    const earnings = await db.otherEarning.findMany({ where: { employeeId: emp.id }, orderBy: { amount: "asc" } });
    expect(earnings.map((e) => Number(e.amount))).toEqual([20000, 175100, 900000]);
    expect(earnings.every((e) => e.status === "APPROVED" && e.periodId === period.id)).toBe(true);
    expect(earnings.find((e) => Number(e.amount) === 20000)!.taxable).toBe(false);
    expect(earnings.find((e) => Number(e.amount) === 175100)!.name).toMatch(/^End of service — Unused annual leave/);
    const deductions = await db.deduction.findMany({ where: { employeeId: emp.id }, orderBy: { amount: "asc" } });
    expect(deductions.map((x) => [x.deductionType, Number(x.amount)])).toEqual([["LOAN", 50000], ["RECOVERY", 200000]]);
    expect(deductions.every((x) => x.status === "APPROVED" && x.authorityReference === s.settlementNumber)).toBe(true);

    const detail = await getSettlement(fin, s.id);
    expect(detail!.paidThroughPayroll).toBe(false); // not until the period is locked
    expect(detail!.lines.every((l) => l.otherEarningId || l.deductionId)).toBe(true);
    const tl = await employeeTimeline(hr, emp.id);
    expect(tl.some((e) => e.kind === "Settlement")).toBe(true);
  });

  it("can be sent back, edited and cancelled before release; a locked period routes to a supplementary run", async () => {
    const { t, hr, exit, emp, period, prep, fin } = await resignedEmployee();
    const s = await prepareSettlement(prep, exit.id);
    await submitSettlement(prep, s.id);
    await expect(returnSettlement(fin, s.id, "")).rejects.toThrow(/what needs to change/);
    await returnSettlement(fin, s.id, "Add the loan balance");
    await addManualLine(prep, s.id, { kind: "DEDUCTION", code: "LOAN", description: "Outstanding staff loan balance", amount: 10000, taxable: false });
    await submitSettlement(prep, s.id);
    await clearEverything(hr, exit.id);
    await approveSettlement(fin, s.id);

    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "APPROVED" } });
    await expect(releaseSettlement(fin, s.id, period.id)).rejects.toThrow(/not yet locked/);
    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
    const r = await releaseSettlement(fin, s.id, period.id);
    expect(r.route).toBe("supplementary");

    const second = await resignedEmployee();
    const s2 = await prepareSettlement(second.prep, second.exit.id);
    await cancelSettlement(second.prep, s2.id, "Raised against the wrong employee");
    expect((await db.exitSettlement.findUniqueOrThrow({ where: { id: s2.id } })).status).toBe("CANCELLED");
    const revived = await prepareSettlement(second.prep, second.exit.id); // a cancelled settlement can be re-opened
    expect(revived.status).toBe("DRAFT");
    expect(revived.id).toBe(s2.id);
    expect(t.org.id).not.toBe(second.t.org.id);
    expect(emp.id).toBeTruthy();
  });

  it("reflects the policy: a summary dismissal forfeits gratuity, and switching it off removes the line", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const emp = await createEmployee(hr, { firstName: "Dismissed", lastName: "Guard", employmentDate: "2018-01-01", categoryId: t.guardId });
    await db.employeePayRate.create({ data: { organizationId: t.org.id, employeeId: emp.id, monthlyGross: 120000, reason: "Test", approvedBy: "Test", effectiveFrom: new Date("2018-01-01T00:00:00Z") } });
    await updateHrPolicy(hr, { gratuityEnabled: true, gratuityExitTypes: ["RESIGNATION", "TERMINATION"] });
    const exit = await initiateExit(hr, { employeeId: emp.id, exitType: "TERMINATION", noticeDate: "2027-05-01", lastWorkingDate: "2027-05-01", reason: "Gross misconduct — theft", reasonCategory: "MISCONDUCT", summaryDismissal: true });
    await approveExit(hr, exit.id);
    const s = await prepareSettlement(t.ctx("PAYROLL_ADMIN"), exit.id);
    const lines = await db.exitSettlementLine.findMany({ where: { settlementId: s.id } });
    expect(lines.some((l) => l.code === "GRATUITY")).toBe(false);
    expect(lines.some((l) => l.code === "NOTICE_PAY")).toBe(false);
    expect(lines.some((l) => l.code === "LEAVE_ENCASHMENT")).toBe(true); // accrued leave is still owed
    const trace = s.calcTrace as { notes: string[] };
    expect(trace.notes.join(" ")).toMatch(/Summary dismissal/);
  });
});

describe("HR overview", () => {
  it("summarizes every lifecycle module for the organization", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN");
    const e = await hire(t, "Counted");
    await createContract(hr, { employeeId: e.id, type: "FIXED_TERM", jobTitle: "Guard", startDate: inDays(-100), endDate: inDays(10) });
    await raiseCase(hr, { employeeId: e.id, type: "COUNSELLING", summary: "Attendance chat", description: "Discussed repeated lateness." });
    await createRequisition(hr, { title: "Cleaner", categoryId: t.officeId, justification: "Cover for leave", headcount: 1, employmentType: "PERMANENT" });

    const o = await hrOverview(hr);
    expect(o.contracts.endingSoon).toBe(1);
    expect(o.relations.open).toBe(1);
    expect(o.recruitment.requisitionsPending).toBe(1);
    expect(o.onboarding.employeesIncomplete).toBe(1);
    await expect(hrOverview(t.ctx("EMPLOYEE"))).rejects.toThrow();
  });
});
