/**
 * Electronic employee documents, part C: the central register, the missing-document tracking, and the employee's own view
 * (the founder's request of 2026-11-07; his answers: a required document counts only when it is Approved, and no requirements are seeded).
 *
 * The register lists every electronic document across the company for anyone with document.view; identification and medical documents are left out unless the
 * caller also holds document.sensitive (in the query itself, so counts and pages are right). Requirements are the company's own list of document types needed of
 * everyone or of one employee category. An employee has a required document only when an approved, unexpired one is on file (src/lib/documents.ts: requirementState).
 * An employee sees their own approved documents here (the file itself opens through the same signed links as for staff: see documents.ts, loadVersion).
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d } from "@/lib/dates";
import { effectiveStatus, requirementState, REQUIREMENT_STATE_LABELS, type DocumentCategory, type DocumentStatus, type RequirementState } from "@/lib/documents";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { workflowActions } from "./documents";

const DAY = 86_400_000;
const startOfDay = (x: Date) => new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
const PREVIEWABLE = ["application/pdf", "image/png", "image/jpeg"];

// ───────────────────────────── Requirements ─────────────────────────────

export async function listRequirements(ctx: Ctx, f: { all?: boolean } = {}) {
  assertCan(ctx, "document.view");
  return db.employeeDocumentRequirement.findMany({
    where: { organizationId: ctx.orgId, ...(f.all ? {} : { active: true }) },
    include: { type: true, category: true },
    orderBy: [{ createdAt: "asc" }],
  });
}

export const requirementSchema = z.object({ typeId: z.string().min(1, "Choose the document type"), categoryId: z.string().optional().transform((v) => (v ? v : undefined)) });

/** A document type the company requires, of everyone or of one employee category. */
export async function addRequirement(ctx: Ctx, raw: z.input<typeof requirementSchema>) {
  assertCan(ctx, "document.configure");
  const v = requirementSchema.parse(raw);
  const type = await db.employeeDocumentType.findFirst({ where: { id: v.typeId, organizationId: ctx.orgId } });
  if (!type) throw new BusinessError("Document type not found.");
  if (v.categoryId && !(await db.employeeCategory.findFirst({ where: { id: v.categoryId, organizationId: ctx.orgId } }))) throw new BusinessError("Employee category not found.");
  if (await db.employeeDocumentRequirement.findFirst({ where: { organizationId: ctx.orgId, typeId: v.typeId, categoryId: v.categoryId ?? null } }))
    throw new BusinessError("That requirement already exists (if it is switched off, switch it back on).");
  const row = await db.employeeDocumentRequirement.create({ data: { organizationId: ctx.orgId, typeId: v.typeId, categoryId: v.categoryId ?? null, createdBy: ctx.name } });
  await logAudit(ctx, { action: "DOCUMENT_REQUIREMENT_ADD", entity: "EmployeeDocumentRequirement", entityId: row.id, newValue: { typeId: row.typeId, categoryId: row.categoryId } });
  return row;
}

/** Requirements are switched on and off, never deleted. */
export async function setRequirementActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "document.configure");
  const r = await db.employeeDocumentRequirement.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Requirement not found.");
  const row = await db.employeeDocumentRequirement.update({ where: { id }, data: { active } });
  await logAudit(ctx, { action: "DOCUMENT_REQUIREMENT_UPDATE", entity: "EmployeeDocumentRequirement", entityId: id, oldValue: { active: r.active }, newValue: { active } });
  return row;
}

// ───────────────────────────── The register ─────────────────────────────

export interface RegisterFilters {
  /** Employee name or number: every word must match. */
  q?: string;
  category?: DocumentCategory;
  /** A stored status, or APPROVED (not expired) / EXPIRED (approved, past its expiry date). */
  status?: DocumentStatus;
  uploadedFrom?: string;
  uploadedTo?: string;
  expiryFrom?: string;
  expiryTo?: string;
  includeArchived?: boolean;
  take?: number;
  skip?: number;
}

/** Identification and medical types are left out of the query for someone without sensitive access, so counts and pages are right. */
const sensitiveWhere = (ctx: Ctx) => (can(ctx.role, "document.sensitive") ? {} : { type: { is: { sensitive: false } } });

const REGISTER_INCLUDE = {
  employee: { select: { id: true, employeeNumber: true, firstName: true, lastName: true } },
  type: true,
  versions: { orderBy: { version: "desc" as const }, select: { id: true, mimeType: true, uploadedByUserId: true } },
} as const;

