"use server";
import { act } from "./_run";
import * as er from "@/server/services/employee-retention";

type V = Record<string, unknown>;
const PAGES = ["/hr", "/employees"];

/** From the "past the retention period" list: the reason is typed in the button's prompt. */
export async function requestRetentionErasureAction(employeeId: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await er.requestErasure(ctx, employeeId, "RETENTION", reason ?? "");
    return { message: "Sent for approval. Someone other than you has to approve it before anything is removed." };
  }, PAGES);
}

/** From the form: the person asked for erasure. */
export async function requestErasureAction(v: V) {
  return act("hr.manage", async (ctx) => {
    await er.requestErasure(ctx, String(v.employeeId ?? ""), "REQUEST", String(v.reason ?? ""));
    return { message: "Sent for approval. Someone other than you has to approve it before anything is removed." };
  }, PAGES);
}

export async function approveErasureAction(id: string, note?: string) {
  return act("hr.approve", async (ctx) => {
    await er.decideErasure(ctx, id, true, note);
    return { message: "Approved. Their personal details have been removed." };
  }, PAGES);
}

export async function rejectErasureAction(id: string, note?: string) {
  return act("hr.approve", async (ctx) => {
    await er.decideErasure(ctx, id, false, note);
    return { message: "Request turned down." };
  }, PAGES);
}
