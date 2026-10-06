"use server";
import { act } from "./_run";
import * as dr from "@/server/services/data-requests";

type V = Record<string, unknown>;
const PAGES = ["/hr", "/me"];

export async function openRequestAction(v: V) {
  return act("hr.manage", async (ctx) => {
    const r = await dr.openRequest(ctx, v as never);
    return { message: `${r.requestNumber} logged — answer by ${r.dueOn.toISOString().slice(0, 10)}.` };
  }, PAGES);
}

export async function verifyIdentityAction(id: string, note?: string) {
  return act("hr.manage", async (ctx) => {
    await dr.verifyIdentity(ctx, id, note ?? "");
    return { message: "Identity recorded — you can now generate their data." };
  }, PAGES);
}

export async function completeRequestAction(id: string, note?: string) {
  return act("hr.manage", async (ctx) => {
    await dr.completeRequest(ctx, id, note);
    return { message: "Request completed." };
  }, PAGES);
}

export async function refuseRequestAction(id: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await dr.refuseRequest(ctx, id, reason ?? "");
    return { message: "Request refused and recorded." };
  }, PAGES);
}
