/**
 * Management financial statements (Trial Balance, Income Statement, Balance Sheet) — computed on
 * the fly from existing operational records, the same way payablesSummary/receivablesSummary/
 * costCenterActuals already work, rather than from a fully GL-integrated ledger.
 *
 * The GL (JournalEntry/JournalLine) today only ever gets posted from payroll locks — client
 * billing (AR), vendor bills (AP), fixed-asset depreciation, and bank accounts never post journal
 * entries. So:
 *  - Trial Balance is 100% GL-accurate (it's literally what JournalLine tracks).
 *  - Income Statement / Balance Sheet combine that GL data (payroll expenses, statutory payables)
 *    with figures pulled directly from AR/AP/fixed-assets/bank records for everything the GL
 *    doesn't see. Equity is a balancing plug (assets − liabilities), not independently tracked —
 *    every result labels it as such rather than presenting it as precisely derived.
 * A future phase could retrofit real GL postings for AR/AP/fixed-assets/bank (mirroring
 * PayrollGlMapping) to make these statements fully GL-sourced; that's out of scope here.
 */
import type { Ctx } from "@/lib/auth/context";
import { d, iso, addDays } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { assertCan, db } from "./_base";
import { accumulatedDepreciation, netBookValue } from "./fixed-assets";

function asOfDate(asOf?: string): Date {
  return d(asOf && asOf.length >= 10 ? asOf : iso(new Date()));
}

/** Every GL account's debit/credit activity and net balance, as of a date. Always balances
 *  (debit total = credit total) since every JournalEntry posts equal debits and credits. */
export async function trialBalance(ctx: Ctx, asOf?: string) {
  assertCan(ctx, "gl.view");
  const cutoff = asOfDate(asOf);
  const lines = await db.journalLine.findMany({
    where: { journal: { organizationId: ctx.orgId, postingDate: { lte: cutoff } } },
    include: { account: true },
  });
  const byAccount = new Map<string, { account: (typeof lines)[number]["account"]; debit: number; credit: number }>();
  for (const l of lines) {
    const row = byAccount.get(l.accountId) ?? { account: l.account, debit: 0, credit: 0 };
    row.debit = round2(row.debit + num(l.debit));
    row.credit = round2(row.credit + num(l.credit));
    byAccount.set(l.accountId, row);
  }
  const rows = [...byAccount.values()]
    .map((r) => {
      const net = round2(r.debit - r.credit);
      return {
        account: r.account,
        debit: r.debit,
        credit: r.credit,
        debitBalance: net > 0 ? net : 0,
        creditBalance: net < 0 ? -net : 0,
      };
    })
    .sort((a, b) => a.account.code.localeCompare(b.account.code));
  const totals = {
    debit: round2(rows.reduce((s, r) => s + r.debitBalance, 0)),
    credit: round2(rows.reduce((s, r) => s + r.creditBalance, 0)),
  };
  return {
    asOf: iso(cutoff),
    rows,
    totals,
    balanced: Math.abs(round2(totals.debit - totals.credit)) < 0.01,
  };
}

/** Revenue from client billing, expenses from the GL (payroll) plus depreciation, for a period. */
export async function incomeStatement(ctx: Ctx, from: string, to: string) {
  assertCan(ctx, "gl.view");
  const fromDate = d(from);
  const toDate = d(to);
  if (toDate < fromDate) throw new Error("'to' must be on or after 'from'.");
  const dayBeforeFrom = addDays(fromDate, -1);

  const invoices = await db.clientInvoice.findMany({
    where: {
      organizationId: ctx.orgId,
      status: { not: "CANCELLED" },
      invoiceDate: { gte: fromDate, lte: toDate },
    },
  });
  const revenue = round2(invoices.reduce((s, i) => s + num(i.subtotal), 0));

  const expenseLines = await db.journalLine.findMany({
    where: {
      journal: { organizationId: ctx.orgId, postingDate: { gte: fromDate, lte: toDate } },
      account: { type: "EXPENSE" },
    },
    include: { account: true },
  });
  const byAccount = new Map<string, { account: (typeof expenseLines)[number]["account"]; amount: number }>();
  for (const l of expenseLines) {
    const row = byAccount.get(l.accountId) ?? { account: l.account, amount: 0 };
    row.amount = round2(row.amount + num(l.debit) - num(l.credit));
    byAccount.set(l.accountId, row);
  }
  const payrollExpenseRows = [...byAccount.values()].sort((a, b) => a.account.code.localeCompare(b.account.code));
  const payrollExpenseTotal = round2(payrollExpenseRows.reduce((s, r) => s + r.amount, 0));

  const assets = await db.fixedAsset.findMany({
    where: { organizationId: ctx.orgId, acquisitionDate: { lte: toDate } },
  });
  const depreciationExpense = round2(
    assets.reduce(
      (s, a) => s + (accumulatedDepreciation(a, toDate) - accumulatedDepreciation(a, dayBeforeFrom)),
      0,
    ),
  );

  const totalExpenses = round2(payrollExpenseTotal + depreciationExpense);
  const netIncome = round2(revenue - totalExpenses);

  return {
    from: iso(fromDate),
    to: iso(toDate),
    revenue,
    payrollExpenseRows,
    payrollExpenseTotal,
    depreciationExpense,
    totalExpenses,
    netIncome,
  };
}

