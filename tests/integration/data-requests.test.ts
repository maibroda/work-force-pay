import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { ctxFor, isolatedOrg, uid } from "../helpers";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { addTraining } from "@/server/services/hr";
import { todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { launchCycle } from "@/server/services/appraisals";
import { requestChange } from "@/server/services/change-requests";
import { acknowledge, createPolicy } from "@/server/services/policies";
import { addContact, addGuarantor } from "@/server/services/personal-records";
import { raiseCase } from "@/server/services/relations";
import { addCandidate, approveRequisition, createRequisition, recordInterviewFeedback, scheduleInterview } from "@/server/services/recruitment";
import {
  compileEmployeeData,
  completeRequest,
  exportForRequest,
  exportMyData,
  listRequests,
  openRequest,
  packageExport,
  refuseRequest,
  requestsNeedingAttention,
  verifyIdentity,
} from "@/server/services/data-requests";
import { buildHrDigest } from "@/server/services/reminders";

const day = (n: number) => iso(addDays(todayUtc(), n));

/** An employee with something in nearly every table, plus a colleague whose data must never appear. */
async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const ada = await createEmployee(hr, { firstName: "Ada", lastName: "Okafor", gender: "FEMALE", dateOfBirth: "1990-05-05", phone: "08031112222", address: "12 Marina, Lagos", employmentDate: "2022-01-10", categoryId: t.guardId, bankName: "Access Bank", accountNumber: "0123456789", accountName: "ADA OKAFOR", taxId: "TIN-ADA-1", pensionPin: "PEN-ADA-1", pfa: "ARM" });
  const bola = await createEmployee(hr, { firstName: "Bola", lastName: "Adeyemi", employmentDate: "2022-02-01", categoryId: t.guardId, bankName: "GTBank", accountNumber: "9999999999", accountName: "BOLA ADEYEMI", phone: "08099990000" });

  await addTraining(hr, { employeeId: ada.id, courseName: "First Aid", issueDate: day(-200), expiryDate: day(300) });
  await addTraining(hr, { employeeId: bola.id, courseName: "BOLA-ONLY-COURSE", issueDate: day(-200) });
  const policy = await createPolicy(hr, { title: "Code of Conduct", body: "Be honest.", effectiveDate: day(-20) });
  await acknowledge(t.ctx("EMPLOYEE", ada.id), policy.id);

  // conduct: an approved and a pending disciplinary record; a confidential case and an ordinary one
  await db.disciplinaryRecord.create({ data: { organizationId: t.org.id, employeeId: ada.id, type: "VERBAL_WARNING", incidentDate: new Date(`${day(-50)}T00:00:00Z`), description: "APPROVED-WARNING-TEXT", issuedBy: "Boss", status: "APPROVED" } });
  await db.disciplinaryRecord.create({ data: { organizationId: t.org.id, employeeId: ada.id, type: "QUERY", incidentDate: new Date(`${day(-5)}T00:00:00Z`), description: "PENDING-QUERY-TEXT", issuedBy: "Boss", status: "PENDING" } });
  await raiseCase(hr, { employeeId: ada.id, type: "MISCONDUCT", summary: "ORDINARY-CASE-SUMMARY", description: "Late on three shifts." });
  await raiseCase(hr, { employeeId: ada.id, type: "WHISTLEBLOWING", summary: "SECRET-CASE-SUMMARY", description: "SECRET-CASE-DESCRIPTION about a colleague." });

  // people she told us about, and a guarantor whose details are not hers
  await addContact(hr, ada.id, { kind: "NEXT_OF_KIN", fullName: "Ngozi Okafor", relationship: "Spouse", phone: "08025550001", address: "14 Allen Avenue" });
  await addGuarantor(hr, ada.id, { fullName: "Chief Guarantor", relationship: "Friend", phone: "08037770099", address: "99 GUARANTOR-STREET", idType: "NIN", idNumber: "NIN-GUARANTOR-77", formReference: "GF-77" });

  // a bank change request: the new account number must not appear in the "requests" section
  await requestChange(hr, ada.id, "BANK", { bankName: "Zenith Bank", accountNumber: "5555555555", accountName: "ADA OKAFOR" }, "Moved banks");

  // appraisals: one signed off, one not
  const cycle = await launchCycle(hr, { name: `Review ${uid()}`, kind: "ANNUAL", periodStart: "2025-01-01", periodEnd: "2026-06-30", dueDate: day(30), employeeIds: [ada.id, bola.id] });
  const appraisals = await db.appraisal.findMany({ where: { cycleId: cycle.cycle.id } });
  await db.appraisal.update({ where: { id: appraisals.find((a) => a.employeeId === ada.id)!.id }, data: { status: "ACKNOWLEDGED", overallScore: 4.2, overallBand: "Exceeds expectations", strengths: "RELEASED-STRENGTHS", employeeAgreed: true, acknowledgedAt: new Date() } });
  await db.appraisal.update({ where: { id: appraisals.find((a) => a.employeeId === bola.id)!.id }, data: { status: "SUBMITTED", overallScore: 1.5, strengths: "BOLA-UNRELEASED" } });
  // a second, unreleased appraisal of Ada herself
  const cycle2 = await launchCycle(hr, { name: `Review B ${uid()}`, kind: "AD_HOC", periodStart: "2026-07-01", periodEnd: "2026-09-30", dueDate: day(30), employeeIds: [ada.id] });
  await db.appraisal.updateMany({ where: { cycleId: cycle2.cycle.id }, data: { status: "SUBMITTED", overallScore: 2.1, strengths: "UNRELEASED-STRENGTHS" } });

  // recruitment: her application, with an interviewer's private feedback
  const req = await createRequisition(hr, { title: "Guard", categoryId: t.guardId, departmentId: t.deptId, headcount: 2, employmentType: "PERMANENT", justification: "Cover" });
  await approveRequisition(t.ctx("COMPANY_ADMIN"), req.id);
  const cand = await addCandidate(hr, { requisitionId: req.id, firstName: "Ada", lastName: "Okafor", phone: "08031112222", source: "REFERRAL" });
  const iv = await scheduleInterview(hr, { candidateId: cand.id, scheduledAt: new Date().toISOString(), interviewer: "Ola", mode: "IN_PERSON" });
  await recordInterviewFeedback(hr, iv.id, { score: 4, recommendation: "HIRE", feedback: "SECRET-INTERVIEWER-FEEDBACK about her." });
  await db.candidate.update({ where: { id: cand.id }, data: { employeeId: ada.id } });

  await db.generatedLetter.create({ data: { organizationId: t.org.id, referenceNumber: `LET-${uid()}`, type: "EMPLOYMENT_CONFIRMATION", recipientName: "Ada Okafor", employeeId: ada.id, subject: "Confirmation of employment", body: "LETTER-BODY-TEXT", signatoryName: "HR", signatoryTitle: "Head of HR", generatedBy: "HR" } });
  return { t, hr, ada, bola };
}

