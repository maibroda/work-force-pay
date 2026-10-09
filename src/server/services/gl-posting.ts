/**
 * General-ledger posting for client billing (AR), vendor billing (AP), and fixed-asset
 * depreciation — the counterpart to accounting.ts's payroll posting, using the same
 * JournalEntry/JournalLine tables and the same "one balanced journal per event" shape, but with
 * `runId` left null (see the JournalEntry model comment in schema.prisma).
 *
 * Each function here is called from inside the caller's own transaction (mirroring
 * accounting.ts#postRunToGl's `tx: Tx = db` pattern), so the business record and its journal
 * commit together — an invoice can never exist without its posting, or vice versa.
 *
 * Simplifications versus a full ledger: all AP spend posts to one generic expense account
 * regardless of vendor category (no per-category expense mapping yet); VAT on a purchase is
 * folded into that same expense rather than tracked as a separate input-VAT receivable; AR/AP
 * cash movements always post to one default "Cash and Bank — Operating" account rather than the
 * specific BankAccount involved, since ClientReceipt/VendorPayment don't carry a bankAccountId
 * (see bank-reconciliation.ts's own note on this same limitation).
 */
import { num, round2 } from "@/lib/money";
import type { Ctx } from "@/lib/auth/context";
import { type Tx } from "./_base";
import { ensureDefaultChart } from "./accounting";
import { postJournal as enginePost } from "./posting";

const ACCOUNTS = {
  AR: "1200",
  WHT_RECEIVABLE: "1220",
  CASH: "1230",
  FIXED_ASSETS_COST: "1240",
  ACCUM_DEPRECIATION: "1250",
  AP: "2180",
  VAT_PAYABLE: "2190",
  WHT_PAYABLE: "2195",
  OPENING_BALANCE_EQUITY: "3100",
  REVENUE: "4100",
  CLIENT_DEDUCTIONS: "4190",
  GAIN_LOSS_ON_DISPOSAL: "4200",
  VENDOR_EXPENSE: "5400",
  DEPRECIATION_EXPENSE: "5410",
  STAFF_LOANS: "1210",
  LOAN_WRITE_OFF: "5420",
} as const;

interface DraftLine {
  accountCode: string;
  description: string;
  debit: number;
  credit: number;
}

/** The document a journal came from, so the ledger line can be traced back to it. */
interface SourceRef {
  type: string;
  id?: string;
}

/**
 * Adapts the account-code drafts used in this file to the posting engine, which owns every rule: balance, active
 * accounts, open accounting period, numbering, source reference and audit. Nothing here writes a journal itself.
 */
async function postJournal(
  ctx: Ctx,
  tx: Tx,
  input: { source: string; ref?: SourceRef; postingDate: Date; description: string; lines: DraftLine[] },
) {
  if (!input.lines.some((l) => round2(l.debit) !== 0 || round2(l.credit) !== 0)) return null;
  await ensureDefaultChart(tx, ctx.orgId);
  return enginePost(ctx, tx, {
    source: input.source,
    sourceType: input.ref?.type,
    sourceId: input.ref?.id,
    postingDate: input.postingDate,
    description: input.description,
    lines: input.lines.map((l) => ({ accountCode: l.accountCode, description: l.description, debit: l.debit, credit: l.credit })),
  });
}

// ─────────────────────────────── Accounts receivable ───────────────────────────────

export async function postArInvoice(
  ctx: Ctx,
  tx: Tx,
  invoice: { id: string; invoiceNumber: string; invoiceDate: Date; subtotal: unknown; vatAmount: unknown; totalAmount: unknown },
) {
  const subtotal = num(invoice.subtotal);
  const vat = num(invoice.vatAmount);
  return postJournal(ctx, tx, {
    source: "AR_INVOICE",
    ref: { type: "CLIENT_INVOICE", id: invoice.id },
    postingDate: invoice.invoiceDate,
    description: `Client invoice ${invoice.invoiceNumber}`,
    lines: [
      { accountCode: ACCOUNTS.AR, description: invoice.invoiceNumber, debit: num(invoice.totalAmount), credit: 0 },
      { accountCode: ACCOUNTS.REVENUE, description: invoice.invoiceNumber, debit: 0, credit: subtotal },
      ...(vat > 0
        ? [{ accountCode: ACCOUNTS.VAT_PAYABLE, description: invoice.invoiceNumber, debit: 0, credit: vat }]
        : []),
    ],
  });
}

/**
 * Cancelling an invoice reverses its posting: the mirror image of postArInvoice, dated the day it is cancelled. The
 * original journal stays in the ledger untouched; the reversal sits beside it, so the trail shows both.
 */
