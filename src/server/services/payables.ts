/**
 * Accounts payable — the mirror image of client billing (src/server/services/billing.ts), but for
 * money going OUT to vendors (uniform/kit suppliers, equipment, utilities, professional services).
 *
 * A vendor bill is recorded as a PurchaseInvoice with line items. We rarely pay it in full in cash:
 * we may be required to withhold tax (WHT) and remit it to the tax authority on the vendor's behalf,
 * or apply another agreed short-payment. Both cash paid (VendorPayment) and non-cash deductions
 * (PurchaseInvoiceDeduction — always justified with a reason and evidenced with a supporting
 * document reference) reduce the outstanding balance; either can bring an invoice to PAID.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";
import { postApDeduction, postApInvoice, postApPayment } from "./gl-posting";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

// ─────────────────────────────── Vendors ───────────────────────────────

export const vendorSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  category: z.enum([
    "UNIFORM_KITS",
    "EQUIPMENT",
    "UTILITIES",
    "PROFESSIONAL_SERVICES",
    "RENT",
    "MAINTENANCE",
    "OTHER",
  ]),
  contactPerson: opt,
  phone: opt,
  email: opt,
  address: opt,
  taxId: opt,
  bankName: opt,
  accountNumber: opt,
  accountName: opt,
});

export async function createVendor(ctx: Ctx, raw: z.input<typeof vendorSchema>) {
  assertCan(ctx, "payment.manage");
  const v = vendorSchema.parse(raw);
  const exists = await db.vendor.findFirst({ where: { organizationId: ctx.orgId, name: v.name } });
  if (exists) throw new BusinessError("A vendor with this name already exists.");
  const vendor = await db.vendor.create({
    data: {
      organizationId: ctx.orgId,
      name: v.name,
      category: v.category,
      contactPerson: v.contactPerson ?? null,
      phone: v.phone ?? null,
      email: v.email ?? null,
      address: v.address ?? null,
      taxId: v.taxId ?? null,
      bankName: v.bankName ?? null,
      accountNumber: v.accountNumber ?? null,
      accountName: v.accountName ?? null,
    },
  });
  await logAudit(ctx, { action: "VENDOR_CREATE", entity: "Vendor", entityId: vendor.id, newValue: vendor });
  return vendor;
}

export async function setVendorActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "payment.manage");
  const vendor = await db.vendor.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!vendor) throw new BusinessError("Vendor not found.");
  await db.vendor.update({ where: { id }, data: { active } });
  await logAudit(ctx, {
    action: active ? "VENDOR_ACTIVATE" : "VENDOR_DEACTIVATE",
    entity: "Vendor",
    entityId: id,
  });
}

export async function listVendors(ctx: Ctx) {
  return db.vendor.findMany({
    where: { organizationId: ctx.orgId },
    include: { _count: { select: { invoices: true } } },
    orderBy: { name: "asc" },
  });
}

// ─────────────────────────────── Purchase invoices ───────────────────────────────

export const purchaseInvoiceLineSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.coerce.number().positive().default(1),
  rate: z.coerce.number().min(0),
});

export const purchaseInvoiceSchema = z.object({
  vendorId: z.string().min(1),
  vendorRef: opt,
  costCenterId: opt,
  description: z.string().trim().min(2, "Description is required"),
  invoiceDate: z.string().min(10, "Invoice date is required"),
  dueDate: z.string().min(10, "Due date is required"),
  vatPct: z.coerce.number().min(0).max(100).optional(),
  lines: z.array(purchaseInvoiceLineSchema).min(1, "At least one line is required"),
});

export async function createPurchaseInvoice(ctx: Ctx, raw: z.input<typeof purchaseInvoiceSchema>) {
  assertCan(ctx, "payment.manage");
  const v = purchaseInvoiceSchema.parse(raw);
  const vendor = await db.vendor.findFirst({ where: { id: v.vendorId, organizationId: ctx.orgId } });
  if (!vendor) throw new BusinessError("Vendor not found.");
  if (v.costCenterId) {
    const cc = await db.costCenter.findFirst({ where: { id: v.costCenterId, organizationId: ctx.orgId } });
    if (!cc) throw new BusinessError("Cost center not found.");
  }
  const vatPct = v.vatPct ?? 0;
  const lineData = v.lines.map((l, i) => ({
    description: l.description,
    quantity: l.quantity,
    rate: l.rate,
    amount: round2(l.quantity * l.rate),
    sortOrder: i,
  }));
  const subtotal = round2(lineData.reduce((a, l) => a + l.amount, 0));
  const vatAmount = round2((subtotal * vatPct) / 100);
  return db.$transaction(async (tx) => {
    const invoiceNumber = await nextNumber(tx, ctx.orgId, "PURCHASE_INVOICE");
    const inv = await tx.purchaseInvoice.create({
      data: {
        organizationId: ctx.orgId,
        vendorId: v.vendorId,
        invoiceNumber,
        vendorRef: v.vendorRef ?? null,
        costCenterId: v.costCenterId ?? null,
        description: v.description,
        invoiceDate: d(v.invoiceDate),
        dueDate: d(v.dueDate),
        subtotal,
        vatPct,
        vatAmount,
        totalAmount: round2(subtotal + vatAmount),
        createdBy: ctx.name,
        lines: { create: lineData },
      },
    });
    await postApInvoice(ctx, tx, inv);
    await logAudit(
      ctx,
      { action: "PURCHASE_INVOICE_CREATE", entity: "PurchaseInvoice", entityId: inv.id, newValue: inv },
      tx,
    );
    return inv;
  });
}

export async function listPurchaseInvoices(
  ctx: Ctx,
  filter: { vendorId?: string; status?: string; from?: string; to?: string } = {},
) {
  return db.purchaseInvoice.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
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
    include: { vendor: true, costCenter: true },
    orderBy: [{ invoiceDate: "desc" }, { invoiceNumber: "desc" }],
    take: 500,
  });
}

export async function getPurchaseInvoice(ctx: Ctx, id: string) {
  return db.purchaseInvoice.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      vendor: true,
      costCenter: true,
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { paidDate: "desc" } },
      deductions: { orderBy: { createdAt: "desc" } },
    },
  });
}

/** Every vendor's billed / paid / deducted / outstanding, across every invoice (optionally date-ranged). */
export async function payablesSummary(ctx: Ctx, filter: { from?: string; to?: string } = {}) {
  assertCan(ctx, "gl.view");
  const invoices = await listPurchaseInvoices(ctx, filter);
  const today = d(iso(new Date()));
  const byVendor = new Map<
    string,
    {
      vendorName: string;
      billed: number;
      paid: number;
      deducted: number;
      outstanding: number;
      overdue: number;
      invoices: number;
    }
  >();
  for (const inv of invoices) {
    if (inv.status === "CANCELLED") continue;
    const k = inv.vendorId;
    const row = byVendor.get(k) ?? {
      vendorName: inv.vendor.name,
      billed: 0,
      paid: 0,
      deducted: 0,
      outstanding: 0,
      overdue: 0,
      invoices: 0,
    };
    const balance = round2(num(inv.totalAmount) - num(inv.amountPaid) - num(inv.totalDeductions));
    row.billed = round2(row.billed + num(inv.totalAmount));
    row.paid = round2(row.paid + num(inv.amountPaid));
    row.deducted = round2(row.deducted + num(inv.totalDeductions));
    row.outstanding = round2(row.outstanding + balance);
    if (balance > 0 && inv.dueDate < today) row.overdue = round2(row.overdue + balance);
    row.invoices += 1;
    byVendor.set(k, row);
  }
  const rows = [...byVendor.values()].sort((a, b) => b.outstanding - a.outstanding);
  return {
    invoices,
    rows,
    totals: {
      billed: round2(rows.reduce((a, r) => a + r.billed, 0)),
      paid: round2(rows.reduce((a, r) => a + r.paid, 0)),
      deducted: round2(rows.reduce((a, r) => a + r.deducted, 0)),
      outstanding: round2(rows.reduce((a, r) => a + r.outstanding, 0)),
      overdue: round2(rows.reduce((a, r) => a + r.overdue, 0)),
    },
  };
}

