/**
 * Pure rules for credit and debit notes. No database here.
 *
 * A credit note reduces what a client owes on an invoice; a debit note increases it. Either is raised by one person and approved
 * by another, and approving it moves the invoice's balance and posts to the ledger. Money is in kobo so nothing drifts.
 */

export type NoteType = "CREDIT" | "DEBIT";
export type NoteReason = "BILLING_ERROR" | "SERVICE_CREDIT" | "DISCOUNT" | "PRICE_ADJUSTMENT" | "PENALTY_OR_FEE" | "OTHER";
export type NoteStatus = "PENDING" | "APPROVED" | "REJECTED";

export const NOTE_TYPE_LABELS: Record<NoteType, string> = { CREDIT: "Credit note", DEBIT: "Debit note" };
export const NOTE_TYPE_HELP: Record<NoteType, string> = {
  CREDIT: "Reduces what the client owes on the invoice: a billing error, a service credit, a discount.",
  DEBIT: "Increases what the client owes on the invoice: an under-billing, a price adjustment, a penalty or fee.",
};
export const NOTE_REASON_LABELS: Record<NoteReason, string> = {
  BILLING_ERROR: "Billing error",
  SERVICE_CREDIT: "Service credit",
  DISCOUNT: "Discount",
  PRICE_ADJUSTMENT: "Price adjustment",
  PENALTY_OR_FEE: "Penalty or fee",
  OTHER: "Other",
};
export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = { PENDING: "Waiting for approval", APPROVED: "Approved and posted", REJECTED: "Turned down" };

const cents = (n: number) => Math.round(n * 100);
const naira = (c: number) => (c / 100).toFixed(2);

/** What is owed on an invoice once its credit and debit notes are counted. */
export function amountDue(inv: { totalAmount: number; totalDebits: number; totalCredits: number; amountPaid: number; totalDeductions: number }): number {
  return (cents(inv.totalAmount) + cents(inv.totalDebits) - cents(inv.totalCredits) - cents(inv.amountPaid) - cents(inv.totalDeductions)) / 100;
}

/** An invoice's total once its notes are counted: the figure its payments and deductions settle. */
export function effectiveTotal(inv: { totalAmount: number; totalDebits: number; totalCredits: number }): number {
  return (cents(inv.totalAmount) + cents(inv.totalDebits) - cents(inv.totalCredits)) / 100;
}

export interface NoteFacts {
  invoiceNumber: string;
  invoiceDate: Date;
  cancelled: boolean;
  /** What is still owed on the invoice. */
  balance: number;
  /** What a credit note can still take off: the invoice's net charge and VAT, less credits already approved, plus debits. */
  netLeft: number;
  vatLeft: number;
}

/** Everything wrong with a note, as plain sentences. Empty = fine. */
export function noteProblems(
  n: { type: NoteType; netAmount: number; vatAmount: number; noteDate: Date | null; reason: string },
  f: NoteFacts,
  today: Date,
): string[] {
  const out: string[] = [];
  if (f.cancelled) out.push(`${f.invoiceNumber} was cancelled, so nothing can be raised against it.`);
  if (!Number.isFinite(n.netAmount) || cents(n.netAmount) <= 0) out.push("The net amount must be greater than zero.");
  if (!Number.isFinite(n.vatAmount) || cents(n.vatAmount) < 0) out.push("VAT can't be negative.");
  if (n.reason.trim().length < 10) out.push("Say why the note is being raised (at least 10 characters).");
  if (!n.noteDate || Number.isNaN(n.noteDate.getTime())) out.push("Choose the date of the note.");
  else {
    if (n.noteDate < f.invoiceDate) out.push(`A note can't be dated before the invoice (${f.invoiceDate.toISOString().slice(0, 10)}).`);
    if (n.noteDate > today) out.push("A note can't be dated in the future.");
  }
  if (n.type === "CREDIT" && !f.cancelled && cents(n.netAmount) > 0) {
    const total = cents(n.netAmount) + cents(n.vatAmount);
    if (total > cents(f.balance)) out.push(`The credit of ${naira(total)} is more than the ${naira(cents(f.balance))} still owed on ${f.invoiceNumber}. If the client has paid more than the corrected amount, record the overpayment as an advance and refund it.`);
    if (cents(n.netAmount) > cents(f.netLeft)) out.push(`The net amount is more than the ${naira(cents(f.netLeft))} of the invoice that has not already been credited.`);
    if (cents(n.vatAmount) > cents(f.vatLeft)) out.push(`The VAT is more than the ${naira(cents(f.vatLeft))} charged on the invoice that has not already been credited.`);
  }
  return out;
}

/** VAT on a net amount at the invoice's own effective rate (its VAT as a share of its subtotal), to the kobo. */
export function suggestedVat(net: number, invoiceVat: number, invoiceSubtotal: number): number {
  if (invoiceSubtotal <= 0 || invoiceVat <= 0) return 0;
  return Math.round((cents(net) * invoiceVat) / invoiceSubtotal) / 100;
}
