import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { d } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { balanceSheet, incomeStatement, trialBalance } from "@/server/services/financial-statements";
import { recordReceipt } from "@/server/services/billing";
import { createBankAccount } from "@/server/services/bank-reconciliation";
import { createFixedAsset } from "@/server/services/fixed-assets";
import { createPurchaseInvoice, createVendor, recordVendorPayment } from "@/server/services/payables";
import { ctxFor, periodFor, uid } from "../helpers";

/**
 * These tests run against a shared seeded org alongside every other integration test file, so
 * assertions either (a) recompute the expected figure independently from raw records and compare
 * ("self-consistency"), or (b) measure a before/after delta from dedicated, uniquely-tagged
 * fixtures dated far outside any other test's date range — never a hardcoded absolute total that
 * some other file's parallel activity could shift.
 */
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
    const tb = await trialBalance(fin, asOf);
    expect(tb.rows.length).toBeGreaterThan(0);
    expect(tb.balanced).toBe(true);

    const rawLines = await db.journalLine.findMany({
      where: { journal: { organizationId: fin.orgId, postingDate: { lte: d(asOf) } } },
    });
    const expectedDebit = round2(rawLines.reduce((s, l) => s + num(l.debit), 0));
    const expectedCredit = round2(rawLines.reduce((s, l) => s + num(l.credit), 0));
    expect(tb.totals.debit).toBeCloseTo(expectedDebit, 1);
    expect(tb.totals.credit).toBeCloseTo(expectedCredit, 1);
  });

  it("income statement sums EXPENSE-type GL accounts for a period, matching an independent recomputation", async () => {
    const fin = await ctxFor("FINANCE");
    const stmt = await incomeStatement(fin, "2026-07-01", "2026-07-31");
    expect(stmt.payrollExpenseRows.length).toBeGreaterThan(0);

    const rawLines = await db.journalLine.findMany({
      where: {
        journal: { organizationId: fin.orgId, postingDate: { gte: d("2026-07-01"), lte: d("2026-07-31") } },
        account: { type: "EXPENSE" },
      },
    });
    const expected = round2(rawLines.reduce((s, l) => s + num(l.debit) - num(l.credit), 0));
    expect(stmt.payrollExpenseTotal).toBeCloseTo(expected, 1);
  });

  it("income statement computes revenue and depreciation for a period, isolated via dedicated fixtures", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    // A dedicated client, not an existing seeded one — ClientInvoice has a unique (clientId, runId)
    // constraint, and other test files generate invoices for every seeded client on this run.
    const client = await db.client.create({
      data: { organizationId: fin.orgId, code: `ISTEST-${tag}`, name: `IS Test Client ${tag}` },
    });
    // September's run only — billing.test.ts owns July's invoices and bank-reconciliation.test.ts
    // owns August's via unscoped "first ISSUED invoice on this run" queries. We only need a valid
    // PayrollRun to satisfy the FK; it doesn't need to be locked or match the invoice's own date.
    const september = await periodFor(fin, 2026, 9);
    const run = await db.payrollRun.findFirstOrThrow({ where: { periodId: september.id, type: "REGULAR" } });
    const subtotal = 543210.5;
    // A date far outside any other test's range (everything else in this suite uses 2026 dates)
    // keeps this deterministic regardless of what runs in parallel.
    await db.clientInvoice.create({
      data: {
        organizationId: fin.orgId,
        clientId: client.id,
        runId: run.id,
        periodId: run.periodId,
        invoiceNumber: `ISTEST-${tag}`,
        invoiceDate: d("2020-01-15"),
        dueDate: d("2020-02-15"),
        subtotal,
        totalAmount: subtotal,
        createdBy: fin.name,
      },
    });
    await createFixedAsset(fin, {
      name: `IS Depreciation Test ${tag}`,
      category: "OTHER",
      acquisitionDate: "2019-12-01",
      cost: 1200000,
      usefulLifeMonths: 12,
      salvageValue: 0,
    });

    const stmt = await incomeStatement(fin, "2020-01-01", "2020-01-31");
    expect(stmt.revenue).toBe(subtotal);
    expect(stmt.payrollExpenseTotal).toBe(0);
    expect(stmt.depreciationExpense).toBe(100000); // 1,200,000 / 12 months — Jan 2020 is month 2 of its life
    expect(stmt.totalExpenses).toBe(100000);
    expect(stmt.netIncome).toBeCloseTo(round2(subtotal - 100000), 2);
  });

  it("balance sheet reflects deltas from new bank accounts, receivables, payables and fixed assets", async () => {
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const asOf = "2031-01-01"; // far future — a stable point that only this test's own fixtures touch
    const before = await balanceSheet(fin, asOf);

    await createBankAccount(fin, {
      name: `BS Test Account ${tag}`,
      bankName: "Test Bank",
      accountNumber: "8888888888",
      openingBalance: 500000,
      openingDate: asOf,
    });

    const client = await db.client.create({
      data: { organizationId: fin.orgId, code: `BSTEST-${tag}`, name: `BS Test Client ${tag}` },
    });
    // September's run only (see the income-statement test above) — any invoice we create here
    // makes generateInvoices' "already exist" guard trip early for whichever run we pick, which
    // would starve bank-reconciliation.test.ts's own multi-client invoice generation on July/August.
    const september = await periodFor(fin, 2026, 9);
    const run = await db.payrollRun.findFirstOrThrow({ where: { periodId: september.id, type: "REGULAR" } });
    const invoice = await db.clientInvoice.create({
      data: {
        organizationId: fin.orgId,
        clientId: client.id,
        runId: run.id,
        periodId: run.periodId,
        invoiceNumber: `BSTEST-${tag}`,
        invoiceDate: d(asOf),
        dueDate: d("2031-02-01"),
        subtotal: 300000,
        totalAmount: 300000,
        createdBy: fin.name,
      },
    });
    await recordReceipt(fin, { invoiceId: invoice.id, amount: 100000, receivedDate: asOf });

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
    expect(cashDelta).toBeCloseTo(500000 + 100000 - 50000, 1); // bank opening + receipt − payment

    const arDelta = round2(after.assets.accountsReceivable - before.assets.accountsReceivable);
    expect(arDelta).toBeCloseTo(300000 - 100000, 1);

    const apDelta = round2(after.liabilities.accountsPayable - before.liabilities.accountsPayable);
    expect(apDelta).toBeCloseTo(150000 - 50000, 1);

    const fixedAssetDelta = round2(after.assets.fixedAssetsNet - before.assets.fixedAssetsNet);
    expect(fixedAssetDelta).toBeCloseTo(240000 - 240000 / 24, 1); // one month's depreciation already accrued

    const totalAssetsDelta = round2(after.assets.total - before.assets.total);
    expect(totalAssetsDelta).toBeCloseTo(round2(cashDelta + arDelta + fixedAssetDelta), 1);

    // Equity is a pure plug — assets always equal liabilities + equity by construction.
    expect(round2(after.liabilities.total + after.equity)).toBeCloseTo(after.assets.total, 1);
  });
});
