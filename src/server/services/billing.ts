/**
 * Client billing / invoicing — the accounts-receivable side of payroll. One invoice per client is
 * generated from a payroll run's client billing (see reports.ts `payrollByContractAndCategory`), with
 * one line per employee category billed (Guard, Supervisor, …) — quantity × rate = amount, prefixed
 * with the contract name when a client has more than one contract on the invoice. Invoices are never
 * edited once issued — corrections belong in the next run.
 *
 * Each line's charge-out amount is split **Direct charge** (default 90%) / **Indirect charge**
 * (default 10%) per employer category. VAT is charged on the total Indirect charge only, not on the
 * full subtotal (the direct, pass-through-cost portion of the charge-out rate is not VATable).
 *
 * A client rarely pays the full invoice value in cash: they may withhold tax (WHT), apply a leave-
 * allowance credit, or another agreed deduction. Both cash received (ClientReceipt) and non-cash
 * deductions (ClientInvoiceDeduction — always justified with a reason and evidenced with a supporting
 * document reference) reduce the outstanding balance; either can bring an invoice to PAID.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { addDays, d, iso } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";
import { payrollByContractAndCategory } from "./reports";
import { postArDeduction, postArInvoice, postArInvoiceCancellation, postArReceipt } from "./gl-posting";
import { recordInvoiceTax, resolveTax, reverseInvoiceTax } from "./tax-engine";

const DEFAULT_PAYMENT_TERMS_DAYS = 30;

export interface GenerateInvoicesOptions {
  /** Leave out to read the rate in force on the invoice date from the tax engine (none, if no tax codes are set up). */
  vatPct?: number;
  whtPct?: number;
  /** Default 90/10 — must sum to 100. */
  directChargePct?: number;
  indirectChargePct?: number;
}

