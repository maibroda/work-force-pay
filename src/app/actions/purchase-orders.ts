"use server";
import { act } from "./_run";
import * as po from "@/server/services/purchase-orders";

type V = Record<string, unknown>;
const PATHS = ["/finance/purchase-orders"];

export async function createPurchaseOrderAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const lines = JSON.parse(String(v.linesJson ?? "[]"));
      const order = await po.createPurchaseOrder(ctx, { ...v, lines } as never);
      return { message: `Purchase order ${order.orderNumber} created.`, redirectTo: "/finance/purchase-orders" };
    },
    PATHS,
  );
}

export async function submitPurchaseOrderAction(id: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await po.submitPurchaseOrder(ctx, id);
      return { message: "Submitted for approval." };
    },
    PATHS,
  );
}

export async function approvePurchaseOrderAction(id: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await po.decidePurchaseOrder(ctx, id, "APPROVED");
      return { message: "Purchase order approved." };
    },
    PATHS,
  );
}

export async function rejectPurchaseOrderAction(id: string, reason?: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await po.decidePurchaseOrder(ctx, id, "REJECTED", reason);
      return { message: "Purchase order rejected." };
    },
    PATHS,
  );
}

export async function cancelPurchaseOrderAction(id: string, reason?: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await po.cancelPurchaseOrder(ctx, id, reason ?? "");
      return { message: "Purchase order cancelled." };
    },
    PATHS,
  );
}

export async function convertPurchaseOrderAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const inv = await po.convertPurchaseOrderToInvoice(ctx, v as never);
      return { message: `Converted to bill ${inv.invoiceNumber}.`, redirectTo: `/finance/payables/${inv.id}` };
    },
    [...PATHS, "/finance/payables"],
  );
}