const json = (x: unknown) => JSON.stringify(x);

describe("compiling a person's data", () => {
  it("covers everything held on them, in plain words, and states what it leaves out", async () => {
    const w = await world();
    const out = await compileEmployeeData(w.t.org.id, w.ada.id);
    expect(out.subject).toEqual({ employeeNumber: w.ada.employeeNumber, name: "Ada Okafor" });
    expect(out.withheld.length).toBeGreaterThanOrEqual(4);
    const s = out.sections;
    expect(s.profile.records[0]).toMatchObject({ firstName: "Ada", gender: "female", dateOfBirth: "1990-05-05", phone: "08031112222", bankName: "Access Bank", accountNumber: "0123456789", taxId: "TIN-ADA-1", pensionPin: "PEN-ADA-1", category: "Security Guard" });
    expect(s.training.records).toEqual([expect.objectContaining({ course: "First Aid" })]);
    expect(s.policies.records).toEqual([expect.objectContaining({ policy: "Code of Conduct", version: 1, how: "by you" })]);
    expect(s.letters.records[0]).toMatchObject({ subject: "Confirmation of employment", text: "LETTER-BODY-TEXT" });
    expect(s.contacts.records.map((r) => r.role).sort()).toEqual(["guarantor", "next of kin"]);
    expect(s.recruitment.records[0]).toMatchObject({ source: "referral" });
    expect(Object.keys(s)).toEqual(expect.arrayContaining(["profile", "contracts", "pay", "loans", "leave", "training", "documents", "conduct", "contacts", "appraisals", "policies", "letters", "changes", "recruitment", "uniformAndKit"]));
  });

  it("leaves out other people's details, interviewers' feedback, confidential cases, unsigned appraisals and pending records", async () => {
    const w = await world();
    const text = json(await compileEmployeeData(w.t.org.id, w.ada.id));
    // her own data is in
    for (const present of ["APPROVED-WARNING-TEXT", "ORDINARY-CASE-SUMMARY", "RELEASED-STRENGTHS", "Ngozi Okafor", "Chief Guarantor"]) expect(text, present).toContain(present);
    // what's held back
    for (const absent of [
      "SECRET-CASE-SUMMARY", "SECRET-CASE-DESCRIPTION", // a confidential case
      "SECRET-INTERVIEWER-FEEDBACK", // free-text feedback about her
      "UNRELEASED-STRENGTHS", // an appraisal not yet signed off
      "PENDING-QUERY-TEXT", // a disciplinary record not yet approved
      "08037770099", "99 GUARANTOR-STREET", "NIN-GUARANTOR-77", "GF-77", // the guarantor's own contact and ID details
      "5555555555", // the proposed new account number in her change request
      "BOLA-ONLY-COURSE", "9999999999", "BOLA-UNRELEASED", "Bola", // a colleague's data
    ])
      expect(text, absent).not.toContain(absent);
    // …but it says a confidential case exists
    expect(text).toMatch(/1 confidential case\(s\) are held and withheld/);
  });

  it("is limited to the one employee and the one organization", async () => {
    const w = await world();
    const other = await isolatedOrg();
    await expect(compileEmployeeData(other.org.id, w.ada.id)).rejects.toThrow(/not found/);
    await expect(compileEmployeeData(w.t.org.id, "ghost")).rejects.toThrow(/not found/);
    const bola = json(await compileEmployeeData(w.t.org.id, w.bola.id));
    expect(bola).toContain("BOLA-ONLY-COURSE");
    expect(bola).not.toContain("First Aid");
    expect(bola).not.toContain("TIN-ADA-1");
  });

  it("packs it into a file with a checksum and section counts", async () => {
    const w = await world();
    const pkg = packageExport(await compileEmployeeData(w.t.org.id, w.ada.id));
    expect(pkg.checksum).toBe(createHash("sha256").update(pkg.text).digest("hex"));
    expect(JSON.parse(pkg.text).sections.profile.records).toHaveLength(1);
    expect(pkg.sections).toMatchObject({ profile: 1, training: 1, policies: 1, letters: 1 });
  });
});

