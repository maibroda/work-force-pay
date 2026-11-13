"use server";
import { actFor } from "./_run";
import * as rs from "@/server/services/retention-schedule";
const act = actFor("retention-schedule.ts");

type V = Record<string, unknown>;
const PAGES = ["/hr/retention-schedule", "/hr/retention"];

/** The Company Administrator changes one rule. A change clears the legal adviser's verification of that rule. */
export async function updateRuleAction(v: V) {
  return act("retention.manage", async (ctx) => {
    await rs.updateRule(ctx, String(v.category ?? ""), { periodMonths: Number(v.periodMonths), trigger: String(v.trigger ?? ""), action: String(v.action ?? ""), note: v.note === undefined ? undefined : String(v.note) });
    return { message: "Rule changed. It is no longer marked as verified by the legal adviser." };
  }, PAGES);
}

/** The Company Administrator records that the legal adviser has seen one rule. */
export async function verifyRuleAction(v: V) {
  return act("retention.manage", async (ctx) => {
    await rs.verifyRule(ctx, String(v.category ?? ""), { verifiedBy: String(v.verifiedBy ?? ""), verifiedOn: String(v.verifiedOn ?? ""), note: v.note ? String(v.note) : null });
    return { message: "Recorded." };
  }, PAGES);
}

/** Any HR administrator may place a hold: waiting for someone else could let a deletion run first. */
export async function placeHoldAction(v: V) {
  return act("hr.manage", async (ctx) => {
    await rs.placeHold(ctx, {
      scope: String(v.scope ?? "") as "EMPLOYEE" | "CATEGORY" | "COMPANY",
      employeeId: v.employeeId ? String(v.employeeId) : null,
      category: v.category ? String(v.category) : null,
      reason: String(v.reason ?? ""),
      reviewOn: String(v.reviewOn ?? ""),
    });
    return { message: "Legal hold placed. Nothing it covers can be deleted until it is released." };
  }, PAGES);
}

/** Only the Company Administrator releases a hold; the reason is typed in the button's prompt. */
export async function releaseHoldAction(id: string, reason?: string) {
  return act("retention.manage", async (ctx) => {
    await rs.releaseHold(ctx, id, reason ?? "");
    return { message: "Hold released." };
  }, PAGES);
}
