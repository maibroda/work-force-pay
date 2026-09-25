/**
 * Financial statements (Trial Balance, Income Statement, Balance Sheet) — fully GL-sourced. Every
 * figure here is a sum of JournalLine debits/credits grouped by GL account (or account type), the
 * same way payroll's own posting (accounting.ts) and client/vendor billing, bank accounts and
 * fixed-asset depreciation/disposal (gl-posting.ts) all post to the same ledger.
 *
 * Because every JournalEntry posts equal debits and credits, the fundamental accounting identity
 * (Assets = Liabilities + Equity + Income − Expense) holds exactly across the whole ledger. Equity
 * is therefore never a plug figure here — it's Opening Balance Equity (from bank-account openings)
 * plus Retained Earnings (the ledger's own cumulative Income − Expense up to the cutoff date), both
 * summed straight from JournalLine like everything else.
 *
 * Known simplification: all AP spend posts to one generic expense account regardless of vendor
 * category, VAT on a purchase is folded into that expense rather than tracked as input VAT, and
 * AR/AP cash movements post to one default operating-cash account rather than a specific
 * BankAccount (see gl-posting.ts's own header comment for why).
 */
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { assertCan, db } from "./_base";
import { GL_POSTING_ACCOUNTS } from "./gl-posting";

function asOfDate(asOf?: string): Date {
  return d(asOf && asOf.length >= 10 ? asOf : iso(new Date()));
}

type AccountRow = { account: { id: string; code: string; name: string; type: string }; net: number };

/** Every JournalLine in range, grouped by account, net = debit − credit (each account's own
 *  natural balance side is whichever of debit/credit that nets positive). */
async function accountBalances(orgId: string, where: { lte?: Date; gte?: Date }) {
  const lines = await db.journalLine.findMany({
    where: { journal: { organizationId: orgId, postingDate: where } },
    include: { account: true },
  });
  const byAccount = new Map<string, AccountRow>();
  for (const l of lines) {
    const row = byAccount.get(l.accountId) ?? { account: l.account, net: 0 };
    row.net = round2(row.net + num(l.debit) - num(l.credit));
    byAccount.set(l.accountId, row);
  }
  return [...byAccount.values()];
}

/** Every GL account's debit/credit activity and net balance, as of a date. Always balances
 *  (debit total = credit total) since every JournalEntry posts equal debits and credits. */