export async function postArInvoiceCancellation(
  ctx: Ctx,
  tx: Tx,
  invoice: { id: string; invoiceNumber: string; subtotal: unknown; vatAmount: unknown; totalAmount: unknown },
  on: Date,
) {
  const subtotal = num(invoice.subtotal);
  const vat = num(invoice.vatAmount);
  return postJournal(ctx, tx, {
    source: "AR_INVOICE_CANCEL",
    ref: { type: "CLIENT_INVOICE", id: invoice.id },
    postingDate: on,
    description: `Reversal of client invoice ${invoice.invoiceNumber} (cancelled)`,
    lines: [
      { accountCode: ACCOUNTS.REVENUE, description: invoice.invoiceNumber, debit: subtotal, credit: 0 },
      ...(vat > 0 ? [{ accountCode: ACCOUNTS.VAT_PAYABLE, description: invoice.invoiceNumber, debit: vat, credit: 0 }] : []),
      { accountCode: ACCOUNTS.AR, description: invoice.invoiceNumber, debit: 0, credit: num(invoice.totalAmount) },
    ],
  });
}

export async function postArReceipt(
  ctx: Ctx,
  tx: Tx,
  receipt: { id?: string; amount: unknown; receivedDate: Date },
  invoiceNumber: string,
) {
  const amount = num(receipt.amount);
  return postJournal(ctx, tx, {
    source: "AR_RECEIPT",
    ref: { type: "CLIENT_RECEIPT", id: receipt.id },
    postingDate: receipt.receivedDate,
    description: `Receipt against ${invoiceNumber}`,
    lines: [
      { accountCode: ACCOUNTS.CASH, description: invoiceNumber, debit: amount, credit: 0 },
      { accountCode: ACCOUNTS.AR, description: invoiceNumber, debit: 0, credit: amount },
    ],
  });
}

export async function postArDeduction(
  ctx: Ctx,
  tx: Tx,
  deduction: { id?: string; type: string; amount: unknown; createdAt?: Date },
  invoiceNumber: string,
) {
  const amount = num(deduction.amount);
  const debitAccount = deduction.type === "WITHHOLDING_TAX" ? ACCOUNTS.WHT_RECEIVABLE : ACCOUNTS.CLIENT_DEDUCTIONS;
  return postJournal(ctx, tx, {
    source: "AR_DEDUCTION",
    ref: { type: "CLIENT_INVOICE_DEDUCTION", id: deduction.id },
    postingDate: deduction.createdAt ?? new Date(),
    description: `Deduction against ${invoiceNumber} (${deduction.type})`,
    lines: [
      { accountCode: debitAccount, description: invoiceNumber, debit: amount, credit: 0 },
      { accountCode: ACCOUNTS.AR, description: invoiceNumber, debit: 0, credit: amount },
    ],
  });
}

// ─────────────────────────────── Accounts payable ───────────────────────────────

export async function postApInvoice(
  ctx: Ctx,
  tx: Tx,
  invoice: { id?: string; invoiceNumber: string; invoiceDate: Date; totalAmount: unknown },
) {
  const total = num(invoice.totalAmount);
  return postJournal(ctx, tx, {
    source: "AP_INVOICE",
    ref: { type: "PURCHASE_INVOICE", id: invoice.id },
    postingDate: invoice.invoiceDate,
    description: `Vendor bill ${invoice.invoiceNumber}`,
    lines: [
      { accountCode: ACCOUNTS.VENDOR_EXPENSE, description: invoice.invoiceNumber, debit: total, credit: 0 },
      { accountCode: ACCOUNTS.AP, description: invoice.invoiceNumber, debit: 0, credit: total },
    ],
  });
}

/** Cancelling a vendor bill reverses its posting, dated the day it is cancelled; the original journal stays. */
export async function postApInvoiceCancellation(
  ctx: Ctx,
  tx: Tx,
  invoice: { id?: string; invoiceNumber: string; totalAmount: unknown },
  on: Date,
) {
  const total = num(invoice.totalAmount);
  return postJournal(ctx, tx, {
    source: "AP_INVOICE_CANCEL",
    ref: { type: "PURCHASE_INVOICE", id: invoice.id },
    postingDate: on,
    description: `Reversal of vendor bill ${invoice.invoiceNumber} (cancelled)`,
    lines: [
      { accountCode: ACCOUNTS.AP, description: invoice.invoiceNumber, debit: total, credit: 0 },
      { accountCode: ACCOUNTS.VENDOR_EXPENSE, description: invoice.invoiceNumber, debit: 0, credit: total },
    ],
  });
}

export async function postApPayment(
  ctx: Ctx,
  tx: Tx,
  payment: { id?: string; amount: unknown; paidDate: Date },
  invoiceNumber: string,
) {
  const amount = num(payment.amount);
  return postJournal(ctx, tx, {
    source: "AP_PAYMENT",
    ref: { type: "VENDOR_PAYMENT", id: payment.id },
    postingDate: payment.paidDate,
    description: `Payment against ${invoiceNumber}`,
    lines: [
      { accountCode: ACCOUNTS.AP, description: invoiceNumber, debit: amount, credit: 0 },
      { accountCode: ACCOUNTS.CASH, description: invoiceNumber, debit: 0, credit: amount },
    ],
  });
}

