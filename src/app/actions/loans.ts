"use server";
import { act } from "./_run";
import * as loans from "@/server/services/loans";
import * as eos from "@/server/services/settlements";

type V = Record<string, unknown>;
const PATHS = ["/payroll/loans", "/payroll/settlements", "/hr", "/employees"];

export async function requestLoanAction(v: V) {
  return act("loan.manage", async (ctx) => {
    const l = await loans.requestLoan(ctx, v as never);
    return { message: `${l.loanNumber} requested — awaiting approval.`, redirectTo: `/payroll/loans/${l.id}` };
  }, PATHS);
}
export async function approveLoanAction(id: string, note?: string) {
  return act("loan.approve", async (ctx) => {
    await loans.approveLoan(ctx, id, note);
    return { message: "Approved — the money is recorded as paid out." };
  }, PATHS);
}
export async function rejectLoanAction(id: string, note?: string) {
  return act("loan.approve", async (ctx) => {
    await loans.rejectLoan(ctx, id, note ?? "");
    return { message: "Rejected." };
  }, PATHS);
}
export async function cancelLoanAction(id: string) {
  return act("loan.manage", async (ctx) => {
    await loans.cancelLoan(ctx, id);
    return { message: "Request cancelled." };
  }, PATHS);
}
export async function scheduleInstallmentsAction(v: V) {
  return act("loan.manage", async (ctx) => {
    const r = await loans.scheduleInstallments(ctx, String(v.periodId ?? ""));
    const skipped = r.skipped.length ? ` Skipped: ${r.skipped.map((s) => `${s.loanNumber} (${s.reason})`).join("; ")}.` : "";
    return {
      message: r.scheduled
        ? `${r.scheduled} repayment(s) totalling ₦${r.total.toLocaleString("en-NG")} added to ${r.periodName} — recalculate that payroll to pick them up.${skipped}`
        : `Nothing to schedule for ${r.periodName}.${skipped}`,
    };
  }, PATHS);
}
export async function cashRepaymentAction(id: string, v: V) {
  return act("loan.manage", async (ctx) => {
    await loans.recordCashRepayment(ctx, id, v as never);
    return { message: "Cash repayment recorded." };
  }, PATHS);
}
export async function writeOffLoanAction(id: string, reason?: string) {
  return act("loan.approve", async (ctx) => {
    await loans.writeOffLoan(ctx, id, reason ?? "");
    return { message: "Balance written off." };
  }, PATHS);
}
export async function addLoanRecoveryAction(settlementId: string) {
  return act("settlement.manage", async (ctx) => {
    const lines = await eos.addLoanRecovery(ctx, settlementId);
    return { message: `${lines.length} loan recovery line(s) added.` };
  }, PATHS);
}
