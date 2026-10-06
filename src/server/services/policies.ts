/**
 * Company policies and acknowledgements.
 *
 * HR publishes a policy to everyone or one category. Its wording lives in numbered versions that are
 * never edited; a new version means everyone acknowledges again. Employees acknowledge the current
 * version themselves (or HR records a paper sign-off), and HR sees who hasn't, with a grace period from
 * the later of the version taking effect and the employee joining. Which version is "current" is worked
 * out from effective dates, so a future-dated version can be scheduled without anyone being chased early.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { ackDueDate, ackState, appliesTo, currentVersion, scheduledVersion, type AckState } from "@/lib/policies";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { todayUtc } from "./hr-policy";

const GONE = ["EXITED", "TERMINATED", "RESIGNED"] as const;

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

// ───────────────────────────── Writing ─────────────────────────────

const content = {
  body: opt,
  documentReference: opt,
  effectiveDate: opt,
};

export const policySchema = z.object({
  title: z.string().trim().min(3, "Name the policy"),
  summary: opt,
  categoryId: opt,
  graceDays: z.coerce.number().int().min(0).max(365).default(14),
  ...content,
});

export const versionSchema = z.object({
  ...content,
  changeSummary: z.string().trim().min(5, "Say what changed, so people know why they're asked again"),
});

function checkContent(v: { body?: string; documentReference?: string }) {
  if (!v.body && !v.documentReference) throw new BusinessError("Give the policy's text, a document reference, or both — employees need something to read.");
}

async function checkCategory(ctx: Ctx, categoryId?: string) {
  if (categoryId && !(await db.employeeCategory.findFirst({ where: { id: categoryId, organizationId: ctx.orgId } }))) throw new BusinessError("Employee category not found.");
}

export async function createPolicy(ctx: Ctx, raw: z.input<typeof policySchema>) {
  assertCan(ctx, "hr.configure");
  const v = policySchema.parse(raw);
  checkContent(v);
  await checkCategory(ctx, v.categoryId);
  if (await db.companyPolicy.findFirst({ where: { organizationId: ctx.orgId, title: { equals: v.title, mode: "insensitive" } } }))
    throw new BusinessError(`There is already a policy called "${v.title}".`);
  const effective = v.effectiveDate ? d(v.effectiveDate) : todayUtc();
  if (Number.isNaN(effective.getTime())) throw new BusinessError("That effective date isn't valid.");
  return db.$transaction(async (tx) => {
    const p = await tx.companyPolicy.create({
      data: {
        organizationId: ctx.orgId,
        title: v.title,
        summary: v.summary ?? null,
        categoryId: v.categoryId ?? null,
        graceDays: v.graceDays,
        createdBy: ctx.name,
        versions: { create: { organizationId: ctx.orgId, version: 1, effectiveDate: effective, body: v.body ?? null, documentReference: v.documentReference ?? null, publishedBy: ctx.name } },
      },
    });
    await logAudit(ctx, { action: "POLICY_CREATE", entity: "CompanyPolicy", entityId: p.id, newValue: { title: p.title, effective: iso(effective) } }, tx);
    return p;
  });
}

export async function updatePolicy(ctx: Ctx, id: string, raw: Partial<Pick<z.input<typeof policySchema>, "title" | "summary" | "categoryId" | "graceDays">>) {
  assertCan(ctx, "hr.configure");
  const old = await db.companyPolicy.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Policy not found.");
  const v = policySchema.pick({ title: true, summary: true, categoryId: true, graceDays: true }).partial().parse(raw);
  await checkCategory(ctx, v.categoryId);
  if (v.title && v.title.toLowerCase() !== old.title.toLowerCase() && (await db.companyPolicy.findFirst({ where: { organizationId: ctx.orgId, id: { not: id }, title: { equals: v.title, mode: "insensitive" } } })))
    throw new BusinessError(`There is already a policy called "${v.title}".`);
  const u = await db.companyPolicy.update({
    where: { id },
    data: {
      ...(v.title ? { title: v.title } : {}),
      ...("summary" in raw ? { summary: v.summary ?? null } : {}),
      ...("categoryId" in raw ? { categoryId: v.categoryId ?? null } : {}),
      ...(v.graceDays !== undefined ? { graceDays: v.graceDays } : {}),
    },
  });
  await logAudit(ctx, { action: "POLICY_UPDATE", entity: "CompanyPolicy", entityId: id, oldValue: old, newValue: u });
  return u;
}

export async function setPolicyStatus(ctx: Ctx, id: string, status: "ACTIVE" | "ARCHIVED") {
  assertCan(ctx, "hr.configure");
  const p = await db.companyPolicy.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!p) throw new BusinessError("Policy not found.");
  if (p.status === status) throw new BusinessError(`This policy is already ${status.toLowerCase()}.`);
  const u = await db.companyPolicy.update({ where: { id }, data: { status } });
  await logAudit(ctx, { action: status === "ARCHIVED" ? "POLICY_ARCHIVE" : "POLICY_RESTORE", entity: "CompanyPolicy", entityId: id });
  return u;
}

/** A new wording. Everyone applicable has to acknowledge it again, from its effective date. */
export async function publishVersion(ctx: Ctx, policyId: string, raw: z.input<typeof versionSchema>) {
  assertCan(ctx, "hr.configure");
  const p = await db.companyPolicy.findFirst({ where: { id: policyId, organizationId: ctx.orgId }, include: { versions: true } });
  if (!p) throw new BusinessError("Policy not found.");
  if (p.status === "ARCHIVED") throw new BusinessError("This policy is archived — restore it before publishing a new version.");
  const v = versionSchema.parse(raw);
  checkContent(v);
  const effective = v.effectiveDate ? d(v.effectiveDate) : todayUtc();
  if (Number.isNaN(effective.getTime())) throw new BusinessError("That effective date isn't valid.");
  const last = p.versions.reduce((a, x) => (x.version > a.version ? x : a));
  if (effective < last.effectiveDate) throw new BusinessError(`A new version can't take effect before version ${last.version} did (${iso(last.effectiveDate)}).`);
  const ver = await db.policyVersion.create({
    data: { organizationId: ctx.orgId, policyId, version: last.version + 1, effectiveDate: effective, body: v.body ?? null, documentReference: v.documentReference ?? null, changeSummary: v.changeSummary, publishedBy: ctx.name },
  });
  await logAudit(ctx, { action: "POLICY_PUBLISH", entity: "CompanyPolicy", entityId: policyId, newValue: { version: ver.version, effective: iso(effective) }, reason: v.changeSummary });
  return ver;
}

