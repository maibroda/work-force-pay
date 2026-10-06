import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { ctxFor, isolatedOrg, uid } from "../helpers";
import { buildReport } from "@/server/report-registry";
import { toCsv } from "@/server/services/reports";
import { approveChange, requestChange } from "@/server/services/change-requests";
import { createContract } from "@/server/services/contracts";
import { createEmployee } from "@/server/services/employees";
import { addTraining } from "@/server/services/hr";
import { todayUtc } from "@/server/services/hr-policy";
import { launchCycle } from "@/server/services/appraisals";
import { acknowledge, createPolicy } from "@/server/services/policies";
import { addContact, addGuarantor, releaseGuarantor, verifyGuarantor } from "@/server/services/personal-records";
import { addRequirement } from "@/server/services/training";

const day = (n: number) => iso(addDays(todayUtc(), n));

/** One organization with something in every HR area. */
async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const fin = t.ctx("FINANCE");
  const ada = await createEmployee(hr, { firstName: "Ada", lastName: "Okafor", gender: "FEMALE", dateOfBirth: "1990-05-05", employmentDate: "2020-01-15", categoryId: t.guardId, departmentId: t.deptId, bankName: "Access Bank", accountNumber: "0123456789", accountName: "ADA OKAFOR" });
  const bola = await createEmployee(hr, { firstName: "Bola", lastName: "Adeyemi", employmentDate: "2024-03-01", categoryId: t.officeId });
  const gone = await createEmployee(hr, { firstName: "Gone", lastName: "Already", employmentDate: "2019-01-01", categoryId: t.guardId });
  await db.employee.update({ where: { id: gone.id }, data: { status: "RESIGNED" } });
  await createContract(hr, { employeeId: ada.id, type: "PERMANENT", jobTitle: "Guard", startDate: "2020-01-15" });

  // training: a requirement Ada holds an expired certificate for, and Bola has none
  await addRequirement(hr, { courseName: "First Aid" });
  await addTraining(hr, { employeeId: ada.id, courseName: "First Aid", issueDate: day(-800), expiryDate: day(-10) });

  // policy: Ada acknowledged, Bola didn't (overdue)
  const policy = await createPolicy(hr, { title: "Code of Conduct", body: "Be honest.", effectiveDate: day(-60), graceDays: 14 });
  await acknowledge(t.ctx("EMPLOYEE", ada.id), policy.id);

  // appraisals: one signed off, one still a draft
  const cycle = await launchCycle(hr, { name: `Review ${uid()}`, kind: "ANNUAL", periodStart: "2025-01-01", periodEnd: "2026-06-30", dueDate: day(30), employeeIds: [ada.id, bola.id] });
  const appraisals = await db.appraisal.findMany({ where: { cycleId: cycle.cycle.id }, include: { employee: true } });
  const adaAppraisal = appraisals.find((a) => a.employeeId === ada.id)!;
  await db.appraisal.update({ where: { id: adaAppraisal.id }, data: { status: "ACKNOWLEDGED", overallScore: 4.1, overallBand: "Exceeds expectations", recommendation: "INCREMENT", approvedBy: "HR Boss", employeeAgreed: true } });
  const bolaAppraisal = appraisals.find((a) => a.employeeId === bola.id)!;
  await db.appraisal.update({ where: { id: bolaAppraisal.id }, data: { status: "SUBMITTED", overallScore: 2.2, overallBand: "Needs improvement", recommendation: "PERFORMANCE_PLAN" } });

  // personal records: Ada has next of kin and a verified guarantor and a released one
  await addContact(hr, ada.id, { kind: "NEXT_OF_KIN", fullName: "Ngozi Okafor", relationship: "Spouse", phone: "08025550001" });
  const g = await addGuarantor(hr, ada.id, { fullName: '=HYPERLINK("http://evil.test","x")', relationship: "Friend", phone: "08037770001", address: "5 Unity Road, Lagos", idType: "NIN", idNumber: "NIN7770001", formReference: "GF-1", guaranteeAmount: 150000 });
  await verifyGuarantor(hr, g.id, "Visited the address");
  const g2 = await addGuarantor(hr, ada.id, { fullName: "Chief Released", relationship: "Relative", phone: "08037770002", address: "9 Unity Road, Lagos" });
  await releaseGuarantor(hr, g2.id, "Replaced by a closer relative");

  // a bank change: a different account name than the employee's
  const req = await requestChange(hr, ada.id, "BANK", { bankName: "Zenith Bank", accountNumber: "0987654321", accountName: "SOMEONE ELSE" }, "Moved banks");
  await approveChange(fin, req.id, "Confirmed");
  return { t, hr, fin, ada, bola, gone, cycle: cycle.cycle };
}

