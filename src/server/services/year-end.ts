/**
 * Year-end close.
 *
 * Closing a financial year posts one journal, dated the last day of the year, that brings every income and expense account to nil
 * (each account reversed dimension by dimension) and moves the profit or loss to a retained-earnings account. It goes into the
 * year's last period, so that period must still accept postings; the period is closed afterwards in the usual way, with its checks
 * and snapshot. Every earlier period that has postings must already be closed.
 *
 * Once a year is closed, income and expense accounts take no more postings dated in it (the posting engine refuses), so the
 * result stays nil. The income statement and the dimension reports leave the closing journal out, so a year's performance still
 * reads as the year's performance; the trial balance and balance sheet include it. A closed year can be reopened, with a
 * reason, while its last period accepts postings: the closing journal is then reversed in full.
 */
import type { Ctx } from "@/lib/auth/context";
import { DIMENSIONS } from "@/lib/dimensions";
import { num, round2 } from "@/lib/money";
import { closingLines, yearEndProblems, type PlBalance } from "@/lib/year-end";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { mirrorLines, postJournal } from "./posting";

/** The sources of the journals that close and reopen a year; reports leave them out. */
export const YEAR_END_SOURCES = ["YEAR_END_CLOSE", "YEAR_END_REOPEN"];

async function loadYear(ctx: Ctx, yearId: string) {
  const year = await db.fiscalYear.findFirst({ where: { id: yearId, organizationId: ctx.orgId }, include: { periods: { orderBy: { number: "asc" }, include: { _count: { select: { journals: true } } } } } });
  if (!year) throw new BusinessError("Financial year not found.");
  return year;
}

/** Each income and expense account's balance over the year, per combination of dimensions, leaving out year-end journals. */
async function plBalances(tx: Tx, orgId: string, start: Date, end: Date): Promise<PlBalance[]> {
  const columns = DIMENSIONS.map((dm) => dm.column);
  // the dimension columns are a list known only at run time, which the generated query types can't follow
  const groupBy = tx.journalLine.groupBy as unknown as (args: unknown) => Promise<unknown>;
  const grouped = await groupBy.call(tx.journalLine, {
    by: ["accountId", ...columns],
    where: { account: { organizationId: orgId, type: { in: ["INCOME", "EXPENSE"] } }, journal: { organizationId: orgId, postingDate: { gte: start, lte: end }, source: { notIn: YEAR_END_SOURCES } } },
    _sum: { debit: true, credit: true },
  });
  return (grouped as unknown as Array<Record<string, unknown> & { accountId: string; _sum: { debit: unknown; credit: unknown } }>).map((g) => ({
    accountId: g.accountId,
    dimensions: Object.fromEntries(columns.filter((c) => g[c]).map((c) => [c, String(g[c])])),
    debit: round2(num(g._sum.debit)),
    credit: round2(num(g._sum.credit)),
  }));
}

/** Total debits less credits on income and expense lines in the year (the whole of it, closing journal included). */
async function plNet(tx: Tx, orgId: string, start: Date, end: Date, exclude: string[] = []) {
  const a = await tx.journalLine.aggregate({
    where: { account: { organizationId: orgId, type: { in: ["INCOME", "EXPENSE"] } }, journal: { organizationId: orgId, postingDate: { gte: start, lte: end }, ...(exclude.length ? { source: { notIn: exclude } } : {}) } },
    _sum: { debit: true, credit: true },
  });
  return round2(num(a._sum.debit) - num(a._sum.credit));
}

