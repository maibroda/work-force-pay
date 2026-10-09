/**
 * The posting engine: the one place a journal is written.
 *
 * Every financial effect in the system — payroll, invoices, receipts, bills, depreciation, loans, bank openings —
 * reaches the ledger through `postJournal`, so the same rules apply to all of them and a module can't forget one.
 * It refuses a journal that:
 *   - has fewer than two lines, a negative amount, or a line that is both debit and credit;
 *   - does not balance (debits must equal credits);
 *   - posts to an account that doesn't exist, belongs to another organization, or is inactive;
 *   - falls in an accounting period that is closed or locked (or soft closed, for anyone without the close permission).
 * and otherwise writes the journal with its period, its source document and its audit entry, in the caller's
 * transaction, so a business record and its journal commit or fail together.
 *
 * A posted journal is never edited or deleted, which the database also enforces; a correction is a new journal.
 */
import { round2 } from "@/lib/money";
import { postingAllowed, type PeriodStatus } from "@/lib/fiscal";
import type { Ctx } from "@/lib/auth/context";
import { BusinessError, type Tx } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";
import { canPostWhenSoftClosed, periodFor } from "./periods";

export interface PostingLine {
  /** Either the account's id or its code; the id wins if both are given. */
  accountId?: string;
  accountCode?: string;
  /** What produced the line (a payroll head code, or the source label). Defaults to the journal's source. */
  headCode?: string;
  description: string;
  debit: number;
  credit: number;
}

export interface PostingInput {
  /** Free-text label of the kind of posting, kept for the register and filters (AR_INVOICE, PAYROLL_LOCK …). */
  source: string;
  /** The document that produced the journal, so the ledger line can be traced back to it. */
  sourceType?: string;
  sourceId?: string;
  postingDate: Date;
  description: string;
  lines: PostingLine[];
  runId?: string;
  periodName?: string | null;
  remarks?: string | null;
  /** Extra facts for the audit entry. */
  audit?: Record<string, unknown>;
}

const TOLERANCE = 0.01;

export async function postJournal(ctx: Ctx, tx: Tx, input: PostingInput) {
  const lines = input.lines.filter((l) => round2(l.debit) !== 0 || round2(l.credit) !== 0);
  if (!lines.length) return null;
  if (lines.length < 2) throw new BusinessError(`Journal for "${input.description}" needs at least two lines.`);
  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0) throw new BusinessError(`Journal for "${input.description}" has a negative amount; post the opposite side instead.`);
    if (l.debit > 0 && l.credit > 0) throw new BusinessError(`Journal for "${input.description}" has a line that is both debit and credit.`);
  }
  const totalDebit = round2(lines.reduce((a, l) => a + l.debit, 0));
  const totalCredit = round2(lines.reduce((a, l) => a + l.credit, 0));
  if (Math.abs(round2(totalDebit - totalCredit)) >= TOLERANCE)
    throw new BusinessError(`Journal for "${input.description}" does not balance (debit ₦${totalDebit} vs credit ₦${totalCredit}).`);

  // Accounts: they must exist in this organization and be active.
  const ids = [...new Set(lines.map((l) => l.accountId).filter((x): x is string => !!x))];
  const codes = [...new Set(lines.filter((l) => !l.accountId).map((l) => l.accountCode).filter((x): x is string => !!x))];
  if (lines.some((l) => !l.accountId && !l.accountCode)) throw new BusinessError(`Journal for "${input.description}" has a line with no account.`);
  const accounts = await tx.glAccount.findMany({ where: { organizationId: ctx.orgId, OR: [{ id: { in: ids } }, { code: { in: codes } }] } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const resolved = lines.map((l) => {
    const a = l.accountId ? byId.get(l.accountId) : byCode.get(l.accountCode!);
    if (!a) throw new BusinessError(`GL account ${l.accountId ? "(by id)" : l.accountCode} is missing from the chart of accounts.`);
    if (!a.active) throw new BusinessError(`GL account ${a.code} ${a.name} is inactive and cannot be posted to.`);
    return { l, a };
  });

  // The accounting period must accept postings.
  const period = await periodFor(tx, ctx.orgId, input.postingDate);
  const check = postingAllowed(period.status as PeriodStatus, period.name, canPostWhenSoftClosed(ctx));
  if (!check.ok) throw new BusinessError(check.reason!);

  const entryNumber = await nextNumber(tx, ctx.orgId, "JOURNAL");
  const journal = await tx.journalEntry.create({
    data: {
      organizationId: ctx.orgId,
      entryNumber,
      runId: input.runId,
      periodId: period.id,
      periodName: input.periodName ?? period.name,
      postingDate: input.postingDate,
      description: input.description,
      source: input.source,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      totalDebit,
      totalCredit,
      postedBy: ctx.name,
      remarks: input.remarks ?? null,
      lines: {
        create: resolved.map(({ l, a }, i) => ({
          accountId: a.id,
          accountCode: a.code,
          accountName: a.name,
          headCode: l.headCode ?? input.source,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
          sortOrder: i,
        })),
      },
    },
  });
  await logAudit(
    ctx,
    {
      action: "GL_POSTING",
      entity: "JournalEntry",
      entityId: journal.id,
      newValue: { entryNumber, source: input.source, sourceType: input.sourceType, sourceId: input.sourceId, period: period.name, totalDebit, lines: lines.length, ...input.audit },
    },
    tx,
  );
  return journal;
}

