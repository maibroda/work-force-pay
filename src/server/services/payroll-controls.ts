/**
 * Payroll controls: variance against the previous payroll, the reconciliation to it, and the gates that stop a payroll being
 * submitted before they are done. Maker-checker itself (whoever prepared or submitted a payroll cannot approve it) lives with the
 * workflow in payroll.ts, and is backed by a database trigger.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { num } from "@/lib/money";
import {
  DEFAULT_VARIANCE_POLICY,
  reconcile,
  varianceFindings,
  type PayPerson,
  type ReconciliationBridge,
  type VariancePolicy,
} from "@/lib/payroll/variance";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

const EXITED = ["TERMINATED", "RESIGNED", "EXITED"];

// ─────────────────────────────── Policy ───────────────────────────────

export async function variancePolicy(client: Tx | typeof db, orgId: string) {
  const o = await client.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { varianceHeadcountPct: true, varianceEmployeePct: true, varianceTotalPct: true, varianceMinAmount: true, reconciliationRequired: true },
  });
  const policy: VariancePolicy = {
    headcountPct: num(o.varianceHeadcountPct),
    employeePct: num(o.varianceEmployeePct),
    totalPct: num(o.varianceTotalPct),
    minAmount: num(o.varianceMinAmount),
  };
  return { policy, reconciliationRequired: o.reconciliationRequired };
}

export const variancePolicySchema = z.object({
  headcountPct: z.coerce.number().min(0).max(1000),
  employeePct: z.coerce.number().min(0).max(1000),
  totalPct: z.coerce.number().min(0).max(1000),
  minAmount: z.coerce.number().min(0),
  reconciliationRequired: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
});

export async function setVariancePolicy(ctx: Ctx, raw: z.input<typeof variancePolicySchema>) {
  assertCan(ctx, "settings.manage");
  const v = variancePolicySchema.parse(raw);
  const before = await variancePolicy(db, ctx.orgId);
  await db.organization.update({
    where: { id: ctx.orgId },
    data: {
      varianceHeadcountPct: v.headcountPct,
      varianceEmployeePct: v.employeePct,
      varianceTotalPct: v.totalPct,
      varianceMinAmount: v.minAmount,
      reconciliationRequired: v.reconciliationRequired,
    },
  });
  await logAudit(ctx, { action: "PAYROLL_VARIANCE_POLICY_SET", entity: "Organization", entityId: ctx.orgId, oldValue: before, newValue: v });
}

export { DEFAULT_VARIANCE_POLICY };

// ─────────────────────────────── The comparison ───────────────────────────────

/** The payroll to compare with: the latest approved, locked or paid regular run from an earlier period. */
async function priorRunPeople(client: Tx | typeof db, orgId: string, period: { year: number; month: number }) {
  const run = await client.payrollRun.findFirst({
    where: {
      organizationId: orgId,
      type: "REGULAR",
      status: { in: ["APPROVED", "LOCKED", "PAID"] },
      period: { OR: [{ year: { lt: period.year } }, { year: period.year, month: { lt: period.month } }] },
    },
    orderBy: [{ period: { year: "desc" } }, { period: { month: "desc" } }, { runNumber: "desc" }],
    include: { period: { select: { name: true } } },
  });
  if (!run) return null;
  const recs = await client.payrollRecord.findMany({ where: { runId: run.id }, select: { employeeId: true, employeeNumber: true, employeeName: true, totalEarnings: true, netPay: true } });
  const people: PayPerson[] = recs.map((r) => ({ id: r.employeeId, label: `${r.employeeNumber} ${r.employeeName}`, gross: num(r.totalEarnings), net: num(r.netPay) }));
  return { run, people };
}

type EmpFacts = { id: string; status: string; employmentDate: Date; exitDate: Date | null };

function movementSets(employees: EmpFacts[], period: { startDate: Date; endDate: Date }) {
  const joiners = new Set(employees.filter((e) => e.employmentDate >= period.startDate && e.employmentDate <= period.endDate).map((e) => e.id));
  const leavers = new Set(employees.filter((e) => EXITED.includes(e.status) && e.exitDate && e.exitDate <= period.endDate).map((e) => e.id));
  return { joiners, leavers };
}

export type VarianceIssue = { employeeId: string | null; category: string; severity: "WARNING"; code: string; message: string; requiresExplanation: true };

/** Variance findings for a payroll being calculated (called with its rows before they are saved). */
export async function varianceIssues(
  orgId: string,
  period: { year: number; month: number; startDate: Date; endDate: Date },
  current: PayPerson[],
  employees: EmpFacts[],
): Promise<VarianceIssue[]> {
  const prior = await priorRunPeople(db, orgId, period);
  if (!prior) return [];
  const { policy } = await variancePolicy(db, orgId);
  const { joiners, leavers } = movementSets(employees, period);
  return varianceFindings({ prior: prior.people, current, joiners, leavers, policy }).map((f) => ({
    employeeId: f.employeeId,
    category: "VARIANCE",
    severity: "WARNING" as const,
    code: f.code,
    message: f.message,
    requiresExplanation: true as const,
  }));
}

async function loadRun(ctx: Ctx, runId: string) {
  const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId: ctx.orgId }, include: { period: true } });
  if (!run) throw new BusinessError("Payroll run not found.");
  return run;
}

export type ReconciliationView = {
  run: Awaited<ReturnType<typeof loadRun>>;
  prior: { runId: string; periodName: string; runNumber: number } | null;
  bridge: ReconciliationBridge;
  policy: VariancePolicy;
  reconciliationRequired: boolean;
  /** Movements with no joiner or leaver record behind them. */
  unexplainedMovements: number;
  unexplainedVariances: number;
};