/** Generates one invoice per billed client from a locked (or paid) payroll run. */
export async function generateInvoices(ctx: Ctx, runId: string, opts: GenerateInvoicesOptions = {}) {
  assertCan(ctx, "payment.manage");
  const directChargePct = opts.directChargePct ?? 90;
  const indirectChargePct = opts.indirectChargePct ?? 10;
  if (Math.abs(directChargePct + indirectChargePct - 100) > 0.01)
    throw new BusinessError("Direct charge % and indirect charge % must add up to 100%.");
  const run = await db.payrollRun.findFirst({
    where: { id: runId, organizationId: ctx.orgId },
    include: { period: true },
  });
  if (!run) throw new BusinessError("Payroll run not found.");
  if (!["LOCKED", "PAID"].includes(run.status))
    throw new BusinessError("Invoices can only be generated from a locked payroll.");
  const existing = await db.clientInvoice.count({ where: { runId } });
  if (existing) throw new BusinessError("Invoices already exist for this payroll run.");

  const contractLines = (await payrollByContractAndCategory(ctx, runId)).filter((c) => c.revenue > 0);
  if (!contractLines.length) throw new BusinessError("No billable client charges on this payroll run.");

  const byClient = new Map<string, { clientName: string; contracts: typeof contractLines }>();
  for (const c of contractLines) {
    const g = byClient.get(c.clientId) ?? { clientName: c.clientName, contracts: [] };
    g.contracts.push(c);
    byClient.set(c.clientId, g);
  }

  const invoiceDate = run.period.endDate;
  const dueDate = addDays(invoiceDate, DEFAULT_PAYMENT_TERMS_DAYS);
  return db.$transaction(async (tx) => {
    // the rates in force on the invoice date: from the tax engine, unless a rate was typed for this run
    const vat = await resolveTax(tx, ctx.orgId, "VAT", invoiceDate, opts.vatPct);
    const wht = await resolveTax(tx, ctx.orgId, "WHT", invoiceDate, opts.whtPct);
    const vatPct = vat.ratePct;
    const whtPct = wht.ratePct;
    const taxBasis = { date: iso(invoiceDate), vat: { code: vat.code, ratePct: vatPct, source: vat.source }, wht: { code: wht.code, ratePct: whtPct, source: wht.source } };
    const invoices = [];
    for (const [clientId, g] of byClient) {
      const subtotal = round2(g.contracts.reduce((a, c) => a + c.revenue, 0));
      const invoiceNumber = await nextNumber(tx, ctx.orgId, "INVOICE");
      const multiContract = g.contracts.length > 1;
      const lineData: Array<{
        contractId: string;
        categoryName: string;
        description: string;
        headcount: number;
        rate: number;
        amount: number;
        directCharge: number;
        indirectCharge: number;
        sortOrder: number;
      }> = [];
      let i = 0;
      for (const c of g.contracts)
        for (const cat of c.categories.filter((x) => x.revenue > 0)) {
          const directCharge = round2((cat.revenue * directChargePct) / 100);
          lineData.push({
            contractId: c.contractId,
            categoryName: cat.categoryName,
            description: multiContract ? `${c.contractName} — ${cat.categoryName}` : cat.categoryName,
            headcount: cat.headcount,
            rate: cat.revenueRate,
            amount: cat.revenue,
            directCharge,
            indirectCharge: round2(cat.revenue - directCharge), // the two always sum to the line amount
            sortOrder: i++,
          });
        }
      const totalDirectCharge = round2(lineData.reduce((a, l) => a + l.directCharge, 0));
      const totalIndirectCharge = round2(lineData.reduce((a, l) => a + l.indirectCharge, 0));
      const vatAmount = round2((totalIndirectCharge * vatPct) / 100);
      const whtAmount = round2((subtotal * whtPct) / 100);
      const inv = await tx.clientInvoice.create({
        data: {
          organizationId: ctx.orgId,
          clientId,
          runId,
          periodId: run.periodId,
          invoiceNumber,
          invoiceDate,
          dueDate,
          subtotal,
          directChargePct,
          indirectChargePct,
          totalDirectCharge,
          totalIndirectCharge,
          vatPct,
          vatAmount,
          whtPct,
          whtAmount,
          totalAmount: round2(subtotal + vatAmount),
          taxBasis,
          createdBy: ctx.name,
          lines: { create: lineData },
        },
        include: { lines: true },
      });
      await recordInvoiceTax(tx, ctx.orgId, inv, { vat: vat.taxCodeId, wht: wht.taxCodeId });
      await postArInvoice(ctx, tx, inv);
      invoices.push(inv);
    }
    await logAudit(
      ctx,
      {
        action: "INVOICES_GENERATE",
        entity: "PayrollRun",
        entityId: runId,
        newValue: {
          period: run.period.name,
          invoices: invoices.length,
          vatPct,
          whtPct,
          directChargePct,
          indirectChargePct,
          taxBasis,
        },
      },
      tx,
    );
    return invoices;
  });
}

export async function listInvoices(
  ctx: Ctx,
  filter: { clientId?: string; status?: string; from?: string; to?: string } = {},
) {
  return db.clientInvoice.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.from || filter.to
        ? {
            invoiceDate: {
              ...(filter.from ? { gte: d(filter.from) } : {}),
              ...(filter.to ? { lte: d(filter.to) } : {}),
            },
          }
        : {}),
    },
    include: { client: true, period: true, run: true },
    orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }],
    take: 500,
  });
}

export async function getInvoice(ctx: Ctx, id: string) {
  return db.clientInvoice.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      client: true,
      period: true,
      run: true,
      lines: { include: { beat: true, contract: true }, orderBy: { sortOrder: "asc" } },
      receipts: { orderBy: { receivedDate: "desc" } },
      deductions: { orderBy: { createdAt: "desc" } },
    },
  });
}

