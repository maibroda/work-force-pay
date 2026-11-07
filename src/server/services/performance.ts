/**
 * Job descriptions and KPIs (the founder's plan of 2026-11-06, docs/plans/performance-management-phase1.md).
 *
 * A job description belongs to an employee category and has versions. HR drafts one (appraisal.manage); a SECOND
 * person makes it active (hr.approve, never the drafter), because it drives how people are rated. An active version is
 * never edited: a change is a new draft that starts as a copy, and making it active retires the old one. KPIs are
 * edited only while the job description is a draft. The achievement bands that turn a result into a 1 to 5 score are
 * HR policy data (hr.configure), with the defaults in src/lib/performance.ts.
 *
 * Audit entries carry ids and the names of changed fields, never the text of a description or a target.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { DEFAULT_KPI_BANDS, KPI_DIRECTIONS, KPI_UNITS, parseKpiNumber, validateBands, type KpiBand } from "@/lib/performance";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy } from "./hr-policy";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

/** A target must be an exact number above zero that fits the column (16 digits, 4 of them decimals). */
function checkedTarget(text: string): string {
  const t = String(text ?? "").trim();
  let scaled: bigint;
  try {
    scaled = parseKpiNumber(t);
  } catch (e) {
    throw new BusinessError((e as Error).message);
  }
  if (scaled <= 0n) throw new BusinessError("The target must be above zero.");
  if (scaled > 9_999_999_999_999_999n) throw new BusinessError("The target is too large.");
  return t;
}

// ───────────────────────────── Job descriptions ─────────────────────────────

export const jobDescriptionSchema = z.object({
  categoryId: z.string().min(1, "Choose the employee category"),
  title: z.string().trim().min(3, "Give the job a title"),
  purpose: opt,
  responsibilities: opt,
  /** Start the new draft as a copy of the active version's KPIs. */
  copyFromActive: z.boolean().default(true),
});

async function loadJd(ctx: Ctx, id: string) {
  const jd = await db.jobDescription.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { category: true, kpis: { orderBy: { sortOrder: "asc" } } },
  });
  if (!jd) throw new BusinessError("Job description not found.");
  return jd;
}

export async function listJobDescriptions(ctx: Ctx, f: { categoryId?: string } = {}) {
  assertCan(ctx, "appraisal.view");
  return db.jobDescription.findMany({
    where: { organizationId: ctx.orgId, ...(f.categoryId ? { categoryId: f.categoryId } : {}) },
    include: { category: true, _count: { select: { kpis: true } } },
    orderBy: [{ category: { name: "asc" } }, { version: "desc" }],
  });
}

export async function getJobDescription(ctx: Ctx, id: string) {
  assertCan(ctx, "appraisal.view");
  return loadJd(ctx, id);
}

export async function createJobDescription(ctx: Ctx, raw: z.input<typeof jobDescriptionSchema>) {
  assertCan(ctx, "appraisal.manage");
  const v = jobDescriptionSchema.parse(raw);
  const category = await db.employeeCategory.findFirst({ where: { id: v.categoryId, organizationId: ctx.orgId } });
  if (!category) throw new BusinessError("Employee category not found.");
  if (await db.jobDescription.findFirst({ where: { organizationId: ctx.orgId, categoryId: v.categoryId, status: "DRAFT" } }))
    throw new BusinessError("There is already a draft job description for this category: finish it or discard it first.");
  const latest = await db.jobDescription.findFirst({ where: { organizationId: ctx.orgId, categoryId: v.categoryId }, orderBy: { version: "desc" }, select: { version: true } });
  const active = v.copyFromActive
    ? await db.jobDescription.findFirst({ where: { organizationId: ctx.orgId, categoryId: v.categoryId, status: "ACTIVE" }, include: { kpis: { orderBy: { sortOrder: "asc" } } } })
    : null;
  return db.$transaction(async (tx) => {
    const jd = await tx.jobDescription.create({
      data: {
        organizationId: ctx.orgId,
        categoryId: v.categoryId,
        version: (latest?.version ?? 0) + 1,
        title: v.title,
        purpose: v.purpose ?? null,
        responsibilities: v.responsibilities ?? null,
        draftedBy: ctx.name,
        draftedByUserId: ctx.userId,
        ...(active
          ? {
              kpis: {
                create: active.kpis.map((k) => ({
                  organizationId: ctx.orgId,
                  name: k.name,
                  description: k.description,
                  unit: k.unit,
                  direction: k.direction,
                  target: k.target,
                  weight: k.weight,
                  sortOrder: k.sortOrder,
                })),
              },
            }
          : {}),
      },
    });
    await logAudit(ctx, { action: "JOB_DESCRIPTION_DRAFT", entity: "JobDescription", entityId: jd.id, newValue: { categoryId: v.categoryId, version: jd.version, copiedFrom: active?.id ?? null } }, tx);
    return jd;
  });
}

