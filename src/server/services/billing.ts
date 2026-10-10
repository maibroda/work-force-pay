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
import { recordInvoiceTax, resolveTax, reverseInvoiceTax, type ResolvedTax, type TaxGroup } from "./tax-engine";
import { resolveBilling } from "./billing-rules";
import { splitCharge, taxableOf, type BillingBase, type RuleSource } from "@/lib/billing-rules";

const DEFAULT_PAYMENT_TERMS_DAYS = 30;

export interface GenerateInvoicesOptions {
  /** Leave out to read the rate in force on the invoice date from the tax engine (none, if no tax codes are set up). */
  vatPct?: number;
  whtPct?: number;
  /**
   * Leave both out to bill each contract under its billing rule (its own override, else its service type's, else the
   * built-in 90/10). Giving one or both applies that split to every contract on the run, recorded as typed. Must sum to 100.
   */
  directChargePct?: number;
  indirectChargePct?: number;
}

/** One taxed amount while an invoice is being worked out: the same code and rate across contracts add together. */
type Bucket = { taxCodeId: string | null; ratePct: number; taxable: number };

const addTo = (buckets: Map<string, Bucket>, taxCodeId: string | null, ratePct: number, taxable: number) => {
  if (taxable === 0) return;
  const key = `${taxCodeId ?? ""}|${ratePct}`;
  const b = buckets.get(key) ?? { taxCodeId, ratePct, taxable: 0 };
  b.taxable = round2(b.taxable + taxable);
  buckets.set(key, b);
};

