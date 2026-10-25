/**
 * Pure rules for the bank payment file. No database here.
 *
 * The file is a single sheet, one row per person to be paid: Name, Account Number, Bank Code, Amount, Payment Description. Rows are built from
 * what was frozen into the locked payroll. A row that cannot be paid as it stands (no account, a malformed account, a bank we cannot find a code for)
 * is listed as a problem rather than guessed at, and the file is not produced unless those people are deliberately left out. Money is in kobo.
 */
import { resolveBank, type BankEntry } from "./bank-codes";

export const PAYMENT_FILE_HEADERS = ["Name", "Account Number", "Bank Code", "Amount", "Payment Description"] as const;

export type PaymentLine = { transactionId: string; employeeNumber: string; name: string; bankName: string | null; accountNumber: string | null; accountName: string | null; amount: number };

export type FileRow = { transactionId: string; name: string; accountNumber: string; bankCode: string; amount: number; description: string };
export type RowProblem = { transactionId: string; employeeNumber: string; name: string; problems: string[] };
export type FileWarning = { transactionId: string; employeeNumber: string; name: string; message: string };

const kobo = (n: number) => Math.round(n * 100);

/** The name the bank will see: the account name when there is one (it has to match the account), otherwise the employee's. */
const beneficiary = (l: PaymentLine) => (l.accountName?.trim() || l.name).replace(/\s+/g, " ").trim();

export function buildPaymentRows(lines: PaymentLine[], banks: BankEntry[], description: string): { rows: FileRow[]; problems: RowProblem[]; warnings: FileWarning[]; total: number } {
  const rows: FileRow[] = [];
  const problems: RowProblem[] = [];
  const warnings: FileWarning[] = [];
  const seen = new Map<string, string>();
  for (const l of lines) {
    const p: string[] = [];
    const account = (l.accountNumber ?? "").replace(/\s/g, "");
    if (!account) p.push("No account number.");
    else if (!/^\d{10}$/.test(account)) p.push(`Account number "${l.accountNumber}" is not 10 digits.`);
    if (!l.bankName?.trim()) p.push("No bank name.");
    const bank = l.bankName ? resolveBank(l.bankName, banks) : null;
    if (l.bankName?.trim() && !bank) p.push(`Bank "${l.bankName}" is not in the bank list, or matches more than one bank. Correct the bank list or the employee's bank.`);
    if (!(kobo(l.amount) > 0)) p.push("Nothing to pay.");
    if (!beneficiary(l)) p.push("No name.");
    if (p.length) {
      problems.push({ transactionId: l.transactionId, employeeNumber: l.employeeNumber, name: l.name, problems: p });
      continue;
    }
    const key = `${account}|${bank!.code}`;
    if (seen.has(key)) warnings.push({ transactionId: l.transactionId, employeeNumber: l.employeeNumber, name: l.name, message: `Same account as ${seen.get(key)}. Check it is not a duplicate payment.` });
    else seen.set(key, `${l.employeeNumber} ${l.name}`);
    rows.push({ transactionId: l.transactionId, name: beneficiary(l), accountNumber: account, bankCode: bank!.code, amount: kobo(l.amount) / 100, description });
  }
  return { rows, problems, warnings, total: rows.reduce((a, r) => a + kobo(r.amount), 0) / 100 };
}
