import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee, getEmployee } from "@/server/services/employees";
import { documentsReport } from "@/server/services/reports";
import { buildHrDigest } from "@/server/services/reminders";
import { hrOverview } from "@/server/services/hr-overview";
import { ROLE_PERMISSIONS, type Permission, type Role } from "@/lib/auth/permissions";
import { STANDARD_TYPES } from "@/lib/documents";
import {
  addType,
  archiveDocument,
  ensureDocumentTypes,
  issueLink,
  listEmployeeDocuments,
  listTypes,
  listVersions,
  openFile,
  replaceDocument,
  updateType,
  uploadDocument,
} from "@/server/services/documents";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { isolatedOrg } from "../helpers";

// Electronic employee documents, part A: the store (the founder's request of 2026-11-07; plan: docs/plans/employee-documents.md).
// The files are tiny synthetic byte strings with the right first bytes: no real documents.

const pdf = (label = "one") => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from(`synthetic ${label}`)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("synthetic image")]);
const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....[Content_Types].xml....word/document.xml....synthetic")]);

const restore: Array<() => void> = [];
/** Takes one permission away from one role for the rest of the test (the roles are fixed in code). */
function without(role: Role, permission: string) {
  const was = ROLE_PERMISSIONS[role];
  ROLE_PERMISSIONS[role] = was.filter((p) => p !== (permission as Permission));
  restore.push(() => {
    ROLE_PERMISSIONS[role] = was;
  });
}
afterEach(() => {
  while (restore.length) restore.pop()!();
});

async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN");
  const emp = await createEmployee(hr, { firstName: "Doc", lastName: "Holder", employmentDate: "2024-01-01", categoryId: t.guardId });
  const types = await listTypes(hr);
  const type = (code: string) => types.find((x) => x.code === code)!;
  return { t, hr, emp, type };
}
type World = Awaited<ReturnType<typeof world>>;

const upload = (w: World, code: string, over: Record<string, unknown> = {}, file = { name: "Offer.pdf", bytes: pdf() }) =>
  uploadDocument(w.hr, { employeeId: w.emp.id, typeId: w.type(code).id, file, ...over } as never);

describe("document types are data", () => {
  it("every company starts with the standard types, and each company's are its own", async () => {
    const w = await world();
    expect(w.type("OFFER_LETTER")).toMatchObject({ category: "EMPLOYMENT", requiresApproval: true, sensitive: false, standard: true });
    expect(w.type("NATIONAL_ID")).toMatchObject({ category: "IDENTIFICATION", sensitive: true, hasExpiry: true });
    expect(w.type("MEDICAL_FITNESS_CERTIFICATE")).toMatchObject({ category: "MEDICAL", sensitive: true });
    expect((await listTypes(w.hr)).length).toBe(STANDARD_TYPES.length);
    const other = await isolatedOrg();
    const theirs = await listTypes(other.ctx("HR_ADMIN"));
    expect(theirs.length).toBe(STANDARD_TYPES.length);
    expect(theirs.every((x) => x.organizationId === other.org.id)).toBe(true);
    await ensureDocumentTypes(w.t.org.id); // asking again adds nothing
    expect((await listTypes(w.hr)).length).toBe(STANDARD_TYPES.length);
  });

  it("an administrator adds, renames and switches off types without any code; nobody else can", async () => {
    const w = await world();
    const added = await addType(w.hr, { category: "COMPLIANCE", name: "Firearms handling certificate", requiresApproval: true, hasExpiry: true, sensitive: false });
    expect(added).toMatchObject({ standard: false, category: "COMPLIANCE", hasExpiry: true });
    await expect(addType(w.hr, { category: "COMPLIANCE", name: "firearms HANDLING certificate" })).rejects.toThrow(/already/i);
    await expect(addType(w.t.ctx("AUDITOR"), { category: "COMPLIANCE", name: "Not allowed" })).rejects.toThrow(/permission/);
    await expect(addType(w.t.ctx("FINANCE"), { category: "COMPLIANCE", name: "Not allowed" })).rejects.toThrow(/permission/);
    const renamed = await updateType(w.hr, added.id, { name: "Firearms handling licence", requiresApproval: false });
    expect(renamed).toMatchObject({ name: "Firearms handling licence", requiresApproval: false });
    await updateType(w.hr, added.id, { active: false });
    expect((await listTypes(w.hr)).some((x) => x.id === added.id)).toBe(false); // switched off: not offered
    expect((await listTypes(w.hr, { all: true })).some((x) => x.id === added.id)).toBe(true);
    await expect(uploadDocument(w.hr, { employeeId: w.emp.id, typeId: added.id, file: { name: "a.pdf", bytes: pdf() } } as never)).rejects.toThrow(/switched off/i);
    // a standard type can be switched off or renamed but keeps its code and category
    const std = await updateType(w.hr, w.type("OFFER_LETTER").id, { name: "Offer of employment" });
    expect(std).toMatchObject({ code: "OFFER_LETTER", category: "EMPLOYMENT", standard: true });
  });
});

