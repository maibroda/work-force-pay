import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { addDays, iso } from "@/lib/dates";
import { isolatedOrg, uid } from "../helpers";
import { createEmployee } from "@/server/services/employees";
import { addDocument } from "@/server/services/hr";
import { todayUtc, updateHrPolicy } from "@/server/services/hr-policy";
import { addContact, addGuarantor } from "@/server/services/personal-records";
import { raiseCase } from "@/server/services/relations";
import { addCandidate, approveRequisition, createRequisition } from "@/server/services/recruitment";
import { requestChange } from "@/server/services/change-requests";
import { openRequest, refuseRequest } from "@/server/services/data-requests";
import { decideErasure, requestErasure, retentionAttention, retentionOverview } from "@/server/services/employee-retention";
import { buildHrDigest } from "@/server/services/reminders";

const yearsAgo = (n: number) => iso(addDays(todayUtc(), -Math.round(n * 365.25)));

async function world(years = 6) {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const boss = t.ctx("COMPANY_ADMIN", null, 2); // a different person, with approval rights
  if (years) await updateHrPolicy(hr, { employeeRetentionYears: years });
  const make = async (first: string, last: string, extra: Record<string, unknown> = {}) =>
    createEmployee(hr, { firstName: first, lastName: last, gender: "FEMALE", dateOfBirth: "1990-05-05", phone: "08031112222", address: "12 Marina, Lagos", employmentDate: "2015-01-10", categoryId: t.guardId, bankName: "Access Bank", accountNumber: "0123456789", accountName: `${first} ${last}`.toUpperCase(), taxId: `TIN-${first}`, pensionPin: `PEN-${first}`, pfa: "ARM", ...extra } as never);
  /** Marks someone as having left that long ago. */
  const leave = (id: string, yrs: number) => db.employee.update({ where: { id }, data: { status: "RESIGNED", exitDate: new Date(`${yearsAgo(yrs)}T00:00:00Z`) } });
  return { t, hr, boss, make, leave };
}

