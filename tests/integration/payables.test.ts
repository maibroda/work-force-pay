import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import {
  cancelPurchaseInvoice,
  createPurchaseInvoice,
  createVendor,
  payablesSummary,
  recordPurchaseInvoiceDeduction,
  recordVendorPayment,
  setVendorActive,
} from "@/server/services/payables";
import { ctxFor, uid } from "../helpers";

describe("accounts payable", () => {
  it("records a vendor bill with line items, computes VAT, and only 'payment.manage' can create one", async () => {
    const fin = await ctxFor("FINANCE");
    const auditor = await ctxFor("AUDITOR");
    const tag = uid();

    const vendor = await createVendor(fin, { name: `ACME Uniforms ${tag}`, category: "UNIFORM_KITS" });

    await expect(
      createPurchaseInvoice(auditor, {
        vendorId: vendor.id,
        description: "Guard uniforms batch",
        invoiceDate: "2027-06-01",
        dueDate: "2027-07-01",
        lines: [{ description: "Uniform sets x50", quantity: 50, rate: 8000 }],
      }),
    ).rejects.toThrow();

    const inv = await createPurchaseInvoice(fin, {
      vendorId: vendor.id,
      description: "Guard uniforms batch",
      invoiceDate: "2027-06-01",
      dueDate: "2027-07-01",
      vatPct: 7.5,
      lines: [
        { description: "Uniform sets x50", quantity: 50, rate: 8000 },
        { description: "Boots x50", quantity: 50, rate: 5000 },
      ],
    });
    expect(inv.invoiceNumber).toMatch(/^PINV-/);
    expect(num(inv.subtotal)).toBe(50 * 8000 + 50 * 5000);
    expect(num(inv.vatAmount)).toBeCloseTo(num(inv.subtotal) * 0.075, 2);
    expect(num(inv.totalAmount)).toBeCloseTo(num(inv.subtotal) + num(inv.vatAmount), 2);
    expect(inv.status).toBe("RECORDED");

    const lines = await db.purchaseInvoiceLine.findMany({ where: { invoiceId: inv.id } });
    expect(lines).toHaveLength(2);
  });

  it("payment + deduction both reduce the balance and move status to PAID; cancellation is blocked once either exists", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const vendor = await createVendor(fin, { name: `Utility Co ${tag}`, category: "UTILITIES" });
    const inv = await createPurchaseInvoice(fin, {
      vendorId: vendor.id,
      description: "June electricity bill",
      invoiceDate: "2027-06-01",
      dueDate: "2027-06-15",
      lines: [{ description: "Electricity — June", quantity: 1, rate: 100000 }],
    });

    await recordPurchaseInvoiceDeduction(fin, {
      invoiceId: inv.id,
      type: "WITHHOLDING_TAX",
      amount: 10000,
      reason: "5% WHT withheld on services per FIRS guidance",
      supportingDocument: "WHT-CN-001",
    });
    const afterDeduction = await db.purchaseInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(num(afterDeduction.totalDeductions)).toBe(10000);
    expect(afterDeduction.status).toBe("PARTIALLY_PAID");

    await recordVendorPayment(fin, {
      invoiceId: inv.id,
      amount: 90000,
      paidDate: "2027-06-10",
      method: "Bank transfer",
    });
    const afterPayment = await db.purchaseInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(num(afterPayment.amountPaid)).toBe(90000);
    expect(afterPayment.status).toBe("PAID");

    // overpayment beyond the remaining balance is rejected
    await expect(
      recordVendorPayment(fin, { invoiceId: inv.id, amount: 1, paidDate: "2027-06-11" }),
    ).rejects.toThrow(/exceeds the outstanding balance/);

    await expect(cancelPurchaseInvoice(fin, inv.id, "changed my mind")).rejects.toThrow(
      /cannot be cancelled/,
    );
  });

  it("a clean invoice (no payments/deductions) can be cancelled, and payablesSummary excludes it", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const vendor = await createVendor(fin, { name: `Cancel Test Vendor ${tag}`, category: "OTHER" });
    const inv = await createPurchaseInvoice(fin, {
      vendorId: vendor.id,
      description: "To be cancelled",
      invoiceDate: "2027-06-01",
      dueDate: "2027-06-15",
      lines: [{ description: "Something", quantity: 1, rate: 5000 }],
    });
    await cancelPurchaseInvoice(fin, inv.id, "Recorded against the wrong vendor");
    const cancelled = await db.purchaseInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(cancelled.status).toBe("CANCELLED");

    const summary = await payablesSummary(fin);
    const row = summary.rows.find((r) => r.vendorName === vendor.name);
    expect(row).toBeUndefined(); // cancelled invoices are excluded from the summary entirely
  });

  it("summary flags overdue balances and vendor deactivation is tracked", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const vendor = await createVendor(fin, { name: `Overdue Vendor ${tag}`, category: "EQUIPMENT" });
    await createPurchaseInvoice(fin, {
      vendorId: vendor.id,
      description: "Radios",
      invoiceDate: "2020-01-01",
      dueDate: "2020-01-15", // long past due relative to "today"
      lines: [{ description: "Radios x10", quantity: 10, rate: 15000 }],
    });
    const summary = await payablesSummary(fin);
    const row = summary.rows.find((r) => r.vendorName === vendor.name)!;
    expect(row.overdue).toBeGreaterThan(0);
    expect(row.outstanding).toBe(150000);

    await setVendorActive(fin, vendor.id, false);
    const deactivated = await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } });
    expect(deactivated.active).toBe(false);
  });
});