/** Assets/liabilities assembled from AR, AP, fixed assets, bank accounts and GL payroll payables;
 *  equity is a balancing plug (assets − liabilities), not an independently tracked figure. */
export async function balanceSheet(ctx: Ctx, asOf?: string) {
  assertCan(ctx, "gl.view");
  const cutoff = asOfDate(asOf);

  const [bankAccounts, receipts, payments] = await Promise.all([
    db.bankAccount.findMany({ where: { organizationId: ctx.orgId, openingDate: { lte: cutoff } } }),
    db.clientReceipt.findMany({ where: { organizationId: ctx.orgId, receivedDate: { lte: cutoff } } }),
    db.vendorPayment.findMany({ where: { organizationId: ctx.orgId, paidDate: { lte: cutoff } } }),
  ]);
  const cash = round2(
    bankAccounts.reduce((s, a) => s + num(a.openingBalance), 0) +
      receipts.reduce((s, r) => s + num(r.amount), 0) -
      payments.reduce((s, p) => s + num(p.amount), 0),
  );

  const clientInvoices = await db.clientInvoice.findMany({
    where: { organizationId: ctx.orgId, status: { not: "CANCELLED" }, invoiceDate: { lte: cutoff } },
  });
  const accountsReceivable = round2(
    clientInvoices.reduce(
      (s, i) => s + round2(num(i.totalAmount) - num(i.amountPaid) - num(i.totalDeductions)),
      0,
    ),
  );

  const purchaseInvoices = await db.purchaseInvoice.findMany({
    where: { organizationId: ctx.orgId, status: { not: "CANCELLED" }, invoiceDate: { lte: cutoff } },
  });
  const accountsPayable = round2(
    purchaseInvoices.reduce(
      (s, i) => s + round2(num(i.totalAmount) - num(i.amountPaid) - num(i.totalDeductions)),
      0,
    ),
  );

  const fixedAssetRows = await db.fixedAsset.findMany({
    where: { organizationId: ctx.orgId, acquisitionDate: { lte: cutoff } },
  });
  const activeAssets = fixedAssetRows.filter(
    (a) => !(a.status === "DISPOSED" && a.disposalDate && a.disposalDate <= cutoff),
  );
  const fixedAssetsNet = round2(activeAssets.reduce((s, a) => s + netBookValue(a, cutoff), 0));

  const liabilityLines = await db.journalLine.findMany({
    where: {
      journal: { organizationId: ctx.orgId, postingDate: { lte: cutoff } },
      account: { type: "LIABILITY" },
    },
    include: { account: true },
  });
  const byAccount = new Map<string, { account: (typeof liabilityLines)[number]["account"]; amount: number }>();
  for (const l of liabilityLines) {
    const row = byAccount.get(l.accountId) ?? { account: l.account, amount: 0 };
    row.amount = round2(row.amount + num(l.credit) - num(l.debit));
    byAccount.set(l.accountId, row);
  }
  const payrollLiabilityRows = [...byAccount.values()]
    .filter((r) => Math.abs(r.amount) > 0.01)
    .sort((a, b) => a.account.code.localeCompare(b.account.code));
  const payrollLiabilityTotal = round2(payrollLiabilityRows.reduce((s, r) => s + r.amount, 0));

  const totalAssets = round2(cash + accountsReceivable + fixedAssetsNet);
  const totalLiabilities = round2(accountsPayable + payrollLiabilityTotal);
  const equity = round2(totalAssets - totalLiabilities);

  return {
    asOf: iso(cutoff),
    assets: { cash, accountsReceivable, fixedAssetsNet, total: totalAssets },
    liabilities: {
      accountsPayable,
      payrollLiabilityRows,
      payrollLiabilityTotal,
      total: totalLiabilities,
    },
    equity,
  };
}
