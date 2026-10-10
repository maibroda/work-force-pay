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
        // blank = each contract's billing rule; a number is a split typed for this whole run
        directChargePct: v.directChargePct !== undefined && v.directChargePct !== null && String(v.directChargePct).trim() !== "" ? Number(v.directChargePct) : undefined,
        indirectChargePct: v.indirectChargePct !== undefined && v.indirectChargePct !== null && String(v.indirectChargePct).trim() !== "" ? Number(v.indirectChargePct) : undefined,
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