describe("uploading a document", () => {
  it("stores it for the right employee, as a version of a pending document, with the file encrypted at rest", async () => {
    const w = await world();
    const file = { name: "Offer letter final.pdf", bytes: pdf("the secret offer") };
    const r = await upload(w, "OFFER_LETTER", { description: "Signed copy", issueDate: "2026-01-05", reference: "OFR-1" }, file);
    expect(r.document).toMatchObject({ employeeId: w.emp.id, organizationId: w.t.org.id, status: "PENDING", description: "Signed copy", documentNumber: "OFR-1" });
    expect(r.version).toMatchObject({ version: 1, fileName: "Offer letter final.pdf", mimeType: "application/pdf", sizeBytes: file.bytes.length });
    const blob = await db.employeeDocumentBlob.findUniqueOrThrow({ where: { versionId: r.version.id } });
    expect(Buffer.from(blob.data).equals(file.bytes)).toBe(false); // not the file as uploaded
    expect(Buffer.from(blob.data).includes(Buffer.from("the secret offer"))).toBe(false);
    expect(blob.iv.length).toBe(12);
    expect(r.version.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a type that needs no approval completes as approved, labelled so; one that needs it is left pending", async () => {
    const w = await world();
    await updateType(w.hr, w.type("TRAINING_CERTIFICATE").id, { requiresApproval: false });
    const done = await upload(w, "TRAINING_CERTIFICATE", {}, { name: "cert.pdf", bytes: pdf("t") });
    expect(done.document.status).toBe("APPROVED");
    expect((await upload(w, "ACADEMIC_CERTIFICATE", {}, { name: "deg.pdf", bytes: pdf("d") })).document.status).toBe("PENDING");
  });

  it("refuses what the server checks for: an empty file, a program renamed as a PDF, a mismatched name, and a bad date", async () => {
    const w = await world();
    await expect(upload(w, "OFFER_LETTER", {}, { name: "a.pdf", bytes: Buffer.alloc(0) })).rejects.toThrow(/empty/i);
    await expect(upload(w, "OFFER_LETTER", {}, { name: "a.pdf", bytes: Buffer.from("MZ\x90\x00 a program") })).rejects.toThrow(/refused/i);
    await expect(upload(w, "OFFER_LETTER", {}, { name: "a.exe", bytes: pdf() })).rejects.toThrow(/Only PDF/);
    await expect(upload(w, "OFFER_LETTER", {}, { name: "a.png", bytes: pdf() })).rejects.toThrow(/does not match/);
    await expect(upload(w, "OFFER_LETTER", { issueDate: "2026-05-01", expiryDate: "2026-01-01" })).rejects.toThrow(/expiry/i);
    expect(await db.employeeDocument.count({ where: { employeeId: w.emp.id, typeId: { not: null } } })).toBe(0); // nothing half-saved
  });

  it("is for someone who manages documents, for an employee and a type of this company only", async () => {
    const w = await world();
    for (const role of ["AUDITOR", "FINANCE", "OPERATIONS"] as const)
      await expect(uploadDocument(w.t.ctx(role), { employeeId: w.emp.id, typeId: w.type("OFFER_LETTER").id, file: { name: "a.pdf", bytes: pdf() } } as never), role).rejects.toThrow(/permission/);
    await expect(uploadDocument(w.t.ctx("EMPLOYEE", w.emp.id), { employeeId: w.emp.id, typeId: w.type("OFFER_LETTER").id, file: { name: "a.pdf", bytes: pdf() } } as never)).rejects.toThrow(/permission/);
    const other = await isolatedOrg();
    await expect(uploadDocument(other.ctx("HR_ADMIN"), { employeeId: w.emp.id, typeId: (await listTypes(other.ctx("HR_ADMIN")))[0].id, file: { name: "a.pdf", bytes: pdf() } } as never)).rejects.toThrow(/Employee not found/i);
    await expect(uploadDocument(w.hr, { employeeId: w.emp.id, typeId: (await listTypes(other.ctx("HR_ADMIN")))[0].id, file: { name: "a.pdf", bytes: pdf() } } as never)).rejects.toThrow(/type not found/i);
  });

  it("is audited by ids and field names, never the file name or the description", async () => {
    const w = await world();
    const r = await upload(w, "OFFER_LETTER", { description: "A private remark" }, { name: "Private name.pdf", bytes: pdf() });
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, entity: "EmployeeDocument", entityId: r.document.id } });
    expect(rows.map((x) => x.action)).toContain("DOCUMENT_UPLOAD");
    expect(JSON.stringify(rows)).not.toContain("Private name");
    expect(JSON.stringify(rows)).not.toContain("A private remark");
    expect(JSON.stringify(rows)).toContain(r.version.id);
  });
});