export const jobDescriptionEditSchema = z.object({ title: z.string().trim().min(3, "Give the job a title").optional(), purpose: opt, responsibilities: opt });

export async function updateJobDescription(ctx: Ctx, id: string, raw: z.input<typeof jobDescriptionEditSchema>) {
  assertCan(ctx, "appraisal.manage");
  const v = jobDescriptionEditSchema.parse(raw);
  const jd = await loadJd(ctx, id);
  if (jd.status !== "DRAFT") throw new BusinessError("Only a draft can be changed: start a new version instead.");
  const data: Record<string, string | null> = {};
  if (v.title !== undefined) data.title = v.title;
  if (raw.purpose !== undefined) data.purpose = v.purpose ?? null;
  if (raw.responsibilities !== undefined) data.responsibilities = v.responsibilities ?? null;
  const u = await db.jobDescription.update({ where: { id }, data });
  await logAudit(ctx, { action: "JOB_DESCRIPTION_UPDATE", entity: "JobDescription", entityId: id, newValue: { fields: Object.keys(data) } });
  return u;
}

export async function discardDraft(ctx: Ctx, id: string) {
  assertCan(ctx, "appraisal.manage");
  const jd = await loadJd(ctx, id);
  if (jd.status !== "DRAFT") throw new BusinessError("Only a draft can be discarded.");
  await db.jobDescription.delete({ where: { id } });
  await logAudit(ctx, { action: "JOB_DESCRIPTION_DISCARD", entity: "JobDescription", entityId: id, newValue: { categoryId: jd.categoryId, version: jd.version } });
}

/** A second person makes a draft active: never the drafter. The version it replaces is retired. */
export async function activateJobDescription(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.approve");
  const jd = await loadJd(ctx, id);
  if (jd.status !== "DRAFT") throw new BusinessError("Only a draft can be made active.");
  if (jd.draftedByUserId === ctx.userId) throw new BusinessError("Someone else has to make this active: you drafted it.");
  return db.$transaction(async (tx) => {
    const old = await tx.jobDescription.findFirst({ where: { organizationId: ctx.orgId, categoryId: jd.categoryId, status: "ACTIVE" }, select: { id: true } });
    if (old) await tx.jobDescription.update({ where: { id: old.id }, data: { status: "RETIRED", retiredAt: new Date() } });
    const u = await tx.jobDescription.update({ where: { id }, data: { status: "ACTIVE", activatedBy: ctx.name, activatedByUserId: ctx.userId, activatedAt: new Date() } });
    await logAudit(ctx, { action: "JOB_DESCRIPTION_ACTIVATE", entity: "JobDescription", entityId: id, newValue: { categoryId: jd.categoryId, version: jd.version, retired: old?.id ?? null } }, tx);
    return u;
  });
}

// ───────────────────────────── KPIs ─────────────────────────────

export const kpiSchema = z.object({
  name: z.string().trim().min(3, "Name the KPI"),
  description: opt,
  unit: z.enum(KPI_UNITS as [string, ...string[]]),
  direction: z.enum(KPI_DIRECTIONS as [string, ...string[]]),
  target: z.union([z.string(), z.number()]).transform((v) => String(v)),
  weight: z.coerce.number().int("The weight must be a whole number").min(1, "The weight must be at least 1").max(1000),
});

async function loadKpi(ctx: Ctx, id: string) {
  const k = await db.kpi.findFirst({ where: { id, organizationId: ctx.orgId }, include: { jobDescription: true } });
  if (!k) throw new BusinessError("KPI not found.");
  return k;
}

