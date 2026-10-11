/**
 * Goods receipts and the three-way match (purchase order ↔ goods received ↔ vendor bill).
 *
 * Receiving is its own step, done by someone other than whoever raised the order. A bill against an order is matched to what was
 * ordered and what was received; a bill with no order is held for approval above a limit; any bill that fails is an "exception" that
 * cannot be paid until a second person approves it (the database refuses the payment too). Receipts arriving or being cancelled
 * re-run the match, so a bill that arrived before the delivery clears by itself once the delivery is recorded.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import {
  DEFAULT_BILL_APPROVAL_THRESHOLD,
  DEFAULT_TOLERANCE,
  matchBill,
  matchStatusFor,
  noOrderException,
  receiptProgress,
  type MatchException,
  type MatchTolerance,
  type ReceiptProgress,
} from "@/lib/three-way-match";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

// ─────────────────────────────── Policy ───────────────────────────────

export async function matchPolicy(client: Tx | typeof db, orgId: string) {
  const org = await client.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { matchPricePct: true, matchQtyPct: true, billApprovalThreshold: true },
  });
  return {
    tolerance: { pricePct: num(org.matchPricePct), qtyPct: num(org.matchQtyPct) } satisfies MatchTolerance,
    threshold: num(org.billApprovalThreshold),
  };
}

export const matchPolicySchema = z.object({
  pricePct: z.coerce.number().min(0).max(100),
  qtyPct: z.coerce.number().min(0).max(100),
  threshold: z.coerce.number().min(0),
});

export async function setMatchPolicy(ctx: Ctx, raw: z.input<typeof matchPolicySchema>) {
  assertCan(ctx, "settings.manage");
  const v = matchPolicySchema.parse(raw);
  const before = await matchPolicy(db, ctx.orgId);
  await db.organization.update({
    where: { id: ctx.orgId },
    data: { matchPricePct: v.pricePct, matchQtyPct: v.qtyPct, billApprovalThreshold: v.threshold },
  });
  await logAudit(ctx, { action: "MATCH_POLICY_SET", entity: "Organization", entityId: ctx.orgId, oldValue: before, newValue: v });
}

export { DEFAULT_BILL_APPROVAL_THRESHOLD, DEFAULT_TOLERANCE };

// ─────────────────────────────── Matching ───────────────────────────────

async function receivedByLine(client: Tx | typeof db, orderId: string) {
  const rows = await client.goodsReceiptLine.groupBy({
    by: ["orderLineId"],
    where: { receipt: { orderId, status: "POSTED" } },
    _sum: { quantity: true },
  });
  return Object.fromEntries(rows.map((r) => [r.orderLineId, num(r._sum.quantity)])) as Record<string, number>;
}

/** The exceptions a recorded bill has right now. */
export async function billExceptions(tx: Tx, orgId: string, invoiceId: string): Promise<{ hasOrder: boolean; exceptions: MatchException[] }> {
  const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  const policy = await matchPolicy(tx, orgId);
  const exceptions: MatchException[] = [];
  if (inv.purchaseOrderId) {
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: inv.purchaseOrderId }, include: { lines: true } });
    exceptions.push(
      ...matchBill({
        orderLines: order.lines.map((l) => ({ id: l.id, description: l.description, quantity: num(l.quantity), rate: num(l.rate) })),
        received: await receivedByLine(tx, order.id),
        billLines: inv.lines.map((l) => ({ orderLineId: l.orderLineId, description: l.description, quantity: num(l.quantity), rate: num(l.rate) })),
        tolerance: policy.tolerance,
      }),
    );
  } else {
    const e = noOrderException(num(inv.totalAmount), policy.threshold);
    if (e) exceptions.push(e);
  }
  // the same vendor, amount and date on another live bill
  const twin = await tx.purchaseInvoice.findFirst({
    where: { organizationId: orgId, vendorId: inv.vendorId, id: { not: inv.id }, status: { not: "CANCELLED" }, totalAmount: inv.totalAmount, invoiceDate: inv.invoiceDate },
    select: { invoiceNumber: true },
  });
  if (twin) exceptions.push({ code: "POSSIBLE_DUPLICATE", message: `Same vendor, amount and date as ${twin.invoiceNumber}.` });
  return { hasOrder: !!inv.purchaseOrderId, exceptions };
}