const names = (rows: Array<Record<string, unknown>>, key = "employeeName") => rows.map((r) => r[key]);

describe("HR reports", () => {
  it("lists current employees with the facts HR is asked for, leaving out leavers", async () => {
    const w = await world();
    const rep = (await buildReport(w.hr, "hr-headcount", {}))!;
    expect(rep.title).toBe("Employee register");
    expect(names(rep.rows)).toEqual(["Ada Okafor", "Bola Adeyemi"]);
    const ada = rep.rows[0];
    expect(ada).toMatchObject({ category: "Security Guard", department: "Operations", gender: "female", contractType: "permanent", contractEnds: "open-ended" });
    expect(Number(ada.age)).toBeGreaterThanOrEqual(36);
    expect(Number(ada.serviceYears)).toBeGreaterThan(6);
    expect(rep.rows[1].contractType).toBe("no contract on file");
  });

  it("puts expired and missing training first, with the status in words", async () => {
    const w = await world();
    const rep = (await buildReport(w.hr, "training-compliance", {}))!;
    expect(rep.rows.map((r) => [r.employeeName, r.status])).toEqual([
      ["Ada Okafor", "Expired"],
      ["Bola Adeyemi", "Missing"],
    ]);
    expect(rep.rows[0]).toMatchObject({ requirement: "First Aid", daysLeft: -10 });
  });

  it("lists policy acknowledgements, overdue first, and how each was given", async () => {
    const w = await world();
    const rep = (await buildReport(w.hr, "policy-acknowledgements", {}))!;
    expect(rep.rows.map((r) => [r.employeeName, r.status, r.how])).toEqual([
      ["Bola Adeyemi", "Overdue", ""],
      ["Ada Okafor", "Acknowledged", "By the employee"],
    ]);
    expect(rep.rows[0]).toMatchObject({ policy: "Code of Conduct", version: "v1" });
  });

  it("shows an appraisal's score only once it has been signed off, and can be limited to one cycle", async () => {
    const w = await world();
    const rep = (await buildReport(w.hr, "appraisal-results", {}))!;
    const ada = rep.rows.find((r) => r.employeeName === "Ada Okafor")!;
    const bola = rep.rows.find((r) => r.employeeName === "Bola Adeyemi")!;
    expect(ada).toMatchObject({ score: 4.1, band: "Exceeds expectations", recommendation: "Salary increment", employeeResponse: "Agreed", signedOffBy: "HR Boss" });
    expect(bola).toMatchObject({ status: "submitted", score: "", band: "", recommendation: "", employeeResponse: "" }); // 2.2 exists but isn't released
    expect((await buildReport(w.hr, "appraisal-results", { cycleId: w.cycle.id }))!.rows).toHaveLength(2);
    expect((await buildReport(w.hr, "appraisal-results", { cycleId: "nope" }))!.rows).toHaveLength(0);
  });

  it("lists every guarantor including released ones, and the CSV can't carry a formula", async () => {
    const w = await world();
    const rep = (await buildReport(w.hr, "guarantors", {}))!;
    expect(rep.rows.map((r) => r.status).sort()).toEqual(["released", "verified"]);
    const verified = rep.rows.find((r) => r.status === "verified")!;
    expect(verified).toMatchObject({ idType: "nin", idNumber: "NIN7770001", guaranteeAmount: 150000, verifiedBy: w.hr.name });
    const csv = toCsv(rep.rows, rep.columns);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""x"")"`); // quoted, with the leading apostrophe
    expect(csv.split("\n").some((line) => line.includes(",=HYPERLINK"))).toBe(false);
    expect(csv).toContain("150000");
  });

  it("lists incomplete personal records first, saying what is missing", async () => {
    const w = await world();
    const rep = (await buildReport(w.hr, "records-completeness", {}))!;
    expect(names(rep.rows)).toEqual(["Ada Okafor", "Bola Adeyemi"]); // both incomplete, so by employee number
    const ada = rep.rows.find((r) => r.employeeName === "Ada Okafor")!;
    const bola = rep.rows.find((r) => r.employeeName === "Bola Adeyemi")!;
    expect(ada).toMatchObject({ nextOfKin: 1, emergencyContacts: 0, guarantorsVerified: 1, guarantorsNeeded: 2, complete: "No" });
    expect(String(ada.missing)).toMatch(/emergency contact/);
    expect(String(ada.missing)).toMatch(/1 verified guarantor/);
    expect(String(bola.missing)).toMatch(/next of kin/);
  });

  it("logs bank, tax and pension changes by field — never by value", async () => {
    const w = await world();
    const rep = (await buildReport(w.hr, "detail-changes", {}))!;
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0]).toMatchObject({ employeeName: "Ada Okafor", kind: "Bank details", fieldsChanged: "Bank, Account number, Account name", status: "approved", requestedBy: w.hr.name, decidedBy: w.fin.name, accountNameMatched: "No" });
    const everything = JSON.stringify(rep) + toCsv(rep.rows, rep.columns);
    for (const secret of ["0123456789", "0987654321", "Zenith", "SOMEONE ELSE", "Access Bank"]) expect(everything).not.toContain(secret);
  });

  it("is limited by the permission that guards each kind of record, and to the organization", async () => {
    const w = await world();
    // PAYROLL_ADMIN sees sensitive details but not HR data or appraisals; OPERATIONS sees none of it
    await expect(buildReport(w.t.ctx("OPERATIONS"), "hr-headcount", {})).rejects.toThrow();
    await expect(buildReport(w.t.ctx("PAYROLL_ADMIN"), "hr-headcount", {})).rejects.toThrow();
    await expect(buildReport(w.t.ctx("PAYROLL_ADMIN"), "appraisal-results", {})).rejects.toThrow();
    await expect(buildReport(w.t.ctx("OPERATIONS"), "guarantors", {})).rejects.toThrow();
    await expect(buildReport(w.t.ctx("SUPERVISOR"), "detail-changes", {})).rejects.toThrow();
    expect((await buildReport(w.t.ctx("PAYROLL_ADMIN"), "guarantors", {}))!.rows).toHaveLength(2);
    expect((await buildReport(w.t.ctx("AUDITOR"), "appraisal-results", {}))!.rows).toHaveLength(2);
    // another organization sees nothing of this one's
    const other = await isolatedOrg();
    for (const slug of ["hr-headcount", "training-compliance", "policy-acknowledgements", "appraisal-results", "guarantors", "records-completeness", "detail-changes"] as const)
      expect((await buildReport(other.ctx("HR_ADMIN"), slug, {}))!.rows).toEqual([]);
  });
});

describe("demo data", () => {
  it("every HR report has rows in the demo organization", async () => {
    const hr = await ctxFor("HR_ADMIN");
    for (const slug of ["hr-headcount", "training-compliance", "policy-acknowledgements", "appraisal-results", "guarantors", "records-completeness"] as const) {
      const rep = (await buildReport(hr, slug, {}))!;
      expect(rep.rows.length, slug).toBeGreaterThan(0);
      expect(toCsv(rep.rows, rep.columns).split("\n")[0]).toBe(rep.columns.map((c) => c.label).join(","));
    }
  });
});
