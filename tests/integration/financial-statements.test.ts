import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { d } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { balanceSheet, incomeStatement, trialBalance } from "@/server/services/financial-statements";
import { generateInvoices, recordDeduction, recordReceipt } from "@/server/services/billing";
import { createBankAccount } from "@/server/services/bank-reconciliation";
import { createFixedAsset, disposeFixedAsset, postDepreciationForMonth } from "@/server/services/fixed-assets";
import {
  createPurchaseInvoice,
  createVendor,
  recordPurchaseInvoiceDeduction,
  recordVendorPayment,
} from "@/server/services/payables";
import { ctxFor, periodFor, uid } from "../helpers";
import type { Ctx } from "@/lib/auth/context";

/**
 * These tests run against a shared seeded org alongside every other integration test file, so
 * assertions either (a) recompute the expected figure independently from raw records and compare
 * ("self-consistency"), or (b) measure a before/after delta from dedicated, uniquely-tagged
 * fixtures dated far outside any other test's date range — never a hardcoded absolute total that
 * some other file's parallel activity could shift.
 */

/**
 * generateInvoices needs a LOCKED/PAID run — only July and August qualify (September's is left
 * OPEN by the seed). billing.test.ts owns July's invoices and bank-reconciliation.test.ts owns
 * August's indices 0/1 via its own generateInvoices call, both via unscoped "first/nth invoice on
 * this run" access — so these tests use August too, but always the *last* invoice in the list, and
 * modest amounts, to stay clear of what those files touch. Falls back to reading existing invoices
 * if another worker already generated them for this run first.
 */
async function invoicesForAugust(ctx: Ctx) {
  const august = await periodFor(ctx, 2026, 8);
  const run = await db.payrollRun.findFirstOrThrow({ where: { periodId: august.id, type: "REGULAR" } });
  try {
    return await generateInvoices(ctx, run.id, { vatPct: 0 });
  } catch (e) {
    if (e instanceof Error && /already exist/.test(e.message))
      return db.clientInvoice.findMany({ where: { runId: run.id } });
    throw e;
  }
}

