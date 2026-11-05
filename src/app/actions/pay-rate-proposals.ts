"use server";
import { actFor } from "./_run";
import * as prop from "@/server/services/pay-rate-proposals";
const act = actFor("pay-rate-proposals.ts");

type V = Record<string, unknown>;
const PAGES = ["/employees", "/employees/pay-rates"];
const text = (v: unknown) => (typeof v === "string" ? v : undefined);

/** HR or payroll proposes a personal monthly gross. The service decides who may; it does not become a pay rate until a payroll manager approves it. */
export async function proposePayRateAction(v: V) {
  return act("employee.view", async (ctx) => {
    await prop.proposePayRate(ctx, { employeeId: String(v.employeeId ?? ""), monthlyGross: v.monthlyGross, structureCode: text(v.structureCode), reason: text(v.reason) ?? "", effectiveFrom: text(v.effectiveFrom) ?? "" });
    return { message: "Proposed. It becomes the employee's pay rate when a payroll manager approves it." };
  }, PAGES);
}

export async function approvePayRateAction(id: string) {
  return act("payrate.approve", async (ctx) => {
    await prop.approvePayRate(ctx, id);
    return { message: "Approved: the pay rate is now in force from its effective date." };
  }, PAGES);
}

export async function rejectPayRateAction(id: string, reason?: string) {
  return act("payrate.approve", async (ctx) => {
    await prop.rejectPayRate(ctx, id, reason ?? "");
    return { message: "Proposal rejected." };
  }, PAGES);
}

export async function cancelPayRateProposalAction(id: string) {
  return act("employee.view", async (ctx) => {
    await prop.cancelPayRateProposal(ctx, id);
    return { message: "Proposal withdrawn." };
  }, PAGES);
}
