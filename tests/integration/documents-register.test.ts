import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { archiveDocument, issueLink, listTypes, openFile, rejectDocument, startReview, submitDocument, approveDocument, updateType, uploadDocument } from "@/server/services/documents";
import { addRequirement, awaitingApproval, expiringDocuments, listRequirements, missingDocuments, myDocuments, searchDocuments, setRequirementActive } from "@/server/services/document-register";
import { isolatedOrg } from "../helpers";

// Electronic employee documents, part C: the central register, the missing-document tracking, and the employee's own view
// (the founder's request of 2026-11-07; his answers: a required document counts only when Approved; no requirements seeded).

const pdf = (label = "one") => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from(`synthetic ${label}`)]);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const reviewer = t.ctx("HR_ADMIN", null, 2);
  const types = await listTypes(hr);
  const type = (code: string) => types.find((x) => x.code === code)!;
  const hire = (first: string, categoryId = t.guardId) => createEmployee(hr, { firstName: first, lastName: "Registry", employmentDate: "2026-01-05", categoryId });
  const e1 = await hire("Ada");
  const e2 = await hire("Bola");
  const e3 = await hire("Chidi", t.officeId);
  const up = (employeeId: string, code: string, over: Record<string, unknown> = {}, name = "doc.pdf") =>
    uploadDocument(hr, { employeeId, typeId: type(code).id, file: { name, bytes: pdf(`${employeeId}-${code}-${name}`) }, ...over } as never);
  /** A type that needs no approval, so an upload counts as approved at once. */
  const noApproval = async (code: string) => updateType(hr, type(code).id, { requiresApproval: false });
  return { t, hr, reviewer, type, hire, e1, e2, e3, up, noApproval };
}
type World = Awaited<ReturnType<typeof world>>;

