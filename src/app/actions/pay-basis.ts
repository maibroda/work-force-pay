"use server";
import { actFor } from "./_run";
import * as pb from "@/server/services/pay-basis";
const act = actFor("pay-basis.ts");

type V = Record<string, unknown>;
const PATHS = ["/contracts/pay-basis", "/contracts"];
const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Someone who manages clients proposes how a contract's pay is divided over the month; a second person (the payroll manager) must approve it. */
export async function proposeBasisAction(v: V) {
  return act("client.manage", async (ctx) => {
    await pb.proposeBasis(ctx, {
      contractId: text(v.contractId),
      basis: text(v.basis),
      workingDaysPerWeek: text(v.workingDaysPerWeek) ? Number(v.workingDaysPerWeek) : null,
      excludePublicHolidays: v.excludePublicHolidays === true || v.excludePublicHolidays === "true" || v.excludePublicHolidays === "on",
      effectiveFrom: text(v.effectiveFrom),
      reason: text(v.reason),
    });
    return { message: "Proposed. It counts for pay only when a payroll manager approves it, from the first day of its month." };
  }, PATHS);
}

export async function approveBasisAction(id: string) {
  return act("payrate.approve", async (ctx) => {
    await pb.approveBasis(ctx, id);
    return { message: "Approved: it applies from its effective month." };
  }, PATHS);
}

export async function rejectBasisAction(id: string, reason?: string) {
  return act("payrate.approve", async (ctx) => {
    await pb.rejectBasis(ctx, id, reason ?? "");
    return { message: "Proposal rejected." };
  }, PATHS);
}

export async function cancelBasisAction(id: string) {
  return act("client.manage", async (ctx) => {
    await pb.cancelBasis(ctx, id);
    return { message: "Proposal withdrawn." };
  }, PATHS);
}
