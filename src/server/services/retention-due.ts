/**
 * Measuring what is past, or near, the end of its retention period (governance step 3b, the non-destructive half). READ ONLY: nothing here deletes, anonymises or changes anything.
 *
 * For every category of the schedule the system can work out, it counts what has reached the end of its period (and what will within 90 days), using the company's own rule (period and
 * the day the period is counted from). The three categories the system already applies from the HR policy (the employee file, raw survey answers, unsuccessful applicants) use that
 * setting, as they do when they run. Counts only: no name, no id of a person and no record text leaves this module.
 *
 * Runs without a signed-in user so the HR digest can use it; the screen wraps it with the permission check (retention-schedule.ts).
 */
import { iso } from "@/lib/dates";
import { eraseFrom, LEFT_STATUSES } from "@/lib/employee-retention";
import {
  DEFAULT_RULES,
  RETENTION_ACTION_LABELS,
  RETENTION_CATEGORIES,
  RETENTION_CATEGORY_LABELS,
  RETENTION_TRIGGER_LABELS,
  expiryDay,
  expiryStatus,
  holdBlocks,
  holdBlocksPerson,
  holdNeedsReview,
  SOON_DAYS,
  triggerMeasurable,
  type HoldLike,
  type RetentionAction,
  type RetentionCategory,
  type RetentionTrigger,
} from "@/lib/retention-schedule";
import { db } from "./_base";
import { getHrPolicy, todayUtc } from "./hr-policy";
import { dueCandidateCount } from "./retention";
import { liveHolds } from "./retention-holds";
import { expiredSurveyCount } from "./survey";

export interface DueCategory {
  category: RetentionCategory;
  label: string;
  action: RetentionAction;
  actionLabel: string;
  /** False when the system cannot work this category out (and `reason` says why). */
  measured: boolean;
  reason: string | null;
  /** The period is switched off, or the rule says keep: nothing is ever due. */
  off: boolean;
  /** What is counted: people (former employees holding a record of the kind) or records. */
  unit: "people" | "records";
  /** Past the end of the period, today. */
  due: number;
  /** Reaching the end of the period within the next 90 days; null where the system does not work that out. */
  soon: number | null;
  /** Of `due`, how many a live legal hold covers. */
  held: number;
}

const DAY_MS = 86_400_000;
const dayOf = (d: Date) => iso(d);
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS);
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Former employees (by id) holding at least one record of the kind. Distinct, within the company, never anyone already erased (the caller passes only those). */
async function peopleWith(category: RetentionCategory, orgId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const where = { organizationId: orgId, employeeId: { in: ids } };
  const pick = { employeeId: true } as const;
  const take = (rows: Array<{ employeeId: string }>) => rows.map((r) => r.employeeId);
  switch (category) {
    case "APPRAISALS":
      return take(await db.appraisal.findMany({ where, select: pick, distinct: ["employeeId"] }));
    case "PROBATION":
      return [...new Set([...take(await db.probationDecision.findMany({ where, select: pick, distinct: ["employeeId"] })), ...take(await db.probationReview.findMany({ where, select: pick, distinct: ["employeeId"] }))])];
    case "FEEDBACK":
      return take(await db.performanceFeedback.findMany({ where, select: pick, distinct: ["employeeId"] }));
    case "IMPROVEMENT_PLANS":
      return take(await db.performanceImprovementPlan.findMany({ where, select: pick, distinct: ["employeeId"] }));
    case "DISCIPLINARY":
      return take(await db.disciplinaryRecord.findMany({ where, select: pick, distinct: ["employeeId"] }));
    case "TRAINING":
      return [
        ...new Set([
          ...take(await db.trainingEnrolment.findMany({ where, select: pick, distinct: ["employeeId"] })),
          ...take(await db.trainingRequest.findMany({ where, select: pick, distinct: ["employeeId"] })),
          ...take(await db.trainingNeed.findMany({ where, select: pick, distinct: ["employeeId"] })),
        ]),
      ];
    case "SKILLS":
      return take(await db.skillAssessment.findMany({ where, select: pick, distinct: ["employeeId"] }));
    case "WELFARE_CASES":
      return take(await db.relationsCase.findMany({ where: { ...where, type: "WELFARE" }, select: pick, distinct: ["employeeId"] }));
    case "SUCCESSION":
      return take(await db.successionCandidate.findMany({ where, select: pick, distinct: ["employeeId"] }));
    default:
      return [];
  }
}