/** Generates one invoice per billed client from a locked (or paid) payroll run. */
export async function generateInvoices(ctx: Ctx, runId: string, opts: GenerateInvoicesOptions = {}) {
  assertCan(ctx, "payment.manage");
  const typedSplit =
    opts.directChargePct !== undefined || opts.indirectChargePct !== undefined
      ? { directPct: opts.directChargePct ?? 100 - (opts.indirectChargePct ?? 0), indirectPct: opts.indirectChargePct ?? 100 - (opts.directChargePct ?? 0) }
      : null;
  if (typedSplit && Math.abs(typedSplit.directPct + typedSplit.indirectPct - 100) > 0.01)
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
    // How each contract is billed on the invoice date: its rule, with the tax rates in force that day (or typed for this run).
    const contractRows = await tx.contract.findMany({ where: { id: { in: contractLines.map((c) => c.contractId) } }, select: { id: true, serviceTypeId: true } });
    const rules = await resolveBilling(tx, ctx.orgId, contractRows, invoiceDate);
    type Taxes = { directPct: number; indirectPct: number; vatBase: BillingBase; whtBase: BillingBase; ruleId: string | null; source: RuleSource; vat: ResolvedTax; wht: ResolvedTax };
    const taxCache = new Map<string, ResolvedTax>();
    const rateFor = async (type: "VAT" | "WHT", base: BillingBase, codeId: string | null, typed: number | undefined): Promise<ResolvedTax> => {
      if (base === "NONE") return { taxCodeId: null, code: null, ratePct: 0, source: "NONE" }; // not charged, so no rate is needed
      const key = `${type}|${codeId ?? ""}|${typed ?? ""}`;
      if (!taxCache.has(key)) taxCache.set(key, await resolveTax(tx, ctx.orgId, type, invoiceDate, typed, codeId));
      return taxCache.get(key)!;
    };
    const how = new Map<string, Taxes>();
    for (const c of contractLines) {
      const r = rules.get(c.contractId)!;
      how.set(c.contractId, {
        directPct: typedSplit?.directPct ?? r.directPct,
        indirectPct: typedSplit?.indirectPct ?? r.indirectPct,
        vatBase: r.vatBase,
        whtBase: r.whtBase,
        ruleId: r.ruleId,
        source: typedSplit ? "TYPED" : r.source,
        vat: await rateFor("VAT", r.vatBase, r.vatTaxCodeId, opts.vatPct),
        wht: await rateFor("WHT", r.whtBase, r.whtTaxCodeId, opts.whtPct),
      });
    }

    const invoices = [];
    for (const [clientId, g] of byClient) {
      const subtotal = round2(g.contracts.reduce((a, c) => a + c.revenue, 0));
      const invoiceNumber = await nextNumber(tx, ctx.orgId, "INVOICE");
      const multiContract = g.contracts.length > 1;
      const lineData: Array<{
        contractId: string;
        billingRuleId: string | null;
        categoryName: string;
        description: string;
        headcount: number;
        rate: number;
        amount: number;
        directCharge: number;
        indirectCharge: number;
        sortOrder: number;
      }> = [];
      const vatBuckets = new Map<string, Bucket>();
      const whtBuckets = new Map<string, Bucket>();
      let i = 0;
      for (const c of g.contracts) {
        const h = how.get(c.contractId)!;
        for (const cat of c.categories.filter((x) => x.revenue > 0)) {
          const { direct, indirect } = splitCharge(cat.revenue, h.directPct); // the two always sum to the line amount
          const part = { amount: cat.revenue, direct, indirect };
          addTo(vatBuckets, h.vat.taxCodeId, h.vat.ratePct, taxableOf(h.vatBase, part));
          addTo(whtBuckets, h.wht.taxCodeId, h.wht.ratePct, taxableOf(h.whtBase, part));
          lineData.push({
            contractId: c.contractId,
            billingRuleId: h.ruleId,
            categoryName: cat.categoryName,
            description: multiContract ? `${c.contractName} — ${cat.categoryName}` : cat.categoryName,
            headcount: cat.headcount,
            rate: cat.revenueRate,
            amount: cat.revenue,
            directCharge: direct,
            indirectCharge: indirect,
            sortOrder: i++,
          });
        }
      }
      const totalDirectCharge = round2(lineData.reduce((a, l) => a + l.directCharge, 0));
      const totalIndirectCharge = round2(lineData.reduce((a, l) => a + l.indirectCharge, 0));
      // tax is worked out once per code and rate on everything taxable at it, so one rule gives exactly the figure it always did
      const groups = (m: Map<string, Bucket>): TaxGroup[] => [...m.values()].map((b) => ({ taxCodeId: b.taxCodeId, taxable: b.taxable, ratePct: b.ratePct, amount: round2((b.taxable * b.ratePct) / 100) }));
      const vatGroups = groups(vatBuckets);
      const whtGroups = groups(whtBuckets);
      const vatAmount = round2(vatGroups.reduce((a, x) => a + x.amount, 0));
      const whtAmount = round2(whtGroups.reduce((a, x) => a + x.amount, 0));
      const effective = (list: TaxGroup[], amount: number) => (list.length === 1 ? list[0].ratePct : list.length ? round2((amount / list.reduce((a, x) => a + x.taxable, 0)) * 100) : 0);
      const vatPct = effective(vatGroups, vatAmount);
      const whtPct = effective(whtGroups, whtAmount);
      const splits = new Set(g.contracts.map((c) => how.get(c.contractId)!.directPct));
      const directChargePct = splits.size === 1 ? [...splits][0] : round2((totalDirectCharge / subtotal) * 100);
      const summary = (list: TaxGroup[], pct: number, pick: (t: Taxes) => ResolvedTax) => {
        const used = [...new Set(g.contracts.map((c) => pick(how.get(c.contractId)!)))];
        const one = list.length <= 1 && used.every((u) => u.source === used[0].source && u.taxCodeId === used[0].taxCodeId);
        return one ? { code: used[0].code, ratePct: pct, source: used[0].source } : { code: null, ratePct: pct, source: "MIXED" };
      };
      const taxBasis = {
        date: iso(invoiceDate),
        vat: summary(vatGroups, vatPct, (t) => t.vat),
        wht: summary(whtGroups, whtPct, (t) => t.wht),
        contracts: g.contracts.map((c) => {
          const h = how.get(c.contractId)!;
          return { contractId: c.contractId, contract: c.contractName, source: h.source, ruleId: h.ruleId, directPct: h.directPct, indirectPct: h.indirectPct, vatBase: h.vatBase, whtBase: h.whtBase, vat: { code: h.vat.code, ratePct: h.vat.ratePct, source: h.vat.source }, wht: { code: h.wht.code, ratePct: h.wht.ratePct, source: h.wht.source } };
        }),
      };
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
          indirectChargePct: round2(100 - directChargePct),
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
      await recordInvoiceTax(tx, ctx.orgId, inv, { vat: null, wht: null }, { vat: vatGroups, wht: whtGroups });
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
          typedSplit,
          typedVatPct: opts.vatPct ?? null,
          typedWhtPct: opts.whtPct ?? null,
          rules: [...how.entries()].map(([contractId, h]) => ({ contractId, source: h.source, ruleId: h.ruleId, directPct: h.directPct, vat: h.vat.source, wht: h.wht.source })),
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
