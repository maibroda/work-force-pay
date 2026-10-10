/**
 * Pure rules for closing a period. No database here.
 *
 * Before a period can be closed the books are checked. Some checks are hard: the trial balance must balance, and each subledger
 * (receivables, payables, client advances) must equal its control account in the ledger as at the last day of the period. Close
 * is refused while any of them is out, and nothing can waive them. Others are pending work dated in the period (an invoice
 * awaiting approval, a journal approved but not posted): they block too, but an approver can close over one with a written reason,
 * which is kept. The rest are advisory. A period's sign-offs (bank accounts reconciled, accruals reviewed …) can be made
 * compulsory by the organization.
 */

export type CheckKind = "HARD" | "PENDING" | "ADVISORY";
export type CheckStatus = "PASS" | "FAIL" | "WARN";

export interface CloseCheck {
  code: string;
  label: string;
  kind: CheckKind;
  status: CheckStatus;
  detail: string;
  /** How many items are outstanding, for the pending checks. */
  count?: number;
  /** Whether an approver has chosen to close over it. */
  waived?: boolean;
}

export const KIND_LABELS: Record<CheckKind, string> = {
  HARD: "Must be right to close",
  PENDING: "Pending work: an approver can close over it with a reason",
  ADVISORY: "For information",
};

/** The checks that stop a period closing: hard ones that fail, and pending ones that fail and have not been waived. */
export function closeBlockers(checks: CloseCheck[]): CloseCheck[] {
  return checks.filter((c) => c.status === "FAIL" && (c.kind === "HARD" || (c.kind === "PENDING" && !c.waived)));
}

/** The standard sign-offs on a period's close checklist, in order. */
export const STANDARD_SIGNOFFS: Array<{ code: string; label: string }> = [
  { code: "BANK_RECS", label: "Bank accounts reconciled and the reconciliations reviewed" },
  { code: "ACCRUALS", label: "Accruals and prepayments reviewed" },
  { code: "PAYROLL_AGREED", label: "Payroll journal agreed to the payroll register" },
  { code: "TAX_REVIEWED", label: "VAT, withholding and PAYE balances reviewed" },
  { code: "ASSETS", label: "Fixed asset additions, disposals and depreciation reviewed" },
];

const cents = (n: number) => Math.round(n * 100);

export interface ReconciliationLine {
  code: string;
  label: string;
  subledger: number;
  ledger: number;
  difference: number;
  agrees: boolean;
}

/** One reconciliation between a subledger and its control account. */
export function reconciliationLine(code: string, label: string, subledger: number, ledger: number): ReconciliationLine {
  const difference = (cents(subledger) - cents(ledger)) / 100;
  return { code, label, subledger, ledger, difference, agrees: difference === 0 };
}

/** The same JSON with its keys in a fixed order, so a checksum doesn't depend on how a database stored it. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}
