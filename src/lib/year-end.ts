/**
 * Pure rules for closing a financial year. No database here.
 *
 * At year end every income and expense account is brought to nil by a closing journal dated the last day of the year, and the
 * profit or loss is moved to retained earnings. The closing journal reverses each account's balance dimension by dimension (so an
 * account that requires a client or contract still gets one, and the dimension reports still net to nil), with one balancing line
 * on the retained earnings account. It is posted into the year's last period before that period is closed, and it can be
 * reversed ("reopening" the year) while the period still accepts postings.
 */

const cents = (n: number) => Math.round(n * 100);

export interface YearPeriod {
  number: number;
  name: string;
  status: "OPEN" | "SOFT_CLOSED" | "CLOSED" | "LOCKED";
  /** How many journals the period holds. */
  journals: number;
}

/** What stops the year being closed now, as plain sentences. Empty = ready. */
export function yearEndProblems(year: { name: string; closed: boolean }, periods: YearPeriod[]): string[] {
  const out: string[] = [];
  if (year.closed) {
    out.push(`${year.name} has already been closed.`);
    return out;
  }
  const sorted = [...periods].sort((a, b) => a.number - b.number);
  const last = sorted[sorted.length - 1];
  if (!last) return ["This year has no periods."];
  for (const p of sorted.slice(0, -1))
    if (p.journals > 0 && p.status !== "CLOSED" && p.status !== "LOCKED") out.push(`${p.name} has postings and is still ${p.status === "OPEN" ? "open" : "soft closed"}. Close it first.`);
  if (last.status === "CLOSED" || last.status === "LOCKED")
    out.push(`${last.name}, the last period, is already ${last.status === "LOCKED" ? "locked" : "closed"}, so the closing entries can't be posted into it. ${last.status === "LOCKED" ? "A locked period can't be reopened." : "Reopen it, with a reason, to post them."}`);
  return out;
}

/** The net of an income or expense account (with one combination of dimensions) over the year, from the ledger. */
export interface PlBalance {
  accountId: string;
  dimensions: Record<string, string>;
  debit: number;
  credit: number;
}

export interface ClosingLine {
  accountId: string;
  description: string;
  debit: number;
  credit: number;
  dimensions: Record<string, string>;
}

/**
 * The closing journal's lines: each balance reversed with its own dimensions, plus one balancing line on retained earnings.
 * `profit` is positive for a profit, negative for a loss.
 */
export function closingLines(balances: PlBalance[], retainedEarningsAccountId: string): { lines: ClosingLine[]; profit: number } {
  const lines: ClosingLine[] = [];
  for (const b of balances) {
    const c = cents(b.debit) - cents(b.credit); // positive: an expense-like debit balance, cleared by a credit
    if (c === 0) continue;
    lines.push({ accountId: b.accountId, description: "Year-end closing", debit: c < 0 ? -c / 100 : 0, credit: c > 0 ? c / 100 : 0, dimensions: b.dimensions });
  }
  const debits = lines.reduce((s, l) => s + cents(l.debit), 0);
  const credits = lines.reduce((s, l) => s + cents(l.credit), 0);
  const diff = debits - credits; // positive: income cleared exceeds expenses cleared, so there is a profit to credit to retained earnings
  if (diff !== 0) lines.push({ accountId: retainedEarningsAccountId, description: "Year-end closing: profit or loss to retained earnings", debit: diff < 0 ? -diff / 100 : 0, credit: diff > 0 ? diff / 100 : 0, dimensions: {} });
  return { lines, profit: diff / 100 };
}
