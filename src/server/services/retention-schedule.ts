/**
 * The retention schedule and legal holds (governance step 3a, docs/plans/hr-governance-plan.md section 2.4).
 *
 * The schedule is data: one rule per category of record (how long, counted from what, and what happens), loaded from the founder's defaults the first time it is read, UNVERIFIED until
 * the Company Administrator records that the legal adviser has seen it. Changing a rule clears its verification. Nothing here deletes anything: the three deletions that exist keep using
 * their own HR-policy settings (the schedule shows those next to the rule so the two never disagree silently) and each checks for a live hold before it runs.
 *
 * A legal hold suspends deletion for one person, one category of record, or the whole company. Any HR administrator may place one (waiting for the Company Administrator could let a deletion
 * run in the meantime); only the Company Administrator may release it. Audit carries ids, categories and field names, never a reason or a note.
 */
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import {
  APPLIED_FROM_POLICY,
  DEFAULT_RULES,
  RETENTION_ACTION_LABELS,
  RETENTION_CATEGORIES,
  RETENTION_CATEGORY_LABELS,
  RETENTION_TRIGGER_LABELS,
  HOLD_REASON_MIN,
  checkHoldInput,
  checkRule,
  holdNeedsReview,
  type HoldScope,
  type RetentionAction,
  type RetentionCategory,
  type RetentionTrigger,
} from "@/lib/retention-schedule";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { retentionOverview } from "./employee-retention";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { retentionPreview } from "./retention";
import { categoryHeld } from "./retention-holds";
import { expiredSurveyCount } from "./survey";

const todayIso = () => iso(todayUtc());

/** Loads the founder's defaults for a company that has none yet (or is missing a category). Unverified. Never overwrites a rule. */
async function ensureRules(orgId: string) {
  if ((await db.retentionRule.count({ where: { organizationId: orgId } })) >= RETENTION_CATEGORIES.length) return;
  await db.retentionRule.createMany({
    data: DEFAULT_RULES.map((r) => ({ organizationId: orgId, category: r.category, periodMonths: r.periodMonths, trigger: r.trigger, action: r.action, note: r.note })),
    skipDuplicates: true,
  });
}

function assertCategory(c: string): asserts c is RetentionCategory {
  if (!(RETENTION_CATEGORIES as readonly string[]).includes(c)) throw new BusinessError("Choose a category of record from the list.");
}

export async function getSchedule(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  await ensureRules(ctx.orgId);
  const [rows, policy, holdRows] = await Promise.all([
    db.retentionRule.findMany({ where: { organizationId: ctx.orgId } }),
    getHrPolicy(ctx.orgId),
    db.retentionHold.findMany({
      where: { organizationId: ctx.orgId },
      include: { employee: { select: { employeeNumber: true, firstName: true, lastName: true } } },
      orderBy: [{ releasedAt: { sort: "asc", nulls: "first" } }, { placedAt: "desc" }],
    }),
  ]);
  const byCategory = new Map(rows.map((r) => [r.category as RetentionCategory, r]));
  const today = todayIso();
  // the reason for a hold and the person it covers are legal matters: shown to the roles that may see misconduct records (HR, the auditor, the Company Administrator), not to everyone who may read the schedule
  const seesDetail = can(ctx.role, "discipline.view");
  const rules = RETENTION_CATEGORIES.map((category) => {
    const r = byCategory.get(category)!;
    const setting = APPLIED_FROM_POLICY[category];
    return {
      category,
      label: RETENTION_CATEGORY_LABELS[category],
      periodMonths: r.periodMonths,
      trigger: r.trigger as RetentionTrigger,
      triggerLabel: RETENTION_TRIGGER_LABELS[r.trigger as RetentionTrigger],
      action: r.action as RetentionAction,
      actionLabel: RETENTION_ACTION_LABELS[r.action as RetentionAction],
      note: r.note,
      verified: r.verifiedOn !== null,
      verifiedOn: r.verifiedOn ? iso(r.verifiedOn) : null,
      verifiedBy: r.verifiedBy,
      verifiedNote: r.verifiedNote,
      updatedBy: r.updatedBy,
      /** The HR-policy setting that is actually applied today for this category, if there is one (the other categories are a schedule only). */
      applied: setting ? { setting, value: policy[setting], unit: setting === "employeeRetentionYears" ? ("years" as const) : ("months" as const) } : null,
    };
  });
  const holds = holdRows.map((h) => ({
    id: h.id,
    scope: h.scope as HoldScope,
    employeeId: seesDetail ? h.employeeId : null,
    employeeNumber: seesDetail ? (h.employee?.employeeNumber ?? null) : null,
    employeeName: seesDetail && h.employee ? `${h.employee.firstName} ${h.employee.lastName}` : null,
    category: h.category as RetentionCategory | null,
    reason: seesDetail ? h.reason : null,
    reviewOn: iso(h.reviewOn),
    placedBy: h.placedBy,
    placedAt: h.placedAt,
    released: h.releasedAt !== null,
    releasedAt: h.releasedAt,
    releasedBy: h.releasedBy,
    releaseReason: seesDetail ? h.releaseReason : null,
    needsReview: holdNeedsReview({ releasedAt: h.releasedAt, reviewOn: iso(h.reviewOn) }, today),
  }));
  return { rules, holds, unverified: rules.filter((r) => !r.verified).length };
}

