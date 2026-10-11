import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { createPurchaseInvoice, createVendor, recordVendorPayment } from "@/server/services/payables";
import { createPurchaseOrder, decidePurchaseOrder, submitPurchaseOrder } from "@/server/services/purchase-orders";
import { approveBillException, cancelGoodsReceipt, orderPosition, recordGoodsReceipt, setMatchPolicy } from "@/server/services/matching";
import { ensureDefaultChart } from "@/server/services/accounting";
import { isolatedOrg, uid } from "../helpers";

const TODAY = new Date().toISOString().slice(0, 10);

/** An isolated org with a buyer, a second finance person who receives, an approver, and an approved order of radios and chargers. */
async function world() {
  const t = await isolatedOrg();
  await db.$transaction((tx) => ensureDefaultChart(tx, t.org.id));
  const buyer = t.ctx("FINANCE", null, 1);
  const receiver = t.ctx("FINANCE", null, 2);
  const approver = t.ctx("COMPANY_ADMIN", null, 1);
  const vendor = await createVendor(buyer, { name: `Vendor ${uid()}`, category: "EQUIPMENT" });
  const order = await createPurchaseOrder(buyer, {
    vendorId: vendor.id,
    description: "Radios and chargers",
    lines: [
      { description: "Radio", quantity: 10, rate: 15000 },
      { description: "Charger", quantity: 2, rate: 5000 },
    ],
  });
  await submitPurchaseOrder(buyer, order.id);
  await decidePurchaseOrder(approver, order.id, "APPROVED");
  const lines = await db.purchaseOrderLine.findMany({ where: { orderId: order.id }, orderBy: { sortOrder: "asc" } });
  const [radio, charger] = lines;
  /** The vendor's bill against the order; `qty`/`rate` default to what was ordered. */
  const bill = (c = buyer, over: { radioQty?: number; radioRate?: number; ref?: string; date?: string } = {}) =>
    createPurchaseInvoice(c, {
      vendorId: vendor.id,
      purchaseOrderId: order.id,
      vendorRef: over.ref,
      description: "Radios and chargers",
      invoiceDate: over.date ?? TODAY,
      dueDate: "2027-12-31",
      lines: [
        { description: "Radio", quantity: over.radioQty ?? 10, rate: over.radioRate ?? 15000, orderLineId: radio.id },
        { description: "Charger", quantity: 2, rate: 5000, orderLineId: charger.id },
      ],
    });
  const receive = (lineQty: [number, number], c = receiver) =>
    recordGoodsReceipt(c, {
      orderId: order.id,
      receivedDate: TODAY,
      deliveryNote: "WB-1",
      lines: [
        ...(lineQty[0] ? [{ orderLineId: radio.id, quantity: lineQty[0] }] : []),
        ...(lineQty[1] ? [{ orderLineId: charger.id, quantity: lineQty[1] }] : []),
      ],
    });
  return { t, buyer, receiver, approver, vendor, order, radio, charger, bill, receive };
}

const status = async (id: string) => (await db.purchaseInvoice.findUniqueOrThrow({ where: { id } })).matchStatus;

