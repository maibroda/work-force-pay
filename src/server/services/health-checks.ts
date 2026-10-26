/**
 * The Payroll Health Check: a limited review of a prospect's payroll process against a standard checklist. The assessor answers each control
 * (seen in place, in part, not seen, does not apply) with the evidence behind the answer, records a finding for every gap, and sends the check for
 * review; a second person (never the assessor) reviews and issues it, and from then on it cannot change. The summary is one page of process
 * evidence with the disclaimer that this is a limited review and detailed reviews are separately scoped. It lives in the bureau's own
 * organization and holds no client payroll data.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { AREAS, blockers, RESPONSES, SEVERITIES, summarise, TEMPLATE, TEMPLATE_VERSION, type Area, type FindingFacts, type ItemFacts, type Response, type Severity } from "@/lib/health-check";
import { summaryPdf, type SummaryDoc } from "@/lib/health-check-pdf";
import { findForbiddenClaims } from "@/lib/pricing";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { crmAvailable } from "./crm";
import { nextNumber } from "./numbering";

async function requireBureau(ctx: Ctx, permission: "healthcheck.view" | "healthcheck.manage") {
  assertCan(ctx, permission);
  if (ctx.homeOrgId) throw new BusinessError("Health checks belong to the bureau's own organization. Go back to the bureau first.");
  if (!(await crmAvailable(ctx))) throw new BusinessError("Health checks belong to a payroll bureau.");
}

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

/** The words that go on the summary can't promise a result. */
function assertNoPromises(label: string, text: string | undefined) {
  const found = findForbiddenClaims(text);
  if (found.length) throw new BusinessError(`${label} makes a promise a health check can't make (${found.join(", ")}). Say what was seen and what was not.`);
}

// ─────────────────────────────── Starting a check ───────────────────────────────

export const checkSchema = z.object({
  title: z.string().trim().min(3).max(120).default("Payroll Health Check"),
  scopeNote: opt,
  periodReviewed: opt,
  employeesInScope: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(1_000_000).optional()),
  feeQuoted: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().min(0).max(1_000_000_000).optional()),
  conductedOn: opt,
});

export async function createHealthCheck(ctx: Ctx, leadId: string, raw: z.input<typeof checkSchema>) {
  await requireBureau(ctx, "healthcheck.manage");
  const v = checkSchema.parse(raw);
  assertNoPromises("The scope", v.scopeNote);
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: ctx.orgId } });
  if (!lead) throw new BusinessError("Lead not found.");
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "HEALTH_CHECK");
    const check = await tx.healthCheck.create({
      data: { organizationId: ctx.orgId, leadId, number, title: v.title, scopeNote: v.scopeNote, periodReviewed: v.periodReviewed, employeesInScope: v.employeesInScope, feeQuoted: v.feeQuoted, conductedOn: v.conductedOn ? new Date(`${v.conductedOn}T00:00:00Z`) : null, templateVersion: TEMPLATE_VERSION, assessedBy: ctx.name, assessedByUserId: ctx.userId },
    });
    await tx.healthCheckItem.createMany({ data: TEMPLATE.map((t, i) => ({ organizationId: ctx.orgId, checkId: check.id, code: t.code, area: t.area, position: i + 1, question: t.question, guidance: t.guidance })) });
    await logAudit(ctx, { action: "HEALTH_CHECK_CREATE", entity: "HealthCheck", entityId: check.id, newValue: { number, lead: lead.number, template: TEMPLATE_VERSION } }, tx);
    return check;
  });
}

async function load(ctx: Ctx, id: string) {
  const c = await db.healthCheck.findFirst({ where: { id, organizationId: ctx.orgId }, include: { lead: true, items: { orderBy: { position: "asc" } }, findings: { orderBy: { number: "asc" } } } });
  if (!c) throw new BusinessError("Health check not found.");
  return c;
}

const itemFacts = (items: { code: string; area: string; question: string; response: string; evidence: string | null; note: string | null }[]): ItemFacts[] =>
  items.map((i) => ({ code: i.code, area: i.area as Area, question: i.question, response: i.response as Response, evidence: i.evidence, note: i.note }));