/** Individual records with the day their period is counted from, for the categories counted per record rather than per person. */
async function recordsFor(category: RetentionCategory, orgId: string): Promise<Array<{ employeeId: string; base: string }> | null> {
  if (category === "WELFARE_CASES") {
    const rows = await db.relationsCase.findMany({ where: { organizationId: orgId, type: "WELFARE", status: "CLOSED", closedAt: { not: null } }, select: { employeeId: true, closedAt: true } });
    return rows.map((r) => ({ employeeId: r.employeeId, base: dayOf(r.closedAt!) }));
  }
  if (category === "SUCCESSION") {
    const rows = await db.successionCandidate.findMany({ where: { organizationId: orgId }, select: { employeeId: true, updatedAt: true } });
    return rows.map((r) => ({ employeeId: r.employeeId, base: dayOf(r.updatedAt) }));
  }
  return null;
}

/** Everything the schedule can measure, for one company, as of `today`. Read only. */
export async function measureCategories(orgId: string, today: Date = todayUtc()): Promise<DueCategory[]> {
  const todayDay = dayOf(today);
  const [ruleRows, policy, holds, leavers] = await Promise.all([
    db.retentionRule.findMany({ where: { organizationId: orgId } }),
    getHrPolicy(orgId),
    liveHolds(orgId),
    db.employee.findMany({ where: { organizationId: orgId, status: { in: [...LEFT_STATUSES] }, anonymizedAt: null, exitDate: { not: null } }, select: { id: true, exitDate: true } }),
  ]);
  // the company's rule where it has one, otherwise the founder's default (reading never writes)
  const rules = new Map<RetentionCategory, { periodMonths: number; trigger: RetentionTrigger; action: RetentionAction }>(
    DEFAULT_RULES.map((r) => [r.category, { periodMonths: r.periodMonths, trigger: r.trigger, action: r.action }]),
  );
  for (const r of ruleRows) rules.set(r.category as RetentionCategory, { periodMonths: r.periodMonths, trigger: r.trigger as RetentionTrigger, action: r.action as RetentionAction });

  const out: DueCategory[] = [];
  for (const category of RETENTION_CATEGORIES) {
    const rule = rules.get(category)!;
    const base: DueCategory = {
      category,
      label: RETENTION_CATEGORY_LABELS[category],
      action: rule.action,
      actionLabel: RETENTION_ACTION_LABELS[rule.action],
      measured: true,
      reason: null,
      off: false,
      unit: "people",
      due: 0,
      soon: 0,
      held: 0,
    };
    const unmeasured = (reason: string): DueCategory => ({ ...base, measured: false, reason, soon: null });

    if (category === "ACCESS_LOGS") {
      out.push(unmeasured("The log has no account-closure date to count from yet, so this is not measured."));
      continue;
    }
    if (category === "SURVEY_REPORTS") {
      out.push(unmeasured("The anonymised reports identify no one and are kept indefinitely: there is nothing to measure."));
      continue;
    }

    // the three the system already applies, from their HR-policy setting (the same setting that governs when they run)
    if (category === "EMPLOYEE_FILE") {
      const years = policy.employeeRetentionYears;
      if (years <= 0) {
        out.push({ ...base, off: true });
        continue;
      }
      const horizon = new Date(today.getTime() + SOON_DAYS * DAY_MS);
      let due = 0;
      let soon = 0;
      let held = 0;
      for (const e of leavers) {
        const from = eraseFrom(e.exitDate!, years);
        if (from <= today) {
          due++;
          if (holdBlocksPerson(holds, e.id)) held++;
        } else if (from <= horizon) soon++;
      }
      out.push({ ...base, due, soon, held });
      continue;
    }
    if (category === "RAW_SURVEYS") {
      const months = policy.surveyRetentionMonths;
      if (months <= 0) {
        out.push({ ...base, off: true, unit: "records", soon: null });
        continue;
      }
      const due = await expiredSurveyCount(orgId, months, todayDay);
      out.push({ ...base, unit: "records", due, soon: null, held: holdBlocks(holds, { category }) ? due : 0 });
      continue;
    }
    if (category === "UNSUCCESSFUL_APPLICANTS") {
      const months = policy.candidateRetentionMonths;
      if (months <= 0) {
        out.push({ ...base, off: true, soon: null });
        continue;
      }
      const due = await dueCandidateCount(orgId, months, today);
      out.push({ ...base, due, soon: null, held: holdBlocks(holds, { category }) ? due : 0 });
      continue;
    }

    // from here the company's own rule decides
    if (rule.action === "KEEP" || rule.periodMonths <= 0) {
      out.push({ ...base, off: true });
      continue;
    }
    if (!triggerMeasurable(category, rule.trigger)) {
      out.push(unmeasured(`The system cannot yet work out ${RETENTION_CATEGORY_LABELS[category].toLowerCase()} counted from "${RETENTION_TRIGGER_LABELS[rule.trigger]}", so nothing is measured for this rule.`));
      continue;
    }

    if (category === "AUDIT_LOGS") {
      // counted per entry, by the day it was written; the day arithmetic is to the day except at the end of a short month
      const pastEnd = nextDay(expiryDay(todayDay, -rule.periodMonths));
      const soonEnd = nextDay(expiryDay(plusDays(todayDay, SOON_DAYS), -rule.periodMonths));
      const [due, soon] = await Promise.all([
        db.auditLog.count({ where: { organizationId: orgId, createdAt: { lt: pastEnd } } }),
        db.auditLog.count({ where: { organizationId: orgId, createdAt: { gte: pastEnd, lt: soonEnd } } }),
      ]);
      out.push({ ...base, unit: "records", due, soon, held: holdBlocks(holds, { category }) ? due : 0 });
      continue;
    }

    if (rule.trigger === "AFTER_EXIT") {
      // former employees whose period has ended or will within 90 days, then those of them who hold a record of the kind
      const status = new Map<string, "PAST" | "SOON">();
      for (const e of leavers) {
        const s = expiryStatus(dayOf(e.exitDate!), rule.periodMonths, todayDay);
        if (s === "PAST" || s === "SOON") status.set(e.id, s);
      }
      const holders = await peopleWith(category, orgId, [...status.keys()]);
      let due = 0;
      let soon = 0;
      let held = 0;
      for (const id of holders) {
        if (status.get(id) === "PAST") {
          due++;
          if (holdBlocks(holds, { category, employeeId: id })) held++;
        } else soon++;
      }
      out.push({ ...base, due, soon, held });
      continue;
    }

    // counted per record (a welfare case from the day it was closed, a succession entry from the day it was last reviewed)
    const records = (await recordsFor(category, orgId)) ?? [];
    let due = 0;
    let soon = 0;
    let held = 0;
    for (const r of records) {
      const s = expiryStatus(r.base, rule.periodMonths, todayDay);
      if (s === "PAST") {
        due++;
        if (holdBlocks(holds, { category, employeeId: r.employeeId })) held++;
      } else if (s === "SOON") soon++;
    }
    out.push({ ...base, unit: "records", due, soon, held });
  }
  return out;
}

/**
 * For the HR digest: how many kinds of record have something past the end of its period, how many will within 90 days, and how many legal holds are due for a look. Counts only.
 * A kind whose rule says keep, or that is switched off, is never counted.
 */
export async function retentionNotices(orgId: string, today: Date = todayUtc()) {
  const [categories, holds] = await Promise.all([measureCategories(orgId, today), liveHolds(orgId)]);
  const live = categories.filter((c) => c.measured && !c.off);
  const todayDay = dayOf(today);
  return {
    pastCategories: live.filter((c) => c.due > 0).length,
    soonCategories: live.filter((c) => (c.soon ?? 0) > 0).length,
    holdsToReview: holds.filter((h: HoldLike) => holdNeedsReview(h, todayDay)).length,
  };
}
