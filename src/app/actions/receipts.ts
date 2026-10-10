"use server";
import { act } from "./_run";
import * as rc from "@/server/services/receipts";

type V = Record<string, unknown>;
const PATHS = ["/finance/receipts", "/finance/invoices", "/finance/statements"];

/** The editor sends the allocations as JSON; everything else is plain fields. */
const allocationsOf = (v: V) => JSON.parse(String(v.linesJson ?? "[]")) as Array<{ invoiceId: string; cash: number; wht: number }>;

export async function recordClientReceiptAction(v: V) {
  return act("payment.manage", async (ctx) => {
    const r = await rc.recordClientReceipt(ctx, { ...v, allocations: allocationsOf(v) } as never);
    return { message: `${r.receiptNumber} recorded.`, redirectTo: `/finance/receipts/${r.id}` };
  }, PATHS);
}

export async function applyAdvanceAction(receiptId: string, v: V) {
  return act("payment.manage", async (ctx) => {
    await rc.applyAdvance(ctx, receiptId, allocationsOf(v), v.appliedOn ? String(v.appliedOn) : undefined);
    return { message: "Applied to the invoices.", redirectTo: `/finance/receipts/${receiptId}` };
  }, PATHS);
}

export async function reverseAllocationAction(id: string, reason?: string) {
  return act("payment.manage", async (ctx) => {
    await rc.reverseAllocation(ctx, id, reason ?? "");
    return { message: "Taken back. The amount is held on the receipt to apply again." };
  }, PATHS);
}

export async function requestRefundAction(receiptId: string, v: V) {
  return act("payment.manage", async (ctx) => {
    const r = await rc.requestRefund(ctx, receiptId, v as never);
    return { message: `${r.refundNumber} requested. Someone else has to approve it before the money goes out.` };
  }, PATHS);
}

export async function decideRefundAction(id: string, approve: boolean, note?: string) {
  return act("receipt.approve", async (ctx) => {
    await rc.decideRefund(ctx, id, approve, note);
    return { message: approve ? "Approved. The refund has been posted." : "Refund turned down." };
  }, PATHS);
}
