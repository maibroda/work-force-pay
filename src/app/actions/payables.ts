"use server";
import { act } from "./_run";
import * as payables from "@/server/services/payables";

type V = Record<string, unknown>;
const PATHS = ["/finance/payables", "/finance/vendors"];

export async function createVendorAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      await payables.createVendor(ctx, v as never);
      return { message: "Vendor created." };
    },
    PATHS,
  );
}

export async function setVendorActiveAction(id: string, active: boolean) {
  return act(
    "payment.manage",
    async (ctx) => {
      await payables.setVendorActive(ctx, id, active);
      return { message: active ? "Vendor reactivated." : "Vendor deactivated." };
    },
    PATHS,
  );
}

export async function createPurchaseInvoiceAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const lines = JSON.parse(String(v.linesJson ?? "[]"));
      const inv = await payables.createPurchaseInvoice(ctx, { ...v, lines } as never);
      return { message: `Purchase invoice ${inv.invoiceNumber} recorded.`, redirectTo: "/finance/payables" };
    },
    PATHS,
  );
}

export async function recordVendorPaymentAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      await payables.recordVendorPayment(ctx, v as never);
      return { message: "Payment recorded." };
    },
    PATHS,
  );
}

export async function recordPurchaseInvoiceDeductionAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      await payables.recordPurchaseInvoiceDeduction(ctx, v as never);
      return { message: "Deduction recorded." };
    },
    PATHS,
  );
}

export async function cancelPurchaseInvoiceAction(id: string, reason?: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await payables.cancelPurchaseInvoice(ctx, id, reason ?? "");
      return { message: "Purchase invoice cancelled." };
    },
    PATHS,
  );
}
