/**
 * Training compliance. HR says which courses and certifications are required — of everyone, or of one
 * category — and this measures every current employee against that using the certificates already
 * recorded on them (EmployeeTraining). Nothing here stores a status: it is worked out from the
 * certificates and today's date, so it can never go stale.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { appliesTo, assess, isGap, type Assessment } from "@/lib/training-compliance";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { getHrPolicy, todayUtc } from "./hr-policy";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const GONE = ["EXITED", "TERMINATED", "RESIGNED"] as const;
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// ───────────────────────────── Requirements ─────────────────────────────

export const requirementSchema = z.object({
  courseName: z.string().trim().min(3, "Name the course or certification"),
  description: opt,
  categoryId: opt,
  graceDays: z.coerce.number().int().min(0).max(365).default(30),
});

export async function listRequirements(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  return db.trainingRequirement.findMany({
    where: { organizationId: ctx.orgId },
    include: { category: { select: { id: true, name: true } } },
    orderBy: [{ active: "desc" }, { courseName: "asc" }],
  });
}

/** Rejects a requirement that repeats one already there, or is already covered by an "everyone" one. */
async function checkNotDuplicate(ctx: Ctx, courseName: string, categoryId: string | undefined, exceptId?: string) {
  const same = (await db.trainingRequirement.findMany({ where: { organizationId: ctx.orgId, ...(exceptId ? { id: { not: exceptId } } : {}) } })).filter((r) => norm(r.courseName) === norm(courseName));
  if (same.some((r) => (r.categoryId ?? undefined) === categoryId)) throw new BusinessError(`"${courseName}" is already a requirement${categoryId ? " for that category" : " for everyone"}.`);
  if (categoryId && same.some((r) => r.categoryId === null && r.active)) throw new BusinessError(`"${courseName}" is already required of everyone, which includes that category.`);
}

async function checkCategory(ctx: Ctx, categoryId?: string) {
  if (categoryId && !(await db.employeeCategory.findFirst({ where: { id: categoryId, organizationId: ctx.orgId } }))) throw new BusinessError("Employee category not found.");
}

export async function addRequirement(ctx: Ctx, raw: z.input<typeof requirementSchema>) {
  assertCan(ctx, "hr.configure");
  const v = requirementSchema.parse(raw);
  await checkCategory(ctx, v.categoryId);
  await checkNotDuplicate(ctx, v.courseName, v.categoryId);
  const r = await db.trainingRequirement.create({
    data: { organizationId: ctx.orgId, courseName: v.courseName, description: v.description ?? null, categoryId: v.categoryId ?? null, graceDays: v.graceDays },
  });
  await logAudit(ctx, { action: "TRAINING_REQUIREMENT_ADD", entity: "TrainingRequirement", entityId: r.id, newValue: r });
  return r;
}

export async function updateRequirement(ctx: Ctx, id: string, raw: Partial<z.input<typeof requirementSchema>> & { active?: boolean }) {
  assertCan(ctx, "hr.configure");
  const old = await db.trainingRequirement.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Requirement not found.");
  const v = requirementSchema.partial().parse(raw);
  const next = { courseName: v.courseName ?? old.courseName, categoryId: "categoryId" in raw ? v.categoryId : (old.categoryId ?? undefined) };
  await checkCategory(ctx, next.categoryId);
  if (raw.active !== false) await checkNotDuplicate(ctx, next.courseName, next.categoryId, id);
  const r = await db.trainingRequirement.update({
    where: { id },
    data: {
      courseName: next.courseName,
      categoryId: next.categoryId ?? null,
      ...(v.description !== undefined || "description" in raw ? { description: v.description ?? null } : {}),
      ...(v.graceDays !== undefined ? { graceDays: v.graceDays } : {}),
      ...(raw.active !== undefined ? { active: raw.active } : {}),
    },
  });
  await logAudit(ctx, { action: "TRAINING_REQUIREMENT_UPDATE", entity: "TrainingRequirement", entityId: id, oldValue: old, newValue: r });
  return r;
}

// ───────────────────────────── Compliance ─────────────────────────────

export interface ComplianceItem {
  requirement: { id: string; courseName: string };
  assessment: Assessment;
}

/** Every current employee against every active requirement that applies to them. No permission check — the digest runs as the system. */
export async function complianceFor(orgId: string, today = todayUtc()) {
  const policy = await getHrPolicy(orgId);
  const [requirements, emps, trainings] = await Promise.all([
    db.trainingRequirement.findMany({ where: { organizationId: orgId, active: true }, orderBy: { courseName: "asc" } }),
    db.employee.findMany({
      where: { organizationId: orgId, status: { notIn: [...GONE] } },
      select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, categoryId: true, employmentDate: true, category: { select: { name: true } } },
      orderBy: { employeeNumber: "asc" },
    }),
    db.employeeTraining.findMany({ where: { organizationId: orgId }, select: { employeeId: true, courseName: true, expiryDate: true, status: true } }),
  ]);
  const byEmployee = new Map<string, typeof trainings>();
  for (const t of trainings) byEmployee.set(t.employeeId, [...(byEmployee.get(t.employeeId) ?? []), t]);

  const rows = emps.map((e) => {
    const certs = byEmployee.get(e.id) ?? [];
    const items: ComplianceItem[] = requirements
      .filter((r) => appliesTo(r, e.categoryId))
      .map((r) => ({ requirement: { id: r.id, courseName: r.courseName }, assessment: assess(r, certs, e.employmentDate, today, policy.trainingAlertDays) }));
    return { employee: e, items, gaps: items.filter((i) => isGap(i.assessment.state)).length, compliant: items.every((i) => !isGap(i.assessment.state)) };
  });

  const perRequirement = requirements.map((r) => {
    const mine = rows.flatMap((row) => row.items.filter((i) => i.requirement.id === r.id));
    const count = (s: string) => mine.filter((i) => i.assessment.state === s).length;
    return {
      requirement: r,
      required: mine.length,
      valid: count("VALID"),
      expiring: count("EXPIRING"),
      expired: count("EXPIRED"),
      missing: count("MISSING"),
      grace: count("GRACE"),
    };
  });

  const all = rows.flatMap((r) => r.items);
  return {
    policy,
    requirements,
    rows,
    perRequirement,
    totals: {
      employees: rows.length,
      withRequirements: rows.filter((r) => r.items.length > 0).length,
      compliant: rows.filter((r) => r.items.length > 0 && r.compliant).length,
      withGaps: rows.filter((r) => !r.compliant).length,
      expired: all.filter((i) => i.assessment.state === "EXPIRED").length,
      missing: all.filter((i) => i.assessment.state === "MISSING").length,
      expiring: all.filter((i) => i.assessment.state === "EXPIRING").length,
    },
  };
}

export async function complianceOverview(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  return complianceFor(ctx.orgId);
}

/** One employee's requirements and where each stands, for their page. */
export async function employeeCompliance(ctx: Ctx, employeeId: string) {
  assertCan(ctx, "hr.view");
  const emp = await db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId }, select: { id: true } });
  if (!emp) throw new BusinessError("Employee not found.");
  const all = await complianceFor(ctx.orgId);
  return all.rows.find((r) => r.employee.id === employeeId)?.items ?? [];
}