/** Runs already LOCKED/PAID that have no invoices yet. */
export async function unbilledRuns(ctx: Ctx) {
  assertCan(ctx, "payment.manage");
  return db.payrollRun.findMany({
    where: { organizationId: ctx.orgId, status: { in: ["LOCKED", "PAID"] }, invoices: { none: {} } },
    include: { period: true },
    orderBy: [{ period: { year: "asc" } }, { period: { month: "asc" } }, { runNumber: "asc" }],
  });
}

/** Every client's billed / received / deducted / outstanding, across every invoice (optionally date-ranged). */
export async function receivablesSummary(ctx: Ctx, filter: { from?: string; to?: string } = {}) {
  assertCan(ctx, "client.view");
  const invoices = await listInvoices(ctx, filter);
  const today = d(iso(new Date()));
  const byClient = new Map<
    string,
    {
      clientName: string;
      billed: number;
      received: number;
      deducted: number;
      outstanding: number;
      overdue: number;
      invoices: number;
    }
  >();
  for (const inv of invoices) {
    if (inv.status === "CANCELLED") continue;
    const k = inv.clientId;
    const row = byClient.get(k) ?? {
      clientName: inv.client.name,
      billed: 0,
      received: 0,
      deducted: 0,
      outstanding: 0,
      overdue: 0,
      invoices: 0,
    };
    const balance = round2(num(inv.totalAmount) - num(inv.amountPaid) - num(inv.totalDeductions));
    row.billed = round2(row.billed + num(inv.totalAmount));
    row.received = round2(row.received + num(inv.amountPaid));
    row.deducted = round2(row.deducted + num(inv.totalDeductions));
    row.outstanding = round2(row.outstanding + balance);
    if (balance > 0 && inv.dueDate < today) row.overdue = round2(row.overdue + balance);
    row.invoices += 1;
    byClient.set(k, row);
  }
  const rows = [...byClient.values()].sort((a, b) => b.outstanding - a.outstanding);
  return {
    invoices,
    rows,
    totals: {
      billed: round2(rows.reduce((a, r) => a + r.billed, 0)),
      received: round2(rows.reduce((a, r) => a + r.received, 0)),
      deducted: round2(rows.reduce((a, r) => a + r.deducted, 0)),
      outstanding: round2(rows.reduce((a, r) => a + r.outstanding, 0)),
      overdue: round2(rows.reduce((a, r) => a + r.overdue, 0)),
    },
  };
}

const balanceOf = (inv: { totalAmount: unknown; amountPaid: unknown; totalDeductions: unknown }) =>
  round2(num(inv.totalAmount) - num(inv.amountPaid) - num(inv.totalDeductions));

export const receiptSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  receivedDate: z.string().min(10),
  method: z.string().trim().optional(),
  reference: z.string().trim().optional(),
});

export async function recordReceipt(ctx: Ctx, raw: z.input<typeof receiptSchema>) {
  assertCan(ctx, "payment.manage");
  const v = receiptSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const inv = await tx.clientInvoice.findFirst({ where: { id: v.invoiceId, organizationId: ctx.orgId } });
    if (!inv) throw new BusinessError("Invoice not found.");
    if (inv.status === "CANCELLED") throw new BusinessError("This invoice was cancelled.");
    const balance = balanceOf(inv);
    if (v.amount > balance + 0.01)
      throw new BusinessError(`Amount exceeds the outstanding balance of ₦${balance.toFixed(2)}.`);
    const receipt = await tx.clientReceipt.create({
      data: {
        organizationId: ctx.orgId,
        invoiceId: inv.id,
        clientId: inv.clientId,
        amount: v.amount,
        receivedDate: d(v.receivedDate),
        method: v.method || null,
        reference: v.reference || null,
        recordedBy: ctx.name,
      },
    });
    const amountPaid = round2(num(inv.amountPaid) + v.amount);
    await tx.clientInvoice.update({
      where: { id: inv.id },
      data: {
        amountPaid,
        status: amountPaid + num(inv.totalDeductions) >= num(inv.totalAmount) ? "PAID" : "PARTIALLY_PAID",
      },
    });
    await postArReceipt(ctx, tx, receipt, inv.invoiceNumber);
    await logAudit(
      ctx,
      {
        action: "CLIENT_RECEIPT_RECORD",
        entity: "ClientInvoice",
        entityId: inv.id,
        newValue: { amount: v.amount, receivedDate: v.receivedDate, reference: v.reference },
      },
      tx,
    );
    return receipt;
  });
}