type RegisterRecord = Awaited<ReturnType<typeof db.employeeDocument.findMany<{ include: typeof REGISTER_INCLUDE }>>>[number];

function registerRow(ctx: Ctx, r: RegisterRecord, today: Date) {
  const status = effectiveStatus(r.status ?? "PENDING", r.expiryDate, today);
  const latest = r.versions[0] ?? null;
  return {
    id: r.id,
    employeeId: r.employeeId,
    employeeNumber: r.employee.employeeNumber,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    typeId: r.typeId,
    name: r.type?.name ?? "Document",
    category: (r.type?.category ?? "COMPLIANCE") as DocumentCategory,
    status,
    requiresApproval: r.type?.requiresApproval ?? null,
    uploadedAt: r.createdAt,
    uploadedBy: r.uploadedBy,
    issueDate: r.issueDate,
    expiryDate: r.expiryDate,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
    submittedAt: r.submittedAt,
    versionCount: r.versions.length,
    current: latest ? { id: latest.id, canPreview: PREVIEWABLE.includes(latest.mimeType) } : null,
    expired: status === "EXPIRED",
    actions: workflowActions(ctx, r, latest?.uploadedByUserId ?? null),
  };
}

/** Search the company's electronic documents: by employee, category, status, upload date and expiry date. */
export async function searchDocuments(ctx: Ctx, f: RegisterFilters = {}) {
  assertCan(ctx, "document.view");
  const today = startOfDay(new Date());
  const and: object[] = [];
  const words = (f.q ?? "").trim().split(/\s+/).filter(Boolean);
  for (const w of words)
    and.push({ employee: { OR: [{ firstName: { contains: w, mode: "insensitive" } }, { lastName: { contains: w, mode: "insensitive" } }, { employeeNumber: { contains: w, mode: "insensitive" } }] } });
  if (f.category) and.push({ type: { is: { category: f.category } } });
  if (f.status === "EXPIRED") and.push({ status: "APPROVED", expiryDate: { lt: today } });
  else if (f.status === "APPROVED") and.push({ status: "APPROVED", OR: [{ expiryDate: null }, { expiryDate: { gte: today } }] });
  else if (f.status) and.push({ status: f.status });
  else if (!f.includeArchived) and.push({ status: { not: "ARCHIVED" } });
  if (f.uploadedFrom) and.push({ createdAt: { gte: d(f.uploadedFrom) } });
  if (f.uploadedTo) and.push({ createdAt: { lt: new Date(d(f.uploadedTo).getTime() + DAY) } }); // the whole of that day
  if (f.expiryFrom) and.push({ expiryDate: { gte: d(f.expiryFrom) } });
  if (f.expiryTo) and.push({ expiryDate: { lte: d(f.expiryTo) } });
  const where = { organizationId: ctx.orgId, typeId: { not: null }, ...sensitiveWhere(ctx), AND: and };
  const take = Math.min(Math.max(f.take ?? 50, 1), 200);
  const [rows, total] = await Promise.all([
    db.employeeDocument.findMany({ where, include: REGISTER_INCLUDE, orderBy: { createdAt: "desc" }, take, skip: Math.max(f.skip ?? 0, 0) }),
    db.employeeDocument.count({ where }),
  ]);
  return { rows: rows.map((r) => registerRow(ctx, r, today)), total };
}

