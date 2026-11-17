"use server";
import { actFor } from "./_run";
import * as tc from "@/server/services/training-cost";
const act = actFor("training-cost.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/training-calendar", "/hr/training-spend"];
const str = (x: unknown) => (typeof x === "string" ? x : undefined);

/** HR records one cost line against a session. The amount stays a TEXT amount in naira all the way: the service reads it to the exact kobo. */
export async function recordCostAction(sessionId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    const l = await tc.recordCost(ctx, sessionId, { kind: (str(v.kind) ?? "") as never, amount: str(v.amount) ?? "", description: str(v.description) ?? "", invoiceReference: str(v.invoiceReference) });
    return { message: l.status === "PENDING" ? "Cost recorded. It is over the company's threshold, so a second person must approve it before it counts." : "Cost recorded." };
  }, PAGES);
}

export async function reverseCostAction(lineId: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await tc.reverseCost(ctx, lineId, reason ?? "");
    return { message: "Reversed with a new negative line. The original stays in the history." };
  }, PAGES);
}

export async function approveCostAction(lineId: string, note?: string) {
  return act("hr.approve", async (ctx) => {
    await tc.decideCost(ctx, lineId, "APPROVED", note);
    return { message: "Cost approved. It now counts in the spend." };
  }, PAGES);
}

export async function declineCostAction(lineId: string, reason?: string) {
  return act("hr.approve", async (ctx) => {
    await tc.decideCost(ctx, lineId, "REJECTED", reason ?? "");
    return { message: "Cost declined. It does not count." };
  }, PAGES);
}

/** The budget form: a year, an optional department and an amount (empty removes the budget). */
export async function setBudgetAction(v: V) {
  return act("hr.manage", async (ctx) => {
    await tc.setTrainingBudget(ctx, Number(str(v.year)), str(v.departmentId) || null, str(v.amount)?.trim() ? (str(v.amount) as string) : null);
    return { message: "Budget saved." };
  }, PAGES);
}