export const deductionSchema = z.object({
  invoiceId: z.string().min(1),
  type: z.enum(["WITHHOLDING_TAX", "LEAVE_ALLOWANCE", "OTHER"]),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  reason: z.string().trim().min(10, "Give a documented justification (at least 10 characters)."),
  supportingDocument: z.string().trim().min(2, "A supporting document reference is required."),
});

/**
 * Records a deduction the client applied instead of paying in full — withholding tax, a leave-
 * allowance credit, or any other agreed amount — always with a reason and a supporting document
 * reference (WHT credit note number, correspondence reference, etc.), never silently.
 */
export async function recordDeduction(ctx: Ctx, raw: z.input<typeof deductionSchema>) {
  assertCan(ctx, "payment.manage");
  const v = deductionSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const inv = await tx.clientInvoice.findFirst({ where: { id: v.invoiceId, organizationId: ctx.orgId } });
    if (!inv) throw new BusinessError("Invoice not found.");
    if (inv.status === "CANCELLED") throw new BusinessError("This invoice was cancelled.");
    const balance = balanceOf(inv);
    if (v.amount > balance + 0.01)
      throw new BusinessError(`Amount exceeds the outstanding balance of ₦${balance.toFixed(2)}.`);
    const deduction = await tx.clientInvoiceDeduction.create({
      data: {
        organizationId: ctx.orgId,
        invoiceId: inv.id,
        clientId: inv.clientId,
        type: v.type,
        amount: v.amount,
        reason: v.reason,
        supportingDocument: v.supportingDocument,
        recordedBy: ctx.name,
      },
    });
    const totalDeductions = round2(num(inv.totalDeductions) + v.amount);
    await tx.clientInvoice.update({
      where: { id: inv.id },
      data: {
        totalDeductions,
        status: num(inv.amountPaid) + totalDeductions >= num(inv.totalAmount) ? "PAID" : "PARTIALLY_PAID",
      },
    });
    await postArDeduction(ctx, tx, deduction, inv.invoiceNumber);
    await logAudit(
      ctx,
      {
        action: "CLIENT_INVOICE_DEDUCTION_RECORD",
        entity: "ClientInvoice",
        entityId: inv.id,
        newValue: { type: v.type, amount: v.amount, supportingDocument: v.supportingDocument },
        reason: v.reason,
      },
      tx,
    );
    return deduction;
  });
}

export async function cancelInvoice(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "payment.manage");
  if (!reason || reason.trim().length < 5)
    throw new BusinessError("Give a reason for cancelling this invoice.");
  const inv = await db.clientInvoice.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!inv) throw new BusinessError("Invoice not found.");
  if (num(inv.amountPaid) > 0 || num(inv.totalDeductions) > 0)
    throw new BusinessError("An invoice with payments or deductions against it cannot be cancelled.");
  if (inv.status === "CANCELLED") throw new BusinessError("This invoice is already cancelled.");
  // The status change and the reversing journal commit together, so a cancelled invoice never stays in the ledger.
  await db.$transaction(async (tx) => {
    await tx.clientInvoice.update({ where: { id }, data: { status: "CANCELLED", notes: reason } });
    await reverseInvoiceTax(tx, id);
    await postArInvoiceCancellation(ctx, tx, inv, new Date(new Date().toISOString().slice(0, 10)));
    await logAudit(ctx, { action: "CLIENT_INVOICE_CANCEL", entity: "ClientInvoice", entityId: id, reason }, tx);
  });
}
