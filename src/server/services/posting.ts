/**
 * The posting engine: the one place a journal is written.
 *
 * Every financial effect in the system — payroll, invoices, receipts, bills, depreciation, loans, bank openings —
 * reaches the ledger through `postJournal`, so the same rules apply to all of them and a module can't forget one.
 * It refuses a journal that:
 *   - has fewer than two lines, a negative amount, or a line that is both debit and credit;
 *   - does not balance (debits must equal credits);
 *   - posts to an account that doesn't exist, belongs to another organization, is inactive, is a header that only
 *     groups other accounts, or is used outside the dates it is effective for;
 *   - carries a dimension (client, contract, cost centre …) that doesn't exist in this organization, is an inactive
 *     region / branch / profit centre / project, or is a contract that doesn't belong to the line's client;
 *   - leaves out a dimension that the account requires;
 *   - falls in an accounting period that is closed or locked (or soft closed, for anyone without the close permission).
 * and otherwise writes the journal with its period, its source document and its audit entry, in the caller's
 * transaction, so a business record and its journal commit or fail together.
 *
 * A posted journal is never edited or deleted, which the database also enforces; a correction is a new journal.
 */
import { round2 } from "@/lib/money";
import { cleanDimensions, DIMENSIONS, dimensionByColumn, missingRequired, type DimensionColumn, type LineDimensions } from "@/lib/dimensions";
import { iso } from "@/lib/dates";
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
  /** Who and what the line is for. Checked, then stored with the line; never changed afterwards. */
  dimensions?: LineDimensions;
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
    if (!a.postable) throw new BusinessError(`GL account ${a.code} ${a.name} is a header that groups other accounts; post to one of its sub-accounts.`);
    if (a.effectiveFrom && input.postingDate < a.effectiveFrom) throw new BusinessError(`GL account ${a.code} ${a.name} isn't effective until ${iso(a.effectiveFrom)}.`);
    if (a.effectiveTo && input.postingDate > a.effectiveTo) throw new BusinessError(`GL account ${a.code} ${a.name} stopped being effective on ${iso(a.effectiveTo)}.`);
    return { l, a };
  });

  await checkDimensions(ctx, tx, input.description, resolved);

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
          ...cleanDimensions(l.dimensions),
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


// ───────────────────────────── Dimensions ─────────────────────────────

interface ResolvedLine {
  l: PostingLine;
  a: { code: string; name: string; requiredDimensions: string[] };
}

/** The organization-scoped lookup for each dimension: which ids exist, and (for the new masters) whether they are active. */
async function lookup(tx: Tx, orgId: string, column: DimensionColumn, ids: string[]): Promise<Array<{ id: string; active: boolean; clientId?: string | null }>> {
  const where = { organizationId: orgId, id: { in: ids } };
  switch (column) {
    case "clientId":
      return (await tx.client.findMany({ where, select: { id: true } })).map((r) => ({ ...r, active: true }));
    case "contractId":
      return (await tx.contract.findMany({ where, select: { id: true, clientId: true } })).map((r) => ({ ...r, active: true }));
    case "beatId":
      return (await tx.beat.findMany({ where, select: { id: true } })).map((r) => ({ ...r, active: true }));
    case "costCenterId":
      return (await tx.costCenter.findMany({ where, select: { id: true } })).map((r) => ({ ...r, active: true }));
    case "departmentId":
      return (await tx.department.findMany({ where, select: { id: true } })).map((r) => ({ ...r, active: true }));
    case "employeeId":
      return (await tx.employee.findMany({ where, select: { id: true } })).map((r) => ({ ...r, active: true }));
    case "fixedAssetId":
      return (await tx.fixedAsset.findMany({ where, select: { id: true } })).map((r) => ({ ...r, active: true }));
    case "regionId":
      return tx.region.findMany({ where, select: { id: true, active: true } });
    case "branchId":
      return tx.branch.findMany({ where, select: { id: true, active: true } });
    case "profitCentreId":
      return tx.profitCentre.findMany({ where, select: { id: true, active: true } });
    case "projectId":
      return tx.project.findMany({ where, select: { id: true, active: true } });
  }
}

/** Refuses a dimension that isn't this organization's, an inactive new-master dimension, a contract that isn't the client's, or a missing required one. */
async function checkDimensions(ctx: Ctx, tx: Tx, description: string, resolved: ResolvedLine[]) {
  const wanted = new Map<DimensionColumn, Set<string>>();
  for (const { l } of resolved)
    for (const [col, id] of Object.entries(cleanDimensions(l.dimensions)) as Array<[DimensionColumn, string]>) wanted.set(col, (wanted.get(col) ?? new Set()).add(id));

  const found = new Map<DimensionColumn, Map<string, { active: boolean; clientId?: string | null }>>();
  for (const [col, ids] of wanted) {
    const rows = await lookup(tx, ctx.orgId, col, [...ids]);
    found.set(col, new Map(rows.map((r) => [r.id, r])));
    const label = dimensionByColumn(col)!.label.toLowerCase();
    for (const id of ids) {
      const row = found.get(col)!.get(id);
      if (!row) throw new BusinessError(`A line of "${description}" names a ${label} that doesn't exist in this organization.`);
      if (!row.active) throw new BusinessError(`A line of "${description}" names a ${label} that is inactive.`);
    }
  }

  for (const { l, a } of resolved) {
    const dims = cleanDimensions(l.dimensions);
    if (dims.contractId && dims.clientId) {
      const contract = found.get("contractId")!.get(dims.contractId)!;
      if (contract.clientId !== dims.clientId) throw new BusinessError(`A line of "${description}" names a contract that doesn't belong to its client.`);
    }
    const missing = missingRequired(a.requiredDimensions, dims);
    if (missing.length)
      throw new BusinessError(`${a.code} ${a.name} needs a ${missing.map((k) => DIMENSIONS.find((d) => d.key === k)!.label.toLowerCase()).join(" and a ")} on every posting (a line of "${description}" has none).`);
  }
}

/**
 * The lines that undo a journal: each one with debit and credit swapped, carrying the same dimensions, so the reversal
 * lands in the same client, contract, cost centre and so on as the original and cancels it exactly.
 */
export function mirrorLines(
  lines: Array<{ accountId: string; headCode: string; description: string; debit: unknown; credit: unknown } & LineDimensions>,
): PostingLine[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    headCode: l.headCode,
    description: l.description,
    debit: Number(l.credit),
    credit: Number(l.debit),
    dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d.column, (l as LineDimensions)[d.column] ?? null])) as LineDimensions,
  }));
}
