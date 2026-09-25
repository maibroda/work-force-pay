import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { createVendor } from "@/server/services/payables";
import {
  cancelPurchaseOrder,
  convertPurchaseOrderToInvoice,
  createPurchaseOrder,
  decidePurchaseOrder,
  submitPurchaseOrder,
} from "@/server/services/purchase-orders";
import { ctxFor, uid } from "../helpers";

describe("purchase orders", () => {
  it("computes VAT/total from lines, and only 'payment.manage' can create one", async () => {
    const fin = await ctxFor("FINANCE");
    const auditor = await ctxFor("AUDITOR");
    const tag = uid();
    const vendor = await createVendor(fin, { name: `PO Vendor ${tag}`, category: "EQUIPMENT" });

    await expect(
      createPurchaseOrder(auditor, {
        vendorId: vendor.id,
        description: "Radios",
        lines: [{ description: "Radio x10", quantity: 10, rate: 15000 }],
      }),
    ).rejects.toThrow();

    const order = await createPurchaseOrder(fin, {
      vendorId: vendor.id,
      description: "Radios for new deployment",
      vatPct: 7.5,
      lines: [
        { description: "Radio x10", quantity: 10, rate: 15000 },
        { description: "Charging dock x2", quantity: 2, rate: 5000 },
      ],
    });
    expect(order.orderNumber).toMatch(/^PO-/);
    expect(order.status).toBe("DRAFT");
    expect(num(order.subtotal)).toBe(10 * 15000 + 2 * 5000);
    expect(num(order.vatAmount)).toBeCloseTo(num(order.subtotal) * 0.075, 2);
    expect(num(order.totalAmount)).toBeCloseTo(num(order.subtotal) + num(order.vatAmount), 2);

    const lines = await db.purchaseOrderLine.findMany({ where: { orderId: order.id } });
    expect(lines).toHaveLength(2);
  });

  it("moves through the request → submit → approve/reject lifecycle, blocking out-of-order transitions", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const vendor = await createVendor(fin, { name: `PO Lifecycle Vendor ${tag}`, category: "OTHER" });
    const order = await createPurchaseOrder(fin, {
      vendorId: vendor.id,
      description: "Test order",
      lines: [{ description: "Item", quantity: 1, rate: 100000 }],
    });

    // can't approve/reject before it's submitted
    await expect(decidePurchaseOrder(fin, order.id, "APPROVED")).rejects.toThrow(/pending approval/);

    const submitted = await submitPurchaseOrder(fin, order.id);
    expect(submitted.status).toBe("PENDING_APPROVAL");

    // can't submit twice
    await expect(submitPurchaseOrder(fin, order.id)).rejects.toThrow(/draft order/);

    // rejection requires a reason
    await expect(decidePurchaseOrder(fin, order.id, "REJECTED")).rejects.toThrow(/reason/);

    const approved = await decidePurchaseOrder(fin, order.id, "APPROVED");
    expect(approved.status).toBe("APPROVED");
    expect(approved.decidedBy).toBe(fin.name);

    // can't decide twice
    await expect(decidePurchaseOrder(fin, order.id, "REJECTED", "changed my mind")).rejects.toThrow(
      /pending approval/,
    );
  });

  it("rejects a submitted order with a reason, and cancellation is blocked once converted", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const vendor = await createVendor(fin, { name: `PO Reject Vendor ${tag}`, category: "OTHER" });

    const rejectedOrder = await createPurchaseOrder(fin, {
      vendorId: vendor.id,
      description: "Will be rejected",
      lines: [{ description: "Item", quantity: 1, rate: 50000 }],
    });
    await submitPurchaseOrder(fin, rejectedOrder.id);
    const rejected = await decidePurchaseOrder(fin, rejectedOrder.id, "REJECTED", "Budget not available this quarter");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.decisionReason).toMatch(/Budget/);

    const convertedOrder = await createPurchaseOrder(fin, {
      vendorId: vendor.id,
      description: "Will be converted",
      lines: [{ description: "Item", quantity: 1, rate: 60000 }],
    });
    await submitPurchaseOrder(fin, convertedOrder.id);
    await decidePurchaseOrder(fin, convertedOrder.id, "APPROVED");
    const invoice = await convertPurchaseOrderToInvoice(fin, {
      purchaseOrderId: convertedOrder.id,
      invoiceDate: "2026-08-01",
      dueDate: "2026-08-15",
    });
    expect(invoice.purchaseOrderId).toBe(convertedOrder.id);
    expect(num(invoice.totalAmount)).toBeCloseTo(60000, 2);

    const afterConvert = await db.purchaseOrder.findUniqueOrThrow({ where: { id: convertedOrder.id } });
    expect(afterConvert.status).toBe("CONVERTED");

    await expect(cancelPurchaseOrder(fin, convertedOrder.id, "Trying to cancel after conversion")).rejects.toThrow(
      /can't be cancelled/,
    );
    await expect(convertPurchaseOrderToInvoice(fin, { purchaseOrderId: convertedOrder.id, invoiceDate: "2026-08-01", dueDate: "2026-08-15" })).rejects.toThrow(
      /Only an approved order/,
    );
  });

  it("cancelling a draft order needs a reason and is terminal", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const vendor = await createVendor(fin, { name: `PO Cancel Vendor ${tag}`, category: "OTHER" });
    const order = await createPurchaseOrder(fin, {
      vendorId: vendor.id,
      description: "Will be cancelled",
      lines: [{ description: "Item", quantity: 1, rate: 25000 }],
    });

    await expect(cancelPurchaseOrder(fin, order.id, "")).rejects.toThrow(/reason/);
    const cancelled = await cancelPurchaseOrder(fin, order.id, "No longer needed");
    expect(cancelled.status).toBe("CANCELLED");
    await expect(cancelPurchaseOrder(fin, order.id, "Again")).rejects.toThrow(/already cancelled/);
  });
});