export async function postApDeduction(
  ctx: Ctx,
  tx: Tx,
  deduction: { id?: string; type: string; amount: unknown; createdAt?: Date },
  invoiceNumber: string,
) {
  const amount = num(deduction.amount);
  const creditAccount = deduction.type === "WITHHOLDING_TAX" ? ACCOUNTS.WHT_PAYABLE : ACCOUNTS.VENDOR_EXPENSE;
  return postJournal(ctx, tx, {
    source: "AP_DEDUCTION",
    ref: { type: "PURCHASE_INVOICE_DEDUCTION", id: deduction.id },
    postingDate: deduction.createdAt ?? new Date(),
    description: `Deduction against ${invoiceNumber} (${deduction.type})`,
    lines: [
      { accountCode: ACCOUNTS.AP, description: invoiceNumber, debit: amount, credit: 0 },
      { accountCode: creditAccount, description: invoiceNumber, debit: 0, credit: amount },
    ],
  });
}

// ─────────────────────────────── Bank accounts & fixed assets ───────────────────────────────

/** Brings a bank account's opening balance onto the books against Opening Balance Equity. */
export async function postBankAccountOpening(
  ctx: Ctx,
  tx: Tx,
  account: { id?: string; name: string; openingBalance: unknown; openingDate: Date },
) {
  const amount = num(account.openingBalance);
  if (amount === 0) return null;
  return postJournal(ctx, tx, {
    source: "BANK_ACCOUNT_OPENING",
    ref: { type: "BANK_ACCOUNT", id: account.id },
    postingDate: account.openingDate,
    description: `Opening balance — ${account.name}`,
    lines:
      amount > 0
        ? [
            { accountCode: ACCOUNTS.CASH, description: account.name, debit: amount, credit: 0 },
            { accountCode: ACCOUNTS.OPENING_BALANCE_EQUITY, description: account.name, debit: 0, credit: amount },
          ]
        : [
            { accountCode: ACCOUNTS.OPENING_BALANCE_EQUITY, description: account.name, debit: -amount, credit: 0 },
            { accountCode: ACCOUNTS.CASH, description: account.name, debit: 0, credit: -amount },
          ],
  });
}

/** Capitalizes a newly-recorded fixed asset, assumed paid from the operating account (this app
 *  doesn't link a FixedAsset to the PurchaseInvoice that may have billed it, so a vendor-billed
 *  acquisition posts twice — once as a vendor expense, once as this capitalization — a known
 *  simplification rather than a bug). */
export async function postFixedAssetAcquisition(
  ctx: Ctx,
  tx: Tx,
  asset: { id?: string; assetNumber: string; acquisitionDate: Date; cost: unknown },
) {
  const cost = num(asset.cost);
  return postJournal(ctx, tx, {
    source: "FIXED_ASSET_ACQUISITION",
    ref: { type: "FIXED_ASSET", id: asset.id },
    postingDate: asset.acquisitionDate,
    description: `Fixed asset acquired — ${asset.assetNumber}`,
    lines: [
      { accountCode: ACCOUNTS.FIXED_ASSETS_COST, description: asset.assetNumber, debit: cost, credit: 0 },
      { accountCode: ACCOUNTS.CASH, description: asset.assetNumber, debit: 0, credit: cost },
    ],
  });
}

/** Removes a disposed asset from the books: clears its cost and accumulated depreciation, brings
 *  in the sale proceeds, and plugs the difference to gain/(loss) on disposal. */
export async function postFixedAssetDisposal(
  ctx: Ctx,
  tx: Tx,
  asset: { id?: string; assetNumber: string; disposalDate: Date; cost: unknown; disposalProceeds: unknown },
  accumulatedDepreciationAtDisposal: number,
) {
  const cost = num(asset.cost);
  const proceeds = num(asset.disposalProceeds);
  const netBookValue = round2(cost - accumulatedDepreciationAtDisposal);
  const gainOrLoss = round2(proceeds - netBookValue);
  const lines: DraftLine[] = [
    { accountCode: ACCOUNTS.ACCUM_DEPRECIATION, description: asset.assetNumber, debit: accumulatedDepreciationAtDisposal, credit: 0 },
    { accountCode: ACCOUNTS.CASH, description: asset.assetNumber, debit: proceeds, credit: 0 },
    { accountCode: ACCOUNTS.FIXED_ASSETS_COST, description: asset.assetNumber, debit: 0, credit: cost },
  ];
  if (gainOrLoss > 0)
    lines.push({ accountCode: ACCOUNTS.GAIN_LOSS_ON_DISPOSAL, description: asset.assetNumber, debit: 0, credit: gainOrLoss });
  else if (gainOrLoss < 0)
    lines.push({ accountCode: ACCOUNTS.GAIN_LOSS_ON_DISPOSAL, description: asset.assetNumber, debit: -gainOrLoss, credit: 0 });
  return postJournal(ctx, tx, {
    source: "FIXED_ASSET_DISPOSAL",
    ref: { type: "FIXED_ASSET", id: asset.id },
    postingDate: asset.disposalDate,
    description: `Fixed asset disposed — ${asset.assetNumber}`,
    lines,
  });
}

