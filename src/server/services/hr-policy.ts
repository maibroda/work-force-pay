/**
 * HR & lifecycle policy + checklist templates — everything a buyer might want to tune without a
 * code change: probation/notice defaults, alert windows, the end-of-service rules, and the
 * onboarding / exit-clearance steps that get stamped onto each new hire and each approved exit.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { addDays, d } from "@/lib/dates";
import { num } from "@/lib/money";
import type { EosPolicy } from "@/lib/eos";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

// ─────────────────────────────── Default templates ───────────────────────────────

export interface TemplateSeed {
  taskName: string;
  dueOffsetDays: number;
  responsibleRole: string;
  mandatory?: boolean;
  blocksSettlement?: boolean;
  systemKey?: string;
}

export const DEFAULT_ONBOARDING_TEMPLATE: TemplateSeed[] = [
  { taskName: "Offer letter signed", dueOffsetDays: 0, responsibleRole: "HR" },
  { taskName: "Employment contract signed & filed", dueOffsetDays: 0, responsibleRole: "HR" },
  { taskName: "Documents collected (ID, certificates, references)", dueOffsetDays: 7, responsibleRole: "HR" },
  { taskName: "Medical examination", dueOffsetDays: 7, responsibleRole: "HR" },
  { taskName: "Guard / firearms license verified", dueOffsetDays: 7, responsibleRole: "Operations" },
  { taskName: "Uniform & kit issued", dueOffsetDays: 3, responsibleRole: "Operations" },
  { taskName: "ID card issued", dueOffsetDays: 3, responsibleRole: "HR" },
  { taskName: "Induction & orientation training", dueOffsetDays: 14, responsibleRole: "HR" },
  { taskName: "Bank & pension details captured", dueOffsetDays: 7, responsibleRole: "Payroll" },
  { taskName: "Deployed to beat", dueOffsetDays: 14, responsibleRole: "Operations" },
  { taskName: "Probation objectives agreed", dueOffsetDays: 14, responsibleRole: "Line manager", mandatory: false },
];

export const DEFAULT_EXIT_TEMPLATE: TemplateSeed[] = [
  { taskName: "Handover of duties", dueOffsetDays: -3, responsibleRole: "Line manager" },
  { taskName: "Return of uniform & kit", dueOffsetDays: 0, responsibleRole: "Operations" },
  { taskName: "Return of ID card", dueOffsetDays: 0, responsibleRole: "HR" },
  { taskName: "Return of company property / equipment", dueOffsetDays: 0, responsibleRole: "Admin" },
  { taskName: "Outstanding loans & advances reviewed", dueOffsetDays: 0, responsibleRole: "Payroll" },
  { taskName: "System access revoked", dueOffsetDays: 0, responsibleRole: "IT" },
  { taskName: "Exit interview conducted", dueOffsetDays: -2, responsibleRole: "HR" },
  {
    taskName: "Final settlement computed",
    dueOffsetDays: 0,
    responsibleRole: "Payroll",
    blocksSettlement: false,
    systemKey: "FINAL_SETTLEMENT",
  },
  { taskName: "Clearance sign-off", dueOffsetDays: 0, responsibleRole: "HR", blocksSettlement: false },
];

/** Seeds an organization's template once (only when it has none for that kind). */
export async function ensureDefaultTemplates(orgId: string, kind: "ONBOARDING" | "EXIT_CLEARANCE", tx: Tx = db) {
  const count = await tx.checklistTemplateItem.count({ where: { organizationId: orgId, kind } });
  if (count) return;
  const defaults = kind === "ONBOARDING" ? DEFAULT_ONBOARDING_TEMPLATE : DEFAULT_EXIT_TEMPLATE;
  await tx.checklistTemplateItem.createMany({
    data: defaults.map((t, i) => ({
      organizationId: orgId,
      kind,
      taskName: t.taskName,
      dueOffsetDays: t.dueOffsetDays,
      responsibleRole: t.responsibleRole,
      mandatory: t.mandatory ?? true,
      blocksSettlement: t.blocksSettlement ?? true,
      systemKey: t.systemKey ?? null,
      sortOrder: i,
    })),
    skipDuplicates: true,
  });
}