describe("getting started", () => {
  it("does nothing until a retention period is set", async () => {
    const { hr, make, leave } = await world(0);
    const ada = await make("Ada", "Okafor");
    await leave(ada.id, 20);
    await expect(requestErasure(hr, ada.id, "REQUEST", "She asked by email on 3 October; ID checked in person.")).rejects.toThrow(/Set how long records are kept/);
    expect((await retentionOverview(hr)).due).toEqual([]);
  });

  it("refuses until the period has passed, naming the date, and never for someone still employed", async () => {
    const { hr, make, leave } = await world(6);
    const recent = await make("Bola", "Adeyemi");
    await leave(recent.id, 2);
    await expect(requestErasure(hr, recent.id, "REQUEST", "He asked by email on 3 October; ID checked in person.")).rejects.toThrow(/must be kept until \d{4}-\d{2}-\d{2}/);
    const current = await make("Chidi", "Eze");
    await expect(requestErasure(hr, current.id, "REQUEST", "He asked by email on 3 October; ID checked in person.")).rejects.toThrow(/haven't left/);
  });

  it("needs a real reason and the right permission", async () => {
    const { t, hr, make, leave } = await world();
    const ada = await make("Ada", "Okafor");
    await leave(ada.id, 8);
    await expect(requestErasure(hr, ada.id, "RETENTION", "ok")).rejects.toThrow(/Say why/);
    await expect(requestErasure(t.ctx("AUDITOR"), ada.id, "RETENTION", "Retention period is over and nothing is outstanding.")).rejects.toThrow(/permission/i);
  });
});

describe("what stands in the way", () => {
  it("an open case or an open data request blocks it until they are closed", async () => {
    const { t, hr, make, leave } = await world();
    const ada = await make("Ada", "Okafor");
    await raiseCase(hr, { employeeId: ada.id, type: "GRIEVANCE" as never, summary: "Pay query from 2018", description: "She queried her overtime pay." });
    await openRequest(hr, { employeeId: ada.id, requesterName: "Ada Okafor", receivedOn: iso(todayUtc()) });
    await leave(ada.id, 8);
    await expect(requestErasure(hr, ada.id, "RETENTION", "Retention period is over and nothing is outstanding.")).rejects.toThrow(/case is still open.*data access request/s);

    const c = await db.relationsCase.findFirstOrThrow({ where: { organizationId: t.org.id, employeeId: ada.id } });
    await db.relationsCase.update({ where: { id: c.id }, data: { status: "CLOSED" } });
    const r = await db.dataAccessRequest.findFirstOrThrow({ where: { organizationId: t.org.id, employeeId: ada.id } });
    await refuseRequest(hr, r.id, "The request was withdrawn by the employee in writing.");
    await expect(requestErasure(hr, ada.id, "RETENTION", "Retention period is over and nothing is outstanding.")).resolves.toMatchObject({ status: "PENDING" });
  });

  it("only one request can wait at a time", async () => {
    const { hr, make, leave } = await world();
    const ada = await make("Ada", "Okafor");
    await leave(ada.id, 8);
    await requestErasure(hr, ada.id, "RETENTION", "Retention period is over and nothing is outstanding.");
    await expect(requestErasure(hr, ada.id, "REQUEST", "She also asked in writing, ID checked in person.")).rejects.toThrow(/already waiting/);
  });
});

describe("a second person decides", () => {
  it("the person who asked can't approve their own request, and an outsider can't see it", async () => {
    const { hr, boss, make, leave } = await world();
    const ada = await make("Ada", "Okafor");
    await leave(ada.id, 8);
    const r = await requestErasure(hr, ada.id, "RETENTION", "Retention period is over and nothing is outstanding.");
    await expect(decideErasure(hr, r.id, true)).rejects.toThrow(/someone else has to approve/);
    const other = await isolatedOrg();
    await expect(decideErasure(other.ctx("COMPANY_ADMIN"), r.id, true)).rejects.toThrow(/not found/i);
    expect((await db.employee.findUniqueOrThrow({ where: { id: ada.id } })).firstName).toBe("Ada"); // untouched
    expect(boss.userId).not.toBe(hr.userId);
  });

  it("turning it down needs a reason, ends the request, and removes nothing", async () => {
    const { hr, boss, make, leave } = await world();
    const ada = await make("Ada", "Okafor");
    await leave(ada.id, 8);
    const r = await requestErasure(hr, ada.id, "RETENTION", "Retention period is over and nothing is outstanding.");
    await expect(decideErasure(boss, r.id, false)).rejects.toThrow(/why it is being turned down/);
    await decideErasure(boss, r.id, false, "Legal asked us to hold this one for a pending claim.");
    expect((await db.employeeErasure.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("REJECTED");
    expect((await db.employee.findUniqueOrThrow({ where: { id: ada.id } })).lastName).toBe("Okafor");
    await expect(decideErasure(boss, r.id, true)).rejects.toThrow(/already rejected/);
    // a turned-down request doesn't block a new one
    await expect(requestErasure(hr, ada.id, "RETENTION", "Legal confirmed the claim is over; hold lifted.")).resolves.toBeTruthy();
  });

  it("is checked again at approval: something that came up in the meantime stops it", async () => {
    const { t, hr, boss, make, leave } = await world();
    const ada = await make("Ada", "Okafor");
    await leave(ada.id, 8);
    const r = await requestErasure(hr, ada.id, "RETENTION", "Retention period is over and nothing is outstanding.");
    await raiseCase(hr, { employeeId: ada.id, type: "GRIEVANCE" as never, summary: "A late complaint", description: "She raised a complaint after leaving." });
    await expect(decideErasure(boss, r.id, true)).rejects.toThrow(/case is still open/);
    expect((await db.employee.findUniqueOrThrow({ where: { id: ada.id } })).anonymizedAt).toBeNull();
    expect(t.org.id).toBeTruthy();
  });
});

describe("carrying it out", () => {
  it("removes the personal details and what hangs off them, keeps the facts, and leaves a colleague alone", async () => {
    const { t, hr, boss, make, leave } = await world();
    const ada = await make("Ada", "Okafor", { email: "ada@example.test" });
    const bola = await make("Bola", "Adeyemi");
    // everything is recorded while they are still employed (the app refuses edits to a leaver's records)
    await addContact(hr, ada.id, { kind: "NEXT_OF_KIN", fullName: "Ngozi Okafor", relationship: "Spouse", phone: "08025550001", address: "14 Allen Avenue" });
    await addGuarantor(hr, ada.id, { fullName: "Chief Guarantor", relationship: "Friend", phone: "08037770099", address: "99 GUARANTOR-STREET", idType: "NIN", idNumber: "70000000045", formReference: "GF-77" });
    await addContact(hr, bola.id, { kind: "NEXT_OF_KIN", fullName: "Bola's Mother", relationship: "Mother", phone: "08025550002", address: "2 Ikoyi Road" });
    await addDocument(hr, { employeeId: ada.id, documentType: "NATIONAL_ID", documentNumber: "NIN-ADA-1", fileReference: "ada-national-id.pdf", notes: "ADA-DOC-NOTE" } as never);
    await db.generatedLetter.create({ data: { organizationId: t.org.id, referenceNumber: `LET-${uid()}`, type: "EMPLOYMENT_CONFIRMATION", recipientName: "Ada Okafor", employeeId: ada.id, subject: "Confirmation of Ada Okafor", body: "Dear Ada Okafor, ...", generatedBy: "HR" } });
    await requestChange(hr, ada.id, "BANK", { bankName: "Zenith Bank", accountNumber: "5555555555", accountName: "ADA OKAFOR" }, "Moved banks");
    const user = await db.user.create({ data: { organizationId: t.org.id, email: `ada.${uid()}@test.local`, name: "Ada Okafor", passwordHash: await bcrypt.hash("Password123!", 4), role: "EMPLOYEE", employeeId: ada.id, totpEnabled: true, totpSecret: "SECRETSECRET" } });
    const req = await createRequisition(hr, { title: "Guard", categoryId: t.guardId, departmentId: t.deptId, headcount: 2, employmentType: "PERMANENT", justification: "Cover" });
    await approveRequisition(boss, req.id);
    const candidate = await addCandidate(hr, { requisitionId: req.id, firstName: "Ada", lastName: "Okafor", phone: "08031112222", email: "ada@example.test", source: "REFERRAL", notes: "ADA-CANDIDATE-NOTE" });
    await db.candidate.update({ where: { id: candidate.id }, data: { employeeId: ada.id } });

    await leave(ada.id, 8);
    await leave(bola.id, 8);

    const r = await requestErasure(hr, ada.id, "RETENTION", "Retention period is over and nothing is outstanding.");
    await decideErasure(boss, r.id, true, "Checked the schedule; fine to proceed.");

    const e = await db.employee.findUniqueOrThrow({ where: { id: ada.id } });
    expect(e).toMatchObject({ firstName: "Former", lastName: "Employee", middleName: null, gender: null, dateOfBirth: null, phone: null, email: null, address: null, bankName: null, accountNumber: null, accountName: null, taxId: null, pensionPin: null, pfa: null });
    expect(e.anonymizedAt).not.toBeNull();
    // what stays
    expect(e.employeeNumber).toMatch(/\d/);
    expect(e.status).toBe("RESIGNED");
    expect(e.exitDate).not.toBeNull();
    expect(e.employmentDate).not.toBeNull();
    expect(e.categoryId).toBe(t.guardId);

    expect(await db.employeeContact.count({ where: { employeeId: ada.id } })).toBe(0);
    expect(await db.employeeGuarantor.count({ where: { employeeId: ada.id } })).toBe(0);
    const doc = await db.employeeDocument.findFirstOrThrow({ where: { employeeId: ada.id } });
    expect(doc).toMatchObject({ fileReference: "[removed]", documentNumber: null, notes: null });
    const cr = await db.employeeChangeRequest.findFirstOrThrow({ where: { employeeId: ada.id } });
    expect(JSON.stringify(cr.proposed) + JSON.stringify(cr.previous)).not.toMatch(/5555555555|Zenith/);
    const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u).toMatchObject({ active: false, name: "Former employee", totpEnabled: false, totpSecret: null });
    expect(u.email).toBe(`erased-${user.id}@invalid.local`);
    expect(await bcrypt.compare("Password123!", u.passwordHash)).toBe(false);
    expect(await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({ firstName: "Anonymised", lastName: "Candidate", phone: null, email: null, notes: null });
    expect(await db.generatedLetter.findFirstOrThrow({ where: { employeeId: ada.id } })).toMatchObject({ recipientName: "[removed]", subject: "[removed]", body: "[removed]" });

    // the request records what was done as counts, never the data
    const done = await db.employeeErasure.findUniqueOrThrow({ where: { id: r.id } });
    expect(done.status).toBe("EXECUTED");
    expect(done.decidedBy).toBe(boss.name);
    expect(done.summary).toMatchObject({ contacts: 1, guarantors: 1, documents: 1, changeRequests: 1, letters: 1, applications: 1, logins: 1, employee: 1 });
    expect(JSON.stringify(done.summary)).not.toMatch(/Ada|Okafor|0123456789/);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: t.org.id, action: "ERASURE_EXECUTE", entityId: ada.id } });
    expect(audit.reason).toMatch(/Checked the schedule/);

    // the colleague is untouched
    const b = await db.employee.findUniqueOrThrow({ where: { id: bola.id } });
    expect(b).toMatchObject({ firstName: "Bola", lastName: "Adeyemi", accountNumber: "0123456789" });
    expect(await db.employeeContact.count({ where: { employeeId: bola.id } })).toBe(1);

    // and it can't be done twice
    await expect(requestErasure(hr, ada.id, "REQUEST", "She asked again in writing, ID checked in person.")).rejects.toThrow(/already been removed/);
    expect((await retentionOverview(hr)).due.map((x) => x.id)).not.toContain(ada.id);
  });
});

