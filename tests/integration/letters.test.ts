import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DEFAULT_TEMPLATES, LETTER_TYPES } from "@/lib/letters";
import { createContract, decideProbation } from "@/server/services/contracts";
import { createEmployee } from "@/server/services/employees";
import { approveDisciplinary, approveExit, completeExitTask, initiateExit, raiseDisciplinary } from "@/server/services/hr";
import {
  addCandidate,
  approveOffer,
  approveRequisition,
  createOffer,
  createRequisition,
  moveCandidate,
  recordInterviewFeedback,
  scheduleInterview,
} from "@/server/services/recruitment";
import { generateLetter, getLetter, listLetters, listTemplates, resetTemplate, saveTemplate } from "@/server/services/letters";
import { addDays, iso } from "@/lib/dates";
import { todayUtc } from "@/server/services/hr-policy";
import { isolatedOrg } from "../helpers";

async function setup() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const emp = await createEmployee(hr, { firstName: "Ada", lastName: "Lovelace", employmentDate: "2022-03-01", categoryId: t.officeId, departmentId: t.deptId });
  await createContract(hr, { employeeId: emp.id, type: "PERMANENT", jobTitle: "Operations Analyst", startDate: "2022-03-01" });
  return { t, hr, emp };
}

describe("letter templates", () => {
  it("starts with a default for every kind of letter, and refuses fields a letter doesn't offer", async () => {
    const { t, hr } = await setup();
    const all = await listTemplates(hr);
    expect(all.map((x) => x.type)).toEqual([...LETTER_TYPES]);
    expect(all[0].body).toBe(DEFAULT_TEMPLATES.OFFER.body);

    await expect(
      saveTemplate(hr, { type: "EMPLOYMENT_CONFIRMATION", subject: "Confirmation", body: "This confirms {{recipient}} earns {{monthlyGross}} a month, in full.", signatoryTitle: "HR" }),
    ).rejects.toThrow(/can't use \{\{monthlyGross\}\}/);
    const saved = await saveTemplate(hr, {
      type: "EMPLOYMENT_CONFIRMATION",
      subject: "Employment verification — {{recipient}}",
      body: "To whom it may concern: {{recipient}} works at {{organization}} as {{jobTitle}} since {{startDate}}.",
      signatoryName: "Grace Hopper",
      signatoryTitle: "Head of People",
    });
    expect(saved.signatoryName).toBe("Grace Hopper");
    await expect(saveTemplate(t.ctx("AUDITOR"), { type: "OFFER", subject: "x1x", body: "y".repeat(30), signatoryTitle: "HR" })).rejects.toThrow();
    await expect(saveTemplate(hr, { type: "OFFER", subject: "Offer", body: "too short", signatoryTitle: "HR" })).rejects.toThrow();

    const back = await resetTemplate(hr, "EMPLOYMENT_CONFIRMATION");
    expect(back.body).toBe(DEFAULT_TEMPLATES.EMPLOYMENT_CONFIRMATION.body);
    expect(back.signatoryName).toBe("");
  });

  it("never rewrites a letter already issued when the wording changes", async () => {
    const { hr, emp } = await setup();
    await saveTemplate(hr, { type: "EMPLOYMENT_CONFIRMATION", subject: "Version one for {{recipient}}", body: "First wording for {{recipient}}, {{jobTitle}}.", signatoryTitle: "HR" });
    const first = await generateLetter(hr, { type: "EMPLOYMENT_CONFIRMATION", employeeId: emp.id });
    await saveTemplate(hr, { type: "EMPLOYMENT_CONFIRMATION", subject: "Version two", body: "Second wording entirely, for {{recipient}} and nobody else.", signatoryTitle: "HR" });
    const second = await generateLetter(hr, { type: "EMPLOYMENT_CONFIRMATION", employeeId: emp.id });
    const reread = await getLetter(hr, first.id);
    expect(reread!.body).toBe("First wording for Ada Lovelace, Operations Analyst.");
    expect(second.body).toContain("Second wording");
    expect(first.referenceNumber).not.toBe(second.referenceNumber);
  });
});

describe("generating letters", () => {
  it("makes an employment confirmation from the contract, for current staff only, and only for HR managers", async () => {
    const { t, hr, emp } = await setup();
    const l = await generateLetter(hr, { type: "EMPLOYMENT_CONFIRMATION", employeeId: emp.id });
    expect(l.referenceNumber).toMatch(/^LET-/);
    expect(l.recipientName).toBe("Ada Lovelace");
    expect(l.body).toContain("Operations Analyst");
    expect(l.body).toContain("Operations"); // department
    expect(l.body).toContain("01 Mar 2022");
    expect(l.body).toContain("permanent");
    expect(l.body).toContain(`employee number ${emp.employeeNumber}`);
    expect(l.body).not.toMatch(/\{\{|—/);
    expect(l.subject).toContain("Ada Lovelace");

    await expect(generateLetter(t.ctx("AUDITOR"), { type: "EMPLOYMENT_CONFIRMATION", employeeId: emp.id })).rejects.toThrow();
    await expect(generateLetter(hr, { type: "EMPLOYMENT_CONFIRMATION" })).rejects.toThrow(/Choose the employee/);
    const gone = await createEmployee(hr, { firstName: "Gone", lastName: "Away", employmentDate: "2022-01-01", categoryId: t.officeId });
    await db.employee.update({ where: { id: gone.id }, data: { status: "RESIGNED", exitDate: new Date("2026-06-30T00:00:00Z") } });
    await expect(generateLetter(hr, { type: "EMPLOYMENT_CONFIRMATION", employeeId: gone.id })).rejects.toThrow(/experience letter instead/);
  });

  it("needs a confirmed probation for a confirmation letter", async () => {
    const { t, hr } = await setup();
    const e = await createEmployee(hr, { firstName: "New", lastName: "Joiner", employmentDate: "2026-01-01", categoryId: t.officeId });
    const c = await createContract(hr, { employeeId: e.id, type: "PROBATION", jobTitle: "Clerk", startDate: "2026-01-01", probationMonths: 3 });
    await expect(generateLetter(hr, { type: "PROBATION_CONFIRMATION", employeeId: e.id })).rejects.toThrow(/no confirmed probation/);
    await decideProbation(hr, c.id, { decision: "CONFIRMED", note: "Good" });
    const l = await generateLetter(hr, { type: "PROBATION_CONFIRMATION", employeeId: e.id });
    expect(l.body).toContain("31 Mar 2026"); // probation ended
    expect(l.body).toContain("Clerk");
  });

  it("makes a warning letter only from a signed-off warning, with the facts but never re-expanding text from the record", async () => {
    const { hr, emp } = await setup();
    const praise = await raiseDisciplinary(hr, { employeeId: emp.id, type: "COMMENDATION", incidentDate: "2026-02-01", description: "Excellent work on the audit" });
    await approveDisciplinary(hr, praise.id);
    await expect(generateLetter(hr, { type: "WARNING", disciplinaryId: praise.id })).rejects.toThrow(/isn't a warning/);

    const w = await raiseDisciplinary(hr, { employeeId: emp.id, type: "WRITTEN_WARNING", incidentDate: "2026-03-05", description: "Left the post early. {{today}} <b>twice</b>", actionTaken: "Written warning issued" });
    await expect(generateLetter(hr, { type: "WARNING", disciplinaryId: w.id })).rejects.toThrow(/signed-off/);
    await approveDisciplinary(hr, w.id);
    const l = await generateLetter(hr, { type: "WARNING", disciplinaryId: w.id });
    expect(l.body).toContain("05 Mar 2026");
    expect(l.body).toContain("written warning");
    expect(l.body).toContain("Left the post early. {{today}} <b>twice</b>"); // stored as plain text, not expanded
    expect(l.body).toContain("Written warning issued");
    expect(l.sourceId).toBe(w.id);
  });

  it("makes exit letters, and a clearance certificate only once every required step is done", async () => {
    const { t, hr, emp } = await setup();
    const x = await initiateExit(hr, { employeeId: emp.id, exitType: "RESIGNATION", noticeDate: "2026-08-01", lastWorkingDate: "2026-08-31", reason: "Relocating abroad" });
    await expect(generateLetter(hr, { type: "EXIT_LETTER", exitRecordId: x.id })).rejects.toThrow(/pending/);
    await approveExit(hr, x.id);
    const exit = await generateLetter(hr, { type: "EXIT_LETTER", exitRecordId: x.id });
    expect(exit.body).toContain("resignation");
    expect(exit.body).toContain("31 Aug 2026");

    await expect(generateLetter(hr, { type: "CLEARANCE_CERTIFICATE", exitRecordId: x.id })).rejects.toThrow(/Clearance isn't finished/);
    for (const task of await db.exitTask.findMany({ where: { exitRecordId: x.id, status: "PENDING", mandatory: true } })) await completeExitTask(hr, task.id);
    const cert = await generateLetter(hr, { type: "CLEARANCE_CERTIFICATE", exitRecordId: x.id });
    expect(cert.body).toContain("31 Aug 2026");
    expect(cert.body).toMatch(/completed the company's exit clearance on \d{2} \w{3} \d{4}/);

    // …and now that they've left, an experience letter with their length of service
    const xp = await generateLetter(hr, { type: "EXPERIENCE", employeeId: emp.id });
    expect(xp.body).toContain("01 Mar 2022");
    expect(xp.body).toContain("31 Aug 2026");
    expect(xp.body).toContain("4 years, 6 months");
    expect(t.org.id).toBeTruthy();
  });

  it("refuses an experience letter for someone still employed", async () => {
    const { hr, emp } = await setup();
    await expect(generateLetter(hr, { type: "EXPERIENCE", employeeId: emp.id })).rejects.toThrow(/hasn't left/);
  });

  it("makes an offer letter only once the offer is approved, with the pay and probation wording", async () => {
    const { t, hr } = await setup();
    const boss = t.ctx("COMPANY_ADMIN");
    const req = await createRequisition(hr, { title: "Site Supervisor", categoryId: t.guardId, justification: "New client site", headcount: 1, employmentType: "PERMANENT" });
    await approveRequisition(boss, req.id);
    const cand = await addCandidate(hr, { requisitionId: req.id, firstName: "Chidi", lastName: "Okafor", source: "REFERRAL" });
    const iv = await scheduleInterview(hr, { candidateId: cand.id, scheduledAt: iso(addDays(todayUtc(), 1)), interviewer: "Ada" });
    await recordInterviewFeedback(hr, iv.id, { score: 5, recommendation: "HIRE", feedback: "Strong candidate overall" });
    await moveCandidate(hr, cand.id, "OFFER");
    const offer = await createOffer(hr, { candidateId: cand.id, jobTitle: "Site Supervisor", monthlyGross: 250000, employmentType: "PERMANENT", probationMonths: 3, noticePeriodDays: 30, startDate: iso(addDays(todayUtc(), 30)), setPayRate: true });

    await expect(generateLetter(hr, { type: "OFFER", offerId: offer.id })).rejects.toThrow(/pending approval/);
    await approveOffer(boss, offer.id);
    const l = await generateLetter(hr, { type: "OFFER", offerId: offer.id });
    expect(l.recipientName).toBe("Chidi Okafor");
    expect(l.candidateId).toBe(cand.id);
    expect(l.employeeId).toBeNull();
    expect(l.body).toContain("₦250,000.00");
    expect(l.body).toContain("probation period of 3 month(s)");
    expect(l.body).toContain("30 days' written notice");
    expect(l.body).toContain("Site Supervisor");
  });
});

describe("listing letters", () => {
  it("filters by employee and type, and only shows the organization's own", async () => {
    const { t, hr, emp } = await setup();
    await generateLetter(hr, { type: "EMPLOYMENT_CONFIRMATION", employeeId: emp.id });
    const other = await setup();
    await generateLetter(other.hr, { type: "EMPLOYMENT_CONFIRMATION", employeeId: other.emp.id });
    const mine = await listLetters(hr, { employeeId: emp.id });
    expect(mine).toHaveLength(1);
    expect((await listLetters(hr)).every((l) => l.organizationId === t.org.id)).toBe(true);
    expect(await listLetters(hr, { type: "EXPERIENCE" })).toHaveLength(0);
    expect((await getLetter(hr, mine[0].id))!.organization.name).toContain("Test org");
    expect(await getLetter(other.hr, mine[0].id)).toBeNull(); // another organization can't open it
    await expect(listLetters(t.ctx("EMPLOYEE"))).rejects.toThrow();
  });
});
