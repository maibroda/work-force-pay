"use server";
import { act } from "./_run";
import * as billing from "@/server/services/billing";

type V = Record<string, unknown>;

const PATHS = ["/finance/invoices"];

export async function submitInvoiceAction(id: string) {
  return act("payment.manage", async (ctx) => {
    await billing.submitInvoice(ctx, id);
    return { message: "Submitted. Someone else has to approve it before it is posted." };
  }, PATHS);
}

export async function approveInvoiceAction(id: string) {
  return act("invoice.approve", async (ctx) => {
    const inv = await billing.approveInvoice(ctx, id);
    return { message: `Approved and posted as ${inv.invoiceNumber}.`, redirectTo: `/finance/invoices/${id}` };
  }, PATHS);
}

export async function rejectInvoiceAction(id: string, note?: string) {
  return act("invoice.approve", async (ctx) => {
    await billing.rejectInvoice(ctx, id, note ?? "");
    return { message: "Sent back to the preparer." };
  }, PATHS);
}

export async function discardDraftAction(id: string, reason?: string) {
  return act("payment.manage", async (ctx) => {
    await billing.discardDraft(ctx, id, reason ?? "");
    return { message: "Draft discarded. The payroll run can be invoiced again.", redirectTo: "/finance/invoices" };
  }, PATHS);
}

export async function markInvoiceSentAction(id: string, via?: string) {
  return act("payment.manage", async (ctx) => {
    await billing.markInvoiceSent(ctx, id, via ?? "");
    return { message: "Recorded as sent." };
  }, PATHS);
}

export async function setInvoiceApprovalRequiredAction(required: boolean) {
  return act("period.approve", async (ctx) => {
    await billing.setInvoiceApprovalRequired(ctx, required);
    return { message: required ? "Invoices are now generated as drafts that a second person approves." : "Invoices post as soon as they are generated." };
  }, PATHS);
}

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