/** Where a year stands: whether it can be closed, why not, what the closing would do, and what it did. */
export async function yearEndStatus(ctx: Ctx, yearId: string) {
  assertCan(ctx, "gl.view");
  const year = await loadYear(ctx, yearId);
  const problems = yearEndProblems(
    { name: year.name, closed: !!year.closedAt },
    year.periods.map((p) => ({ number: p.number, name: p.name, status: p.status as never, journals: p._count.journals })),
  );
  const balances = year.closedAt ? [] : await plBalances(db, ctx.orgId, year.startDate, year.endDate);
  const preview = closingLines(balances, "preview");
  const equity = await db.glAccount.findMany({ where: { organizationId: ctx.orgId, type: "EQUITY", active: true, postable: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
  const closing = year.closingJournalId ? await db.journalEntry.findUnique({ where: { id: year.closingJournalId }, select: { id: true, entryNumber: true, totalDebit: true } }) : null;
  return {
    year,
    problems,
    canClose: problems.length === 0 && preview.lines.length > 0,
    nothingToClose: !year.closedAt && preview.lines.length === 0,
    profit: preview.profit,
    closingLines: preview.lines.length - (preview.lines.length ? 1 : 0),
    equity,
    suggestedAccountId: equity.find((a) => a.code === "3101")?.id ?? equity[0]?.id ?? null,
    closing,
  };
}

/** Posts the closing entries for a year. */
export async function closeFiscalYear(ctx: Ctx, yearId: string, retainedEarningsAccountId: string) {
  assertCan(ctx, "period.approve");
  const year = await loadYear(ctx, yearId);
  const problems = yearEndProblems(
    { name: year.name, closed: !!year.closedAt },
    year.periods.map((p) => ({ number: p.number, name: p.name, status: p.status as never, journals: p._count.journals })),
  );
  if (problems.length) throw new BusinessError(problems.slice(0, 2).join(" "));
  const account = await db.glAccount.findFirst({ where: { id: retainedEarningsAccountId, organizationId: ctx.orgId } });
  if (!account || account.type !== "EQUITY") throw new BusinessError("Choose an equity account to move the profit or loss to (usually Retained Earnings).");
  if (!account.active || !account.postable) throw new BusinessError(`${account.code} ${account.name} can't be posted to.`);

  // the heavy reading first; the transaction then checks the ledger hasn't moved
  const balances = await plBalances(db, ctx.orgId, year.startDate, year.endDate);
  const { lines, profit } = closingLines(balances, account.id);
  if (!lines.length) throw new BusinessError(`${year.name} has no income or expense postings to close.`);
  const before = await plNet(db, ctx.orgId, year.startDate, year.endDate, YEAR_END_SOURCES);

  return db.$transaction(
    async (tx) => {
      if ((await plNet(tx, ctx.orgId, year.startDate, year.endDate, YEAR_END_SOURCES)) !== before) throw new BusinessError("The ledger changed while the year was being closed. Nothing has been closed; try again.");
      const fresh = await tx.fiscalYear.findUnique({ where: { id: year.id }, select: { closedAt: true } });
      if (fresh?.closedAt) throw new BusinessError(`${year.name} has already been closed.`);
      const journal = await postJournal(ctx, tx, {
        source: "YEAR_END_CLOSE",
        sourceType: "FISCAL_YEAR",
        sourceId: year.id,
        postingDate: year.endDate,
        description: `Year-end close ${year.name}`,
        lines: lines.map((l) => ({ accountId: l.accountId, description: l.description, debit: l.debit, credit: l.credit, dimensions: l.dimensions as never })),
        audit: { year: year.name, profit },
      });
      if (!journal) throw new BusinessError("Nothing to post.");
      await tx.fiscalYear.update({ where: { id: year.id }, data: { closedAt: new Date(), closedBy: ctx.name, closedByUserId: ctx.userId, closingJournalId: journal.id, retainedEarningsAccountId: account.id } });
      await logAudit(ctx, { action: "FISCAL_YEAR_CLOSE", entity: "FiscalYear", entityId: year.id, newValue: { year: year.name, journal: journal.entryNumber, profit, retainedEarnings: `${account.code} ${account.name}`, lines: lines.length } }, tx);
      return { journal, profit, lines: lines.length };
    },
    { timeout: 60_000 },
  );
}

/** Reverses the closing journal and reopens the year for income and expense postings. */
export async function reopenFiscalYear(ctx: Ctx, yearId: string, reason: string) {
  assertCan(ctx, "period.reopen");
  if (!reason || reason.trim().length < 15) throw new BusinessError("Say why the year is being reopened, in a sentence or two. It is recorded.");
  const year = await loadYear(ctx, yearId);
  if (!year.closedAt || !year.closingJournalId) throw new BusinessError(`${year.name} isn't closed.`);
  const last = year.periods[year.periods.length - 1];
  if (last.status === "CLOSED" || last.status === "LOCKED") throw new BusinessError(`${last.name}, the last period, is ${last.status === "LOCKED" ? "locked" : "closed"}. ${last.status === "LOCKED" ? "A locked period can't be reopened, so neither can the year." : "Reopen it first, with a reason, then reopen the year."}`);
  return db.$transaction(
    async (tx) => {
      const original = await tx.journalEntry.findUniqueOrThrow({ where: { id: year.closingJournalId! }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
      const reversal = await postJournal(ctx, tx, {
        source: "YEAR_END_REOPEN",
        sourceType: "FISCAL_YEAR",
        sourceId: year.id,
        postingDate: year.endDate,
        description: `Reversal of year-end close ${year.name} (year reopened)`,
        lines: mirrorLines(original.lines),
        reversalOfId: original.id,
        audit: { year: year.name },
      });
      await tx.fiscalYear.update({ where: { id: year.id }, data: { closedAt: null, closedBy: null, closedByUserId: null, closingJournalId: null } });
      await logAudit(ctx, { action: "FISCAL_YEAR_REOPEN", entity: "FiscalYear", entityId: year.id, newValue: { year: year.name, reversal: reversal?.entryNumber }, reason }, tx);
      return reversal;
    },
    { timeout: 60_000 },
  );
}

