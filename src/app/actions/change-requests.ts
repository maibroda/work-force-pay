"use server";
import { act } from "./_run";
import * as cr from "@/server/services/change-requests";
import type { ChangeKindName } from "@/lib/change-control";

type V = Record<string, unknown>;
const PAGES = ["/employees", "/me", "/hr", "/payroll"];

// Requesting is open to HR and to the employee for their own details, so it only needs a login — the
// service decides. Deciding needs employee.approve, and the service rules out the requester and the employee.
export async function requestChangeAction(employeeId: string, kind: ChangeKindName, v: V) {
  return act(undefined, async (ctx) => {
    const { reason, ...fields } = v;
    await cr.requestChange(ctx, employeeId, kind, fields, String(reason ?? ""));
    return { message: "Change requested — it takes effect once someone else approves it." };
  }, PAGES);
}

export async function approveChangeAction(id: string) {
  return act("employee.approve", async (ctx) => {
    await cr.approveChange(ctx, id);
    return { message: "Approved — the details have been updated." };
  }, PAGES);
}

export async function rejectChangeAction(id: string, reason?: string) {
  return act("employee.approve", async (ctx) => {
    await cr.rejectChange(ctx, id, reason ?? "");
    return { message: "Request rejected." };
  }, PAGES);
}

export async function cancelChangeAction(id: string) {
  return act(undefined, async (ctx) => {
    await cr.cancelChange(ctx, id);
    return { message: "Request cancelled." };
  }, PAGES);
}