const balanceOf = (inv: { totalAmount: unknown; amountPaid: unknown; totalDeductions: unknown }) =>
  round2(num(inv.totalAmount) - num(inv.amountPaid) - num(inv.totalDeductions));

export const vendorPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  paidDate: z.string().min(10),
  method: opt,
  reference: opt,
});

export async function recordVendorPayment(ctx: Ctx, raw: z.input<typeof vendorPaymentSchema>) {
  assertCan(ctx, "payment.manage");
  const v = vendorPaymentSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const inv = await tx.purchaseInvoice.findFirst({ where: { id: v.invoiceId, organizationId: ctx.orgId } });
    if (!inv) throw new BusinessError("Purchase invoice not found.");
    if (inv.status === "CANCELLED") throw new BusinessError("This invoice was cancelled.");
    const balance = balanceOf(inv);
    if (v.amount > balance + 0.01)
      throw new BusinessError(`Amount exceeds the outstanding balance of ₦${balance.toFixed(2)}.`);
    const payment = await tx.vendorPayment.create({
      data: {
        organizationId: ctx.orgId,
        invoiceId: inv.id,
        vendorId: inv.vendorId,
        amount: v.amount,
        paidDate: d(v.paidDate),
        method: v.method ?? null,
        reference: v.reference ?? null,
        recordedBy: ctx.name,
      },
    });
    const amountPaid = round2(num(inv.amountPaid) + v.amount);
    await tx.purchaseInvoice.update({
      where: { id: inv.id },
      data: {
        amountPaid,
        status: amountPaid + num(inv.totalDeductions) >= num(inv.totalAmount) ? "PAID" : "PARTIALLY_PAID",
      },
    });
    await postApPayment(ctx, tx, payment, inv.invoiceNumber);
    await logAudit(
      ctx,
      {
        action: "VENDOR_PAYMENT_RECORD",
        entity: "PurchaseInvoice",
        entityId: inv.id,
        newValue: { amount: v.amount, paidDate: v.paidDate, reference: v.reference },
      },
      tx,
    );
    return payment;
  });
}