// ─────────────────────────────── Fixed-asset depreciation ───────────────────────────────

export async function postDepreciation(
  ctx: Ctx,
  tx: Tx,
  postingDate: Date,
  periodLabel: string,
  perAssetAmounts: { assetNumber: string; amount: number }[],
) {
  const lines = perAssetAmounts.filter((a) => round2(a.amount) > 0);
  const total = round2(lines.reduce((a, l) => a + l.amount, 0));
  if (!lines.length || total <= 0) return null;
  return postJournal(ctx, tx, {
    source: "DEPRECIATION",
    ref: { type: "DEPRECIATION_MONTH", id: postingDate.toISOString().slice(0, 7) },
    postingDate,
    description: `Depreciation — ${periodLabel}`,
    lines: [
      ...lines.map((l) => ({
        accountCode: ACCOUNTS.DEPRECIATION_EXPENSE,
        description: l.assetNumber,
        debit: l.amount,
        credit: 0,
      })),
      { accountCode: ACCOUNTS.ACCUM_DEPRECIATION, description: periodLabel, debit: 0, credit: total },
    ],
  });
}

export { ACCOUNTS as GL_POSTING_ACCOUNTS };

// ───────────────────────────── Staff loans & advances ─────────────────────────────
// Repayments taken through payroll credit the staff-loans account via the payroll GL mapping
// (the LOAN / SALARY_ADVANCE heads), so only the cash legs and the write-off post from here.

const loanLabel = (l: { type: string; loanNumber: string }) =>
  `${l.type === "SALARY_ADVANCE" ? "Salary advance" : "Staff loan"} ${l.loanNumber}`;

/** Money paid out: Dr Staff Loans & Advances / Cr Cash. */
export async function postLoanDisbursement(
  ctx: Ctx,
  tx: Tx,
  loan: { id?: string; loanNumber: string; type: string; principal: unknown; disbursedOn: Date },
) {
  const amount = num(loan.principal);
  return postJournal(ctx, tx, {
    source: "LOAN_DISBURSEMENT",
    ref: { type: "STAFF_LOAN", id: loan.id },
    postingDate: loan.disbursedOn,
    description: `${loanLabel(loan)} paid out`,
    lines: [
      { accountCode: ACCOUNTS.STAFF_LOANS, description: loan.loanNumber, debit: amount, credit: 0 },
      { accountCode: ACCOUNTS.CASH, description: loan.loanNumber, debit: 0, credit: amount },
    ],
  });
}

/** Repayment paid straight to the company: Dr Cash / Cr Staff Loans & Advances. */
export async function postLoanCashRepayment(
  ctx: Ctx,
  tx: Tx,
  loan: { id?: string; loanNumber: string; type: string },
  amount: number,
  date: Date,
) {
  return postJournal(ctx, tx, {
    source: "LOAN_REPAYMENT",
    ref: { type: "STAFF_LOAN", id: loan.id },
    postingDate: date,
    description: `${loanLabel(loan)} repaid in cash`,
    lines: [
      { accountCode: ACCOUNTS.CASH, description: loan.loanNumber, debit: amount, credit: 0 },
      { accountCode: ACCOUNTS.STAFF_LOANS, description: loan.loanNumber, debit: 0, credit: amount },
    ],
  });
}

/** Bad debt: Dr Staff Loan Write-off / Cr Staff Loans & Advances. */
export async function postLoanWriteOff(
  ctx: Ctx,
  tx: Tx,
  loan: { id?: string; loanNumber: string; type: string },
  amount: number,
  date: Date,
) {
  return postJournal(ctx, tx, {
    source: "LOAN_WRITE_OFF",
    ref: { type: "STAFF_LOAN", id: loan.id },
    postingDate: date,
    description: `${loanLabel(loan)} written off`,
    lines: [
      { accountCode: ACCOUNTS.LOAN_WRITE_OFF, description: loan.loanNumber, debit: amount, credit: 0 },
      { accountCode: ACCOUNTS.STAFF_LOANS, description: loan.loanNumber, debit: 0, credit: amount },
    ],
  });
}