const findingFacts = (fs: { number: number; itemCode: string | null; area: string; title: string; severity: string; recommendation: string }[]): FindingFacts[] =>
  fs.map((f) => ({ number: f.number, itemCode: f.itemCode, area: f.area as Area, title: f.title, severity: f.severity as Severity, recommendation: f.recommendation }));

export async function getHealthCheck(ctx: Ctx, id: string) {
  await requireBureau(ctx, "healthcheck.view");
  const c = await load(ctx, id);
  const items = itemFacts(c.items);
  const findings = findingFacts(c.findings);
  return { ...c, summary: summarise(items, findings), blockers: c.status === "IN_PROGRESS" ? blockers(items, findings) : [], mine: c.assessedByUserId === ctx.userId };
}

export async function listHealthChecks(ctx: Ctx, f: { leadId?: string; status?: string } = {}) {
  await requireBureau(ctx, "healthcheck.view");
  const rows = await db.healthCheck.findMany({
    where: { organizationId: ctx.orgId, ...(f.leadId ? { leadId: f.leadId } : {}), ...(f.status && ["IN_PROGRESS", "IN_REVIEW", "ISSUED", "WITHDRAWN"].includes(f.status) ? { status: f.status as "IN_PROGRESS" } : {}) },
    include: { lead: { select: { number: true, company: true } }, _count: { select: { findings: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows;
}

async function inProgress(ctx: Ctx, id: string) {
  const c = await load(ctx, id);
  if (c.status !== "IN_PROGRESS") throw new BusinessError(c.status === "IN_REVIEW" ? "This check is with the reviewer. Ask them to send it back to change it." : `This check is ${c.status.toLowerCase().replace("_", " ")} and can't change.`);
  return c;
}

export async function updateHealthCheck(ctx: Ctx, id: string, raw: z.input<typeof checkSchema>) {
  await requireBureau(ctx, "healthcheck.manage");
  await inProgress(ctx, id);
  const v = checkSchema.parse(raw);
  assertNoPromises("The scope", v.scopeNote);
  await db.healthCheck.update({ where: { id }, data: { title: v.title, scopeNote: v.scopeNote ?? null, periodReviewed: v.periodReviewed ?? null, employeesInScope: v.employeesInScope ?? null, feeQuoted: v.feeQuoted ?? null, conductedOn: v.conductedOn ? new Date(`${v.conductedOn}T00:00:00Z`) : null } });
  await logAudit(ctx, { action: "HEALTH_CHECK_UPDATE", entity: "HealthCheck", entityId: id });
}

// ─────────────────────────────── Assessing ───────────────────────────────

export const itemSchema = z.object({ response: z.enum(RESPONSES), evidence: opt, note: opt });

/** Answers one control. What must be written depends on the answer (see RESPONSE_HELP); the database holds the same rule. */
export async function assessItem(ctx: Ctx, itemId: string, raw: z.input<typeof itemSchema>) {
  await requireBureau(ctx, "healthcheck.manage");
  const v = itemSchema.parse(raw);
  const item = await db.healthCheckItem.findFirst({ where: { id: itemId, organizationId: ctx.orgId } });
  if (!item) throw new BusinessError("Control not found.");
  await inProgress(ctx, item.checkId);
  const ev = v.evidence ?? "";
  if ((v.response === "IN_PLACE" || v.response === "PARTLY") && ev.length < 10) throw new BusinessError("Say what you saw that shows it operating (at least 10 characters). A tick without evidence doesn't count.");
  if (v.response === "NOT_SEEN" && ev.length < 5 && (v.note ?? "").length < 5) throw new BusinessError("Say what you asked for and what you were shown.");
  if (v.response === "NOT_APPLICABLE" && (v.note ?? "").length < 5) throw new BusinessError("Say why this control doesn't apply to this business.");
  await db.healthCheckItem.update({ where: { id: itemId }, data: { response: v.response, evidence: v.evidence ?? null, note: v.note ?? null, assessedAt: v.response === "NOT_ASSESSED" ? null : new Date() } });
  await logAudit(ctx, { action: "HEALTH_CHECK_ASSESS", entity: "HealthCheckItem", entityId: itemId, newValue: { code: item.code, response: v.response } });
}

export const findingSchema = z.object({
  itemCode: opt,
  area: z.preprocess((v) => (v === "" ? undefined : v), z.enum(AREAS).optional()),
  title: z.string().trim().min(5, "Give the finding a short title"),
  description: z.string().trim().min(10, "Say what was found"),
  severity: z.enum(SEVERITIES),
  recommendation: z.string().trim().min(10, "Say what should be done about it"),
});

export async function addFinding(ctx: Ctx, checkId: string, raw: z.input<typeof findingSchema>) {
  await requireBureau(ctx, "healthcheck.manage");
  const c = await inProgress(ctx, checkId);
  const v = findingSchema.parse(raw);
  assertNoPromises("The finding", `${v.title} ${v.recommendation}`);
  const item = v.itemCode ? c.items.find((i) => i.code === v.itemCode) : undefined;
  if (v.itemCode && !item) throw new BusinessError(`${v.itemCode} isn't a control on this check.`);
  const area = (item?.area ?? v.area) as Area | undefined;
  if (!area) throw new BusinessError("Say which area this finding is about, or which control.");
  return db.$transaction(async (tx) => {
    const last = await tx.healthCheckFinding.findFirst({ where: { checkId }, orderBy: { number: "desc" }, select: { number: true } });
    const f = await tx.healthCheckFinding.create({ data: { organizationId: ctx.orgId, checkId, number: (last?.number ?? 0) + 1, itemCode: v.itemCode ?? null, area, title: v.title, description: v.description, severity: v.severity, recommendation: v.recommendation, createdBy: ctx.name } });
    await logAudit(ctx, { action: "HEALTH_CHECK_FINDING", entity: "HealthCheckFinding", entityId: f.id, newValue: { check: c.number, number: f.number, severity: v.severity, item: v.itemCode ?? null } }, tx);
    return f;
  });
}

export async function deleteFinding(ctx: Ctx, findingId: string) {
  await requireBureau(ctx, "healthcheck.manage");
  const f = await db.healthCheckFinding.findFirst({ where: { id: findingId, organizationId: ctx.orgId } });
  if (!f) throw new BusinessError("Finding not found.");
  await inProgress(ctx, f.checkId);
  await db.healthCheckFinding.delete({ where: { id: findingId } });
  await logAudit(ctx, { action: "HEALTH_CHECK_FINDING_REMOVE", entity: "HealthCheckFinding", entityId: findingId, oldValue: { number: f.number, title: f.title } });
}

// ─────────────────────────────── Review and issue ───────────────────────────────

export async function submitForReview(ctx: Ctx, id: string) {
  await requireBureau(ctx, "healthcheck.manage");
  const c = await inProgress(ctx, id);
  const problems = blockers(itemFacts(c.items), findingFacts(c.findings));
  if (problems.length) throw new BusinessError(`It isn't ready for review: ${problems.slice(0, 4).join(" ")}${problems.length > 4 ? ` (and ${problems.length - 4} more)` : ""}`);
  await db.healthCheck.update({ where: { id }, data: { status: "IN_REVIEW", submittedAt: new Date(), conductedOn: c.conductedOn ?? new Date(`${iso(new Date())}T00:00:00Z`) } });
  await logAudit(ctx, { action: "HEALTH_CHECK_SUBMIT", entity: "HealthCheck", entityId: id, newValue: { number: c.number, findings: c.findings.length } });
}

export async function sendBack(ctx: Ctx, id: string, note: string) {
  await requireBureau(ctx, "healthcheck.manage");
  const c = await load(ctx, id);
  if (c.status !== "IN_REVIEW") throw new BusinessError("Only a check in review can be sent back.");
  if (!note || note.trim().length < 5) throw new BusinessError("Say what needs another look (at least 5 characters).");
  await db.healthCheck.update({ where: { id }, data: { status: "IN_PROGRESS", submittedAt: null, reviewNote: note.trim() } });
  await logAudit(ctx, { action: "HEALTH_CHECK_SEND_BACK", entity: "HealthCheck", entityId: id, newValue: { number: c.number }, reason: note });
}

export const issueSchema = z.object({ headline: opt, reviewNote: opt });

/** The reviewer, who must be someone other than the assessor, issues it: it is then frozen and the summary is final. */
export async function issueHealthCheck(ctx: Ctx, id: string, raw: z.input<typeof issueSchema> = {}) {
  await requireBureau(ctx, "healthcheck.manage");
  const v = issueSchema.parse(raw);
  const c = await load(ctx, id);
  if (c.status !== "IN_REVIEW") throw new BusinessError(c.status === "ISSUED" ? "This check has already been issued." : "A check is sent for review before it is issued.");
  if (c.assessedByUserId === ctx.userId) throw new BusinessError("You carried out this check, so someone else has to review and issue it.");
  assertNoPromises("The overall observation", v.headline);
  const problems = blockers(itemFacts(c.items), findingFacts(c.findings));
  if (problems.length) throw new BusinessError(`It can't be issued: ${problems[0]}`);
  const now = new Date();
  await db.healthCheck.update({ where: { id }, data: { status: "ISSUED", reviewedBy: ctx.name, reviewedByUserId: ctx.userId, reviewedAt: now, issuedAt: now, reviewNote: v.reviewNote ?? null, headline: v.headline ?? null } });
  await logAudit(ctx, { action: "HEALTH_CHECK_ISSUE", entity: "HealthCheck", entityId: id, newValue: { number: c.number, assessedBy: c.assessedBy, findings: c.findings.length }, reason: v.reviewNote });
}

export async function withdrawHealthCheck(ctx: Ctx, id: string, reason: string) {
  await requireBureau(ctx, "healthcheck.manage");
  const c = await load(ctx, id);
  if (c.status === "ISSUED" || c.status === "WITHDRAWN") throw new BusinessError(`This check is already ${c.status.toLowerCase()}.`);
  if (!reason || reason.trim().length < 5) throw new BusinessError("Say why it is being withdrawn (at least 5 characters).");
  await db.healthCheck.update({ where: { id }, data: { status: "WITHDRAWN", withdrawnReason: reason.trim() } });
  await logAudit(ctx, { action: "HEALTH_CHECK_WITHDRAW", entity: "HealthCheck", entityId: id, newValue: { number: c.number }, reason });
}

// ─────────────────────────────── The summary ───────────────────────────────

/** The one-page summary. An unissued check is stamped as a draft. Every download is audited. */
export async function summaryFile(ctx: Ctx, id: string) {
  await requireBureau(ctx, "healthcheck.view");
  const c = await load(ctx, id);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const doc: SummaryDoc = {
    bureauName: org.name,
    number: c.number,
    company: c.lead.company,
    contact: c.lead.contactName,
    title: c.title,
    issuedOn: c.issuedAt ? iso(c.issuedAt) : null,
    conductedOn: c.conductedOn ? iso(c.conductedOn) : null,
    periodReviewed: c.periodReviewed,
    employeesInScope: c.employeesInScope,
    scopeNote: c.scopeNote,
    assessedBy: c.assessedBy,
    reviewedBy: c.reviewedBy,
    headline: c.headline,
    items: itemFacts(c.items),
    findings: findingFacts(c.findings),
    draft: c.status !== "ISSUED",
  };
  const r = await summaryPdf(doc);
  await logAudit(ctx, { action: "HEALTH_CHECK_SUMMARY_DOWNLOAD", entity: "HealthCheck", entityId: id, newValue: { number: c.number, status: c.status, fee: c.feeQuoted ? num(c.feeQuoted) : null } });
  return { bytes: r.bytes, shown: r.shown, total: r.total, fileName: `${c.number}-health-check-${c.lead.company.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.pdf` };
}