describe("identification and medical documents are sensitive", () => {
  it("need the document-sensitive permission to upload, list, version-list or open", async () => {
    const w = await world();
    const sensitive = await upload(w, "NATIONAL_ID", { expiryDate: "2030-01-01" }, { name: "id.png", bytes: png });
    const plain = await upload(w, "OFFER_LETTER");
    const aud = w.t.ctx("AUDITOR"); // reads the register, but is not allowed sensitive files
    const seen = (await listEmployeeDocuments(aud, w.emp.id)).map((d) => d.id);
    expect(seen).toContain(plain.document.id);
    expect(seen).not.toContain(sensitive.document.id); // not even listed
    await expect(listVersions(aud, sensitive.document.id)).rejects.toThrow(/not found/i);
    await expect(issueLink(aud, sensitive.version.id, "download")).rejects.toThrow(/not found/i);
    await expect(issueLink(aud, plain.version.id, "download")).resolves.toBeTruthy();
    // and an HR administrator who loses the permission cannot add one either
    without("HR_ADMIN", "document.sensitive");
    await expect(upload(w, "MEDICAL_FITNESS_CERTIFICATE", {}, { name: "med.pdf", bytes: pdf() })).rejects.toThrow(/permission/);
    expect((await listEmployeeDocuments(w.t.ctx("HR_ADMIN"), w.emp.id)).map((d) => d.id)).not.toContain(sensitive.document.id);
  });
});

