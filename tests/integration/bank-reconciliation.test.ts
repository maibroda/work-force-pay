import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { generateInvoices, recordReceipt } from "@/server/services/billing";
import { createPurchaseInvoice, createVendor, recordVendorPayment } from "@/server/services/payables";
import {
  autoMatchStatementLines,
  createBankAccount,
  importStatementLines,
  manualMatchStatementLine,
  markStatementLineManual,
  reconciliationSummary,
  unmatchStatementLine,
} from "@/server/services/bank-reconciliation";
import { ctxFor, periodFor, uid } from "../helpers";
import type { Ctx } from "@/lib/auth/context";

/** billing.test.ts also generates invoices for these same seeded runs; test files run against a
 *  shared DB, so whichever runs first wins the generation — the other just reads what's there. */
async function invoicesForRun(ctx: Ctx, runId: string, opts: Parameters<typeof generateInvoices>[2] = {}) {
  try {
    return await generateInvoices(ctx, runId, opts);
  } catch (e) {
    if (e instanceof Error && /already exist/.test(e.message)) {
      return db.clientInvoice.findMany({ where: { runId } });
    }
    throw e;
  }
}

describe("bank reconciliation (operating account)", () => {
  it("creates a bank account and only 'payment.manage' can manage it", async () => {
    const fin = await ctxFor("FINANCE");
    const auditor = await ctxFor("AUDITOR");
    const tag = uid();

    await expect(
      createBankAccount(auditor, {
        name: `Operating ${tag}`,
        bankName: "GTBank",
        accountNumber: "0123456789",
        openingBalance: 0,
        openingDate: "2026-01-01",
      }),
    ).rejects.toThrow();

    const acct = await createBankAccount(fin, {
      name: `Operating ${tag}`,
      bankName: "GTBank",
      accountNumber: "0123456789",
      openingBalance: 500000,
      openingDate: "2026-01-01",
    });
    expect(acct.bankName).toBe("GTBank");
    expect(acct.active).toBe(true);
  });

  it("imports a statement, auto-matches a client receipt and a vendor payment by amount + date, and fully reconciles", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    // billing.test.ts owns invoice generation for the July run with specific vatPct/whtPct
    // options it asserts on — use August here so the two test files can't race for the same run.
    const august = await periodFor(fin, 2026, 8);
    const run = await db.payrollRun.findFirstOrThrow({ where: { periodId: august.id, type: "REGULAR" } });
    const invoices = await invoicesForRun(fin, run.id, { vatPct: 0 });
    const invoice = invoices[0];

    const receiptAmount = 137500.5;
    const receipt = await recordReceipt(fin, {
      invoiceId: invoice.id,
      amount: receiptAmount,
      receivedDate: "2026-08-10",
    });

    const vendor = await createVendor(fin, { name: `Bank Rec Vendor ${tag}`, category: "OTHER" });
    const purchaseInvoice = await createPurchaseInvoice(fin, {
      vendorId: vendor.id,
      description: "Office supplies",
      invoiceDate: "2026-08-01",
      dueDate: "2026-08-20",
      lines: [{ description: "Supplies", quantity: 1, rate: 62345.75 }],
    });
    const paymentAmount = 62345.75;
    const payment = await recordVendorPayment(fin, {
      invoiceId: purchaseInvoice.id,
      amount: paymentAmount,
      paidDate: "2026-08-12",
    });

    const acct = await createBankAccount(fin, {
      name: `Reconciled Account ${tag}`,
      bankName: "Zenith Bank",
      accountNumber: "9988776655",
      openingBalance: 0,
      openingDate: "2026-08-01",
    });

    const csv = [
      "date,description,amount,reference",
      `2026-08-10,Client transfer,${receiptAmount},RCPT-1`,
      `2026-08-12,${vendor.name} payment,-${paymentAmount},PMT-1`,
    ].join("\n");
    const result = await importStatementLines(fin, acct.id, csv);
    expect(result.imported).toBe(2);
    expect(result.matched).toBe(2);
    expect(result.remaining).toBe(0);

    const summary = await reconciliationSummary(fin, acct.id, "2026-08-31");
    expect(summary.unmatchedLines).toHaveLength(0);
    const receiptLine = summary.lines.find((l) => l.matchedClientReceiptId === receipt.id);
    const paymentLine = summary.lines.find((l) => l.matchedVendorPaymentId === payment.id);
    expect(receiptLine?.matchType).toBe("CLIENT_RECEIPT");
    expect(paymentLine?.matchType).toBe("VENDOR_PAYMENT");
    expect(Math.abs(summary.difference)).toBeLessThan(0.01);
    expect(summary.fullyReconciled).toBe(true);
  });

  it("leaves ambiguous amounts unmatched, and supports manual match / mark-manual / unmatch", async () => {
    const fin = await ctxFor("FINANCE");
    const auditor = await ctxFor("AUDITOR");
    const tag = uid();
    const august = await periodFor(fin, 2026, 8);
    const run = await db.payrollRun.findFirstOrThrow({ where: { periodId: august.id, type: "REGULAR" } });
    const invoices = await invoicesForRun(fin, run.id, { vatPct: 0 });

    // Two receipts with the identical amount and date — auto-match must refuse to guess.
    const ambiguousAmount = 54321;
    const receiptA = await recordReceipt(fin, {
      invoiceId: invoices[0].id,
      amount: ambiguousAmount,
      receivedDate: "2026-07-15",
    });
    const receiptB = await recordReceipt(fin, {
      invoiceId: invoices[1].id,
      amount: ambiguousAmount,
      receivedDate: "2026-07-15",
    });

    const acct = await createBankAccount(fin, {
      name: `Manual Match Account ${tag}`,
      bankName: "Access Bank",
      accountNumber: "1122334455",
      openingBalance: 0,
      openingDate: "2026-07-01",
    });

    const csv = [
      "date,description,amount,reference",
      `2026-07-15,Ambiguous transfer,${ambiguousAmount},RCPT-AMB`,
      "2026-07-16,Monthly account maintenance fee,-4500,CHG-1",
    ].join("\n");
    const result = await importStatementLines(fin, acct.id, csv);
    expect(result.matched).toBe(0); // ambiguous receipt candidate + no candidate at all for the fee
    expect(result.remaining).toBe(2);

    const lines = await db.bankStatementLine.findMany({ where: { bankAccountId: acct.id }, orderBy: { date: "asc" } });
    const ambiguousLine = lines.find((l) => l.reference === "RCPT-AMB")!;
    const feeLine = lines.find((l) => l.reference === "CHG-1")!;

    // Only FINANCE (payment.manage) can act on these.
    await expect(manualMatchStatementLine(auditor, ambiguousLine.id, "CLIENT_RECEIPT", receiptA.id)).rejects.toThrow();

    await manualMatchStatementLine(fin, ambiguousLine.id, "CLIENT_RECEIPT", receiptA.id);
    const afterManual = await db.bankStatementLine.findUniqueOrThrow({ where: { id: ambiguousLine.id } });
    expect(afterManual.matchType).toBe("CLIENT_RECEIPT");
    expect(afterManual.matchedClientReceiptId).toBe(receiptA.id);

    // receiptB is still unmatched and can't be claimed twice by the same or another line.
    await expect(manualMatchStatementLine(fin, ambiguousLine.id, "CLIENT_RECEIPT", receiptB.id)).rejects.toThrow(
      /already matched/,
    );

    await expect(markStatementLineManual(fin, feeLine.id, "x")).rejects.toThrow(/at least 5 characters/);
    await markStatementLineManual(fin, feeLine.id, "Monthly account maintenance fee — GTBank");
    const afterFee = await db.bankStatementLine.findUniqueOrThrow({ where: { id: feeLine.id } });
    expect(afterFee.matchType).toBe("MANUAL");
    expect(afterFee.matchNote).toMatch(/maintenance fee/);

    const reconciled = await reconciliationSummary(fin, acct.id, "2026-07-31");
    expect(reconciled.unmatchedLines).toHaveLength(0);
    expect(Math.abs(reconciled.difference)).toBeLessThan(0.01);
    expect(reconciled.fullyReconciled).toBe(true);

    await unmatchStatementLine(fin, ambiguousLine.id);
    const afterUnmatch = await db.bankStatementLine.findUniqueOrThrow({ where: { id: ambiguousLine.id } });
    expect(afterUnmatch.matchType).toBeNull();
    expect(afterUnmatch.matchedClientReceiptId).toBeNull();

    const afterUnmatchSummary = await reconciliationSummary(fin, acct.id, "2026-07-31");
    expect(afterUnmatchSummary.unmatchedLines).toHaveLength(1);
    expect(afterUnmatchSummary.fullyReconciled).toBe(false);

    // receiptA and receiptB are both free again, so the ambiguity is back — auto-match still refuses to guess.
    const rerun = await autoMatchStatementLines(fin, acct.id);
    expect(rerun.matched).toBe(0);
  });
});