// ───────────────────────────── Compliance ─────────────────────────────

export interface PolicyRow {
  employee: { id: string; employeeNumber: string; firstName: string; middleName: string | null; lastName: string; categoryId: string; employmentDate: Date; category: { name: string } };
  state: AckState;
  due: Date;
  acknowledgedAt: Date | null;
  method: "SELF" | "RECORDED" | null;
  note: string | null;
}

/** Every active policy, its current version, and where each applicable employee stands. No permission check — the digest runs as the system. */
export async function policyCompliance(orgId: string, today = todayUtc(), policyId?: string) {
  const [policies, emps] = await Promise.all([
    db.companyPolicy.findMany({ where: { organizationId: orgId, ...(policyId ? { id: policyId } : { status: "ACTIVE" }) }, include: { versions: true, category: { select: { name: true } } }, orderBy: { title: "asc" } }),
    db.employee.findMany({
      where: { organizationId: orgId, status: { notIn: [...GONE] } },
      select: { id: true, employeeNumber: true, firstName: true, middleName: true, lastName: true, categoryId: true, employmentDate: true, category: { select: { name: true } } },
      orderBy: { employeeNumber: "asc" },
    }),
  ]);
  const currents = policies.map((p) => ({ p, current: currentVersion(p.versions, today), scheduled: scheduledVersion(p.versions, today) }));
  const acks = await db.policyAcknowledgement.findMany({ where: { organizationId: orgId, versionId: { in: currents.flatMap((c) => (c.current ? [c.current.id] : [])) } } });
  return currents.map(({ p, current, scheduled }) => {
    const rows: PolicyRow[] = current
      ? emps
          .filter((e) => appliesTo(p, e.categoryId))
          .map((e) => {
            const a = acks.find((x) => x.versionId === current.id && x.employeeId === e.id);
            const due = ackDueDate(current.effectiveDate, e.employmentDate, p.graceDays);
            return { employee: e, state: ackState(Boolean(a), due, today), due, acknowledgedAt: a?.acknowledgedAt ?? null, method: a?.method ?? null, note: a?.note ?? null };
          })
      : [];
    const count = (s: AckState) => rows.filter((r) => r.state === s).length;
    return { policy: p, current, scheduled, rows, totals: { applicable: rows.length, acknowledged: count("ACKNOWLEDGED"), pending: count("PENDING"), overdue: count("OVERDUE") } };
  });
}