/** Works out and stores a bill's match status. A bill whose exceptions were approved stays approved. */
export async function applyMatch(tx: Tx, orgId: string, invoiceId: string) {
  const inv = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { matchStatus: true, status: true } });
  if (inv.status === "CANCELLED" || inv.matchStatus === "APPROVED") return inv.matchStatus;
  const { hasOrder, exceptions } = await billExceptions(tx, orgId, invoiceId);
  const status = matchStatusFor(hasOrder, exceptions);
  await tx.purchaseInvoice.update({ where: { id: invoiceId }, data: { matchStatus: status, matchExceptions: exceptions as never } });
  return status;
}

/** Re-runs the match for the bill on an order, after a delivery was recorded or cancelled. */
async function rematchOrder(tx: Tx, orgId: string, orderId: string) {
  const bill = await tx.purchaseInvoice.findFirst({ where: { organizationId: orgId, purchaseOrderId: orderId }, select: { id: true } });
  if (bill) await applyMatch(tx, orgId, bill.id);
}

export async function approveBillException(ctx: Ctx, invoiceId: string, reason: string) {
  assertCan(ctx, "purchase.approve");
  if (!reason || reason.trim().length < 10) throw new BusinessError("Say why this bill is being approved despite its exceptions (at least 10 characters).");
  return db.$transaction(async (tx) => {
    const inv = await tx.purchaseInvoice.findFirst({ where: { id: invoiceId, organizationId: ctx.orgId } });
    if (!inv) throw new BusinessError("Purchase invoice not found.");
    if (inv.status === "CANCELLED") throw new BusinessError("This invoice was cancelled.");
    if (inv.matchStatus !== "EXCEPTION") throw new BusinessError("Only a bill with unresolved match exceptions needs approving.");
    if (inv.createdByUserId === ctx.userId) throw new BusinessError("You recorded this bill, so someone else has to approve it.");
    const updated = await tx.purchaseInvoice.update({
      where: { id: invoiceId },
      data: { matchStatus: "APPROVED", matchApprovedBy: ctx.name, matchApprovedByUserId: ctx.userId, matchApprovedAt: new Date(), matchApprovalReason: reason.trim() },
    });
    await logAudit(ctx, { action: "PURCHASE_INVOICE_MATCH_APPROVE", entity: "PurchaseInvoice", entityId: invoiceId, newValue: { exceptions: inv.matchExceptions }, reason }, tx);
    return updated;
  });
}

// ─────────────────────────────── Goods receipts ───────────────────────────────

export const goodsReceiptSchema = z.object({
  orderId: z.string().min(1),
  receivedDate: z.string().min(10, "Date received is required"),
  deliveryNote: opt,
  notes: opt,
  lines: z
    .array(z.object({ orderLineId: z.string().min(1), quantity: z.coerce.number().positive("Quantity received must be more than zero") }))
    .min(1, "Say what was received"),
});

export async function recordGoodsReceipt(ctx: Ctx, raw: z.input<typeof goodsReceiptSchema>) {
  assertCan(ctx, "goods.receive");
  const v = goodsReceiptSchema.parse(raw);
  if (v.receivedDate > iso(new Date())) throw new BusinessError("The date received can't be in the future.");
  if (new Set(v.lines.map((l) => l.orderLineId)).size !== v.lines.length) throw new BusinessError("Each order line can appear only once on a receipt.");
  return db.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findFirst({ where: { id: v.orderId, organizationId: ctx.orgId }, include: { lines: true } });
    if (!order) throw new BusinessError("Purchase order not found.");
    if (order.status !== "APPROVED" && order.status !== "CONVERTED") throw new BusinessError("Goods can only be received against an approved order.");
    if (order.requestedByUserId === ctx.userId) throw new BusinessError("You raised this order, so someone else has to record its receipt.");
    const got = await receivedByLine(tx, order.id);
    const byId = new Map(order.lines.map((l) => [l.id, l]));
    for (const l of v.lines) {
      const o = byId.get(l.orderLineId);
      if (!o) throw new BusinessError("A line on the receipt is not on this order.");
      const open = Math.round(num(o.quantity) * 100) - Math.round((got[o.id] ?? 0) * 100);
      if (Math.round(l.quantity * 100) > open) throw new BusinessError(`"${o.description}": ${l.quantity} received, but only ${open / 100} of the order is still outstanding.`);
    }
    const receiptNumber = await nextNumber(tx, ctx.orgId, "GOODS_RECEIPT");
    const receipt = await tx.goodsReceipt.create({
      data: {
        organizationId: ctx.orgId,
        receiptNumber,
        orderId: order.id,
        vendorId: order.vendorId,
        receivedDate: d(v.receivedDate),
        deliveryNote: v.deliveryNote ?? null,
        notes: v.notes ?? null,
        receivedBy: ctx.name,
        receivedByUserId: ctx.userId,
        lines: { create: v.lines.map((l) => ({ orderLineId: l.orderLineId, quantity: l.quantity })) },
      },
    });
    await rematchOrder(tx, ctx.orgId, order.id);
    await logAudit(ctx, { action: "GOODS_RECEIPT_RECORD", entity: "GoodsReceipt", entityId: receipt.id, newValue: { receiptNumber, orderId: order.id, lines: v.lines } }, tx);
    return receipt;
  });
}