describe("the overview and the digest", () => {
  it("lists leavers past the period with what blocks each, and counts those still inside it", async () => {
    const { hr, make, leave } = await world();
    const ready = await make("Ada", "Okafor");
    const blocked = await make("Bola", "Adeyemi");
    const inside = await make("Chidi", "Eze");
    await leave(ready.id, 8);
    await leave(blocked.id, 8);
    await leave(inside.id, 2);
    await raiseCase(hr, { employeeId: blocked.id, type: "GRIEVANCE" as never, summary: "Open complaint", description: "An unresolved complaint from his time here." });
    const o = await retentionOverview(hr);
    expect(o.years).toBe(6);
    expect(o.waiting).toBe(1);
    expect(o.due.find((x) => x.id === ready.id)?.blockers).toEqual([]);
    expect(o.due.find((x) => x.id === blocked.id)?.blockers.join(" ")).toMatch(/case is still open/);
    expect(o.due.map((x) => x.id)).not.toContain(inside.id);
  });

  it("tells HR what is ready and what is waiting for a second person", async () => {
    const { t, hr, make, leave } = await world();
    const a = await make("Ada", "Okafor");
    const b = await make("Bola", "Adeyemi");
    await leave(a.id, 8);
    await leave(b.id, 8);
    expect(await retentionAttention(t.org.id, todayUtc())).toEqual({ pending: 0, ready: 2 });
    await requestErasure(hr, a.id, "RETENTION", "Retention period is over and nothing is outstanding.");
    expect(await retentionAttention(t.org.id, todayUtc())).toEqual({ pending: 1, ready: 1 }); // a is now waiting, not "ready"
    const digest = await buildHrDigest(t.org.id);
    expect(digest.sections.find((s) => s.key === "retention")?.items.map((i) => i.text).join(" ")).toMatch(/1 erasure request.*1 former employee/s);
  });

  it("says nothing when the feature is off", async () => {
    const { t, make, leave } = await world(0);
    const a = await make("Ada", "Okafor");
    await leave(a.id, 20);
    expect(await retentionAttention(t.org.id, todayUtc())).toEqual({ pending: 0, ready: 0 });
  });
});
