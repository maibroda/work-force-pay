"use server";
import { act } from "./_run";
import * as st from "@/server/services/structures";
import * as inp from "@/server/services/inputs";
import * as pr from "@/server/services/payroll";
import * as pay from "@/server/services/payments";
import * as stat from "@/server/services/statutory";

type V = Record<string, unknown>;

export async function createStructureAction(v: st.StructureInput) {
  return act(
    "structure.manage",
    async (ctx) => {
      const s = await st.createStructure(ctx, v);
      return {
        message: `Salary structure ${s.name} created (${s.status}).`,
        redirectTo: `/payroll/structures/${s.id}`,
      };
    },
    ["/payroll/structures"],
  );
}
export async function updateStructureAction(id: string, v: st.StructureInput) {
  return act(
    "structure.manage",
    async (ctx) => {
      await st.updateStructure(ctx, id, v);
      return { message: "Draft structure updated.", redirectTo: `/payroll/structures/${id}` };
    },
    ["/payroll/structures"],
  );
}
export async function activateStructureAction(id: string) {
  return act(
    "structure.manage",
    async (ctx) => {
      await st.activateStructure(ctx, id);
      return { message: "Structure activated." };
    },
    ["/payroll/structures"],
  );
}
export async function deactivateStructureAction(id: string) {
  return act(
    "structure.manage",
    async (ctx) => {
      await st.deactivateStructure(ctx, id);
      return { message: "Structure deactivated." };
    },
    ["/payroll/structures"],
  );
}
export async function cloneStructureAction(id: string, code?: string) {
  return act(
    "structure.manage",
    async (ctx) => {
      const c = code?.trim().toUpperCase() || `COPY-${Date.now().toString(36).toUpperCase()}`;
      const s = await st.cloneStructure(ctx, id, c, `Copy (${c})`);
      return { message: "Cloned as a new DRAFT version.", redirectTo: `/payroll/structures/${s.id}` };
    },
    ["/payroll/structures"],
  );
}

export async function createOvertimeAction(v: V) {
  return act(
    "payroll.inputs",
    async (ctx) => {
      const o = await inp.createOvertime(ctx, v as never);
      return { message: `Overtime validated: ${o.hours}h = ₦${o.amount}. Awaiting approval.` };
    },
    ["/payroll"],
  );
}
export async function approveOvertimeAction(id: string, ref?: string) {
  return act(
    "payroll.inputs.approve",
    async (ctx) => {
      await inp.approveOvertime(ctx, id, ref);
      return { message: "Overtime approved." };
    },
    ["/payroll"],
  );
}
export async function createDeductionAction(v: V) {
  return act(
    "payroll.inputs",
    async (ctx) => {
      await inp.createDeduction(ctx, v as never);
      return { message: "Deduction recorded — awaiting approval." };
    },
    ["/payroll"],
  );
}
export async function approveDeductionAction(id: string) {
  return act(
    "payroll.inputs.approve",
    async (ctx) => {
      await inp.approveDeduction(ctx, id);
      return { message: "Deduction approved." };
    },
    ["/payroll"],
  );
}
export async function createArrearsAction(v: V) {
  return act(
    "payroll.inputs",
    async (ctx) => {
      const a = await inp.createArrears(ctx, v as never);
      return {
        message: `Arrears calculated: gross ₦${a.grossImpact}, net ₦${a.netImpact}. Awaiting approval.`,
      };
    },
    ["/payroll"],
  );
}
export async function approveArrearsAction(id: string) {
  return act(
    "payroll.inputs.approve",
    async (ctx) => {
      await inp.approveArrears(ctx, id);
      return { message: "Arrears approved — will be included in the next payroll calculation." };
    },
    ["/payroll"],
  );
}
export async function createOtherEarningAction(v: V) {
  return act(
    "payroll.inputs",
    async (ctx) => {
      await inp.createOtherEarning(ctx, {
        ...(v as Record<string, unknown>),
        taxable: v.taxable !== false,
      } as never);
      return { message: "Earning recorded — awaiting approval." };
    },
    ["/payroll"],
  );
}
export async function approveOtherEarningAction(id: string) {
  return act(
    "payroll.inputs.approve",
    async (ctx) => {
      await inp.approveOtherEarning(ctx, id);
    },
    ["/payroll"],
  );
}
export async function rejectInputAction(
  kind: "overtime" | "deduction" | "arrears" | "otherEarning",
  id: string,
  reason?: string,
) {
  return act(
    "payroll.inputs.approve",
    async (ctx) => {
      await inp.rejectInput(ctx, kind, id, reason ?? "Rejected");
      return { message: "Rejected." };
    },
    ["/payroll"],
  );
}

