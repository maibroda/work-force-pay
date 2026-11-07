/**
 * Electronic employee documents, part A: the store (the founder's request of 2026-11-07; plan: docs/plans/employee-documents.md).
 *
 * A document belongs to one employee and one type. Each file is a VERSION: a replacement adds one and never overwrites, and the earlier ones can be
 * inspected. The bytes are encrypted before they are saved (src/lib/document-crypto.ts) and live in their own table, so listing documents never loads
 * them. Nobody reaches a file except through a short-lived signed link issued after the permission check and checked again when it is used; every
 * link, view and download is audited. Nothing is ever deleted: a document is archived.
 *
 * Identification and medical documents (and the older reference-only records of those kinds) need document.sensitive: without it they are not listed
 * and "do not exist". Every query is scoped to the caller's company. Audit entries carry ids and field names, never a file name or a description.
 *
 * Part B adds the approval workflow: Pending, then Submitted (by someone who manages documents), then Under review (taken by an approver), then Approved or
 * Rejected (a rejection needs a reason). The person who uploaded or submitted a document can never review it. A checklist step (onboarding or exit) linked to
 * a document type follows its document and is completed only by the approved document.
 */
import crypto from "node:crypto";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d } from "@/lib/dates";
import { checkUpload, DOCUMENT_CATEGORIES, effectiveStatus, inlineViewable, LEGACY_TYPES, STANDARD_STEP_LINKS, STANDARD_TYPES, taskStateFromDocument, type DocumentStatus, type FileKind } from "@/lib/documents";
import { decryptBytes, DocumentKeyError, documentKey, encryptBytes, linkSecret, signLink, verifyLink } from "@/lib/document-crypto";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { ensureDefaultTemplates } from "./hr-policy";

export const LINK_SECONDS = 300;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

/** The key, or a plain refusal that says storage is not set up (never the key itself). */
function key() {
  try {
    return documentKey();
  } catch (e) {
    if (e instanceof DocumentKeyError) throw new BusinessError(e.message);
    throw e;
  }
}

// ───────────────────────────── Document types ─────────────────────────────

/** Gives a company the standard types the first time they are needed. Asking again adds nothing. */
export async function ensureDocumentTypes(orgId: string) {
  if (await db.employeeDocumentType.count({ where: { organizationId: orgId } })) return;
  await db.employeeDocumentType.createMany({
    data: STANDARD_TYPES.map((t, i) => ({ organizationId: orgId, code: t.code, name: t.name, category: t.category, hasExpiry: t.hasExpiry, sensitive: t.sensitive, requiresApproval: true, standard: true, sortOrder: i })),
    skipDuplicates: true,
  });
}

export async function listTypes(ctx: Ctx, f: { all?: boolean } = {}) {
  assertCan(ctx, "document.view");
  await ensureDocumentTypes(ctx.orgId);
  return db.employeeDocumentType.findMany({
    where: { organizationId: ctx.orgId, ...(f.all ? {} : { active: true }) },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });
}

export const typeSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  name: z.string().trim().min(3, "Name the document type").max(80),
  requiresApproval: z.boolean().default(true),
  hasExpiry: z.boolean().default(false),
  sensitive: z.boolean().optional(),
});

const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export async function addType(ctx: Ctx, raw: z.input<typeof typeSchema>) {
  assertCan(ctx, "document.configure");
  const v = typeSchema.parse(raw);
  await ensureDocumentTypes(ctx.orgId);
  if (await db.employeeDocumentType.findFirst({ where: { organizationId: ctx.orgId, name: { equals: v.name, mode: "insensitive" } } }))
    throw new BusinessError(`There is already a document type called "${v.name}".`);
  let code = `CUSTOM_${slug(v.name)}`;
  if (await db.employeeDocumentType.findFirst({ where: { organizationId: ctx.orgId, code } })) code = `${code}_${Date.now().toString(36).toUpperCase()}`;
  const sortOrder = await db.employeeDocumentType.count({ where: { organizationId: ctx.orgId } });
  const row = await db.employeeDocumentType.create({
    data: { organizationId: ctx.orgId, category: v.category, code, name: v.name, requiresApproval: v.requiresApproval, hasExpiry: v.hasExpiry, sensitive: v.sensitive ?? (v.category === "IDENTIFICATION" || v.category === "MEDICAL"), standard: false, sortOrder },
  });
  await logAudit(ctx, { action: "DOCUMENT_TYPE_ADD", entity: "EmployeeDocumentType", entityId: row.id, newValue: { category: row.category, requiresApproval: row.requiresApproval, hasExpiry: row.hasExpiry, sensitive: row.sensitive } });
  return row;
}