export async function reconciliationFor(ctx: Ctx, runId: string): Promise<ReconciliationView> {
  assertCan(ctx, "payroll.view");
  const run = await loadRun(ctx, runId);
  const recs = await db.payrollRecord.findMany({ where: { runId }, select: { employeeId: true, employeeNumber: true, employeeName: true, totalEarnings: true, netPay: true } });
  const current: PayPerson[] = recs.map((r) => ({ id: r.employeeId, label: `${r.employeeNumber} ${r.employeeName}`, gross: num(r.totalEarnings), net: num(r.netPay) }));
  const prior = run.type === "REGULAR" ? await priorRunPeople(db, ctx.orgId, run.period) : null;
  const ids = [...new Set([...current.map((c) => c.id), ...(prior?.people.map((p) => p.id) ?? [])])];
  const emps = await db.employee.findMany({ where: { organizationId: ctx.orgId, id: { in: ids } }, select: { id: true, status: true, employmentDate: true, exitDate: true } });
  const { joiners, leavers } = movementSets(emps, run.period);
  const bridge = reconcile({ prior: prior?.people ?? [], current, joiners, leavers });
  const { policy, reconciliationRequired } = await variancePolicy(db, ctx.orgId);
  const unexplainedVariances = await db.payrollValidationIssue.count({ where: { runId, requiresExplanation: true, explanation: null, overridden: false } });
  return {
    run,
    prior: prior ? { runId: prior.run.id, periodName: prior.run.period.name, runNumber: prior.run.runNumber } : null,
    bridge,
    policy,
    reconciliationRequired,
    unexplainedMovements: bridge.otherAdded.length + bridge.otherRemoved.length,
    unexplainedVariances,
  };
}

// ─────────────────────────────── Explanations and sign-off ───────────────────────────────

/** A written explanation for a variance finding, by the person preparing the payroll. */
export async function explainIssue(ctx: Ctx, issueId: string, explanation: string) {
  assertCan(ctx, "payroll.run");
  if (!explanation || explanation.trim().length < 10) throw new BusinessError("Explain the change in a sentence (at least 10 characters), so the reviewer can judge it.");
  const issue = await db.payrollValidationIssue.findFirst({ where: { id: issueId, organizationId: ctx.orgId }, include: { run: true } });
  if (!issue) throw new BusinessError("Validation issue not found.");
  if (!issue.requiresExplanation) throw new BusinessError("This finding does not need an explanation.");
  if (issue.run.status !== "CALCULATED") throw new BusinessError("Explanations are written while the payroll is being prepared, before it is submitted.");
  await db.payrollValidationIssue.update({
    where: { id: issueId },
    data: { explanation: explanation.trim(), explainedBy: ctx.name, explainedByUserId: ctx.userId, explainedAt: new Date() },
  });
  await logAudit(ctx, { action: "PAYROLL_VARIANCE_EXPLAIN", entity: "PayrollValidationIssue", entityId: issueId, oldValue: { message: issue.message }, reason: explanation });
}

/** Signs off that this payroll has been walked from the previous one. Cleared if the payroll is recalculated. */
export async function signOffReconciliation(ctx: Ctx, runId: string, note?: string) {
  assertCan(ctx, "payroll.run");
  const view = await reconciliationFor(ctx, runId);
  const { run, bridge } = view;
  if (run.type !== "REGULAR") throw new BusinessError("Only a regular payroll is reconciled to the previous one.");
  if (run.status !== "CALCULATED") throw new BusinessError("Reconcile a payroll while it is being prepared, before it is submitted.");
  if (!bridge.balanced) throw new BusinessError("The reconciliation does not add up, so it can't be signed off. Recalculate the payroll.");
  const text = (note ?? "").trim();
  if (view.unexplainedMovements > 0 && text.length < 10)
    throw new BusinessError(`${view.unexplainedMovements} employee(s) appear or disappear without a joiner or leaver record. Say why in the note (at least 10 characters).`);
  if (!bridge.hasPrior && text.length < 10) throw new BusinessError("There is no earlier payroll to reconcile to. Say so in the note, for example that this is the first payroll or an opening run (at least 10 characters).");
  await db.payrollRun.update({
    where: { id: runId },
    data: { reconciledBy: ctx.name, reconciledByUserId: ctx.userId, reconciledAt: new Date(), reconciliationNote: text || null },
  });
  await logAudit(ctx, { action: "PAYROLL_RECONCILED", entity: "PayrollRun", entityId: runId, newValue: { priorHeadcount: bridge.priorHeadcount, currentHeadcount: bridge.currentHeadcount, note: text } });
}

/** What still stands between a calculated payroll and submission. Empty means it can be submitted. */
export async function submissionBlockers(orgId: string, run: { id: string; type: string; reconciledAt: Date | null }): Promise<string[]> {
  const out: string[] = [];
  const unexplained = await db.payrollValidationIssue.count({ where: { runId: run.id, requiresExplanation: true, explanation: null, overridden: false } });
  if (unexplained) out.push(`${unexplained} variance finding(s) still need a written explanation.`);
  if (run.type === "REGULAR") {
    const { reconciliationRequired } = await variancePolicy(db, orgId);
    if (reconciliationRequired && !run.reconciledAt) out.push("The payroll has not been reconciled to the previous one and signed off.");
  }
  return out;
}