export const purchaseInvoiceDeductionSchema = z.object({
  invoiceId: z.string().min(1),
  type: z.enum(["WITHHOLDING_TAX", "OTHER"]),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  reason: z.string().trim().min(10, "Give a documented justification (at least 10 characters)."),
  supportingDocument: z.string().trim().min(2, "A supporting document reference is required."),
});

/**
 * Records a deduction WE applied instead of paying a vendor bill in full — withholding tax we're
 * required to remit on the vendor's behalf, or any other agreed short-payment — always with a
 * reason and a supporting document reference, never silently.
 */
export async function recordPurchaseInvoiceDeduction(
  ctx: Ctx,
  raw: z.input<typeof purchaseInvoiceDeductionSchema>,
) {
  assertCan(ctx, "payment.manage");
  const v = purchaseInvoiceDeductionSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const inv = await tx.purchaseInvoice.findFirst({ where: { id: v.invoiceId, organizationId: ctx.orgId } });
    if (!inv) throw new BusinessError("Purchase invoice not found.");
    if (inv.status === "CANCELLED") throw new BusinessError("This invoice was cancelled.");
    const balance = balanceOf(inv);
    if (v.amount > balance + 0.01)
      throw new BusinessError(`Amount exceeds the outstanding balance of ₦${balance.toFixed(2)}.`);
    const deduction = await tx.purchaseInvoiceDeduction.create({
      data: {
        organizationId: ctx.orgId,
        invoiceId: inv.id,
        vendorId: inv.vendorId,
        type: v.type,
        amount: v.amount,
        reason: v.reason,
        supportingDocument: v.supportingDocument,
        recordedBy: ctx.name,
      },
    });
    const totalDeductions = round2(num(inv.totalDeductions) + v.amount);
    await tx.purchaseInvoice.update({
      where: { id: inv.id },
      data: {
        totalDeductions,
        status: num(inv.amountPaid) + totalDeductions >= num(inv.totalAmount) ? "PAID" : "PARTIALLY_PAID",
      },
    });
    await postApDeduction(ctx, tx, deduction, inv.invoiceNumber);
    await logAudit(
      ctx,
      {
        action: "PURCHASE_INVOICE_DEDUCTION_RECORD",
        entity: "PurchaseInvoice",
        entityId: inv.id,
        newValue: { type: v.type, amount: v.amount, supportingDocument: v.supportingDocument },
        reason: v.reason,
      },
      tx,
    );
    return deduction;
  });
}

export async function cancelPurchaseInvoice(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "payment.manage");
  if (!reason || reason.trim().length < 5)
    throw new BusinessError("Give a reason for cancelling this invoice.");
  const inv = await db.purchaseInvoice.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!inv) throw new BusinessError("Purchase invoice not found.");
  if (num(inv.amountPaid) > 0 || num(inv.totalDeductions) > 0)
    throw new BusinessError("An invoice with payments or deductions against it cannot be cancelled.");
  if (inv.status === "CANCELLED") throw new BusinessError("This invoice is already cancelled.");
  await db.purchaseInvoice.update({ where: { id }, data: { status: "CANCELLED", notes: reason } });
  await logAudit(ctx, {
    action: "PURCHASE_INVOICE_CANCEL",
    entity: "PurchaseInvoice",
    entityId: id,
    reason,
  });
}
