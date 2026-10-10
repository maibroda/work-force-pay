/**
 * Pure rules for manual journals and for reversing a posted journal. No database here.
 *
 * A manual journal is a document: drafted, submitted, approved by someone else, then posted. Nothing touches the
 * ledger until it is posted. A posted journal is never edited or deleted; if it was wrong, a reversal is requested,
 * someone else approves it, and a mirror journal is posted beside the original.
 */

export type JournalKind = "MANUAL" | "ADJUSTMENT" | "ACCRUAL" | "RECLASSIFICATION";
export type DocumentStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "POSTED" | "REJECTED" | "CANCELLED";

export const KIND_LABELS: Record<JournalKind, string> = {
  MANUAL: "Manual journal",
  ADJUSTMENT: "Adjustment",
  ACCRUAL: "Accrual (reverses itself)",
  RECLASSIFICATION: "Reclassification",
};

export const KIND_HELP: Record<JournalKind, string> = {
  MANUAL: "Any entry that no other part of the system posts.",
  ADJUSTMENT: "A correction to a balance, for example at the end of a period.",
  ACCRUAL: "Recognises a cost or income that belongs to this period before the paperwork arrives, and reverses itself on the date you choose.",
  RECLASSIFICATION: "Moves an amount from one account, client, contract or cost centre to another.",
};

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved, not posted",
  POSTED: "Posted",
  REJECTED: "Returned",
  CANCELLED: "Cancelled",
};

/** A document's lines can only be changed while it is a draft or has been returned. */
export const canEditDocument = (s: DocumentStatus) => s === "DRAFT" || s === "REJECTED";

export interface DraftLine {
  accountId: string;
  description: string;
  debit: number;
  credit: number;
}

const cents = (n: number) => Math.round(n * 100);

/** Everything wrong with a draft that stops it being submitted, as plain sentences. Empty = ready. */
export function draftProblems(input: { kind: JournalKind; postingDate: Date | null; reverseOn: Date | null; lines: DraftLine[] }): string[] {
  const out: string[] = [];
  if (!input.postingDate || Number.isNaN(input.postingDate.getTime())) out.push("Choose the date it posts on.");
  const used = input.lines.filter((l) => cents(l.debit) !== 0 || cents(l.credit) !== 0);
  if (used.length < 2) out.push("A journal needs at least two lines with an amount.");
  input.lines.forEach((l, i) => {
    if (l.debit < 0 || l.credit < 0) out.push(`Line ${i + 1} has a negative amount; put it on the other side instead.`);
    if (cents(l.debit) !== 0 && cents(l.credit) !== 0) out.push(`Line ${i + 1} is both debit and credit; use two lines.`);
    if (!l.accountId && (cents(l.debit) !== 0 || cents(l.credit) !== 0)) out.push(`Line ${i + 1} has an amount but no account.`);
  });
  const debit = used.reduce((s, l) => s + cents(l.debit), 0);
  const credit = used.reduce((s, l) => s + cents(l.credit), 0);
  if (debit !== credit) out.push(`It doesn't balance: debits are ${(debit / 100).toFixed(2)} and credits ${(credit / 100).toFixed(2)} (difference ${(Math.abs(debit - credit) / 100).toFixed(2)}).`);
  if (input.kind === "ACCRUAL") {
    if (!input.reverseOn || Number.isNaN(input.reverseOn.getTime())) out.push("An accrual needs the date it reverses on.");
    else if (input.postingDate && input.reverseOn <= input.postingDate) out.push("An accrual must reverse after the day it posts.");
  }
  return out;
}

export interface ReversibilityFacts {
  sourceType: string | null;
  reversalOfId: string | null;
  /** The entry number of the journal that already reverses this one, if any. */
  reversedByNumber: string | null;
}

export interface Reversibility {
  ok: boolean;
  reason?: string;
}

/**
 * Whether a journal can be reversed from here. Only a manual journal can: a journal made by invoicing, payroll,
 * payables or depreciation belongs to a document, and reversing the journal alone would leave that document and the
 * ledger disagreeing. Those are corrected through their own document (cancel the invoice, and so on).
 */
export function reversibility(f: ReversibilityFacts): Reversibility {
  if (f.reversalOfId) return { ok: false, reason: "This journal is itself a reversal. To put the original back, create a new journal." };
  if (f.reversedByNumber) return { ok: false, reason: `It has already been reversed, by ${f.reversedByNumber}.` };
  if (f.sourceType !== "MANUAL_JOURNAL")
    return { ok: false, reason: "This journal was made by another part of the system, so it is corrected through the document that produced it (for example cancel the invoice or bill), not reversed on its own." };
  return { ok: true };
}