describe("the register", () => {
  it("shows each document with its type, status, dates, who uploaded it and its current version", async () => {
    const w = await world();
    const r = await upload(w, "OFFER_LETTER", { issueDate: "2026-01-05" });
    const [row] = await listEmployeeDocuments(w.hr, w.emp.id);
    expect(row).toMatchObject({ id: r.document.id, name: "Offer letter", category: "EMPLOYMENT", status: "PENDING", uploadedBy: w.hr.name, versionCount: 1, referenceOnly: false });
    expect(row.current).toMatchObject({ version: 1, fileName: "Offer.pdf", canPreview: true });
    expect(row.uploadedAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("keeps the records from before document management, labelled reference only, with no approval invented", async () => {
    const w = await world();
    const legacyContract = await db.employeeDocument.create({ data: { organizationId: w.t.org.id, employeeId: w.emp.id, documentType: "EMPLOYMENT_CONTRACT", fileReference: "box 4 shelf 2", uploadedBy: "HR test" } });
    const legacyId = await db.employeeDocument.create({ data: { organizationId: w.t.org.id, employeeId: w.emp.id, documentType: "NATIONAL_ID", fileReference: "scan-7.pdf", uploadedBy: "HR test" } });
    const hrRows = await listEmployeeDocuments(w.hr, w.emp.id);
    expect(hrRows.find((d) => d.id === legacyContract.id)).toMatchObject({ referenceOnly: true, status: "REFERENCE_ONLY", current: null });
    expect(hrRows.some((d) => d.id === legacyId.id)).toBe(true);
    const audRows = (await listEmployeeDocuments(w.t.ctx("AUDITOR"), w.emp.id)).map((d) => d.id);
    expect(audRows).toContain(legacyContract.id);
    expect(audRows).not.toContain(legacyId.id); // an identification record is sensitive too
    expect((await db.employeeDocument.findUniqueOrThrow({ where: { id: legacyContract.id } })).status).toBeNull();
  });

  it("an approved document past its expiry shows as expired", async () => {
    const w = await world();
    await updateType(w.hr, w.type("LICENCE").id, { requiresApproval: false });
    await upload(w, "LICENCE", { expiryDate: "2020-01-01" }, { name: "lic.pdf", bytes: pdf("l") });
    expect((await listEmployeeDocuments(w.hr, w.emp.id))[0].status).toBe("EXPIRED");
  });

  it("is for those who may see documents, and an employee's own record only", async () => {
    const w = await world();
    await upload(w, "OFFER_LETTER");
    await expect(listEmployeeDocuments(w.t.ctx("FINANCE"), w.emp.id)).rejects.toThrow(/permission/);
    const other = await isolatedOrg();
    expect(await listEmployeeDocuments(other.ctx("HR_ADMIN"), w.emp.id)).toEqual([]);
  });
});

describe("replacing a document keeps every earlier version", () => {
  it("adds version 2, marks version 1 as replaced by whom and when, and both can be read back", async () => {
    const w = await world();
    const first = await upload(w, "OFFER_LETTER", {}, { name: "v1.pdf", bytes: pdf("first") });
    const second = await replaceDocument(w.t.ctx("HR_ADMIN", null, 2), first.document.id, { file: { name: "v2.pdf", bytes: pdf("second") } });
    expect(second.version.version).toBe(2);
    const versions = await listVersions(w.hr, first.document.id);
    expect(versions.map((v) => [v.version, v.fileName])).toEqual([[2, "v2.pdf"], [1, "v1.pdf"]]);
    const old = versions.find((v) => v.version === 1)!;
    expect(old.replacedBy).toBe("HR_ADMIN 2");
    expect(old.replacedAt).toBeInstanceOf(Date);
    expect(versions.find((v) => v.version === 2)!.replacedAt).toBeNull();
    // the register shows the latest as the active one
    expect((await listEmployeeDocuments(w.hr, w.emp.id))[0]).toMatchObject({ versionCount: 2, current: { version: 2, fileName: "v2.pdf" } });
    // and the earlier file is still there to open
    const link = await issueLink(w.hr, old.id, "download");
    expect((await openFile(w.hr, link.token)).bytes.equals(pdf("first"))).toBe(true);
    // the audit trail records the replacement
    expect((await db.auditLog.findMany({ where: { organizationId: w.t.org.id, entityId: first.document.id } })).map((x) => x.action)).toEqual(expect.arrayContaining(["DOCUMENT_UPLOAD", "DOCUMENT_REPLACE"]));
  });

  it("puts a document that needs approval back to pending, and refuses an archived one or someone without the permission", async () => {
    const w = await world();
    const r = await upload(w, "OFFER_LETTER");
    await db.employeeDocument.update({ where: { id: r.document.id }, data: { status: "APPROVED" } });
    await replaceDocument(w.hr, r.document.id, { file: { name: "v2.pdf", bytes: pdf("two") } });
    expect((await db.employeeDocument.findUniqueOrThrow({ where: { id: r.document.id } })).status).toBe("PENDING");
    await expect(replaceDocument(w.t.ctx("AUDITOR"), r.document.id, { file: { name: "v3.pdf", bytes: pdf("three") } })).rejects.toThrow(/permission/);
    await archiveDocument(w.hr, r.document.id);
    await expect(replaceDocument(w.hr, r.document.id, { file: { name: "v4.pdf", bytes: pdf("four") } })).rejects.toThrow(/archived/i);
  });

  it("attaching a file to a record from before document management needs a type, and turns it into a normal document", async () => {
    const w = await world();
    const legacy = await db.employeeDocument.create({ data: { organizationId: w.t.org.id, employeeId: w.emp.id, documentType: "EMPLOYMENT_CONTRACT", fileReference: "box 4", uploadedBy: "HR test" } });
    await expect(replaceDocument(w.hr, legacy.id, { file: { name: "scan.pdf", bytes: pdf("scan") } })).rejects.toThrow(/choose the type/i);
    const r = await replaceDocument(w.hr, legacy.id, { typeId: w.type("EMPLOYMENT_CONTRACT").id, file: { name: "scan.pdf", bytes: pdf("scan") } });
    expect(r.version.version).toBe(1);
    expect(r.document).toMatchObject({ typeId: w.type("EMPLOYMENT_CONTRACT").id, status: "PENDING" });
  });
});

describe("a short-lived signed link, and nothing else, opens a file", () => {
  it("returns the exact file, is audited, and is for one user", async () => {
    const w = await world();
    const file = { name: "Offer.pdf", bytes: pdf("exact bytes") };
    const r = await upload(w, "OFFER_LETTER", {}, file);
    const link = await issueLink(w.hr, r.version.id, "view");
    expect(link.url).toContain("/api/documents/file?t=");
    const out = await openFile(w.hr, link.token);
    expect(out.bytes.equals(file.bytes)).toBe(true);
    expect(out).toMatchObject({ fileName: "Offer.pdf", mime: "application/pdf", disposition: "inline" });
    const dl = await openFile(w.hr, (await issueLink(w.hr, r.version.id, "download")).token);
    expect(dl.disposition).toBe("attachment");
    const actions = (await db.auditLog.findMany({ where: { organizationId: w.t.org.id, entityId: r.document.id } })).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["DOCUMENT_LINK_ISSUED", "DOCUMENT_VIEW", "DOCUMENT_DOWNLOAD"]));
    // another person cannot use it
    await expect(openFile(w.t.ctx("HR_ADMIN", null, 2), link.token)).rejects.toThrow(/not valid/i);
  });

  it("expires after five minutes, and a changed or invented link is refused", async () => {
    const w = await world();
    const r = await upload(w, "OFFER_LETTER");
    const now = Math.floor(Date.now() / 1000);
    const link = await issueLink(w.hr, r.version.id, "download", now);
    expect(link.expiresAt).toBe(now + 300);
    await expect(openFile(w.hr, link.token, now + 299)).resolves.toBeTruthy();
    await expect(openFile(w.hr, link.token, now + 301)).rejects.toThrow(/not valid|expired/i);
    const [body, sig] = link.token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), m: "view" })).toString("base64url");
    await expect(openFile(w.hr, `${forged}.${sig}`)).rejects.toThrow(/not valid/i);
    await expect(openFile(w.hr, "rubbish")).rejects.toThrow(/not valid/i);
  });

  it("is checked again on use: if the permission is taken away, or the person belongs to another company, it fails", async () => {
    const w = await world();
    const r = await upload(w, "OFFER_LETTER");
    const link = await issueLink(w.hr, r.version.id, "download");
    const other = await isolatedOrg();
    await expect(openFile({ ...other.ctx("HR_ADMIN"), userId: w.hr.userId }, link.token)).rejects.toThrow(/not valid/i);
    without("HR_ADMIN", "document.view");
    await expect(openFile(w.hr, link.token)).rejects.toThrow(/permission/);
  });

  it("a Word file can only be downloaded, and another company's file does not exist", async () => {
    const w = await world();
    const r = await upload(w, "OFFER_LETTER", {}, { name: "Letter.docx", bytes: docx });
    await expect(issueLink(w.hr, r.version.id, "view")).rejects.toThrow(/downloaded/i);
    const out = await openFile(w.hr, (await issueLink(w.hr, r.version.id, "download")).token);
    expect(out.mime).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const other = await isolatedOrg();
    await expect(issueLink(other.ctx("HR_ADMIN"), r.version.id, "download")).rejects.toThrow(/not found/i);
    await expect(listVersions(other.ctx("HR_ADMIN"), r.document.id)).rejects.toThrow(/not found/i);
  });

  it("refuses to hand over a file whose stored bytes have been altered", async () => {
    const w = await world();
    const r = await upload(w, "OFFER_LETTER");
    const blob = await db.employeeDocumentBlob.findUniqueOrThrow({ where: { versionId: r.version.id } });
    const bad = Buffer.from(blob.data);
    bad[0] ^= 1;
    await db.employeeDocumentBlob.update({ where: { versionId: r.version.id }, data: { data: bad } });
    const link = await issueLink(w.hr, r.version.id, "download");
    await expect(openFile(w.hr, link.token)).rejects.toThrow(/could not be read|altered/i);
  });
});

