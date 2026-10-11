"use server";
import { act } from "./_run";
import * as matching from "@/server/services/matching";

type V = Record<string, unknown>;
const PATHS = ["/finance/purchase-orders", "/finance/payables"];

export async function recordGoodsReceiptAction(v: V) {
  return act(
    "goods.receive",
    async (ctx) => {
      const lines = JSON.parse(String(v.linesJson ?? "[]"));
      const r = await matching.recordGoodsReceipt(ctx, { ...v, lines } as never);
      return { message: `Goods receipt ${r.receiptNumber} recorded.` };
    },
    PATHS,
  );
}

export async function cancelGoodsReceiptAction(id: string, reason?: string) {
  return act(
    "goods.receive",
    async (ctx) => {
      await matching.cancelGoodsReceipt(ctx, id, reason ?? "");
      return { message: "Goods receipt cancelled." };
    },
    PATHS,
  );
}

export async function approveBillExceptionAction(id: string, reason?: string) {
  return act(
    "purchase.approve",
    async (ctx) => {
      await matching.approveBillException(ctx, id, reason ?? "");
      return { message: "Bill approved for payment." };
    },
    PATHS,
  );
}

export async function setMatchPolicyAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      await matching.setMatchPolicy(ctx, v as never);
      return { message: "Matching policy saved." };
    },
    PATHS,
  );
}