async function assertDraft(jd: { status: string }) {
  if (jd.status !== "DRAFT") throw new BusinessError("KPIs can only be changed while the job description is a draft: start a new version.");
}

export async function addKpi(ctx: Ctx, jobDescriptionId: string, raw: z.input<typeof kpiSchema>) {
  assertCan(ctx, "appraisal.manage");
  const v = kpiSchema.parse(raw);
  const jd = await loadJd(ctx, jobDescriptionId);
  await assertDraft(jd);
  const target = checkedTarget(v.target);
  if (jd.kpis.some((k) => k.name.toLowerCase() === v.name.toLowerCase())) throw new BusinessError(`There is already a KPI called "${v.name}" on this job description.`);
  const k = await db.kpi.create({
    data: { organizationId: ctx.orgId, jobDescriptionId, name: v.name, description: v.description ?? null, unit: v.unit as never, direction: v.direction as never, target, weight: v.weight, sortOrder: jd.kpis.length },
  });
  await logAudit(ctx, { action: "KPI_ADD", entity: "Kpi", entityId: k.id, newValue: { jobDescriptionId, unit: v.unit, direction: v.direction, weight: v.weight } });
  return k;
}

export async function updateKpi(ctx: Ctx, id: string, raw: Partial<z.input<typeof kpiSchema>>) {
  assertCan(ctx, "appraisal.manage");
  const v = kpiSchema.partial().parse(raw);
  const k = await loadKpi(ctx, id);
  await assertDraft(k.jobDescription);
  const data: Record<string, unknown> = {};
  if (v.name !== undefined) {
    const clash = await db.kpi.findFirst({ where: { jobDescriptionId: k.jobDescriptionId, id: { not: id }, name: { equals: v.name, mode: "insensitive" } } });
    if (clash) throw new BusinessError(`There is already a KPI called "${v.name}" on this job description.`);
    data.name = v.name;
  }
  if (raw.description !== undefined) data.description = v.description ?? null;
  if (v.unit !== undefined) data.unit = v.unit;
  if (v.direction !== undefined) data.direction = v.direction;
  if (v.target !== undefined) data.target = checkedTarget(v.target);
  if (v.weight !== undefined) data.weight = v.weight;
  const u = await db.kpi.update({ where: { id }, data });
  await logAudit(ctx, { action: "KPI_UPDATE", entity: "Kpi", entityId: id, newValue: { fields: Object.keys(data) } });
  return u;
}

export async function removeKpi(ctx: Ctx, id: string) {
  assertCan(ctx, "appraisal.manage");
  const k = await loadKpi(ctx, id);
  await assertDraft(k.jobDescription);
  await db.kpi.delete({ where: { id } });
  await logAudit(ctx, { action: "KPI_REMOVE", entity: "Kpi", entityId: id, newValue: { jobDescriptionId: k.jobDescriptionId } });
}

// ───────────────────────────── The achievement bands ─────────────────────────────

const bandsSchema = z.array(z.object({ fromBp: z.coerce.number(), score: z.coerce.number() }));

/** The company's bands, or the defaults when it has set none. */
export async function getKpiBands(orgId: string): Promise<KpiBand[]> {
  const row = await db.hrPolicy.findUnique({ where: { organizationId: orgId }, select: { kpiBands: true } });
  const parsed = bandsSchema.safeParse(row?.kpiBands);
  if (!row?.kpiBands || !parsed.success || validateBands(parsed.data).length) return DEFAULT_KPI_BANDS;
  return parsed.data;
}

export async function updateKpiBands(ctx: Ctx, raw: Array<{ fromBp: number; score: number }>) {
  assertCan(ctx, "hr.configure");
  const bands = bandsSchema.parse(raw);
  const problems = validateBands(bands);
  if (problems.length) throw new BusinessError(problems.join(" "));
  await getHrPolicy(ctx.orgId); // makes sure the policy row exists
  await db.hrPolicy.update({ where: { organizationId: ctx.orgId }, data: { kpiBands: bands } });
  await logAudit(ctx, { action: "KPI_BANDS_UPDATE", entity: "HrPolicy", newValue: { bands: bands.length } });
  return bands;
}