describe("archiving, never deleting", () => {
  it("hides the document from the register by default, keeps it and its files, and is audited", async () => {
    const w = await world();
    const r = await upload(w, "OFFER_LETTER");
    await expect(archiveDocument(w.t.ctx("AUDITOR"), r.document.id)).rejects.toThrow(/permission/);
    const other = await isolatedOrg();
    await expect(archiveDocument(other.ctx("HR_ADMIN"), r.document.id)).rejects.toThrow(/not found/i);
    await archiveDocument(w.hr, r.document.id, "Superseded by a new contract");
    expect((await listEmployeeDocuments(w.hr, w.emp.id)).map((d) => d.id)).not.toContain(r.document.id);
    expect((await listEmployeeDocuments(w.hr, w.emp.id, { includeArchived: true }))[0]).toMatchObject({ id: r.document.id, status: "ARCHIVED" });
    const row = await db.employeeDocument.findUniqueOrThrow({ where: { id: r.document.id } });
    expect(row).toMatchObject({ status: "ARCHIVED", archivedBy: w.hr.name });
    expect(row.archivedAt).toBeInstanceOf(Date);
    expect(await db.employeeDocumentBlob.count({ where: { versionId: r.version.id } })).toBe(1);
    expect((await db.auditLog.findMany({ where: { organizationId: w.t.org.id, entityId: r.document.id } })).map((x) => x.action)).toContain("DOCUMENT_ARCHIVE");
    await expect(archiveDocument(w.hr, r.document.id)).rejects.toThrow(/already archived/i);
  });
});