/** Documents waiting for a decision: submitted, or under review. Oldest first. */
export async function awaitingApproval(ctx: Ctx) {
  assertCan(ctx, "document.view");
  const today = startOfDay(new Date());
  const rows = await db.employeeDocument.findMany({
    where: { organizationId: ctx.orgId, typeId: { not: null }, status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, ...sensitiveWhere(ctx) },
    include: REGISTER_INCLUDE,
    orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  return rows.map((r) => registerRow(ctx, r, today));
}

/** Approved documents that expire within the given number of days, and those already expired. Soonest first. */
export async function expiringDocuments(ctx: Ctx, days: number) {
  assertCan(ctx, "document.view");
  const today = startOfDay(new Date());
  const rows = await db.employeeDocument.findMany({
    where: { organizationId: ctx.orgId, typeId: { not: null }, status: "APPROVED", expiryDate: { not: null, lte: new Date(today.getTime() + Math.max(days, 0) * DAY) }, ...sensitiveWhere(ctx) },
    include: REGISTER_INCLUDE,
    orderBy: { expiryDate: "asc" },
    take: 500,
  });
  return rows.map((r) => registerRow(ctx, r, today));
}

// ───────────────────────────── Missing documents ─────────────────────────────

/**
 * For each active requirement, which active employees (and employees on leave) it applies to and what each still lacks. Only an approved, unexpired document counts as
 * on file. A required identification or medical type is left out for someone without sensitive access (whether a person has such a file is itself sensitive).
 */
export async function missingDocuments(ctx: Ctx) {
  assertCan(ctx, "document.view");
  const today = startOfDay(new Date());
  const reqs = (await db.employeeDocumentRequirement.findMany({ where: { organizationId: ctx.orgId, active: true, type: { is: { active: true } } }, include: { type: true } })).filter((r) => !r.type.sensitive || can(ctx.role, "document.sensitive"));
  if (!reqs.length) return { summary: [] as Array<{ typeId: string; typeName: string; required: number; present: number; missing: number }>, rows: [] as MissingRow[] };
  const employees = await db.employee.findMany({
    where: { organizationId: ctx.orgId, status: { in: ["ACTIVE", "ON_LEAVE"] } },
    select: { id: true, employeeNumber: true, firstName: true, lastName: true, categoryId: true },
    orderBy: { employeeNumber: "asc" },
  });
  const typeIds = [...new Set(reqs.map((r) => r.typeId))];
  const docs = await db.employeeDocument.findMany({ where: { organizationId: ctx.orgId, typeId: { in: typeIds } }, select: { employeeId: true, typeId: true, status: true, expiryDate: true } });
  const byKey = new Map<string, Array<{ status: DocumentStatus | null; expiryDate: Date | null }>>();
  for (const x of docs) {
    const k = `${x.employeeId}|${x.typeId}`;
    byKey.set(k, [...(byKey.get(k) ?? []), { status: x.status, expiryDate: x.expiryDate }]);
  }
  const rows: MissingRow[] = [];
  const summary: Array<{ typeId: string; typeName: string; required: number; present: number; missing: number }> = [];
  for (const typeId of typeIds) {
    const forType = reqs.filter((r) => r.typeId === typeId);
    const type = forType[0].type;
    let required = 0;
    let present = 0;
    for (const e of employees) {
      if (!forType.some((r) => r.categoryId === null || r.categoryId === e.categoryId)) continue; // the requirement does not apply to this employee
      required += 1;
      const state = requirementState(byKey.get(`${e.id}|${typeId}`) ?? [], today);
      if (state === "PRESENT") present += 1;
      else rows.push({ employeeId: e.id, employeeNumber: e.employeeNumber, employeeName: `${e.firstName} ${e.lastName}`, typeId, typeName: type.name, category: type.category as DocumentCategory, state, stateLabel: REQUIREMENT_STATE_LABELS[state] });
    }
    summary.push({ typeId, typeName: type.name, required, present, missing: required - present });
  }
  rows.sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber) || a.typeName.localeCompare(b.typeName));
  return { summary: summary.sort((a, b) => a.typeName.localeCompare(b.typeName)), rows: rows.slice(0, 5000) };
}

export interface MissingRow {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  typeId: string;
  typeName: string;
  category: DocumentCategory;
  state: RequirementState;
  stateLabel: string;
}

// ───────────────────────────── The employee's own documents ─────────────────────────────

/** The signed-in employee's own approved documents (an expired one is labelled Expired). Medical included: it is their own. Nothing of anyone else's. */
export async function myDocuments(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  const today = startOfDay(new Date());
  const rows = await db.employeeDocument.findMany({
    where: { organizationId: ctx.orgId, employeeId: ctx.employeeId, typeId: { not: null }, status: "APPROVED" },
    include: { type: true, versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, mimeType: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.type?.name ?? "Document",
    category: (r.type?.category ?? "COMPLIANCE") as DocumentCategory,
    status: effectiveStatus(r.status ?? "APPROVED", r.expiryDate, today),
    issueDate: r.issueDate,
    expiryDate: r.expiryDate,
    approvedOn: r.reviewedAt ?? r.updatedAt,
    current: r.versions[0] ? { id: r.versions[0].id, canPreview: PREVIEWABLE.includes(r.versions[0].mimeType) } : null,
  }));
}
