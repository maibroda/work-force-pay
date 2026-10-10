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
        // blank = the rate in force from the tax engine; a number (even 0) is a rate typed for this run
        vatPct: v.vatPct !== undefined && v.vatPct !== null && String(v.vatPct).trim() !== "" ? Number(v.vatPct) : undefined,
        whtPct: v.whtPct !== undefined && v.whtPct !== null && String(v.whtPct).trim() !== "" ? Number(v.whtPct) : undefined,
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