export async function cancelGoodsReceipt(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "goods.receive");
  if (!reason || reason.trim().length < 5) throw new BusinessError("Say why this receipt is being cancelled.");
  return db.$transaction(async (tx) => {
    const r = await tx.goodsReceipt.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!r) throw new BusinessError("Goods receipt not found.");
    if (r.status === "CANCELLED") throw new BusinessError("This receipt is already cancelled.");
    await tx.goodsReceipt.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: ctx.name, cancelReason: reason.trim() } });
    await rematchOrder(tx, ctx.orgId, r.orderId);
    await logAudit(ctx, { action: "GOODS_RECEIPT_CANCEL", entity: "GoodsReceipt", entityId: id, reason }, tx);
  });
}

export async function listGoodsReceipts(ctx: Ctx, orderId?: string) {
  return db.goodsReceipt.findMany({
    where: { organizationId: ctx.orgId, ...(orderId ? { orderId } : {}) },
    include: { lines: { include: { orderLine: { select: { description: true } } } }, order: { select: { orderNumber: true } }, vendor: { select: { name: true } } },
    orderBy: [{ receivedDate: "desc" }, { receiptNumber: "desc" }],
    take: 500,
  });
}

/** Per order line: ordered, received (live receipts), and billed (bills not cancelled). */
export async function orderPosition(ctx: Ctx, orderId: string) {
  const order = await db.purchaseOrder.findFirst({ where: { id: orderId, organizationId: ctx.orgId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!order) throw new BusinessError("Purchase order not found.");
  const got = await receivedByLine(db, orderId);
  const billed = await db.purchaseInvoiceLine.groupBy({
    by: ["orderLineId"],
    where: { orderLineId: { in: order.lines.map((l) => l.id) }, invoice: { status: { not: "CANCELLED" } } },
    _sum: { quantity: true },
  });
  const billedBy = new Map(billed.map((b) => [b.orderLineId, num(b._sum.quantity)]));
  const lines = order.lines.map((l) => ({
    id: l.id,
    description: l.description,
    ordered: num(l.quantity),
    rate: num(l.rate),
    received: got[l.id] ?? 0,
    billed: billedBy.get(l.id) ?? 0,
    open: round2(num(l.quantity) - (got[l.id] ?? 0)),
  }));
  return { lines, progress: receiptProgress(lines.map((l) => ({ quantity: l.ordered, received: l.received }))) };
}

/** How far each of these orders has been received, for the order list. */
export async function receiptProgressFor(ctx: Ctx, orderIds: string[]): Promise<Record<string, ReceiptProgress>> {
  if (!orderIds.length) return {};
  const lines = await db.purchaseOrderLine.findMany({ where: { orderId: { in: orderIds }, order: { organizationId: ctx.orgId } }, select: { id: true, orderId: true, quantity: true } });
  const rows = await db.goodsReceiptLine.groupBy({ by: ["orderLineId"], where: { orderLineId: { in: lines.map((l) => l.id) }, receipt: { status: "POSTED" } }, _sum: { quantity: true } });
  const got = new Map(rows.map((r) => [r.orderLineId, num(r._sum.quantity)]));
  const per = new Map<string, { quantity: number; received: number }[]>();
  for (const l of lines) per.set(l.orderId, [...(per.get(l.orderId) ?? []), { quantity: num(l.quantity), received: got.get(l.id) ?? 0 }]);
  return Object.fromEntries(orderIds.map((id) => [id, receiptProgress(per.get(id) ?? [])]));
}