export const typeEditSchema = z.object({
  name: z.string().trim().min(3, "Name the document type").max(80).optional(),
  requiresApproval: z.boolean().optional(),
  hasExpiry: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** Rename a type or change how it behaves. A standard type keeps its code and category. */
export async function updateType(ctx: Ctx, id: string, raw: z.input<typeof typeEditSchema>) {
  assertCan(ctx, "document.configure");
  const v = typeEditSchema.parse(raw);
  const t = await db.employeeDocumentType.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!t) throw new BusinessError("Document type not found.");
  if (v.name && (await db.employeeDocumentType.findFirst({ where: { organizationId: ctx.orgId, id: { not: id }, name: { equals: v.name, mode: "insensitive" } } })))
    throw new BusinessError(`There is already a document type called "${v.name}".`);
  const data = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
  const row = await db.employeeDocumentType.update({ where: { id }, data });
  await logAudit(ctx, { action: "DOCUMENT_TYPE_UPDATE", entity: "EmployeeDocumentType", entityId: id, newValue: { fields: Object.keys(data) } });
  return row;
}

// ───────────────────────────── Access ─────────────────────────────

/** Whether this caller may see a document of this kind: identification and medical need the sensitive permission. */
function mayOpen(ctx: Ctx, doc: { type: { sensitive: boolean } | null; documentType: string }) {
  const sensitive = doc.type ? doc.type.sensitive : (LEGACY_TYPES[doc.documentType]?.sensitive ?? false);
  return !sensitive || can(ctx.role, "document.sensitive");
}

async function loadDocument(ctx: Ctx, id: string) {
  const doc = await db.employeeDocument.findFirst({ where: { id, organizationId: ctx.orgId }, include: { type: true } });
  // a document the caller may not open is not confirmed to exist
  if (!doc || !mayOpen(ctx, doc)) throw new BusinessError("Document not found.");
  return doc;
}

// ───────────────────────────── Uploading ─────────────────────────────

const fileSchema = z.object({ name: z.string().min(1, "The file has no name"), bytes: z.instanceof(Buffer) });

export const uploadSchema = z.object({
  employeeId: z.string().min(1, "Choose the employee"),
  /** Not needed when the upload is for a checklist step: the step names the type. */
  typeId: z.string().optional(),
  /** Upload for an onboarding or exit checklist step linked to a document type. */
  task: z.object({ kind: z.enum(["ONBOARDING", "EXIT"]), id: z.string().min(1) }).optional(),
  description: opt,
  issueDate: opt,
  expiryDate: opt,
  reference: opt,
  file: fileSchema,
});

function checkedDates(issue?: string, expiry?: string) {
  const i = issue ? d(issue) : null;
  const e = expiry ? d(expiry) : null;
  if ((i && Number.isNaN(i.getTime())) || (e && Number.isNaN(e.getTime()))) throw new BusinessError("One of the dates isn't valid.");
  if (i && e && e < i) throw new BusinessError("The expiry date can't be before the issue date.");
  return { issueDate: i, expiryDate: e };
}

function checkedFile(file: { name: string; bytes: Buffer }) {
  const r = checkUpload(file.name, file.bytes);
  if (!r.ok) throw new BusinessError(r.error);
  return r;
}

/** Stores one file as a new version, encrypted, inside the caller's transaction. */
async function storeVersion(
  ctx: Ctx,
  tx: Pick<typeof db, "employeeDocumentVersion" | "employeeDocumentBlob">,
  documentId: string,
  version: number,
  file: { bytes: Buffer },
  c: { mime: string; safeName: string },
) {
  const id = crypto.randomUUID();
  const enc = encryptBytes(file.bytes, key(), id);
  const v = await tx.employeeDocumentVersion.create({
    data: {
      id,
      organizationId: ctx.orgId,
      documentId,
      version,
      fileName: c.safeName,
      mimeType: c.mime,
      sizeBytes: file.bytes.length,
      sha256: crypto.createHash("sha256").update(file.bytes).digest("hex"),
      uploadedBy: ctx.name,
      uploadedByUserId: ctx.userId,
    },
  });
  await tx.employeeDocumentBlob.create({ data: { versionId: id, organizationId: ctx.orgId, data: new Uint8Array(enc.data), iv: new Uint8Array(enc.iv), authTag: new Uint8Array(enc.tag) } });
  return v;
}

/** A checklist step of this company, with the employee it belongs to and the document type it names. */
async function loadTask(ctx: Ctx, ref: { kind: "ONBOARDING" | "EXIT"; id: string }) {
  if (ref.kind === "ONBOARDING") {
    const t = await db.onboardingTask.findFirst({ where: { id: ref.id, organizationId: ctx.orgId } });
    if (!t) throw new BusinessError("Checklist step not found.");
    return { employeeId: t.employeeId, documentTypeId: t.documentTypeId };
  }
  const t = await db.exitTask.findFirst({ where: { id: ref.id, organizationId: ctx.orgId }, include: { exitRecord: { select: { employeeId: true } } } });
  if (!t) throw new BusinessError("Checklist step not found.");
  return { employeeId: t.exitRecord.employeeId, documentTypeId: t.documentTypeId };
}

export async function uploadDocument(ctx: Ctx, raw: z.input<typeof uploadSchema>) {
  assertCan(ctx, "document.manage");
  const v = uploadSchema.parse(raw);
  await ensureDocumentTypes(ctx.orgId);
  let typeId = v.typeId;
  if (v.task) {
    const step = await loadTask(ctx, v.task);
    if (step.employeeId !== v.employeeId) throw new BusinessError("That checklist step does not belong to this employee.");
    if (!step.documentTypeId) throw new BusinessError("This step is not linked to a document type.");
    typeId = step.documentTypeId;
  }
  if (!typeId) throw new BusinessError("Choose the type of document.");
  const type = await db.employeeDocumentType.findFirst({ where: { id: typeId, organizationId: ctx.orgId } });
  if (!type) throw new BusinessError("Document type not found.");
  if (!type.active) throw new BusinessError("That document type is switched off.");
  if (type.sensitive) assertCan(ctx, "document.sensitive");
  const emp = await db.employee.findFirst({ where: { id: v.employeeId, organizationId: ctx.orgId }, select: { id: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  const dates = checkedDates(v.issueDate, v.expiryDate);
  const c = checkedFile(v.file);
  key(); // storage must be set up before anything is saved
  return db.$transaction(async (tx) => {
    const status: DocumentStatus = type.requiresApproval ? "PENDING" : "APPROVED";
    const document = await tx.employeeDocument.create({
      data: {
        organizationId: ctx.orgId,
        employeeId: emp.id,
        typeId: type.id,
        // the older register's own required columns: a type from its fixed list, and a name for the file
        documentType: "OTHER",
        fileReference: c.safeName,
        documentNumber: v.reference ?? null,
        issueDate: dates.issueDate,
        expiryDate: dates.expiryDate,
        description: v.description ?? null,
        uploadedBy: ctx.name,
        status,
      },
    });
    const version = await storeVersion(ctx, tx, document.id, 1, v.file, c);
    await logAudit(ctx, { action: "DOCUMENT_UPLOAD", entity: "EmployeeDocument", entityId: document.id, newValue: { employeeId: emp.id, typeId: type.id, versionId: version.id, version: 1, sizeBytes: version.sizeBytes, kind: c.kind, status, taskKind: v.task?.kind ?? null, taskId: v.task?.id ?? null } }, tx);
    if (v.task) {
      // the step now follows this document (a type that needs no approval completes it on the spot)
      if (v.task.kind === "ONBOARDING") await tx.onboardingTask.update({ where: { id: v.task.id }, data: { documentId: document.id } });
      else await tx.exitTask.update({ where: { id: v.task.id }, data: { documentId: document.id } });
      await syncTasks(tx, ctx, document);
    }
    return { document, version };
  });
}

export const replaceSchema = z.object({ typeId: opt, file: fileSchema });

/** A replacement is a new version; the earlier ones stay. For a reference-only record it attaches the first file and needs a type. */
export async function replaceDocument(ctx: Ctx, documentId: string, raw: z.input<typeof replaceSchema>) {
  assertCan(ctx, "document.manage");
  const v = replaceSchema.parse(raw);
  const doc = await loadDocument(ctx, documentId);
  if (doc.status === "ARCHIVED") throw new BusinessError("An archived document can't be replaced.");
  let type = doc.type;
  if (!type) {
    if (!v.typeId) throw new BusinessError("Choose the type of this document before attaching a file.");
    type = await db.employeeDocumentType.findFirst({ where: { id: v.typeId, organizationId: ctx.orgId } });
    if (!type) throw new BusinessError("Document type not found.");
    if (!type.active) throw new BusinessError("That document type is switched off.");
  }
  if (type.sensitive) assertCan(ctx, "document.sensitive");
  const c = checkedFile(v.file);
  key();
  return db.$transaction(async (tx) => {
    const latest = await tx.employeeDocumentVersion.findFirst({ where: { documentId, organizationId: ctx.orgId }, orderBy: { version: "desc" } });
    if (latest) await tx.employeeDocumentVersion.update({ where: { id: latest.id }, data: { replacedBy: ctx.name, replacedAt: new Date() } });
    const version = await storeVersion(ctx, tx, documentId, (latest?.version ?? 0) + 1, v.file, c);
    const status: DocumentStatus = type!.requiresApproval ? "PENDING" : "APPROVED";
    // a changed file must be approved again: the workflow starts over
    const document = await tx.employeeDocument.update({
      where: { id: documentId },
      data: { typeId: type!.id, status, fileReference: c.safeName, submittedBy: null, submittedByUserId: null, submittedAt: null, reviewedBy: null, reviewedByUserId: null, reviewStartedAt: null, reviewedAt: null, reviewNote: null },
    });
    await logAudit(ctx, { action: "DOCUMENT_REPLACE", entity: "EmployeeDocument", entityId: documentId, newValue: { versionId: version.id, version: version.version, previousVersionId: latest?.id ?? null, typeId: type!.id, status } }, tx);
    await syncTasks(tx, ctx, document);
    return { document, version };
  });
}

// ───────────────────────────── Reading ─────────────────────────────

/** What the caller may do with a document next, from its status and who they are. Only a guide for the screen: every action checks again on the server. */
function workflowActions(ctx: Ctx, doc: { status: DocumentStatus | null; submittedByUserId: string | null; reviewedByUserId: string | null; typeId: string | null; type: { requiresApproval: boolean } | null }, uploaderUserId: string | null) {
  const own = ctx.userId === uploaderUserId || ctx.userId === doc.submittedByUserId;
  return {
    submit: can(ctx.role, "document.manage") && doc.status === "PENDING" && !!doc.type?.requiresApproval && !!doc.typeId,
    startReview: can(ctx.role, "document.approve") && doc.status === "SUBMITTED" && !own,
    decide: can(ctx.role, "document.approve") && !own && (doc.status === "SUBMITTED" || (doc.status === "UNDER_REVIEW" && doc.reviewedByUserId === ctx.userId)),
  };
}

export async function listEmployeeDocuments(ctx: Ctx, employeeId: string, f: { includeArchived?: boolean } = {}) {
  assertCan(ctx, "document.view");
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId }, select: { id: true } });
  if (!emp) return [];
  const rows = await db.employeeDocument.findMany({
    where: { organizationId: ctx.orgId, employeeId },
    include: {
      type: true,
      versions: { orderBy: { version: "desc" }, select: { id: true, version: true, fileName: true, mimeType: true, sizeBytes: true, uploadedBy: true, uploadedByUserId: true, uploadedAt: true, replacedBy: true, replacedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const today = new Date();
  return rows
    .filter((r) => mayOpen(ctx, r) && (f.includeArchived || r.status !== "ARCHIVED"))
    .map((r) => {
      const referenceOnly = !r.typeId && r.versions.length === 0;
      const legacy = LEGACY_TYPES[r.documentType];
      const latest = r.versions[0] ?? null;
      return {
        id: r.id,
        employeeId: r.employeeId,
        typeId: r.typeId,
        name: r.type?.name ?? legacy?.name ?? "Document",
        category: r.type?.category ?? legacy?.category ?? "COMPLIANCE",
        sensitive: r.type ? r.type.sensitive : (legacy?.sensitive ?? false),
        status: referenceOnly ? ("REFERENCE_ONLY" as const) : effectiveStatus(r.status ?? "PENDING", r.expiryDate, today),
        referenceOnly,
        requiresApproval: r.type?.requiresApproval ?? null,
        submittedBy: r.submittedBy,
        submittedAt: r.submittedAt,
        reviewedBy: r.reviewedBy,
        reviewedAt: r.reviewedAt,
        reviewNote: r.reviewNote,
        // what this caller may do next (the server checks again when they do it)
        actions: workflowActions(ctx, r, r.versions[0]?.uploadedByUserId ?? null),
        reference: r.documentNumber,
        description: r.description,
        issueDate: r.issueDate,
        expiryDate: r.expiryDate,
        uploadedBy: r.uploadedBy,
        uploadedAt: r.createdAt,
        updatedAt: r.updatedAt,
        versionCount: r.versions.length,
        legacyReference: referenceOnly ? r.fileReference : null,
        versions: r.versions.map((v) => ({ id: v.id, version: v.version, fileName: v.fileName, canPreview: ["application/pdf", "image/png", "image/jpeg"].includes(v.mimeType), uploadedBy: v.uploadedBy, uploadedAt: v.uploadedAt, replacedBy: v.replacedBy, replacedAt: v.replacedAt })),
        current: latest ? { id: latest.id, version: latest.version, fileName: latest.fileName, mimeType: latest.mimeType, sizeBytes: latest.sizeBytes, uploadedBy: latest.uploadedBy, uploadedAt: latest.uploadedAt, canPreview: ["application/pdf", "image/png", "image/jpeg"].includes(latest.mimeType) } : null,
      };
    });
}

/** Every version of one document, newest first. */
export async function listVersions(ctx: Ctx, documentId: string) {
  assertCan(ctx, "document.view");
  await loadDocument(ctx, documentId);
  return db.employeeDocumentVersion.findMany({
    where: { documentId, organizationId: ctx.orgId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, fileName: true, mimeType: true, sizeBytes: true, uploadedBy: true, uploadedAt: true, replacedBy: true, replacedAt: true },
  });
}

// ───────────────────────────── The approval workflow ─────────────────────────────

/** Keeps every checklist step that follows this document in line with it: Completed only when the document is approved. */
async function syncTasks(tx: Tx, ctx: Ctx, doc: { id: string; status: DocumentStatus | null; reviewedBy: string | null; reviewNote: string | null }) {
  const state = taskStateFromDocument(doc.status);
  const doneBy = doc.reviewedBy ? `Document approved (${doc.reviewedBy})` : "Document uploaded (no approval required)";
  const note = doc.status === "REJECTED" && doc.reviewNote ? `Document rejected: ${doc.reviewNote}` : null;

  const onboarding = await tx.onboardingTask.findMany({ where: { documentId: doc.id, organizationId: ctx.orgId, status: { not: "NOT_APPLICABLE" } } });
  for (const t of onboarding) {
    if (state === "COMPLETED" && t.status !== "DONE") {
      await tx.onboardingTask.update({ where: { id: t.id }, data: { status: "DONE", completedBy: doneBy, completedAt: new Date(), notes: null } });
      await logAudit(ctx, { action: "ONBOARDING_TASK_DOCUMENT_COMPLETE", entity: "Employee", entityId: t.employeeId, newValue: { taskId: t.id, documentId: doc.id } }, tx);
    } else if (state !== "COMPLETED" && (t.status === "DONE" || t.notes !== note)) {
      await tx.onboardingTask.update({ where: { id: t.id }, data: { status: "PENDING", completedBy: null, completedAt: null, notes: note } });
      if (t.status === "DONE") await logAudit(ctx, { action: "ONBOARDING_TASK_DOCUMENT_REOPEN", entity: "Employee", entityId: t.employeeId, newValue: { taskId: t.id, documentId: doc.id } }, tx);
    }
  }
  const exits = await tx.exitTask.findMany({ where: { documentId: doc.id, organizationId: ctx.orgId, status: { not: "NOT_APPLICABLE" } }, include: { exitRecord: { select: { employeeId: true } } } });
  for (const t of exits) {
    if (state === "COMPLETED" && t.status !== "DONE") {
      await tx.exitTask.update({ where: { id: t.id }, data: { status: "DONE", completedBy: doneBy, completedAt: new Date(), notes: null } });
      await logAudit(ctx, { action: "EXIT_TASK_DOCUMENT_COMPLETE", entity: "Employee", entityId: t.exitRecord.employeeId, newValue: { taskId: t.id, documentId: doc.id } }, tx);
    } else if (state !== "COMPLETED" && (t.status === "DONE" || t.notes !== note)) {
      await tx.exitTask.update({ where: { id: t.id }, data: { status: "PENDING", completedBy: null, completedAt: null, notes: note } });
      if (t.status === "DONE") await logAudit(ctx, { action: "EXIT_TASK_DOCUMENT_REOPEN", entity: "Employee", entityId: t.exitRecord.employeeId, newValue: { taskId: t.id, documentId: doc.id } }, tx);
    }
  }
}

/** A document, with the person who uploaded its latest file (so they can be kept from reviewing it). */
async function loadForWorkflow(ctx: Ctx, id: string) {
  const doc = await loadDocument(ctx, id);
  const latest = await db.employeeDocumentVersion.findFirst({ where: { documentId: id, organizationId: ctx.orgId }, orderBy: { version: "desc" }, select: { uploadedByUserId: true } });
  return { doc, uploaderUserId: latest?.uploadedByUserId ?? null, hasFile: !!latest };
}

/** The person who uploaded or submitted a document is never the one who reviews it. */
function assertNotOwn(ctx: Ctx, doc: { submittedByUserId: string | null }, uploaderUserId: string | null) {
  if (ctx.userId === uploaderUserId || ctx.userId === doc.submittedByUserId) throw new BusinessError("You uploaded or submitted this document: someone else has to review it.");
}

/** Submit a pending document for review. */
export async function submitDocument(ctx: Ctx, id: string) {
  assertCan(ctx, "document.manage");
  const { doc, hasFile } = await loadForWorkflow(ctx, id);
  if (!doc.type) throw new BusinessError("Attach a file and choose the type of this document first.");
  if (!doc.type.requiresApproval) throw new BusinessError("This type of document does not need approval.");
  if (doc.status !== "PENDING") throw new BusinessError("Only a pending document can be submitted for review.");
  if (!hasFile) throw new BusinessError("Upload the file first.");
  return db.$transaction(async (tx) => {
    const u = await tx.employeeDocument.update({ where: { id }, data: { status: "SUBMITTED", submittedBy: ctx.name, submittedByUserId: ctx.userId, submittedAt: new Date(), reviewedBy: null, reviewedByUserId: null, reviewStartedAt: null, reviewedAt: null, reviewNote: null } });
    await logAudit(ctx, { action: "DOCUMENT_SUBMIT", entity: "EmployeeDocument", entityId: id, oldValue: { status: doc.status }, newValue: { status: "SUBMITTED" } }, tx);
    await syncTasks(tx, ctx, u);
    return u;
  });
}

/** A reviewer takes a submitted document: it is now under review, by them. */
export async function startReview(ctx: Ctx, id: string) {
  assertCan(ctx, "document.approve");
  const { doc, uploaderUserId } = await loadForWorkflow(ctx, id);
  if (doc.status !== "SUBMITTED") throw new BusinessError("Only a submitted document can be taken for review.");
  assertNotOwn(ctx, doc, uploaderUserId);
  return db.$transaction(async (tx) => {
    const u = await tx.employeeDocument.update({ where: { id }, data: { status: "UNDER_REVIEW", reviewedBy: ctx.name, reviewedByUserId: ctx.userId, reviewStartedAt: new Date() } });
    await logAudit(ctx, { action: "DOCUMENT_REVIEW_START", entity: "EmployeeDocument", entityId: id, oldValue: { status: doc.status }, newValue: { status: "UNDER_REVIEW" } }, tx);
    await syncTasks(tx, ctx, u);
    return u;
  });
}

/** The checks shared by approving and rejecting: a submitted (or under review by you) document, and not one you uploaded or submitted. */
async function loadForDecision(ctx: Ctx, id: string) {
  assertCan(ctx, "document.approve");
  const { doc, uploaderUserId } = await loadForWorkflow(ctx, id);
  if (doc.status !== "SUBMITTED" && doc.status !== "UNDER_REVIEW") throw new BusinessError("Only a submitted document can be approved or rejected.");
  if (doc.status === "UNDER_REVIEW" && doc.reviewedByUserId !== ctx.userId) throw new BusinessError("Another reviewer has this document under review.");
  assertNotOwn(ctx, doc, uploaderUserId);
  return doc;
}

export async function approveDocument(ctx: Ctx, id: string, note?: string) {
  const doc = await loadForDecision(ctx, id);
  return db.$transaction(async (tx) => {
    const u = await tx.employeeDocument.update({
      where: { id },
      data: { status: "APPROVED", reviewedBy: ctx.name, reviewedByUserId: ctx.userId, reviewStartedAt: doc.reviewStartedAt ?? new Date(), reviewedAt: new Date(), reviewNote: note?.trim() || null },
    });
    await logAudit(ctx, { action: "DOCUMENT_APPROVE", entity: "EmployeeDocument", entityId: id, oldValue: { status: doc.status }, newValue: { status: "APPROVED" } }, tx);
    await syncTasks(tx, ctx, u);
    return u;
  });
}

/** A rejection always has a reason. The document is then replaced and submitted again. */
export async function rejectDocument(ctx: Ctx, id: string, reason: string) {
  const doc = await loadForDecision(ctx, id);
  const why = String(reason ?? "").trim();
  if (why.length < 5) throw new BusinessError("Say why the document is rejected (at least a few words).");
  return db.$transaction(async (tx) => {
    const u = await tx.employeeDocument.update({
      where: { id },
      data: { status: "REJECTED", reviewedBy: ctx.name, reviewedByUserId: ctx.userId, reviewStartedAt: doc.reviewStartedAt ?? new Date(), reviewedAt: new Date(), reviewNote: why },
    });
    await logAudit(ctx, { action: "DOCUMENT_REJECT", entity: "EmployeeDocument", entityId: id, oldValue: { status: doc.status }, newValue: { status: "REJECTED" }, reason: why }, tx);
    await syncTasks(tx, ctx, u);
    return u;
  });
}

// ───────────────────────────── How a step shows its document ─────────────────────────────

/** What a loader adds to an onboarding or exit task so a screen can show the document it follows. */
export const TASK_DOCUMENT_INCLUDE = {
  documentType: { select: { name: true, sensitive: true } },
  document: { select: { id: true, status: true, reviewNote: true, versions: { orderBy: { version: "desc" as const }, take: 1, select: { id: true, mimeType: true } } } },
} as const;

interface TaskWithDocument {
  id: string;
  status: string;
  documentTypeId: string | null;
  documentType: { name: string; sensitive: boolean } | null;
  document: { id: string; status: DocumentStatus | null; reviewNote: string | null; versions: Array<{ id: string; mimeType: string }> } | null;
}

/** The document side of a checklist step, for the caller: null when the step is not linked to a document type. A guide for the screen; the server checks every action. */
export function taskDocumentView(ctx: Ctx, t: TaskWithDocument) {
  if (!t.documentTypeId || !t.documentType) return null;
  const sensitiveOk = !t.documentType.sensitive || can(ctx.role, "document.sensitive");
  const v = t.document?.versions[0];
  return {
    typeName: t.documentType.name,
    state: taskStateFromDocument(t.document?.status ?? null),
    documentId: t.document?.id ?? null,
    note: t.document?.status === "REJECTED" ? t.document.reviewNote : null,
    current: v && sensitiveOk && can(ctx.role, "document.view") ? { id: v.id, canPreview: ["application/pdf", "image/png", "image/jpeg"].includes(v.mimeType) } : null,
    canUpload: can(ctx.role, "document.manage") && sensitiveOk && t.status !== "NOT_APPLICABLE",
  };
}

// ───────────────────────────── Linking checklist steps ─────────────────────────────

/**
 * Links the standard checklist steps that have an obvious document type (see STANDARD_STEP_LINKS) to that type. Only steps with no link yet are
 * linked, so a step an administrator linked by hand is never overridden, and tasks that already exist are not changed (only steps made from now on follow
 * a document). Returns how many steps were linked in each checklist.
 */
export async function linkStandardSteps(ctx: Ctx) {
  assertCan(ctx, "document.configure");
  assertCan(ctx, "hr.configure");
  await ensureDocumentTypes(ctx.orgId);
  const types = await db.employeeDocumentType.findMany({ where: { organizationId: ctx.orgId } });
  const out = { onboarding: 0, exit: 0 };
  for (const kind of ["ONBOARDING", "EXIT_CLEARANCE"] as const) {
    await ensureDefaultTemplates(ctx.orgId, kind);
    const links = STANDARD_STEP_LINKS[kind];
    const steps = await db.checklistTemplateItem.findMany({ where: { organizationId: ctx.orgId, kind, documentTypeId: null, taskName: { in: Object.keys(links) } } });
    for (const step of steps) {
      const type = types.find((t) => t.code === links[step.taskName]);
      if (!type) continue;
      await db.checklistTemplateItem.update({ where: { id: step.id }, data: { documentTypeId: type.id } });
      if (kind === "ONBOARDING") out.onboarding += 1;
      else out.exit += 1;
    }
  }
  await logAudit(ctx, { action: "CHECKLIST_STEPS_LINKED_TO_DOCUMENTS", entity: "ChecklistTemplateItem", newValue: out });
  return out;
}

// ───────────────────────────── Links and files ─────────────────────────────

const kindOfMime = (mime: string): FileKind => (mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpeg" : mime === "application/msword" ? "doc" : "docx");

async function loadVersion(ctx: Ctx, versionId: string) {
  const v = await db.employeeDocumentVersion.findFirst({ where: { id: versionId, organizationId: ctx.orgId }, include: { document: { include: { type: true } } } });
  if (!v || !mayOpen(ctx, v.document)) throw new BusinessError("Document not found.");
  return v;
}

/** A signed link that works for five minutes, for this user only. The permission is checked now and again when the link is used. */
export async function issueLink(ctx: Ctx, versionId: string, mode: "view" | "download", at: number = nowSeconds()) {
  assertCan(ctx, "document.view");
  const v = await loadVersion(ctx, versionId);
  if (mode === "view" && !inlineViewable(kindOfMime(v.mimeType))) throw new BusinessError("This kind of file can only be downloaded, not previewed.");
  const exp = at + LINK_SECONDS;
  const token = signLink({ v: v.id, u: ctx.userId, o: ctx.orgId, m: mode, exp }, linkSecret(key()));
  await logAudit(ctx, { action: "DOCUMENT_LINK_ISSUED", entity: "EmployeeDocument", entityId: v.documentId, newValue: { versionId: v.id, mode } });
  return { token, url: `/api/documents/file?t=${token}`, expiresAt: exp };
}

/** The file behind a link: decrypted, checked against its stored checksum, and the access recorded. */
export async function openFile(ctx: Ctx, token: string, at: number = nowSeconds()) {
  const claims = verifyLink(token, linkSecret(key()), at);
  if (!claims || claims.u !== ctx.userId || claims.o !== ctx.orgId) throw new BusinessError("This download link is not valid or has expired.");
  assertCan(ctx, "document.view");
  const v = await loadVersion(ctx, claims.v);
  const blob = await db.employeeDocumentBlob.findUnique({ where: { versionId: v.id } });
  if (!blob) throw new BusinessError("This file is no longer stored.");
  let bytes: Buffer;
  try {
    bytes = decryptBytes({ data: Buffer.from(blob.data), iv: Buffer.from(blob.iv), tag: Buffer.from(blob.authTag) }, key(), v.id);
  } catch {
    throw new BusinessError("This file could not be read: it may have been altered.");
  }
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== v.sha256) throw new BusinessError("This file could not be read: it may have been altered.");
  await logAudit(ctx, { action: claims.m === "view" ? "DOCUMENT_VIEW" : "DOCUMENT_DOWNLOAD", entity: "EmployeeDocument", entityId: v.documentId, newValue: { versionId: v.id, version: v.version } });
  return { bytes, fileName: v.fileName, mime: v.mimeType, disposition: claims.m === "view" ? ("inline" as const) : ("attachment" as const) };
}

// ───────────────────────────── Archiving ─────────────────────────────

/** A document is never deleted: archiving takes it out of the register but keeps it, its versions and its files. */
export async function archiveDocument(ctx: Ctx, id: string, reason?: string) {
  assertCan(ctx, "document.manage");
  const doc = await loadDocument(ctx, id);
  if (doc.status === "ARCHIVED") throw new BusinessError("This document is already archived.");
  return db.$transaction(async (tx) => {
    const u = await tx.employeeDocument.update({ where: { id }, data: { status: "ARCHIVED", archivedBy: ctx.name, archivedAt: new Date() } });
    await logAudit(ctx, { action: "DOCUMENT_ARCHIVE", entity: "EmployeeDocument", entityId: id, oldValue: { status: doc.status }, newValue: { status: "ARCHIVED" }, reason: reason?.trim() || undefined }, tx);
    await syncTasks(tx, ctx, u);
    return u;
  });
}