export async function trialBalance(ctx: Ctx, asOf?: string) {
  assertCan(ctx, "gl.view");
  const cutoff = asOfDate(asOf);
  const rows = (await accountBalances(ctx.orgId, { lte: cutoff }))
    .map((r) => ({
      account: r.account,
      debitBalance: r.net > 0 ? r.net : 0,
      creditBalance: r.net < 0 ? -r.net : 0,
    }))
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

/** Revenue (INCOME accounts) less expenses (EXPENSE accounts), from the GL, for a period. A
 *  contra-revenue account (e.g. client deductions) reduces revenue rather than appearing as a
 *  separate expense — it shows as a negative income row. */
export async function incomeStatement(ctx: Ctx, from: string, to: string) {
  assertCan(ctx, "gl.view");
  const fromDate = d(from);
  const toDate = d(to);
  if (toDate < fromDate) throw new Error("'to' must be on or after 'from'.");

  const balances = await accountBalances(ctx.orgId, { gte: fromDate, lte: toDate });
  const sortByCode = (a: { account: { code: string } }, b: { account: { code: string } }) =>
    a.account.code.localeCompare(b.account.code);

  const incomeRows = balances
    .filter((r) => r.account.type === "INCOME" && Math.abs(r.net) > 0.01)
    .map((r) => ({ account: r.account, amount: round2(-r.net) })) // income's natural side is credit
    .sort(sortByCode);
  const revenue = round2(incomeRows.reduce((s, r) => s + r.amount, 0));

  const expenseRows = balances
    .filter((r) => r.account.type === "EXPENSE" && Math.abs(r.net) > 0.01)
    .map((r) => ({ account: r.account, amount: r.net })) // expense's natural side is debit
    .sort(sortByCode);
  const totalExpenses = round2(expenseRows.reduce((s, r) => s + r.amount, 0));

  const netIncome = round2(revenue - totalExpenses);

  return { from: iso(fromDate), to: iso(toDate), incomeRows, revenue, expenseRows, totalExpenses, netIncome };
}

/** Assets, liabilities and equity, all summed straight from the GL as of a date. Equity is Opening
 *  Balance Equity plus Retained Earnings (cumulative income − expense to date) — both genuinely
 *  computed, not a balancing plug — so `assets.total === liabilities.total + equity.total` holds
 *  exactly, the same way a trial balance always balances. */
export async function balanceSheet(ctx: Ctx, asOf?: string) {
  assertCan(ctx, "gl.view");
  const cutoff = asOfDate(asOf);
  const balances = await accountBalances(ctx.orgId, { lte: cutoff });
  const netOf = (code: string) => balances.find((r) => r.account.code === code)?.net ?? 0;
  const sortByCode = (a: { account: { code: string } }, b: { account: { code: string } }) =>
    a.account.code.localeCompare(b.account.code);

  const namedAssetCodes = [
    GL_POSTING_ACCOUNTS.CASH,
    GL_POSTING_ACCOUNTS.AR,
    GL_POSTING_ACCOUNTS.WHT_RECEIVABLE,
    GL_POSTING_ACCOUNTS.FIXED_ASSETS_COST,
    GL_POSTING_ACCOUNTS.ACCUM_DEPRECIATION,
  ] as string[];
  const cash = netOf(GL_POSTING_ACCOUNTS.CASH);
  const accountsReceivable = netOf(GL_POSTING_ACCOUNTS.AR);
  const withholdingTaxReceivable = netOf(GL_POSTING_ACCOUNTS.WHT_RECEIVABLE);
  const fixedAssetsNet = round2(
    netOf(GL_POSTING_ACCOUNTS.FIXED_ASSETS_COST) + netOf(GL_POSTING_ACCOUNTS.ACCUM_DEPRECIATION),
  );
  // Any other ASSET account (e.g. 1210 Staff Loans & Salary Advances from payroll) rolls up here
  // rather than being silently dropped.
  const otherAssetRows = balances
    .filter((r) => r.account.type === "ASSET" && !namedAssetCodes.includes(r.account.code) && Math.abs(r.net) > 0.01)
    .map((r) => ({ account: r.account, amount: r.net }))
    .sort(sortByCode);
  const otherAssetsTotal = round2(otherAssetRows.reduce((s, r) => s + r.amount, 0));
  const totalAssets = round2(cash + accountsReceivable + withholdingTaxReceivable + fixedAssetsNet + otherAssetsTotal);

  const accountsPayable = round2(-netOf(GL_POSTING_ACCOUNTS.AP));
  const otherLiabilityRows = balances
    .filter((r) => r.account.type === "LIABILITY" && r.account.code !== GL_POSTING_ACCOUNTS.AP && Math.abs(r.net) > 0.01)
    .map((r) => ({ account: r.account, amount: round2(-r.net) })) // liability's natural side is credit
    .sort(sortByCode);
  const otherLiabilitiesTotal = round2(otherLiabilityRows.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = round2(accountsPayable + otherLiabilitiesTotal);

  const openingBalanceEquity = round2(-netOf(GL_POSTING_ACCOUNTS.OPENING_BALANCE_EQUITY));
  const otherEquityRows = balances
    .filter(
      (r) => r.account.type === "EQUITY" && r.account.code !== GL_POSTING_ACCOUNTS.OPENING_BALANCE_EQUITY && Math.abs(r.net) > 0.01,
    )
    .map((r) => ({ account: r.account, amount: round2(-r.net) }))
    .sort(sortByCode);
  const totalIncome = round2(balances.filter((r) => r.account.type === "INCOME").reduce((s, r) => s - r.net, 0));
  const totalExpense = round2(balances.filter((r) => r.account.type === "EXPENSE").reduce((s, r) => s + r.net, 0));
  const retainedEarnings = round2(totalIncome - totalExpense);
  const totalEquity = round2(
    openingBalanceEquity + otherEquityRows.reduce((s, r) => s + r.amount, 0) + retainedEarnings,
  );

  return {
    asOf: iso(cutoff),
    assets: {
      cash,
      accountsReceivable,
      withholdingTaxReceivable,
      fixedAssetsNet,
      otherAssetRows,
      otherAssetsTotal,
      total: totalAssets,
    },
    liabilities: { accountsPayable, otherLiabilityRows, otherLiabilitiesTotal, total: totalLiabilities },
    equity: { openingBalanceEquity, otherEquityRows, retainedEarnings, total: totalEquity },
  };
}