describe("when a person's data is erased", () => {
  it("the stored file bytes go with it", async () => {
    const w = await world();
    const r = await upload(w, "OFFER_LETTER");
    expect(await db.employeeDocumentBlob.count({ where: { versionId: r.version.id } })).toBe(1);
    await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.emp.id, new Date()));
    expect(await db.employeeDocumentBlob.count({ where: { versionId: r.version.id } })).toBe(0);
    const v = await db.employeeDocumentVersion.findUniqueOrThrow({ where: { id: r.version.id } });
    expect(v.fileName).not.toContain("Offer");
  });
});

describe("the other places that list a person's documents follow the same rules", () => {
  it("the profile's reference-only table holds only the old reference records, and hides the sensitive kinds from those who may not see them", async () => {
    const w = await world();
    const e = await upload(w, "OFFER_LETTER");
    const sens = await upload(w, "NATIONAL_ID", {}, { name: "id.png", bytes: png });
    const oldContract = await db.employeeDocument.create({ data: { organizationId: w.t.org.id, employeeId: w.emp.id, documentType: "EMPLOYMENT_CONTRACT", fileReference: "box 4", uploadedBy: "HR test" } });
    const oldId = await db.employeeDocument.create({ data: { organizationId: w.t.org.id, employeeId: w.emp.id, documentType: "NATIONAL_ID", fileReference: "scan-9.pdf", uploadedBy: "HR test" } });
    const hrView = (await getEmployee(w.hr, w.emp.id))!.documents.map((d) => d.id);
    expect(hrView.sort()).toEqual([oldContract.id, oldId.id].sort()); // not the electronic documents, which are in the register
    expect(hrView).not.toContain(e.document.id);
    expect(hrView).not.toContain(sens.document.id);
    const audView = (await getEmployee(w.t.ctx("AUDITOR"), w.emp.id))!.documents.map((d) => d.id);
    expect(audView).toEqual([oldContract.id]); // the old identification record is sensitive
  });

  it("the HR compliance report names the type, leaves out archived documents and sensitive ones the caller may not see", async () => {
    const w = await world();
    const a = await upload(w, "OFFER_LETTER", { expiryDate: "2031-01-01" });
    await upload(w, "NATIONAL_ID", {}, { name: "id.png", bytes: png });
    const gone = await upload(w, "TRAINING_CERTIFICATE", {}, { name: "t.pdf", bytes: pdf("t") });
    await archiveDocument(w.hr, gone.document.id);
    const hrRows = await documentsReport(w.hr);
    expect(hrRows.map((r) => r.documentType).sort()).toEqual(["National identification", "Offer letter"]);
    const audRows = await documentsReport(w.t.ctx("AUDITOR"));
    expect(audRows.map((r) => r.documentType)).toEqual(["Offer letter"]);
    expect(JSON.stringify(audRows)).not.toContain("id.png");
    expect(a.document.id).toBeTruthy();
  });

  it("an archived document no longer counts as expiring, and the digest names the type", async () => {
    const w = await world();
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const keep = await upload(w, "LICENCE", { expiryDate: soon }, { name: "l.pdf", bytes: pdf("l") });
    const drop = await upload(w, "PROFESSIONAL_CERTIFICATE", { expiryDate: soon }, { name: "p.pdf", bytes: pdf("p") });
    await archiveDocument(w.hr, drop.document.id);
    const text = JSON.stringify((await buildHrDigest(w.t.org.id)).sections);
    expect(text.toLowerCase()).toContain("licence expires");
    expect(text.toLowerCase()).not.toContain("professional certificate");
    expect((await hrOverview(w.hr)).expiringDocuments).toBe(1);
    expect(keep.document.id).toBeTruthy();
  });
});
