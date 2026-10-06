"use server";
import { act } from "./_run";
import * as pol from "@/server/services/policies";

type V = Record<string, unknown>;
const PAGES = ["/hr", "/me", "/employees"];

export async function createPolicyAction(v: V) {
  return act("hr.configure", async (ctx) => {
    const p = await pol.createPolicy(ctx, v as never);
    return { message: "Policy published — employees can now acknowledge it.", redirectTo: `/hr/policies/${p.id}` };
  }, PAGES);
}

/** The form always sends every field, so a blank audience means everyone and a blank summary clears it. */
export async function updatePolicyAction(id: string, v: V) {
  return act("hr.configure", async (ctx) => {
    await pol.updatePolicy(ctx, id, { ...v, categoryId: v.categoryId ?? "", summary: v.summary ?? "" } as never);
    return { message: "Policy updated." };
  }, PAGES);
}

export async function publishVersionAction(policyId: string, v: V) {
  return act("hr.configure", async (ctx) => {
    const ver = await pol.publishVersion(ctx, policyId, v as never);
    return { message: `Version ${ver.version} published — everyone it applies to will be asked to acknowledge it.` };
  }, PAGES);
}

export async function setPolicyStatusAction(id: string, status: "ACTIVE" | "ARCHIVED") {
  return act("hr.configure", async (ctx) => {
    await pol.setPolicyStatus(ctx, id, status);
    return { message: status === "ARCHIVED" ? "Policy archived — nobody is asked to acknowledge it." : "Policy restored." };
  }, PAGES);
}

// Employees acknowledge for themselves, so this only needs a login — the service uses the caller's own employee record.
export async function acknowledgeAction(policyId: string) {
  return act(undefined, async (ctx) => {
    await pol.acknowledge(ctx, policyId);
    return { message: "Thank you — your acknowledgement is recorded." };
  }, PAGES);
}

export async function recordAcknowledgementAction(policyId: string, employeeId: string, note?: string) {
  return act("hr.manage", async (ctx) => {
    await pol.recordAcknowledgement(ctx, policyId, employeeId, note ?? "");
    return { message: "Paper sign-off recorded." };
  }, PAGES);
}