export async function updateRule(ctx: Ctx, category: string, input: { periodMonths: number; trigger: string; action: string; note?: string | null }) {
  assertCan(ctx, "retention.manage");
  assertCategory(category);
  const bad = checkRule(input);
  if (bad) throw new BusinessError(bad);
  await ensureRules(ctx.orgId);
  const before = await db.retentionRule.findUniqueOrThrow({ where: { organizationId_category: { organizationId: ctx.orgId, category } } });
  const note = input.note === undefined ? before.note : input.note?.trim() || null;
  const changed = [
    before.periodMonths !== input.periodMonths && "periodMonths",
    before.trigger !== input.trigger && "trigger",
    before.action !== input.action && "action",
    before.note !== note && "note",
  ].filter(Boolean) as string[];
  await db.retentionRule.update({
    where: { organizationId_category: { organizationId: ctx.orgId, category } },
    data: {
      periodMonths: input.periodMonths,
      trigger: input.trigger as RetentionTrigger,
      action: input.action as RetentionAction,
      note,
      // a changed rule is no longer the one the adviser saw
      verifiedOn: null,
      verifiedBy: null,
      verifiedNote: null,
      updatedByUserId: ctx.userId,
      updatedBy: ctx.name,
    },
  });
  await logAudit(ctx, {
    action: "RETENTION_RULE_CHANGE",
    entity: "RetentionRule",
    entityId: before.id,
    oldValue: { category, periodMonths: before.periodMonths, trigger: before.trigger, action: before.action, verified: before.verifiedOn !== null },
    newValue: { category, periodMonths: input.periodMonths, trigger: input.trigger, action: input.action, verified: false, changed },
  });
}