describe("the request register", () => {
  it("logs a request with a deadline from the policy, and refuses bad input and the wrong people", async () => {
    const w = await world();
    const r = await openRequest(w.hr, { employeeId: w.ada.id, requesterName: "Ada Okafor", channel: "Email", receivedOn: day(-3) });
    expect(r.requestNumber).toMatch(/^DSR-\d{5}$/);
    expect(iso(r.dueOn)).toBe(day(27)); // 30 days from 3 days ago
    expect(r).toMatchObject({ status: "OPEN", identityVerified: false, createdBy: w.hr.name });

    await updateHrPolicy(w.hr, { dsarResponseDays: 14 });
    expect(iso((await openRequest(w.hr, { employeeId: w.bola.id, requesterName: "Bola's lawyer", receivedOn: day(0) })).dueOn)).toBe(day(14));
    await expect(updateHrPolicy(w.hr, { dsarResponseDays: 0 })).rejects.toThrow();
    await expect(updateHrPolicy(w.hr, { dsarResponseDays: 91 })).rejects.toThrow();

    await expect(openRequest(w.hr, { employeeId: w.ada.id, requesterName: "Ada", receivedOn: day(2) })).rejects.toThrow(/future/);
    await expect(openRequest(w.hr, { employeeId: "ghost", requesterName: "Ada", receivedOn: day(0) })).rejects.toThrow(/not found/);
    await expect(openRequest(w.hr, { employeeId: w.ada.id, requesterName: "A", receivedOn: day(0) })).rejects.toThrow();
    await expect(openRequest(w.t.ctx("AUDITOR"), { employeeId: w.ada.id, requesterName: "Ada", receivedOn: day(0) })).rejects.toThrow();
    await expect(openRequest(w.t.ctx("OPERATIONS"), { employeeId: w.ada.id, requesterName: "Ada", receivedOn: day(0) })).rejects.toThrow();
    const other = await isolatedOrg();
    await expect(openRequest(other.ctx("HR_ADMIN"), { employeeId: w.ada.id, requesterName: "Ada", receivedOn: day(0) })).rejects.toThrow(/not found/);
  });

  it("works through identity check → export → completion, and records what was handed over", async () => {
    const w = await world();
    const r = await openRequest(w.hr, { employeeId: w.ada.id, requesterName: "Ada Okafor", receivedOn: day(-1) });
    await expect(exportForRequest(w.hr, r.id)).rejects.toThrow(/identity/);
    await expect(completeRequest(w.hr, r.id)).rejects.toThrow(/Generate the export first/);
    await expect(verifyIdentity(w.hr, r.id, "ok")).rejects.toThrow(/how you checked/);
    await expect(verifyIdentity(w.t.ctx("AUDITOR"), r.id, "Shown staff ID in person")).rejects.toThrow();
    const v = await verifyIdentity(w.hr, r.id, "Shown staff ID card in person");
    expect(v).toMatchObject({ identityVerified: true, verifiedBy: w.hr.name });

    await expect(exportForRequest(w.t.ctx("PAYROLL_ADMIN"), r.id)).rejects.toThrow(); // no hr.manage
    const out = await exportForRequest(w.hr, r.id);
    expect(out.requestNumber).toBe(r.requestNumber);
    expect(out.checksum).toBe(createHash("sha256").update(out.text).digest("hex"));
    const stored = await db.dataAccessRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(stored).toMatchObject({ exportChecksum: out.checksum, status: "OPEN" });
    expect(stored.exportedAt).not.toBeNull();
    expect((stored.exportSections as Record<string, number>).profile).toBe(1);
    // the register never keeps the data itself
    expect(JSON.stringify(stored)).not.toContain("TIN-ADA-1");

    const done = await completeRequest(w.hr, r.id, "Emailed securely");
    expect(done).toMatchObject({ status: "FULFILLED", handledBy: w.hr.name, completionNote: "Emailed securely" });
    await expect(completeRequest(w.hr, r.id)).rejects.toThrow(/already fulfilled/);
    await expect(exportForRequest(w.hr, r.id)).rejects.toThrow(/already fulfilled/);
    await expect(refuseRequest(w.hr, r.id, "Changed our mind about this")).rejects.toThrow(/already fulfilled/);

    const actions = (await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "DSAR_" } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["DSAR_OPEN", "DSAR_VERIFY", "DSAR_EXPORT", "DSAR_COMPLETE"]);
  });

  it("can be refused with a reason", async () => {
    const w = await world();
    const r = await openRequest(w.hr, { employeeId: w.bola.id, requesterName: "Someone else", receivedOn: day(0) });
    await expect(refuseRequest(w.hr, r.id, "no")).rejects.toThrow(/in a sentence/);
    await expect(refuseRequest(w.t.ctx("AUDITOR"), r.id, "Requester could not prove who they are")).rejects.toThrow();
    const u = await refuseRequest(w.hr, r.id, "Requester could not prove who they are");
    expect(u).toMatchObject({ status: "REFUSED", refusalReason: "Requester could not prove who they are", handledBy: w.hr.name });
    await expect(verifyIdentity(w.hr, r.id, "Shown ID in person now")).rejects.toThrow(/already refused/);
  });

  it("shows how each request stands against its deadline, and flags the late ones in the digest", async () => {
    const w = await world();
    await db.user.create({ data: { organizationId: w.t.org.id, email: `hr-${uid()}@dsr.test`.toLowerCase(), name: "HR", role: "HR_ADMIN", passwordHash: "x" } });
    const late = await openRequest(w.hr, { employeeId: w.ada.id, requesterName: "Ada", receivedOn: day(-40) });
    const soon = await openRequest(w.hr, { employeeId: w.bola.id, requesterName: "Bola", receivedOn: day(-26) });
    const fresh = await openRequest(w.hr, { employeeId: w.bola.id, requesterName: "Bola again", receivedOn: day(0) });
    const rows = await listRequests(w.hr);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(late.id)).toMatchObject({ state: "OVERDUE", daysLeft: -10 });
    expect(by(soon.id)).toMatchObject({ state: "DUE_SOON", daysLeft: 4 });
    expect(by(fresh.id)).toMatchObject({ state: "ON_TRACK", daysLeft: 30 });
    await expect(listRequests(w.t.ctx("OPERATIONS"))).rejects.toThrow();

    expect((await requestsNeedingAttention(w.t.org.id, todayUtc())).map((r) => r.id)).toEqual([late.id, soon.id]);
    const items = (await buildHrDigest(w.t.org.id)).sections.find((s) => s.key === "data-requests")!.items.map((i) => i.text);
    expect(items[0]).toMatch(/DSR-\d+ — EMP-\d+ Ada Okafor: overdue by 10 day\(s\)/);
    expect(items[1]).toMatch(/Bola Adeyemi: due in 4 day\(s\)/);
    await refuseRequest(w.hr, late.id, "Requester could not be identified at all");
    expect((await requestsNeedingAttention(w.t.org.id, todayUtc())).map((r) => r.id)).toEqual([soon.id]);
  });
});

