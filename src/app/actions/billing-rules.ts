"use server";
import { act } from "./_run";
import * as br from "@/server/services/billing-rules";

type V = Record<string, unknown>;
const PATHS = ["/finance/billing-rules", "/finance/invoices"];

export async function saveServiceTypeAction(v: V) {
  return act("billing.rule.manage", async (ctx) => {
    const s = await br.saveServiceType(ctx, v as never);
    return { message: `Service type ${s.code} created. Propose its billing rule next.` };
  }, PATHS);
}

export async function setServiceTypeActiveAction(id: string, active: boolean) {
  return act("billing.rule.manage", async (ctx) => {
    await br.setServiceTypeActive(ctx, id, active);
    return { message: active ? "Service type reactivated." : "Service type deactivated." };
  }, PATHS);
}

export async function installStandardBillingAction() {
  return act("billing.rule.approve", async (ctx) => {
    await br.installStandardBilling(ctx);
    return { message: "Security & Guarding set up with the standard treatment, and every contract placed under it. Nothing in what is billed changes." };
  }, PATHS);
}

export async function assignServiceTypeAction(v: V) {
  return act("billing.rule.approve", async (ctx) => {
    await br.assignServiceType(ctx, String(v.contractId), v.serviceTypeId ? String(v.serviceTypeId) : null, String(v.reason ?? ""));
    return { message: "Contract moved. Its next invoice is billed under the new service type's rule." };
  }, PATHS);
}

export async function proposeServiceRuleAction(serviceTypeId: string, v: V) {
  return act("billing.rule.manage", async (ctx) => {
    await br.proposeRule(ctx, { serviceTypeId }, v as never);
    return { message: "Rule proposed. Someone else has to approve it before invoices can use it." };
  }, PATHS);
}

export async function proposeContractRuleAction(v: V) {
  return act("billing.rule.manage", async (ctx) => {
    await br.proposeRule(ctx, { contractId: String(v.contractId ?? "") }, v as never);
    return { message: "Override proposed. Someone else has to approve it before invoices can use it." };
  }, PATHS);
}

export async function decideRuleAction(id: string, approve: boolean, note?: string) {
  return act("billing.rule.approve", async (ctx) => {
    await br.decideRule(ctx, id, approve, note);
    return { message: approve ? "Rule approved. Invoices dated on or after its start date will use it." : "Rule turned down." };
  }, PATHS);
}