describe("financial statements", () => {
  it("requires gl.view for every statement", async () => {
    const employee = await ctxFor("EMPLOYEE");
    await expect(trialBalance(employee, "2026-08-31")).rejects.toThrow();
    await expect(incomeStatement(employee, "2026-07-01", "2026-07-31")).rejects.toThrow();
    await expect(balanceSheet(employee, "2026-08-31")).rejects.toThrow();
  });

  it("trial balance sums every JournalLine per account and always balances", async () => {
    const fin = await ctxFor("FINANCE");
    const asOf = "2026-08-31";

    // Other test files can post journal entries dated on/before this cutoff at any point while this
    // test runs, but they only ever ADD lines, never remove them — so a snapshot taken just before
    // trialBalance() and one taken just after bracket the true total at the instant it ran, even
    // though the three queries aren't in a single transaction.
    const lineTotals = async () => {
      const rawLines = await db.journalLine.findMany({
        where: { journal: { organizationId: fin.orgId, postingDate: { lte: d(asOf) } } },
      });
      return {
        debit: round2(rawLines.reduce((s, l) => s + num(l.debit), 0)),
        credit: round2(rawLines.reduce((s, l) => s + num(l.credit), 0)),
      };
    };

    const before = await lineTotals();
    const tb = await trialBalance(fin, asOf);
    const after = await lineTotals();

    expect(tb.rows.length).toBeGreaterThan(0);
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBeGreaterThanOrEqual(before.debit - 0.01);
    expect(tb.totals.debit).toBeLessThanOrEqual(after.debit + 0.01);
    expect(tb.totals.credit).toBeGreaterThanOrEqual(before.credit - 0.01);
    expect(tb.totals.credit).toBeLessThanOrEqual(after.credit + 0.01);
  });

  it("income statement sums INCOME and EXPENSE accounts for a period, matching an independent recomputation", async () => {
    const fin = await ctxFor("FINANCE");
    const from = "2026-07-01";
    const to = "2026-07-31";
    const stmt = await incomeStatement(fin, from, to);

    const rawLines = await db.journalLine.findMany({
      where: { journal: { organizationId: fin.orgId, postingDate: { gte: d(from), lte: d(to) } } },
      include: { account: true },
    });
    const expectedRevenue = round2(
      rawLines.filter((l) => l.account.type === "INCOME").reduce((s, l) => s + num(l.credit) - num(l.debit), 0),
    );
    const expectedExpense = round2(
      rawLines.filter((l) => l.account.type === "EXPENSE").reduce((s, l) => s + num(l.debit) - num(l.credit), 0),
    );
    expect(stmt.revenue).toBeCloseTo(expectedRevenue, 1);
    expect(stmt.totalExpenses).toBeCloseTo(expectedExpense, 1);
    expect(stmt.netIncome).toBeCloseTo(round2(expectedRevenue - expectedExpense), 1);
  });

  it("posts a balanced AR_INVOICE journal for each client invoice, and AR_RECEIPT/AR_DEDUCTION for its receipts and deductions", async () => {
    const fin = await ctxFor("FINANCE");
    const invoices = await invoicesForAugust(fin);
    expect(invoices.length).toBeGreaterThan(0);
    const inv = invoices[invoices.length - 1];

    const invoiceJournal = await db.journalEntry.findFirst({
      where: { organizationId: fin.orgId, source: "AR_INVOICE", description: { contains: inv.invoiceNumber } },
      include: { lines: true },
    });
    expect(invoiceJournal).toBeTruthy();
    expect(num(invoiceJournal!.totalDebit)).toBeCloseTo(num(invoiceJournal!.totalCredit), 2);
    const arLine = invoiceJournal!.lines.find((l) => l.accountCode === "1200");
    expect(num(arLine!.debit)).toBeCloseTo(num(inv.totalAmount), 2);

    const receipt = await recordReceipt(fin, {
      invoiceId: inv.id,
      amount: 1000,
      receivedDate: "2026-09-15",
    });
    const receiptJournal = await db.journalEntry.findFirst({
      where: { organizationId: fin.orgId, source: "AR_RECEIPT", description: { contains: inv.invoiceNumber } },
      include: { lines: true },
    });
    expect(receiptJournal).toBeTruthy();
    expect(num(receiptJournal!.totalDebit)).toBeCloseTo(num(receipt.amount), 2);
    expect(receiptJournal!.lines.find((l) => l.accountCode === "1230")!.debit).toBeTruthy();
    expect(receiptJournal!.lines.find((l) => l.accountCode === "1200")!.credit).toBeTruthy();

    await recordDeduction(fin, {
      invoiceId: inv.id,
      type: "WITHHOLDING_TAX",
      amount: 500,
      reason: "5% WHT withheld per client's credit note",
      supportingDocument: "WHT-FS-TEST",
    });
    const deductionJournal = await db.journalEntry.findFirst({
      where: { organizationId: fin.orgId, source: "AR_DEDUCTION", description: { contains: inv.invoiceNumber } },
      include: { lines: true },
    });
    expect(deductionJournal).toBeTruthy();
    expect(deductionJournal!.lines.find((l) => l.accountCode === "1220")!.debit).toBeTruthy(); // WHT receivable
    expect(deductionJournal!.lines.find((l) => l.accountCode === "1200")!.credit).toBeTruthy(); // reduces AR
  });

  it("posts balanced AP_INVOICE, AP_PAYMENT and AP_DEDUCTION journals for a vendor bill", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const vendor = await createVendor(fin, { name: `FS AP Vendor ${tag}`, category: "OTHER" });
    const invoice = await createPurchaseInvoice(fin, {
      vendorId: vendor.id,
      description: "Test bill",
      invoiceDate: "2026-09-01",
      dueDate: "2026-09-30",
      vatPct: 7.5,
      lines: [{ description: "Item", quantity: 1, rate: 100000 }],
    });

    const invoiceJournal = await db.journalEntry.findFirst({
      where: { organizationId: fin.orgId, source: "AP_INVOICE", description: { contains: invoice.invoiceNumber } },
      include: { lines: true },
    });
    expect(invoiceJournal).toBeTruthy();
    expect(num(invoiceJournal!.totalDebit)).toBeCloseTo(num(invoice.totalAmount), 2);
    expect(invoiceJournal!.lines.find((l) => l.accountCode === "2180")!.credit).toBeCloseTo(num(invoice.totalAmount), 2);

    await recordVendorPayment(fin, { invoiceId: invoice.id, amount: 50000, paidDate: "2026-09-05" });
    const paymentJournal = await db.journalEntry.findFirst({
      where: { organizationId: fin.orgId, source: "AP_PAYMENT", description: { contains: invoice.invoiceNumber } },
      include: { lines: true },
    });
    expect(paymentJournal).toBeTruthy();
    expect(paymentJournal!.lines.find((l) => l.accountCode === "2180")!.debit).toBeTruthy();
    expect(paymentJournal!.lines.find((l) => l.accountCode === "1230")!.credit).toBeTruthy();

    await recordPurchaseInvoiceDeduction(fin, {
      invoiceId: invoice.id,
      type: "WITHHOLDING_TAX",
      amount: 5000,
      reason: "5% WHT withheld per FIRS guidance",
      supportingDocument: "WHT-AP-FS-TEST",
    });
    const deductionJournal = await db.journalEntry.findFirst({
      where: { organizationId: fin.orgId, source: "AP_DEDUCTION", description: { contains: invoice.invoiceNumber } },
      include: { lines: true },
    });
    expect(deductionJournal).toBeTruthy();
    expect(deductionJournal!.lines.find((l) => l.accountCode === "2180")!.debit).toBeTruthy();
    expect(deductionJournal!.lines.find((l) => l.accountCode === "2195")!.credit).toBeTruthy(); // WHT payable
  });

  it("posts a bank account's opening balance, and a fixed asset's acquisition and disposal, with a correct gain/loss", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();

    const account = await createBankAccount(fin, {
      name: `FS Bank Account ${tag}`,
      bankName: "Test Bank",
      accountNumber: "7777777777",
      openingBalance: 200000,
      openingDate: "2026-09-01",
    });
    const openingJournal = await db.journalEntry.findFirst({
      where: { organizationId: fin.orgId, source: "BANK_ACCOUNT_OPENING", description: { contains: account.name } },
      include: { lines: true },
    });
    expect(openingJournal).toBeTruthy();
    expect(openingJournal!.lines.find((l) => l.accountCode === "1230")!.debit).toBeCloseTo(200000, 2);
    expect(openingJournal!.lines.find((l) => l.accountCode === "3100")!.credit).toBeCloseTo(200000, 2);

    const asset = await createFixedAsset(fin, {
      name: `FS Fixed Asset ${tag}`,
      category: "OTHER",
      acquisitionDate: "2026-01-01",
      cost: 240000,
      usefulLifeMonths: 24,
      salvageValue: 0,
    });
    const acquisitionJournal = await db.journalEntry.findFirst({
      where: {
        organizationId: fin.orgId,
        source: "FIXED_ASSET_ACQUISITION",
        description: { contains: asset.assetNumber },
      },
      include: { lines: true },
    });
    expect(acquisitionJournal).toBeTruthy();
    expect(acquisitionJournal!.lines.find((l) => l.accountCode === "1240")!.debit).toBeCloseTo(240000, 2);

    // 2026-01-01 to 2026-09-01 is 9 months of a 24-month life: accumulated = 240000/24*9 = 90000.
    // Disposed for 100000 (proceeds) against a net book value of 150000 → a 50000 loss.
    await disposeFixedAsset(fin, asset.id, {
      disposalDate: "2026-09-01",
      disposalProceeds: 100000,
      disposalReason: "Sold — test",
    });
    const disposalJournal = await db.journalEntry.findFirst({
      where: {
        organizationId: fin.orgId,
        source: "FIXED_ASSET_DISPOSAL",
        description: { contains: asset.assetNumber },
      },
      include: { lines: true },
    });
    expect(disposalJournal).toBeTruthy();
    expect(num(disposalJournal!.totalDebit)).toBeCloseTo(num(disposalJournal!.totalCredit), 2);
    expect(disposalJournal!.lines.find((l) => l.accountCode === "1250")!.debit).toBeCloseTo(90000, 2);
    expect(disposalJournal!.lines.find((l) => l.accountCode === "1230")!.debit).toBeCloseTo(100000, 2);
    expect(disposalJournal!.lines.find((l) => l.accountCode === "1240")!.credit).toBeCloseTo(240000, 2);
    expect(disposalJournal!.lines.find((l) => l.accountCode === "4200")!.debit).toBeCloseTo(50000, 2); // loss
  });

  it("postDepreciationForMonth posts the month's accrued depreciation and blocks re-posting the same month", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    // postDepreciationForMonth sweeps every in-service asset org-wide into one journal, so other
    // parallel tests' assets may ride along in the same entry — key off this asset's own line
    // (by its unique assetNumber) rather than "the" 5410 line, of which there may be several.
    const asset = await createFixedAsset(fin, {
      name: `Depreciation Post Test ${tag}`,
      category: "OTHER",
      acquisitionDate: "2031-01-01",
      cost: 240000,
      usefulLifeMonths: 24,
      salvageValue: 0,
    });

    const journal = await postDepreciationForMonth(fin, 2031, 1);
    const posted = await db.journalEntry.findUniqueOrThrow({ where: { id: journal!.id }, include: { lines: true } });
    expect(num(posted.totalDebit)).toBeCloseTo(num(posted.totalCredit), 2);
    const expenseLine = posted.lines.find((l) => l.accountCode === "5410" && l.description === asset.assetNumber);
    expect(num(expenseLine!.debit)).toBeCloseTo(10000, 2); // 240000 / 24
    const accumLine = posted.lines.find((l) => l.accountCode === "1250");
    expect(num(accumLine!.credit)).toBeGreaterThanOrEqual(10000); // may include other assets' depreciation too

    await expect(postDepreciationForMonth(fin, 2031, 1)).rejects.toThrow(/already been posted/);
  });

  it("balance sheet reflects deltas from a bank account, receivable, payable and fixed asset — and always balances exactly", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const asOf = "2031-01-01"; // far future — a stable point that only this test's own fixtures touch
    const before = await balanceSheet(fin, asOf);
    expect(round2(before.liabilities.total + before.equity.total)).toBeCloseTo(before.assets.total, 1);

    await createBankAccount(fin, {
      name: `BS Test Account ${tag}`,
      bankName: "Test Bank",
      accountNumber: "8888888888",
      openingBalance: 500000,
      openingDate: asOf,
    });

    const invoices = await invoicesForAugust(fin);
    const receiptInv = invoices[invoices.length - 1];
    const receiptAmount = 77000;
    await recordReceipt(fin, { invoiceId: receiptInv.id, amount: receiptAmount, receivedDate: asOf });

    const vendor = await createVendor(fin, { name: `BS Test Vendor ${tag}`, category: "OTHER" });
    const purchaseInvoice = await createPurchaseInvoice(fin, {
      vendorId: vendor.id,
      description: "Test bill",
      invoiceDate: asOf,
      dueDate: "2031-02-01",
      lines: [{ description: "Item", quantity: 1, rate: 150000 }],
    });
    await recordVendorPayment(fin, { invoiceId: purchaseInvoice.id, amount: 50000, paidDate: asOf });

    await createFixedAsset(fin, {
      name: `BS Test Asset ${tag}`,
      category: "OTHER",
      acquisitionDate: asOf,
      cost: 240000,
      usefulLifeMonths: 24,
      salvageValue: 0,
    });

    const after = await balanceSheet(fin, asOf);

    const cashDelta = round2(after.assets.cash - before.assets.cash);
    // bank opening (500000) + AR receipt (77000) − AP payment (50000) − fixed asset purchase (240000)
    expect(cashDelta).toBeCloseTo(500000 + receiptAmount - 50000 - 240000, 1);

    const arDelta = round2(after.assets.accountsReceivable - before.assets.accountsReceivable);
    expect(arDelta).toBeCloseTo(-receiptAmount, 1); // the receipt reduced AR; no new invoice was raised here

    const apDelta = round2(after.liabilities.accountsPayable - before.liabilities.accountsPayable);
    expect(apDelta).toBeCloseTo(150000 - 50000, 1);

    // Depreciation only reaches the GL when postDepreciationForMonth is actually run (see its own
    // test) — an asset's NBV on the balance sheet is its full cost until then, not an auto-accrual.
    const fixedAssetDelta = round2(after.assets.fixedAssetsNet - before.assets.fixedAssetsNet);
    expect(fixedAssetDelta).toBeCloseTo(240000, 1);

    // The balance sheet identity holds exactly, both before and after — equity is never a plug.
    expect(round2(after.liabilities.total + after.equity.total)).toBeCloseTo(after.assets.total, 1);
  });
});