describe("an employee's own copy", () => {
  it("is their own data only, needs a linked login, and is recorded", async () => {
    const w = await world();
    const me: Ctx = w.t.ctx("EMPLOYEE", w.ada.id);
    const out = await exportMyData(me);
    expect(out.data.subject.name).toBe("Ada Okafor");
    expect(out.text).toContain("TIN-ADA-1");
    expect(out.text).not.toContain("BOLA-ONLY-COURSE");
    expect(out.text).not.toContain("SECRET-INTERVIEWER-FEEDBACK");
    expect(out.checksum).toBe(createHash("sha256").update(out.text).digest("hex"));
    await expect(exportMyData(w.t.ctx("EMPLOYEE"))).rejects.toThrow(/isn't linked/);
    // a different employee gets their own, never Ada's
    const bola = await exportMyData(w.t.ctx("EMPLOYEE", w.bola.id));
    expect(bola.text).toContain("BOLA-ONLY-COURSE");
    expect(bola.text).not.toContain("TIN-ADA-1");
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "DATA_EXPORT_SELF" } })).toBe(2);
  });
});

describe("demo data", () => {
  it("seeds requests that are overdue, due soon and answered", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const rows = await listRequests(hr);
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(["OVERDUE", "DUE_SOON", "DONE"]));
    expect(rows.every((r) => /^DSR-\d{5}$/.test(r.requestNumber))).toBe(true);
    expect(rows.find((r) => r.status === "FULFILLED")!.exportChecksum).toHaveLength(64);
  });
});