/** The legal adviser has seen this rule: the day and the adviser's name as given (they are not a user of the system). */
export async function verifyRule(ctx: Ctx, category: string, input: { verifiedBy: string; verifiedOn: string; note?: string | null }) {
  assertCan(ctx, "retention.manage");
  assertCategory(category);
  const by = input.verifiedBy.trim();
  if (by.length < 3) throw new BusinessError("Give the legal adviser's name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.verifiedOn)) throw new BusinessError("Give the day the adviser saw it.");
  if (input.verifiedOn > todayIso()) throw new BusinessError("The day the adviser saw it can't be in the future.");
  await ensureRules(ctx.orgId);
  const r = await db.retentionRule.update({
    where: { organizationId_category: { organizationId: ctx.orgId, category } },
    data: { verifiedOn: d(input.verifiedOn), verifiedBy: by, verifiedNote: input.note?.trim() || null, updatedByUserId: ctx.userId, updatedBy: ctx.name },
  });
  await logAudit(ctx, { action: "RETENTION_RULE_VERIFY", entity: "RetentionRule", entityId: r.id, newValue: { category, verifiedOn: input.verifiedOn } });
}

export async function placeHold(ctx: Ctx, input: { scope: HoldScope; employeeId?: string | null; category?: string | null; reason: string; reviewOn: string }) {
  assertCan(ctx, "hr.manage");
  const bad = checkHoldInput({ ...input, today: todayIso() });
  if (bad) throw new BusinessError(bad);
  if (input.scope === "EMPLOYEE") {
    const e = await db.employee.findFirst({ where: { id: input.employeeId!, organizationId: ctx.orgId }, select: { id: true } });
    if (!e) throw new BusinessError("Employee not found.");
  }
  const h = await db.retentionHold.create({
    data: {
      organizationId: ctx.orgId,
      scope: input.scope,
      employeeId: input.scope === "EMPLOYEE" ? input.employeeId! : null,
      category: input.scope === "CATEGORY" ? (input.category as RetentionCategory) : null,
      reason: input.reason.trim(),
      reviewOn: d(input.reviewOn),
      placedByUserId: ctx.userId,
      placedBy: ctx.name,
    },
  });
  await logAudit(ctx, { action: "RETENTION_HOLD_PLACE", entity: "RetentionHold", entityId: h.id, newValue: { scope: h.scope, employeeId: h.employeeId, category: h.category, reviewOn: input.reviewOn } });
  return h;
}

export async function releaseHold(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "retention.manage");
  if (reason.trim().length < HOLD_REASON_MIN) throw new BusinessError(`Give the reason for releasing the hold (at least ${HOLD_REASON_MIN} characters).`);
  const h = await db.retentionHold.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!h) throw new BusinessError("Hold not found.");
  if (h.releasedAt) throw new BusinessError("This hold is already released.");
  const done = await db.retentionHold.updateMany({
    where: { id, organizationId: ctx.orgId, releasedAt: null },
    data: { releasedAt: new Date(), releasedByUserId: ctx.userId, releasedBy: ctx.name, releaseReason: reason.trim() },
  });
  if (done.count !== 1) throw new BusinessError("This hold is already released.");
  await logAudit(ctx, { action: "RETENTION_HOLD_RELEASE", entity: "RetentionHold", entityId: id, newValue: { scope: h.scope, employeeId: h.employeeId, category: h.category } });
}

/**
 * What is due, as counts. Only three categories can be measured today (the ones the system already applies); the rest say "not measured yet". Counts only: no name, and nothing here
 * deletes anything.
 */
export async function dueView(ctx: Ctx) {
  assertCan(ctx, "hr.view");
  const policy = await getHrPolicy(ctx.orgId);
  const [overview, applicants, surveysDue, applicantsHeld, surveysHeld] = await Promise.all([
    retentionOverview(ctx),
    retentionPreview(ctx),
    expiredSurveyCount(ctx.orgId, policy.surveyRetentionMonths),
    categoryHeld(ctx.orgId, "UNSUCCESSFUL_APPLICANTS"),
    categoryHeld(ctx.orgId, "RAW_SURVEYS"),
  ]);
  const categories = RETENTION_CATEGORIES.map((category) => {
    const base = { category, label: RETENTION_CATEGORY_LABELS[category], measured: false, due: 0, held: 0, off: false };
    if (category === "EMPLOYEE_FILE") return { ...base, measured: true, due: overview.due.length, held: overview.due.filter((x) => x.onHold).length, off: overview.years <= 0 };
    if (category === "UNSUCCESSFUL_APPLICANTS") return { ...base, measured: true, due: applicants.due, held: applicantsHeld ? applicants.due : 0, off: applicants.months <= 0 };
    if (category === "RAW_SURVEYS") return { ...base, measured: true, due: surveysDue, held: surveysHeld ? surveysDue : 0, off: policy.surveyRetentionMonths <= 0 };
    return base;
  });
  return { categories };
}