describe("document requirements", () => {
  it("a requirement is a document type needed by everyone or by one employee category, set by someone who configures documents", async () => {
    const w = await world();
    const everyone = await addRequirement(w.hr, { typeId: w.type("EMPLOYMENT_CONTRACT").id });
    expect(everyone).toMatchObject({ categoryId: null, active: true, typeId: w.type("EMPLOYMENT_CONTRACT").id });
    await expect(addRequirement(w.hr, { typeId: w.type("EMPLOYMENT_CONTRACT").id })).rejects.toThrow(/already/i);
    const guards = await addRequirement(w.hr, { typeId: w.type("EMPLOYMENT_CONTRACT").id, categoryId: w.t.guardId }); // for one category too
    expect(guards.categoryId).toBe(w.t.guardId);
    await expect(addRequirement(w.hr, { typeId: w.type("EMPLOYMENT_CONTRACT").id, categoryId: w.t.guardId })).rejects.toThrow(/already/i);
    expect((await listRequirements(w.hr)).map((r) => r.id).sort()).toEqual([everyone.id, guards.id].sort());
    for (const role of ["AUDITOR", "FINANCE", "OPERATIONS"] as const) await expect(addRequirement(w.t.ctx(role), { typeId: w.type("OFFER_LETTER").id }), role).rejects.toThrow(/permission/);
  });

  it("can name only this company's types and categories, can be switched off, and is audited", async () => {
    const w = await world();
    const other = await isolatedOrg();
    const foreignType = (await listTypes(other.ctx("HR_ADMIN")))[0];
    await expect(addRequirement(w.hr, { typeId: foreignType.id })).rejects.toThrow(/type not found/i);
    await expect(addRequirement(w.hr, { typeId: w.type("OFFER_LETTER").id, categoryId: other.guardId })).rejects.toThrow(/category not found/i);
    const r = await addRequirement(w.hr, { typeId: w.type("OFFER_LETTER").id });
    await expect(setRequirementActive(other.ctx("HR_ADMIN"), r.id, false)).rejects.toThrow(/not found/i);
    await setRequirementActive(w.hr, r.id, false);
    expect((await listRequirements(w.hr)).some((x) => x.id === r.id)).toBe(false);
    expect((await listRequirements(w.hr, { all: true })).find((x) => x.id === r.id)?.active).toBe(false);
    const actions = (await db.auditLog.findMany({ where: { organizationId: w.t.org.id, entity: "EmployeeDocumentRequirement" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["DOCUMENT_REQUIREMENT_ADD", "DOCUMENT_REQUIREMENT_UPDATE"]));
  });
});

describe("missing documents", () => {
  async function setup() {
    const w = await world();
    await w.noApproval("EMPLOYMENT_CONTRACT");
    await addRequirement(w.hr, { typeId: w.type("EMPLOYMENT_CONTRACT").id }); // everyone
    await addRequirement(w.hr, { typeId: w.type("OFFER_LETTER").id, categoryId: w.t.officeId }); // office staff only
    await w.up(w.e1.id, "EMPLOYMENT_CONTRACT"); // approved at once
    await w.up(w.e2.id, "EMPLOYMENT_CONTRACT").then(async (r) => db.employeeDocument.update({ where: { id: r.document.id }, data: { status: "PENDING" } })); // uploaded, not submitted
    return w;
  }
  const keyed = (rows: Array<{ employeeNumber: string; typeName: string; state: string }>) => rows.map((r) => `${r.employeeNumber}|${r.typeName}|${r.state}`).sort();

  it("lists what each employee still lacks, only for the employees the requirement applies to", async () => {
    const w = await setup();
    const r = await missingDocuments(w.hr);
    expect(keyed(r.rows)).toEqual(
      [`${w.e2.employeeNumber}|Employment contract|NOT_SUBMITTED`, `${w.e3.employeeNumber}|Employment contract|MISSING`, `${w.e3.employeeNumber}|Offer letter|MISSING`].sort(),
    );
    expect(r.summary.find((s) => s.typeName === "Employment contract")).toMatchObject({ required: 3, present: 1, missing: 2 });
    expect(r.summary.find((s) => s.typeName === "Offer letter")).toMatchObject({ required: 1, present: 0, missing: 1 });
  });

  it("only an approved document counts: submitted shows as awaiting approval, rejected as rejected, and approving it clears the row", async () => {
    const w = await setup();
    await w.noApproval("EMPLOYMENT_CONTRACT").then(() => updateType(w.hr, w.type("EMPLOYMENT_CONTRACT").id, { requiresApproval: true }));
    const doc = await db.employeeDocument.findFirstOrThrow({ where: { employeeId: w.e2.id, typeId: w.type("EMPLOYMENT_CONTRACT").id } });
    await submitDocument(w.hr, doc.id);
    const state = async () => (await missingDocuments(w.hr)).rows.find((x) => x.employeeNumber === w.e2.employeeNumber)?.state;
    expect(await state()).toBe("IN_REVIEW");
    await startReview(w.reviewer, doc.id);
    expect(await state()).toBe("IN_REVIEW");
    await rejectDocument(w.reviewer, doc.id, "The scan is cut off");
    expect(await state()).toBe("REJECTED");
    await db.employeeDocument.update({ where: { id: doc.id }, data: { status: "SUBMITTED", reviewedBy: null, reviewedByUserId: null } });
    await approveDocument(w.reviewer, doc.id);
    expect(await state()).toBeUndefined(); // on file now
  });

  it("an expired document, an archived one, a switched-off requirement and a leaver are all handled", async () => {
    const w = await setup();
    // an approved document past its expiry shows as expired
    const lic = await w.up(w.e1.id, "EMPLOYMENT_CONTRACT", { expiryDate: "2020-01-01" }, "old.pdf");
    expect(lic.document.status).toBe("APPROVED");
    // e1 still has the other, valid contract: present. Archive that one: only the expired one remains
    const valid = await db.employeeDocument.findFirstOrThrow({ where: { employeeId: w.e1.id, typeId: w.type("EMPLOYMENT_CONTRACT").id, expiryDate: null } });
    await archiveDocument(w.hr, valid.id);
    const e1 = (await missingDocuments(w.hr)).rows.find((x) => x.employeeNumber === w.e1.employeeNumber);
    expect(e1?.state).toBe("EXPIRED");
    // a leaver is not chased for documents
    await db.employee.update({ where: { id: w.e3.id }, data: { status: "RESIGNED" } });
    expect((await missingDocuments(w.hr)).rows.some((x) => x.employeeNumber === w.e3.employeeNumber)).toBe(false);
    // and a switched-off requirement stops being checked
    for (const r of await listRequirements(w.hr)) await setRequirementActive(w.hr, r.id, false);
    expect((await missingDocuments(w.hr)).rows).toEqual([]);
  });

  it("a required identification type is shown only to someone with sensitive access, and nothing leaks across companies", async () => {
    const w = await world();
    await addRequirement(w.hr, { typeId: w.type("NATIONAL_ID").id });
    await addRequirement(w.hr, { typeId: w.type("OFFER_LETTER").id });
    const hrRows = (await missingDocuments(w.hr)).rows.map((r) => r.typeName);
    expect(hrRows).toEqual(expect.arrayContaining(["National identification", "Offer letter"]));
    const aud = await missingDocuments(w.t.ctx("AUDITOR")); // may see documents, not sensitive ones
    expect(aud.rows.map((r) => r.typeName)).not.toContain("National identification");
    expect(aud.summary.map((s) => s.typeName)).not.toContain("National identification");
    expect(aud.rows.map((r) => r.typeName)).toContain("Offer letter");
    await expect(missingDocuments(w.t.ctx("FINANCE"))).rejects.toThrow(/permission/);
    const other = await isolatedOrg();
    expect((await missingDocuments(other.ctx("HR_ADMIN"))).rows).toEqual([]);
  });
});

describe("the central register", () => {
  async function filled() {
    const w = await world();
    await w.noApproval("EMPLOYMENT_CONTRACT");
    const contract = await w.up(w.e1.id, "EMPLOYMENT_CONTRACT", { expiryDate: inDays(400) }, "contract.pdf"); // approved
    const offer = await w.up(w.e2.id, "OFFER_LETTER", {}, "offer.pdf"); // pending
    const academic = await w.up(w.e3.id, "ACADEMIC_CERTIFICATE", {}, "degree.pdf"); // pending, office staff
    const idCard = await w.up(w.e1.id, "NATIONAL_ID", { expiryDate: inDays(10) }, "id.pdf"); // pending, sensitive
    await updateType(w.hr, w.type("LICENCE").id, { requiresApproval: false });
    const expired = await w.up(w.e2.id, "LICENCE", { expiryDate: "2020-06-30" }, "licence.pdf"); // approved, past expiry
    return { w, contract, offer, academic, idCard, expired };
  }
  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

  it("searches by employee name or number, and by category", async () => {
    const { w, contract, offer, academic, expired } = await filled();
    expect(ids((await searchDocuments(w.hr, { q: "Ada" })).rows)).toContain(contract.document.id);
    expect(ids((await searchDocuments(w.hr, { q: "Ada" })).rows)).not.toContain(offer.document.id);
    expect(ids((await searchDocuments(w.hr, { q: w.e2.employeeNumber })).rows)).toContain(offer.document.id);
    expect(ids((await searchDocuments(w.hr, { q: "bola" })).rows)).toContain(offer.document.id); // not case-sensitive
    const edu = (await searchDocuments(w.hr, { category: "EDUCATION_PROFESSIONAL" })).rows;
    expect(ids(edu)).toEqual([academic.document.id, expired.document.id].sort()); // the Licence type is an education and professional type too
    expect(edu.find((r) => r.id === academic.document.id)).toMatchObject({ employeeNumber: w.e3.employeeNumber, category: "EDUCATION_PROFESSIONAL" });
  });

  it("filters by status, including Expired, which is worked out from the expiry date", async () => {
    const { w, contract, offer, expired } = await filled();
    expect(ids((await searchDocuments(w.hr, { status: "PENDING" })).rows)).toContain(offer.document.id);
    expect(ids((await searchDocuments(w.hr, { status: "PENDING" })).rows)).not.toContain(contract.document.id);
    expect(ids((await searchDocuments(w.hr, { status: "APPROVED" })).rows)).toEqual([contract.document.id]); // the expired one is not "approved"
    expect(ids((await searchDocuments(w.hr, { status: "EXPIRED" })).rows)).toEqual([expired.document.id]);
    expect((await searchDocuments(w.hr, { status: "EXPIRED" })).rows[0].status).toBe("EXPIRED");
  });

  it("filters by upload date and expiry date", async () => {
    const { w, contract } = await filled();
    expect((await searchDocuments(w.hr, { uploadedFrom: inDays(1) })).total).toBe(0); // nothing uploaded tomorrow
    expect((await searchDocuments(w.hr, { uploadedTo: inDays(0) })).total).toBeGreaterThan(0); // today is included
    expect((await searchDocuments(w.hr, { uploadedFrom: inDays(0), uploadedTo: inDays(0) })).total).toBeGreaterThan(0);
    expect(ids((await searchDocuments(w.hr, { expiryFrom: inDays(300), expiryTo: inDays(500) })).rows)).toEqual([contract.document.id]);
    expect((await searchDocuments(w.hr, { expiryFrom: inDays(600) })).total).toBe(0);
  });

  it("leaves out archived documents unless asked, hides sensitive ones from someone without access, and pages", async () => {
    const { w, offer, idCard } = await filled();
    await archiveDocument(w.hr, offer.document.id);
    expect(ids((await searchDocuments(w.hr, {})).rows)).not.toContain(offer.document.id);
    expect(ids((await searchDocuments(w.hr, { includeArchived: true })).rows)).toContain(offer.document.id);
    expect(ids((await searchDocuments(w.hr, {})).rows)).toContain(idCard.document.id);
    expect(ids((await searchDocuments(w.t.ctx("AUDITOR"), {})).rows)).not.toContain(idCard.document.id);
    const all = await searchDocuments(w.hr, {});
    const page = await searchDocuments(w.hr, { take: 2, skip: 0 });
    expect(page.rows.length).toBe(2);
    expect(page.total).toBe(all.total);
  });

  it("is for those who may see documents, one company's only, and each row opens the employee's profile data", async () => {
    const { w, contract } = await filled();
    await expect(searchDocuments(w.t.ctx("FINANCE"), {})).rejects.toThrow(/permission/);
    const other = await isolatedOrg();
    expect((await searchDocuments(other.ctx("HR_ADMIN"), {})).total).toBe(0);
    const row = (await searchDocuments(w.hr, { q: "Ada" })).rows.find((r) => r.id === contract.document.id)!;
    expect(row).toMatchObject({ employeeId: w.e1.id, employeeNumber: w.e1.employeeNumber, name: "Employment contract", uploadedBy: w.hr.name });
    expect(row.current).toMatchObject({ canPreview: true });
  });

  it("the approval queue holds the submitted and the under-review documents, with who may decide each", async () => {
    const { w, offer, academic } = await filled();
    await submitDocument(w.hr, offer.document.id);
    await submitDocument(w.hr, academic.document.id);
    await startReview(w.reviewer, academic.document.id);
    const queue = await awaitingApproval(w.reviewer);
    expect(ids(queue)).toEqual([offer.document.id, academic.document.id].sort());
    expect(queue.find((r) => r.id === offer.document.id)!.actions).toMatchObject({ startReview: true, decide: true });
    expect(queue.find((r) => r.id === academic.document.id)!.actions).toMatchObject({ decide: true }); // taken by this reviewer
    const uploaderView = await awaitingApproval(w.hr); // they uploaded and submitted them: they cannot decide
    expect(uploaderView.every((r) => !r.actions.decide && !r.actions.startReview)).toBe(true);
    const auditorView = await awaitingApproval(w.t.ctx("AUDITOR"));
    expect(auditorView.every((r) => !r.actions.decide)).toBe(true);
    await expect(awaitingApproval(w.t.ctx("FINANCE"))).rejects.toThrow(/permission/);
  });

  it("lists the documents expiring within the chosen number of days, and those already expired", async () => {
    const { w, idCard, contract, expired } = await filled();
    await db.employeeDocument.update({ where: { id: idCard.document.id }, data: { status: "APPROVED" } });
    const in30 = await expiringDocuments(w.hr, 30);
    expect(ids(in30)).toEqual([idCard.document.id, expired.document.id].sort());
    expect(in30.find((r) => r.id === expired.document.id)!.expired).toBe(true);
    expect(in30.find((r) => r.id === idCard.document.id)!.expired).toBe(false);
    expect(ids(await expiringDocuments(w.hr, 500))).toContain(contract.document.id);
    expect(ids(await expiringDocuments(w.t.ctx("AUDITOR"), 30))).not.toContain(idCard.document.id); // sensitive
  });
});

describe("an employee's own documents", () => {
  async function owned() {
    const w = await world();
    await w.noApproval("OFFER_LETTER");
    await w.noApproval("MEDICAL_EXAMINATION_REPORT");
    await w.noApproval("LICENCE");
    const offer = await w.up(w.e1.id, "OFFER_LETTER", {}, "offer.pdf"); // approved
    const medical = await w.up(w.e1.id, "MEDICAL_EXAMINATION_REPORT", {}, "medical.pdf"); // approved, sensitive
    const licence = await w.up(w.e1.id, "LICENCE", { expiryDate: "2020-01-01" }, "licence.pdf"); // approved, expired
    const pending = await w.up(w.e1.id, "EMPLOYMENT_CONTRACT", {}, "pending.pdf"); // needs approval, pending
    const rejected = await w.up(w.e1.id, "ACADEMIC_CERTIFICATE", {}, "rejected.pdf");
    await submitDocument(w.hr, rejected.document.id);
    await rejectDocument(w.reviewer, rejected.document.id, "The scan is unreadable");
    const archived = await w.up(w.e1.id, "TRAINING_CERTIFICATE", {}, "archived.pdf");
    await db.employeeDocument.update({ where: { id: archived.document.id }, data: { status: "APPROVED" } });
    await archiveDocument(w.hr, archived.document.id);
    const others = await w.up(w.e2.id, "OFFER_LETTER", {}, "someone-elses.pdf"); // approved, but not theirs
    const me = w.t.ctx("EMPLOYEE", w.e1.id);
    return { w, me, offer, medical, licence, pending, rejected, archived, others };
  }

  it("shows only their own approved documents (expired ones labelled), medical included, never anything else", async () => {
    const { me, offer, medical, licence, pending, rejected, archived, others } = await owned();
    const rows = await myDocuments(me);
    expect(rows.map((r) => r.id).sort()).toEqual([offer.document.id, medical.document.id, licence.document.id].sort());
    expect(rows.find((r) => r.id === licence.document.id)!.status).toBe("EXPIRED");
    expect(rows.find((r) => r.id === medical.document.id)).toMatchObject({ category: "MEDICAL", status: "APPROVED" });
    const all = rows.map((r) => r.id);
    for (const hidden of [pending, rejected, archived, others]) expect(all).not.toContain(hidden.document.id);
    expect(rows[0]).toMatchObject({ current: expect.objectContaining({ canPreview: true }) });
  });

  it("can open and download their own approved documents through a signed link, and every use is audited as theirs", async () => {
    const { w, me, offer, medical } = await owned();
    const link = await issueLink(me, offer.version.id, "view");
    const out = await openFile(me, link.token);
    expect(out.bytes.equals(pdf(`${w.e1.id}-OFFER_LETTER-offer.pdf`))).toBe(true);
    expect(out.disposition).toBe("inline");
    await expect(openFile(me, (await issueLink(me, medical.version.id, "download")).token)).resolves.toMatchObject({ disposition: "attachment" }); // their own medical file
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, entityId: offer.document.id, action: "DOCUMENT_VIEW" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ self: true });
    // another employee cannot use the link: it is bound to the user, and even if the test helper gives both the same user id the file is not theirs
    await expect(openFile(w.t.ctx("EMPLOYEE", w.e2.id), link.token)).rejects.toThrow(/not valid|not found/i);
  });

  it("cannot reach a document that is not theirs, not approved, archived, or another company's", async () => {
    const { w, me, pending, rejected, archived, others } = await owned();
    for (const hidden of [pending, rejected, archived, others]) await expect(issueLink(me, hidden.version.id, "download")).rejects.toThrow(/not found/i);
    const other = await isolatedOrg();
    await expect(issueLink(other.ctx("EMPLOYEE", w.e1.id), (await db.employeeDocumentVersion.findFirstOrThrow({ where: { documentId: others.document.id } })).id, "download")).rejects.toThrow(/not found|permission/i);
  });

  it("a person with no employee record has no documents, a person who is not an employee cannot use the self-service path, and staff are unaffected", async () => {
    const { w, offer } = await owned();
    expect(await myDocuments(w.hr)).toEqual([]);
    await expect(issueLink(w.t.ctx("OPERATIONS"), offer.version.id, "download")).rejects.toThrow(/permission/);
    await expect(issueLink(w.hr, offer.version.id, "download")).resolves.toBeTruthy(); // HR as before
  });
});