describe("goods receipts and the three-way match", () => {
  it("keeps raising, approving and receiving an order with different people", async () => {
    const w = await world();
    const o2 = await createPurchaseOrder(w.buyer, { vendorId: w.vendor.id, description: "Test order", lines: [{ description: "Item", quantity: 1, rate: 100 }] });
    await submitPurchaseOrder(w.buyer, o2.id);
    await expect(decidePurchaseOrder(w.buyer, o2.id, "APPROVED")).rejects.toThrow(/permission/);
    const admin1 = w.t.ctx("COMPANY_ADMIN", null, 2);
    const o3 = await createPurchaseOrder(admin1, { vendorId: w.vendor.id, description: "own order", lines: [{ description: "Item", quantity: 1, rate: 100 }] });
    await submitPurchaseOrder(admin1, o3.id);
    await expect(decidePurchaseOrder(admin1, o3.id, "APPROVED")).rejects.toThrow(/someone else has to approve/);

    // the buyer raised the order, so can't receive it; an auditor can't receive at all
    await expect(w.receive([10, 2], w.buyer)).rejects.toThrow(/someone else has to record/);
    await expect(w.receive([10, 2], w.t.ctx("AUDITOR", null, 1))).rejects.toThrow(/permission/);
    // goods can't be received against an order that isn't approved
    await expect(recordGoodsReceipt(w.receiver, { orderId: o2.id, receivedDate: TODAY, lines: [{ orderLineId: (await db.purchaseOrderLine.findFirstOrThrow({ where: { orderId: o2.id } })).id, quantity: 1 }] })).rejects.toThrow(/approved order/);
  });

  it("refuses receiving more than is outstanding, or in the future, and tracks the position", async () => {
    const w = await world();
    await expect(w.receive([11, 0])).rejects.toThrow(/only 10 of the order is still outstanding/);
    await expect(recordGoodsReceipt(w.receiver, { orderId: w.order.id, receivedDate: "2999-01-01", lines: [{ orderLineId: w.radio.id, quantity: 1 }] })).rejects.toThrow(/future/);
    await expect(recordGoodsReceipt(w.receiver, { orderId: w.order.id, receivedDate: TODAY, lines: [] })).rejects.toThrow();

    const r1 = await w.receive([6, 0]);
    expect(r1.receiptNumber).toMatch(/^GRN-/);
    let pos = await orderPosition(w.receiver, w.order.id);
    expect(pos.progress).toBe("PARTIAL");
    expect(pos.lines[0]).toMatchObject({ ordered: 10, received: 6, open: 4 });
    await expect(w.receive([5, 0])).rejects.toThrow(/only 4 of the order is still outstanding/);
    await w.receive([4, 2]);
    pos = await orderPosition(w.receiver, w.order.id);
    expect(pos.progress).toBe("FULL");
  });

  it("holds a bill that arrives before delivery, and clears it when the goods are recorded", async () => {
    const w = await world();
    const inv = await w.bill();
    expect(inv.matchStatus).toBe("EXCEPTION");
    const ex = inv.matchExceptions as { code: string }[];
    expect(ex.map((e) => e.code)).toEqual(["NOT_RECEIVED", "NOT_RECEIVED"]);

    await expect(recordVendorPayment(w.buyer, { invoiceId: inv.id, amount: 1000, paidDate: TODAY })).rejects.toThrow(/match exceptions/);
    // the database refuses it too, whatever the application does
    await expect(
      db.vendorPayment.create({ data: { organizationId: w.t.org.id, invoiceId: inv.id, vendorId: w.vendor.id, amount: 1, paidDate: new Date(TODAY), recordedBy: "x" } }),
    ).rejects.toThrow(/unresolved match exceptions/);

    await w.receive([10, 2]);
    expect(await status(inv.id)).toBe("MATCHED");
    await recordVendorPayment(w.buyer, { invoiceId: inv.id, amount: 1000, paidDate: TODAY });
    expect(num((await db.purchaseInvoice.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid)).toBe(1000);
  });

  it("goes back to an exception when a receipt is cancelled, and a cancelled receipt needs a reason", async () => {
    const w = await world();
    const r = await w.receive([10, 2]);
    const inv = await w.bill();
    expect(inv.matchStatus).toBe("MATCHED");

    await expect(cancelGoodsReceipt(w.receiver, r.id, "")).rejects.toThrow(/why/);
    await cancelGoodsReceipt(w.receiver, r.id, "Recorded against the wrong order");
    expect(await status(inv.id)).toBe("EXCEPTION");
    await expect(cancelGoodsReceipt(w.receiver, r.id, "again please")).rejects.toThrow(/already cancelled/);
    expect((await orderPosition(w.receiver, w.order.id)).progress).toBe("NONE");
  });

  it("flags a price above the tolerance, and lets a second person approve it for payment", async () => {
    const w = await world();
    await w.receive([10, 2]);
    const inv = await w.bill(w.buyer, { radioRate: 15200 });
    expect(inv.matchStatus).toBe("EXCEPTION");
    expect((inv.matchExceptions as { code: string }[]).map((e) => e.code)).toEqual(["PRICE_OVER"]);

    await expect(approveBillException(w.buyer, inv.id, "It is fine, really")).rejects.toThrow(/permission/);
    const sameAdmin = w.t.ctx("COMPANY_ADMIN", null, 1);
    await expect(approveBillException(sameAdmin, inv.id, "short")).rejects.toThrow(/at least 10/);
    // the person who recorded the bill can't approve it
    const adminBuyer = { ...sameAdmin, userId: w.buyer.userId };
    await expect(approveBillException(adminBuyer, inv.id, "I recorded it myself")).rejects.toThrow(/someone else/);

    await approveBillException(sameAdmin, inv.id, "Vendor price rise agreed by phone with the buyer");
    const after = await db.purchaseInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.matchStatus).toBe("APPROVED");
    expect(after.matchApprovedBy).toBe(sameAdmin.name);
    await recordVendorPayment(w.buyer, { invoiceId: inv.id, amount: 500, paidDate: TODAY });
    await expect(approveBillException(sameAdmin, inv.id, "approving it twice over")).rejects.toThrow(/Only a bill with unresolved/);
    // an approved bill stays approved if a receipt is later cancelled
    const r = await db.goodsReceipt.findFirstOrThrow({ where: { orderId: w.order.id } });
    await cancelGoodsReceipt(w.receiver, r.id, "Wrong delivery note entered");
    expect(await status(inv.id)).toBe("APPROVED");
  });

  it("accepts a price within the tolerance, and the policy can be changed by whoever manages settings", async () => {
    const w = await world();
    await w.receive([10, 2]);
    expect((await w.bill(w.buyer, { radioRate: 15150, ref: "A-1" })).matchStatus).toBe("MATCHED");

    await expect(setMatchPolicy(w.buyer, { pricePct: 5, qtyPct: 0, threshold: 0 })).rejects.toThrow(/permission/);
    const admin = w.t.ctx("COMPANY_ADMIN", null, 1);
    await setMatchPolicy(admin, { pricePct: 0, qtyPct: 0, threshold: 0 });
    // a second order, now with no tolerance at all
    const o2 = await createPurchaseOrder(w.buyer, { vendorId: w.vendor.id, description: "More radios", lines: [{ description: "Radio", quantity: 1, rate: 1000 }] });
    await submitPurchaseOrder(w.buyer, o2.id);
    await decidePurchaseOrder(admin, o2.id, "APPROVED");
    const l = await db.purchaseOrderLine.findFirstOrThrow({ where: { orderId: o2.id } });
    await recordGoodsReceipt(w.receiver, { orderId: o2.id, receivedDate: TODAY, lines: [{ orderLineId: l.id, quantity: 1 }] });
    const inv = await createPurchaseInvoice(w.buyer, {
      vendorId: w.vendor.id, purchaseOrderId: o2.id, description: "More radios", invoiceDate: TODAY, dueDate: "2027-12-31",
      lines: [{ description: "Radio", quantity: 1, rate: 1001, orderLineId: l.id }],
    });
    expect(inv.matchStatus).toBe("EXCEPTION");
  });

  it("holds a bill with no order above the limit, and every such bill when the limit is zero", async () => {
    const w = await world();
    const bill = (amount: number, ref: string) =>
      createPurchaseInvoice(w.buyer, { vendorId: w.vendor.id, vendorRef: ref, description: "Rent", invoiceDate: TODAY, dueDate: "2027-12-31", lines: [{ description: "Rent", quantity: 1, rate: amount }] });
    expect((await bill(100000, "R-1")).matchStatus).toBe("NOT_REQUIRED");
    const big = await bill(600000, "R-2");
    expect(big.matchStatus).toBe("EXCEPTION");
    expect((big.matchExceptions as { code: string }[])[0].code).toBe("NO_ORDER_OVER_LIMIT");
    await expect(recordVendorPayment(w.buyer, { invoiceId: big.id, amount: 100, paidDate: TODAY })).rejects.toThrow(/second person/);
    await approveBillException(w.approver, big.id, "Annual rent agreed in the lease");
    await recordVendorPayment(w.buyer, { invoiceId: big.id, amount: 100, paidDate: TODAY });

    await setMatchPolicy(w.approver, { pricePct: 1, qtyPct: 0, threshold: 0 });
    expect((await bill(10, "R-3")).matchStatus).toBe("EXCEPTION");
  });

  it("refuses a repeated vendor bill number and flags the same vendor, amount and date", async () => {
    const w = await world();
    const bill = (ref: string | undefined, amount = 5000) =>
      createPurchaseInvoice(w.buyer, { vendorId: w.vendor.id, vendorRef: ref, description: "Service", invoiceDate: TODAY, dueDate: "2027-12-31", lines: [{ description: "Service", quantity: 1, rate: amount }] });
    const first = await bill("INV-77");
    expect(first.matchStatus).toBe("NOT_REQUIRED");
    await expect(bill("inv-77", 6000)).rejects.toThrow(/already recorded as/);
    const twin = await bill(undefined);
    expect(twin.matchStatus).toBe("EXCEPTION");
    expect((twin.matchExceptions as { code: string }[])[0].code).toBe("POSSIBLE_DUPLICATE");
  });

  it("won't take a bill against an order for another vendor or one that is already billed, nor foreign order lines", async () => {
    const w = await world();
    const other = await createVendor(w.buyer, { name: `Other ${uid()}`, category: "OTHER" });
    const mk = (vendorId: string, orderLineId?: string) =>
      createPurchaseInvoice(w.buyer, { vendorId, purchaseOrderId: w.order.id, description: "Test bill", invoiceDate: TODAY, dueDate: "2027-12-31", lines: [{ description: "Radio", quantity: 1, rate: 1, orderLineId }] });
    await expect(mk(other.id, w.radio.id)).rejects.toThrow(/different vendor/);
    await expect(mk(w.vendor.id, "not-a-line")).rejects.toThrow(/not on the purchase order/);
    await w.bill();
    await expect(mk(w.vendor.id, w.radio.id)).rejects.toThrow(/approved order that has not been billed/);
  });

  it("never lets a receipt be changed or removed behind the application's back", async () => {
    const w = await world();
    const r = await w.receive([5, 0]);
    const line = await db.goodsReceiptLine.findFirstOrThrow({ where: { receiptId: r.id } });
    await expect(db.goodsReceiptLine.update({ where: { id: line.id }, data: { quantity: 9 } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.goodsReceiptLine.delete({ where: { id: line.id } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.goodsReceipt.delete({ where: { id: r.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.goodsReceipt.update({ where: { id: r.id }, data: { receivedDate: new Date("2020-01-01") } })).rejects.toThrow(/cannot be changed/);
    await expect(db.goodsReceipt.update({ where: { id: r.id }, data: { status: "CANCELLED" } })).rejects.toThrow(/who cancelled it/);
  });
});