export async function listPolicies(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const active = await policyCompliance(ctx.orgId);
  const archived = await db.companyPolicy.findMany({ where: { organizationId: ctx.orgId, status: "ARCHIVED" }, include: { versions: true, category: { select: { name: true } } }, orderBy: { title: "asc" } });
  return { active, archived };
}

export async function getPolicy(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.view");
  const [c] = await policyCompliance(ctx.orgId, todayUtc(), id);
  if (!c) return null;
  const versions = [...c.policy.versions].sort((a, b) => b.version - a.version);
  return { ...c, versions };
}

// ───────────────────────────── Acknowledging ─────────────────────────────

async function applicable(ctx: Ctx, policyId: string, employeeId: string) {
  const [p, e] = await Promise.all([
    db.companyPolicy.findFirst({ where: { id: policyId, organizationId: ctx.orgId }, include: { versions: true } }),
    db.employee.findFirst({ where: { id: employeeId, organizationId: ctx.orgId } }),
  ]);
  if (!p) throw new BusinessError("Policy not found.");
  if (!e) throw new BusinessError("Employee not found.");
  if (p.status === "ARCHIVED") throw new BusinessError("This policy is archived.");
  if ((GONE as readonly string[]).includes(e.status)) throw new BusinessError("This employee has left.");
  if (!appliesTo(p, e.categoryId)) throw new BusinessError("This policy doesn't apply to this employee's category.");
  const current = currentVersion(p.versions, todayUtc());
  if (!current) throw new BusinessError("This policy hasn't taken effect yet.");
  return { p, e, current };
}

async function insertAck(data: Prisma.PolicyAcknowledgementUncheckedCreateInput) {
  try {
    return await db.policyAcknowledgement.create({ data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new BusinessError("That has already been acknowledged.");
    throw err;
  }
}

/** The employee acknowledges the current version themselves. */
export async function acknowledge(ctx: Ctx, policyId: string) {
  if (!ctx.employeeId) throw new BusinessError("Your login isn't linked to an employee record, so there's nothing for you to acknowledge.");
  const { p, current } = await applicable(ctx, policyId, ctx.employeeId);
  const a = await insertAck({ organizationId: ctx.orgId, versionId: current.id, employeeId: ctx.employeeId, method: "SELF" });
  await logAudit(ctx, { action: "POLICY_ACK", entity: "CompanyPolicy", entityId: p.id, newValue: { version: current.version, employeeId: ctx.employeeId } });
  return a;
}

/** HR records a paper sign-off on the employee's behalf; a reference to the signed sheet is required. */
export async function recordAcknowledgement(ctx: Ctx, policyId: string, employeeId: string, note: string) {
  assertCan(ctx, "hr.manage");
  if (ctx.employeeId && ctx.employeeId === employeeId) throw new BusinessError("Acknowledge your own policies yourself — HR can't record them for you.");
  if (!note || note.trim().length < 3) throw new BusinessError("Say where the signed sheet is (e.g. the file number).");
  const { p, current } = await applicable(ctx, policyId, employeeId);
  const a = await insertAck({ organizationId: ctx.orgId, versionId: current.id, employeeId, method: "RECORDED", recordedBy: ctx.name, note: note.trim() });
  await logAudit(ctx, { action: "POLICY_ACK_RECORDED", entity: "CompanyPolicy", entityId: p.id, newValue: { version: current.version, employeeId }, reason: note });
  return a;
}

/** What one employee must acknowledge, with the wording — their own view, or HR's view of them. */
async function policiesFor(orgId: string, employeeId: string) {
  const all = await policyCompliance(orgId);
  return all
    .map((c) => ({ c, row: c.rows.find((r) => r.employee.id === employeeId) }))
    .filter((x): x is { c: (typeof all)[number]; row: PolicyRow } => Boolean(x.row && x.c.current))
    .map(({ c, row }) => ({ policy: c.policy, version: c.current!, scheduled: c.scheduled, state: row.state, due: row.due, acknowledgedAt: row.acknowledgedAt, method: row.method }));
}

export async function myPolicies(ctx: Ctx) {
  if (!ctx.employeeId) return [];
  return policiesFor(ctx.orgId, ctx.employeeId);
}

export async function employeePolicies(ctx: Ctx, employeeId: string) {
  assertCan(ctx, "hr.view");
  return policiesFor(ctx.orgId, employeeId);
}

/** Overdue acknowledgements per policy, for the HR digest. */
export async function policyAttention(orgId: string, today: Date) {
  const all = await policyCompliance(orgId, today);
  return all.filter((c) => c.totals.overdue > 0).map((c) => ({ policy: c.policy, overdue: c.totals.overdue, applicable: c.totals.applicable }));
}