export async function createPeriodAction(v: V) {
  return act(
    "payroll.run",
    async (ctx) => {
      const p = await pr.createPeriod(ctx, Number(v.year), Number(v.month));
      return { message: `${p.name} opened.` };
    },
    ["/payroll"],
  );
}
export async function runPayrollAction(periodId: string) {
  return act(
    "payroll.run",
    async (ctx) => {
      const r = await pr.runPayroll(ctx, periodId);
      return {
        message: `Payroll calculated for ${r.employeeCount} employees (calculation #${r.calculationCount}).`,
        redirectTo: `/payroll/runs/${r.id}`,
      };
    },
    ["/payroll", "/"],
  );
}
export async function submitRunAction(id: string) {
  return act(
    "payroll.run",
    async (ctx) => {
      await pr.submitForApproval(ctx, id);
      return { message: "Submitted to Finance for approval." };
    },
    ["/payroll"],
  );
}
export async function approveRunAction(id: string) {
  return act(
    "payroll.approve",
    async (ctx) => {
      await pr.approveRun(ctx, id);
      return { message: "Payroll approved." };
    },
    ["/payroll"],
  );
}
export async function returnRunAction(id: string, reason?: string) {
  return act(
    "payroll.approve",
    async (ctx) => {
      await pr.returnRun(ctx, id, reason ?? "");
      return { message: "Payroll returned for correction; period re-opened." };
    },
    ["/payroll"],
  );
}
export async function lockRunAction(id: string) {
  return act(
    "payroll.lock",
    async (ctx) => {
      await pr.lockRun(ctx, id);
      return { message: "Payroll locked. Operational changes for this period are now blocked." };
    },
    ["/payroll", "/"],
  );
}
export async function overrideIssueAction(id: string, reason?: string) {
  return act(
    "payroll.override",
    async (ctx) => {
      await pr.overrideIssue(ctx, id, reason ?? "");
      return { message: "Issue overridden with documented reason." };
    },
    ["/payroll"],
  );
}
export async function createSupplementaryAction(v: V) {
  return act(
    "payroll.run",
    async (ctx) => {
      const r = await pr.createSupplementaryRun(
        ctx,
        String(v.periodId),
        String(v.description ?? "Supplementary payroll"),
      );
      return {
        message: `Supplementary run #${r.runNumber} calculated.`,
        redirectTo: `/payroll/runs/${r.id}`,
      };
    },
    ["/payroll"],
  );
}

export async function createBatchesAction(runId: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      const b = await pay.createPaymentBatches(ctx, runId);
      return { message: `${b.length} payment batch(es) created.` };
    },
    ["/payments", "/payroll"],
  );
}
export async function markBatchPaidAction(id: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await pay.markBatchPaid(ctx, id);
      return { message: "Batch marked paid." };
    },
    ["/payments", "/payroll"],
  );
}
export async function reconcileAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const r = await pay.reconcileBatch(ctx, String(v.batchId), String(v.csv ?? ""));
      return {
        message: `Matched ${r.matched}; ${r.unmatchedStatementLines.length} unmatched statement line(s); ${r.outstandingTransactions} outstanding.`,
      };
    },
    ["/payments"],
  );
}
export async function generateRemittancesAction(runId: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await pay.generateRemittances(ctx, runId);
      return { message: "PAYE and pension remittance schedules generated." };
    },
    ["/payments"],
  );
}
export async function markRemittedAction(id: string, reference?: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await pay.markRemitted(ctx, id, reference ?? "");
    },
    ["/payments"],
  );
}

export async function createTaxRuleAction(raw: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      await stat.createTaxRuleVersion(ctx, raw as never);
      return { message: "New PAYE rule version created; previous version end-dated." };
    },
    ["/settings/statutory", "/payroll/paye"],
  );
}
export async function createPensionRuleAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      await stat.createPensionRule(ctx, {
        ...(v as Record<string, unknown>),
        pensionableCodes: String(v.pensionableCodes ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      } as never);
      return { message: "New pension rule version created." };
    },
    ["/settings/statutory"],
  );
}
export async function createPayrollRuleAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      await stat.createPayrollRule(ctx, v as never);
      return { message: "New payroll rule version created." };
    },
    ["/settings/payroll-rules"],
  );
}
export async function createEmployerCostRuleAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      await stat.createEmployerCostRule(ctx, v as never);
      return { message: "New employer cost rule version created." };
    },
    ["/settings/employer-costs"],
  );
}
