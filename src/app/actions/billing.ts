"use server";
import { act } from "./_run";
import * as billing from "@/server/services/billing";

type V = Record<string, unknown>;

const PATHS = ["/finance/invoices"];

export async function generateInvoicesAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const invoices = await billing.generateInvoices(ctx, String(v.runId), {
        vatPct: v.vatPct ? Number(v.vatPct) : 0,
        whtPct: v.whtPct ? Number(v.whtPct) : 0,
        directChargePct: v.directChargePct ? Number(v.directChargePct) : 90,
        indirectChargePct: v.indirectChargePct ? Number(v.indirectChargePct) : 10,
      });
      return { message: `${invoices.length} invoice(s) generated.` };
    },
    PATHS,
  );
}

export async function recordReceiptAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      await billing.recordReceipt(ctx, v as never);
      return { message: "Receipt recorded." };
    },
    PATHS,
  );
}

export async function recordDeductionAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      await billing.recordDeduction(ctx, v as never);
      return { message: "Deduction recorded." };
    },
    PATHS,
  );
}

export async function cancelInvoiceAction(id: string, reason?: string) {
  return act(
    "payment.manage",
    async (ctx) => {
      await billing.cancelInvoice(ctx, id, reason ?? "");
      return { message: "Invoice cancelled." };
    },
    PATHS,
  );
}
