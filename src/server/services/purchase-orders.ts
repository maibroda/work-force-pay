/**
 * Purchase orders — requested and approved before a vendor bill exists, then converted to a
 * PurchaseInvoice once the bill actually arrives. Mirrors payables.ts's invoice-creation math
 * (subtotal/VAT/total from lines) but adds a request → approve/reject → convert lifecycle instead
 * of recording a bill directly.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";
import { createPurchaseInvoice } from "./payables";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const purchaseOrderLineSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.coerce.number().positive().default(1),
  rate: z.coerce.number().min(0),
});

export const purchaseOrderSchema = z.object({
  vendorId: z.string().min(1),
  costCenterId: opt,
  description: z.string().trim().min(2, "Description is required"),
  vatPct: z.coerce.number().min(0).max(100).optional(),
  lines: z.array(purchaseOrderLineSchema).min(1, "At least one line is required"),
  notes: opt,
});

export async function createPurchaseOrder(ctx: Ctx, raw: z.input<typeof purchaseOrderSchema>) {
  assertCan(ctx, "payment.manage");
  const v = purchaseOrderSchema.parse(raw);
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
    const orderNumber = await nextNumber(tx, ctx.orgId, "PURCHASE_ORDER");
    const order = await tx.purchaseOrder.create({
      data: {
        organizationId: ctx.orgId,
        orderNumber,
        vendorId: v.vendorId,
        costCenterId: v.costCenterId ?? null,
        description: v.description,
        subtotal,
        vatPct,
        vatAmount,
        totalAmount: round2(subtotal + vatAmount),
        notes: v.notes ?? null,
        requestedBy: ctx.name,
        lines: { create: lineData },
      },
    });
    await logAudit(
      ctx,
      { action: "PURCHASE_ORDER_CREATE", entity: "PurchaseOrder", entityId: order.id, newValue: order },
      tx,
    );
    return order;
  });
}

export async function submitPurchaseOrder(ctx: Ctx, id: string) {
  assertCan(ctx, "payment.manage");
  const order = await db.purchaseOrder.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!order) throw new BusinessError("Purchase order not found.");
  if (order.status !== "DRAFT") throw new BusinessError("Only a draft order can be submitted for approval.");
  const updated = await db.purchaseOrder.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
  await logAudit(ctx, { action: "PURCHASE_ORDER_SUBMIT", entity: "PurchaseOrder", entityId: id });
  return updated;
}

export async function decidePurchaseOrder(
  ctx: Ctx,
  id: string,
  decision: "APPROVED" | "REJECTED",
  reason?: string,
) {
  assertCan(ctx, "payment.manage");
  if (decision === "REJECTED" && (!reason || reason.trim().length < 5))
    throw new BusinessError("Give a reason for rejecting this order.");
  const order = await db.purchaseOrder.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!order) throw new BusinessError("Purchase order not found.");
  if (order.status !== "PENDING_APPROVAL")
    throw new BusinessError("Only an order pending approval can be approved or rejected.");
  const updated = await db.purchaseOrder.update({
    where: { id },
    data: {
      status: decision,
      decidedBy: ctx.name,
      decidedAt: new Date(),
      decisionReason: reason?.trim() || null,
    },
  });
  await logAudit(ctx, {
    action: decision === "APPROVED" ? "PURCHASE_ORDER_APPROVE" : "PURCHASE_ORDER_REJECT",
    entity: "PurchaseOrder",
    entityId: id,
    reason: reason?.trim(),
  });
  return updated;
}

export async function cancelPurchaseOrder(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "payment.manage");
  if (!reason || reason.trim().length < 5) throw new BusinessError("Give a reason for cancelling this order.");
  const order = await db.purchaseOrder.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!order) throw new BusinessError("Purchase order not found.");
  if (order.status === "CONVERTED") throw new BusinessError("A converted order can't be cancelled.");
  if (order.status === "CANCELLED") throw new BusinessError("This order is already cancelled.");
  const updated = await db.purchaseOrder.update({
    where: { id },
    data: { status: "CANCELLED", decisionReason: reason.trim() },
  });
  await logAudit(ctx, { action: "PURCHASE_ORDER_CANCEL", entity: "PurchaseOrder", entityId: id, reason });
  return updated;
}

export const convertPurchaseOrderSchema = z.object({
  purchaseOrderId: z.string().min(1),
  vendorRef: opt,
  invoiceDate: z.string().min(10),
  dueDate: z.string().min(10),
});

/** Turns an APPROVED order into a PurchaseInvoice, carrying over vendor, cost center, lines and VAT. */
export async function convertPurchaseOrderToInvoice(ctx: Ctx, raw: z.input<typeof convertPurchaseOrderSchema>) {
  assertCan(ctx, "payment.manage");
  const v = convertPurchaseOrderSchema.parse(raw);
  const order = await db.purchaseOrder.findFirst({
    where: { id: v.purchaseOrderId, organizationId: ctx.orgId },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!order) throw new BusinessError("Purchase order not found.");
  if (order.status !== "APPROVED") throw new BusinessError("Only an approved order can be converted to a bill.");
  if (d(v.dueDate) < d(v.invoiceDate)) throw new BusinessError("Due date can't be before the invoice date.");

  const invoice = await createPurchaseInvoice(ctx, {
    vendorId: order.vendorId,
    vendorRef: v.vendorRef,
    costCenterId: order.costCenterId ?? undefined,
    description: order.description,
    invoiceDate: v.invoiceDate,
    dueDate: v.dueDate,
    vatPct: num(order.vatPct),
    lines: order.lines.map((l) => ({
      description: l.description,
      quantity: num(l.quantity),
      rate: num(l.rate),
    })),
  } as never);

  // Link the two records and flip the order to CONVERTED together, so a failure here can't leave
  // an invoice that exists without a status change (the invoice itself is already safely recorded
  // by this point either way).
  const [updatedInvoice] = await db.$transaction([
    db.purchaseInvoice.update({ where: { id: invoice.id }, data: { purchaseOrderId: order.id } }),
    db.purchaseOrder.update({ where: { id: order.id }, data: { status: "CONVERTED" } }),
  ]);
  await logAudit(ctx, {
    action: "PURCHASE_ORDER_CONVERT",
    entity: "PurchaseOrder",
    entityId: order.id,
    newValue: { purchaseInvoiceId: invoice.id },
  });
  return updatedInvoice;
}

export async function listPurchaseOrders(ctx: Ctx, filter: { vendorId?: string; status?: string } = {}) {
  return db.purchaseOrder.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
    },
    include: { vendor: true, costCenter: true },
    orderBy: { requestedAt: "desc" },
    take: 500,
  });
}

export async function getPurchaseOrder(ctx: Ctx, id: string) {
  return db.purchaseOrder.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: {
      vendor: true,
      costCenter: true,
      lines: { orderBy: { sortOrder: "asc" } },
      convertedInvoice: true,
    },
  });
}