/** Stamps the active onboarding template onto a new hire (steps limited to other categories are skipped). */
export async function instantiateOnboardingTasks(
  ctx: Ctx,
  employee: { id: string; categoryId: string; employmentDate: Date },
  tx: Tx = db,
) {
  await ensureDefaultTemplates(ctx.orgId, "ONBOARDING", tx);
  const items = await tx.checklistTemplateItem.findMany({
    where: {
      organizationId: ctx.orgId,
      kind: "ONBOARDING",
      active: true,
      OR: [{ categoryId: null }, { categoryId: employee.categoryId }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (!items.length) return 0;
  await tx.onboardingTask.createMany({
    data: items.map((t, i) => ({
      organizationId: ctx.orgId,
      employeeId: employee.id,
      taskName: t.taskName,
      dueDate: addDays(employee.employmentDate, t.dueOffsetDays),
      responsibleRole: t.responsibleRole,
      mandatory: t.mandatory,
      sortOrder: i,
    })),
  });
  return items.length;
}

/** Stamps the active exit-clearance template onto an approved exit. */
export async function instantiateExitTasks(
  ctx: Ctx,
  exit: { id: string; lastWorkingDate: Date },
  employee: { categoryId: string },
  tx: Tx = db,
) {
  await ensureDefaultTemplates(ctx.orgId, "EXIT_CLEARANCE", tx);
  const items = await tx.checklistTemplateItem.findMany({
    where: {
      organizationId: ctx.orgId,
      kind: "EXIT_CLEARANCE",
      active: true,
      OR: [{ categoryId: null }, { categoryId: employee.categoryId }],
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (!items.length) return 0;
  await tx.exitTask.createMany({
    data: items.map((t, i) => ({
      organizationId: ctx.orgId,
      exitRecordId: exit.id,
      taskName: t.taskName,
      dueDate: addDays(exit.lastWorkingDate, t.dueOffsetDays),
      responsibleRole: t.responsibleRole,
      mandatory: t.mandatory,
      blocksSettlement: t.blocksSettlement,
      systemKey: t.systemKey,
      sortOrder: i,
    })),
  });
  return items.length;
}

export async function listChecklistTemplates(ctx: Ctx, kind: "ONBOARDING" | "EXIT_CLEARANCE") {
  await ensureDefaultTemplates(ctx.orgId, kind);
  return db.checklistTemplateItem.findMany({
    where: { organizationId: ctx.orgId, kind },
    include: { category: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const templateItemSchema = z.object({
  kind: z.enum(["ONBOARDING", "EXIT_CLEARANCE"]),
  taskName: z.string().trim().min(2, "A task name is required"),
  dueOffsetDays: z.coerce.number().int().min(-365).max(365).default(0),
  responsibleRole: opt,
  mandatory: z.boolean().default(true),
  blocksSettlement: z.boolean().default(true),
  categoryId: opt,
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export async function addTemplateItem(ctx: Ctx, raw: z.input<typeof templateItemSchema>) {
  assertCan(ctx, "hr.configure");
  const v = templateItemSchema.parse(raw);
  await ensureDefaultTemplates(ctx.orgId, v.kind);
  if (v.categoryId) {
    const cat = await db.employeeCategory.findFirst({ where: { id: v.categoryId, organizationId: ctx.orgId } });
    if (!cat) throw new BusinessError("Employee category not found.");
  }
  const dup = await db.checklistTemplateItem.findFirst({
    where: { organizationId: ctx.orgId, kind: v.kind, taskName: v.taskName },
  });
  if (dup) throw new BusinessError(`There is already a step called "${v.taskName}" in this checklist.`);
  const max = await db.checklistTemplateItem.aggregate({
    where: { organizationId: ctx.orgId, kind: v.kind },
    _max: { sortOrder: true },
  });
  const item = await db.checklistTemplateItem.create({
    data: {
      organizationId: ctx.orgId,
      kind: v.kind,
      taskName: v.taskName,
      dueOffsetDays: v.dueOffsetDays,
      responsibleRole: v.responsibleRole ?? null,
      mandatory: v.mandatory,
      blocksSettlement: v.kind === "EXIT_CLEARANCE" ? v.blocksSettlement : false,
      categoryId: v.categoryId ?? null,
      sortOrder: v.sortOrder ?? (max._max.sortOrder ?? -1) + 1,
    },
  });
  await logAudit(ctx, { action: "CHECKLIST_TEMPLATE_ADD", entity: "ChecklistTemplateItem", entityId: item.id, newValue: item });
  return item;
}

export async function updateTemplateItem(
  ctx: Ctx,
  id: string,
  raw: Partial<Pick<z.input<typeof templateItemSchema>, "taskName" | "dueOffsetDays" | "responsibleRole" | "mandatory" | "blocksSettlement" | "sortOrder">> & {
    active?: boolean;
  },
) {
  assertCan(ctx, "hr.configure");
  const old = await db.checklistTemplateItem.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Checklist step not found.");
  const patch = templateItemSchema.partial().extend({ active: z.boolean().optional() }).parse(raw);
  if (patch.taskName && patch.taskName !== old.taskName) {
    const dup = await db.checklistTemplateItem.findFirst({
      where: { organizationId: ctx.orgId, kind: old.kind, taskName: patch.taskName, NOT: { id } },
    });
    if (dup) throw new BusinessError(`There is already a step called "${patch.taskName}" in this checklist.`);
  }
  const item = await db.checklistTemplateItem.update({
    where: { id },
    data: {
      ...(patch.taskName !== undefined ? { taskName: patch.taskName } : {}),
      ...(patch.dueOffsetDays !== undefined ? { dueOffsetDays: patch.dueOffsetDays } : {}),
      ...(patch.responsibleRole !== undefined ? { responsibleRole: patch.responsibleRole } : {}),
      ...(patch.mandatory !== undefined ? { mandatory: patch.mandatory } : {}),
      ...(patch.blocksSettlement !== undefined && old.kind === "EXIT_CLEARANCE"
        ? { blocksSettlement: patch.blocksSettlement }
        : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    },
  });
  await logAudit(ctx, {
    action: "CHECKLIST_TEMPLATE_UPDATE",
    entity: "ChecklistTemplateItem",
    entityId: id,
    oldValue: old,
    newValue: item,
  });
  return item;
}

export async function deleteTemplateItem(ctx: Ctx, id: string) {
  assertCan(ctx, "hr.configure");
  const old = await db.checklistTemplateItem.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Checklist step not found.");
  await db.checklistTemplateItem.delete({ where: { id } });
  await logAudit(ctx, { action: "CHECKLIST_TEMPLATE_DELETE", entity: "ChecklistTemplateItem", entityId: id, oldValue: old });
}

// ─────────────────────────────── Policy ───────────────────────────────

export async function getHrPolicy(orgId: string, tx: Tx = db) {
  return tx.hrPolicy.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId }, update: {} });
}

const EXIT_TYPES = ["RESIGNATION", "TERMINATION", "END_OF_CONTRACT", "RETIREMENT", "ABSCONDMENT", "DECEASED"] as const;
const exitTypes = z.array(z.enum(EXIT_TYPES));
const day = z.coerce.number().int().min(0).max(3650);

export const hrPolicySchema = z
  .object({
    defaultProbationMonths: z.coerce.number().int().min(0).max(24),
    maxProbationMonths: z.coerce.number().int().min(0).max(24),
    defaultNoticeDays: day,
    retirementAge: z.coerce.number().int().min(40).max(80),
    contractAlertDays: day,
    probationAlertDays: day,
    offerValidityDays: z.coerce.number().int().min(1).max(180),
    relationsCaseSlaDays: z.coerce.number().int().min(1).max(365),
    dailyRateDivisor: z.coerce.number().int().min(1).max(31),
    leaveEncashmentEnabled: z.boolean(),
    leaveEncashmentBasis: z.enum(["GROSS", "BASIC"]),
    leaveEncashmentRespectsEligibility: z.boolean(),
    leaveEncashmentMaxDays: z.coerce.number().int().min(0).max(365).nullable(),
    leaveEncashmentTaxable: z.boolean(),
    leaveEncashmentExitTypes: exitTypes,
    gratuityEnabled: z.boolean(),
    gratuityBasis: z.enum(["GROSS", "BASIC"]),
    gratuityMinYears: z.coerce.number().int().min(0).max(50),
    gratuityDaysPerYear: z.coerce.number().min(0).max(365),
    gratuityPartialYears: z.boolean(),
    gratuityTaxable: z.boolean(),
    gratuityExitTypes: exitTypes,
    severanceEnabled: z.boolean(),
    severanceDaysPerYear: z.coerce.number().min(0).max(365),
    severanceTaxable: z.boolean(),
    noticePayEnabled: z.boolean(),
    noticeRecoveryEnabled: z.boolean(),
    noticePayTaxable: z.boolean(),
    loanMaxGrossMultiple: z.coerce.number().min(0).max(36),
    loanMaxDeductionPct: z.coerce.number().int().min(0).max(100),
    advanceMaxGrossPct: z.coerce.number().int().min(0).max(100),
    reminderEmailsEnabled: z.boolean(),
    reminderExtraEmails: z.array(z.string().trim().toLowerCase().email("That isn't a valid email address")).max(20),
    candidateRetentionMonths: z.coerce.number().int().min(0).max(120),
  })
  .partial();

export async function updateHrPolicy(ctx: Ctx, raw: z.input<typeof hrPolicySchema>) {
  assertCan(ctx, "hr.configure");
  const v = hrPolicySchema.parse(raw);
  const old = await getHrPolicy(ctx.orgId);
  const nextMax = v.maxProbationMonths ?? old.maxProbationMonths;
  const nextDefault = v.defaultProbationMonths ?? old.defaultProbationMonths;
  if (nextDefault > nextMax)
    throw new BusinessError("The default probation can't be longer than the maximum probation.");
  const next = await db.hrPolicy.update({ where: { organizationId: ctx.orgId }, data: v });
  await logAudit(ctx, { action: "HR_POLICY_UPDATE", entity: "HrPolicy", entityId: next.id, oldValue: old, newValue: next });
  return next;
}

/** The slice of HrPolicy the settlement calculator needs, with Decimals converted to numbers. */
export function eosPolicyOf(p: Awaited<ReturnType<typeof getHrPolicy>>): EosPolicy {
  return {
    dailyRateDivisor: p.dailyRateDivisor,
    leaveEncashmentEnabled: p.leaveEncashmentEnabled,
    leaveEncashmentBasis: p.leaveEncashmentBasis,
    leaveEncashmentRespectsEligibility: p.leaveEncashmentRespectsEligibility,
    leaveEncashmentMaxDays: p.leaveEncashmentMaxDays,
    leaveEncashmentTaxable: p.leaveEncashmentTaxable,
    leaveEncashmentExitTypes: p.leaveEncashmentExitTypes,
    gratuityEnabled: p.gratuityEnabled,
    gratuityBasis: p.gratuityBasis,
    gratuityMinYears: p.gratuityMinYears,
    gratuityDaysPerYear: num(p.gratuityDaysPerYear),
    gratuityPartialYears: p.gratuityPartialYears,
    gratuityTaxable: p.gratuityTaxable,
    gratuityExitTypes: p.gratuityExitTypes,
    severanceEnabled: p.severanceEnabled,
    severanceDaysPerYear: num(p.severanceDaysPerYear),
    severanceTaxable: p.severanceTaxable,
    noticePayEnabled: p.noticePayEnabled,
    noticeRecoveryEnabled: p.noticeRecoveryEnabled,
    noticePayTaxable: p.noticePayTaxable,
  };
}

export const todayUtc = () => d(new Date().toISOString().slice(0, 10));
