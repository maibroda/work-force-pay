/**
 * Bank reconciliation for the organization's own operating account(s) — distinct from
 * payments.ts#reconcileBatch, which only matches payroll disbursements against a bank statement.
 * This reconciles everything else that moves through the account: client receipts in, vendor
 * payments out, plus bank-only items (charges, interest, transfers) that never touch AR/AP.
 *
 * Scoped to a single primary operating account for now: ClientReceipt/VendorPayment carry no
 * bankAccountId, so matching pulls from the org-wide, not-yet-matched pool. A receipt or payment
 * can only ever be claimed by one statement line, so multiple accounts can't double-match the
 * same record.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d, iso } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { postBankAccountOpening } from "./gl-posting";

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const MATCH_WINDOW_DAYS = 5;
const TOLERANCE = 0.01;

// ─────────────────────────────── Bank accounts ───────────────────────────────

export const bankAccountSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  bankName: z.string().trim().min(2, "Bank name is required"),
  accountNumber: z.string().trim().min(4, "Account number is required"),
  glAccountId: opt,
  openingBalance: z.coerce.number().default(0),
  openingDate: z.string().min(10, "Opening date is required"),
});

export async function createBankAccount(ctx: Ctx, raw: z.input<typeof bankAccountSchema>) {
  assertCan(ctx, "payment.manage");
  const v = bankAccountSchema.parse(raw);
  const exists = await db.bankAccount.findFirst({ where: { organizationId: ctx.orgId, name: v.name } });
  if (exists) throw new BusinessError("A bank account with this name already exists.");
  if (v.glAccountId) {
    const gl = await db.glAccount.findFirst({ where: { id: v.glAccountId, organizationId: ctx.orgId } });
    if (!gl) throw new BusinessError("GL account not found.");
  }
  return db.$transaction(async (tx) => {
    const acct = await tx.bankAccount.create({
      data: {
        organizationId: ctx.orgId,
        name: v.name,
        bankName: v.bankName,
        accountNumber: v.accountNumber,
        glAccountId: v.glAccountId ?? null,
        openingBalance: v.openingBalance,
        openingDate: d(v.openingDate),
        createdBy: ctx.name,
      },
    });
    await postBankAccountOpening(ctx, tx, acct);
    await logAudit(
      ctx,
      { action: "BANK_ACCOUNT_CREATE", entity: "BankAccount", entityId: acct.id, newValue: acct },
      tx,
    );
    return acct;
  });
}

export async function setBankAccountActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "payment.manage");
  const acct = await db.bankAccount.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!acct) throw new BusinessError("Bank account not found.");
  await db.bankAccount.update({ where: { id }, data: { active } });
  await logAudit(ctx, {
    action: active ? "BANK_ACCOUNT_ACTIVATE" : "BANK_ACCOUNT_DEACTIVATE",
    entity: "BankAccount",
    entityId: id,
  });
}

export async function listBankAccounts(ctx: Ctx) {
  return db.bankAccount.findMany({
    where: { organizationId: ctx.orgId },
    include: { glAccount: true, _count: { select: { statementLines: true } } },
    orderBy: { name: "asc" },
  });
}

// ─────────────────────────────── Statement import & matching ───────────────────────────────

/** Statement CSV: date,description,amount[,reference] — positive = money in, negative = money out. */
export async function importStatementLines(ctx: Ctx, bankAccountId: string, csv: string) {
  assertCan(ctx, "payment.manage");
  const acct = await db.bankAccount.findFirst({ where: { id: bankAccountId, organizationId: ctx.orgId } });
  if (!acct) throw new BusinessError("Bank account not found.");
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new BusinessError("Statement is empty.");
  const header = lines[0].toLowerCase().split(",");
  const di = header.indexOf("date");
  const desci = header.indexOf("description");
  const ai = header.indexOf("amount");
  const ri = header.indexOf("reference");
  if (di < 0 || desci < 0 || ai < 0)
    throw new BusinessError("Statement needs date, description and amount columns.");
  const rows: { organizationId: string; bankAccountId: string; date: Date; description: string; amount: number; reference: string | null }[] = [];
  lines.slice(1).forEach((line, i) => {
    const cols = line.split(",");
    const rawDate = cols[di]?.trim();
    const amt = Number(cols[ai]);
    if (!rawDate) throw new BusinessError(`Row ${i + 2}: missing date.`);
    if (!Number.isFinite(amt)) throw new BusinessError(`Row ${i + 2}: "${cols[ai]}" is not a valid amount.`);
    rows.push({
      organizationId: ctx.orgId,
      bankAccountId,
      date: d(rawDate),
      description: cols[desci]?.trim() || "(no description)",
      amount: round2(amt),
      reference: ri >= 0 ? cols[ri]?.trim() || null : null,
    });
  });
  await db.$transaction(rows.map((r) => db.bankStatementLine.create({ data: r })));
  await logAudit(ctx, {
    action: "BANK_STATEMENT_IMPORT",
    entity: "BankAccount",
    entityId: bankAccountId,
    newValue: { count: rows.length },
  });
  const match = await autoMatchStatementLines(ctx, bankAccountId);
  return { imported: rows.length, ...match };
}

/**
 * Auto-matches every unmatched line for a bank account against ClientReceipt/VendorPayment by
 * amount (±1 kobo) and date proximity (within MATCH_WINDOW_DAYS). Only matches when exactly one
 * candidate is found — an ambiguous amount is left for manual review rather than guessed.
 */
export async function autoMatchStatementLines(ctx: Ctx, bankAccountId: string) {
  assertCan(ctx, "payment.manage");
  const acct = await db.bankAccount.findFirst({ where: { id: bankAccountId, organizationId: ctx.orgId } });
  if (!acct) throw new BusinessError("Bank account not found.");
  const [pending, matchedElsewhere] = await Promise.all([
    db.bankStatementLine.findMany({ where: { organizationId: ctx.orgId, bankAccountId, matchType: null } }),
    db.bankStatementLine.findMany({
      where: { organizationId: ctx.orgId, matchType: { not: null } },
      select: { matchedClientReceiptId: true, matchedVendorPaymentId: true },
    }),
  ]);
  const takenReceipts = new Set(
    matchedElsewhere.map((l) => l.matchedClientReceiptId).filter((x): x is string => !!x),
  );
  const takenPayments = new Set(
    matchedElsewhere.map((l) => l.matchedVendorPaymentId).filter((x): x is string => !!x),
  );
  const DAY = 24 * 60 * 60 * 1000;
  let matched = 0;
  for (const line of pending) {
    const amt = num(line.amount);
    if (Math.abs(amt) < TOLERANCE) continue;
    if (amt > 0) {
      const candidates = await db.clientReceipt.findMany({
        where: {
          organizationId: ctx.orgId,
          id: { notIn: [...takenReceipts] },
          amount: { gte: amt - TOLERANCE, lte: amt + TOLERANCE },
        },
      });
      const close = candidates.filter(
        (c) => Math.abs(c.receivedDate.getTime() - line.date.getTime()) <= MATCH_WINDOW_DAYS * DAY,
      );
      if (close.length === 1) {
        await db.bankStatementLine.update({
          where: { id: line.id },
          data: {
            matchType: "CLIENT_RECEIPT",
            matchedClientReceiptId: close[0].id,
            matchedBy: "AUTO",
            matchedAt: new Date(),
          },
        });
        takenReceipts.add(close[0].id);
        matched++;
      }
    } else {
      const abs = Math.abs(amt);
      const candidates = await db.vendorPayment.findMany({
        where: {
          organizationId: ctx.orgId,
          id: { notIn: [...takenPayments] },
          amount: { gte: abs - TOLERANCE, lte: abs + TOLERANCE },
        },
      });
      const close = candidates.filter(
        (c) => Math.abs(c.paidDate.getTime() - line.date.getTime()) <= MATCH_WINDOW_DAYS * DAY,
      );
      if (close.length === 1) {
        await db.bankStatementLine.update({
          where: { id: line.id },
          data: {
            matchType: "VENDOR_PAYMENT",
            matchedVendorPaymentId: close[0].id,
            matchedBy: "AUTO",
            matchedAt: new Date(),
          },
        });
        takenPayments.add(close[0].id);
        matched++;
      }
    }
  }
  await logAudit(ctx, {
    action: "BANK_STATEMENT_AUTO_MATCH",
    entity: "BankAccount",
    entityId: bankAccountId,
    newValue: { matched, remaining: pending.length - matched },
  });
  return { matched, remaining: pending.length - matched };
}

export async function manualMatchStatementLine(
  ctx: Ctx,
  lineId: string,
  kind: "CLIENT_RECEIPT" | "VENDOR_PAYMENT",
  targetId: string,
) {
  assertCan(ctx, "payment.manage");
  const line = await db.bankStatementLine.findFirst({ where: { id: lineId, organizationId: ctx.orgId } });
  if (!line) throw new BusinessError("Statement line not found.");
  if (line.matchType) throw new BusinessError("This line is already matched — unmatch it first.");
  const alreadyUsed = await db.bankStatementLine.findFirst({
    where:
      kind === "CLIENT_RECEIPT"
        ? { organizationId: ctx.orgId, matchedClientReceiptId: targetId }
        : { organizationId: ctx.orgId, matchedVendorPaymentId: targetId },
  });
  if (alreadyUsed) throw new BusinessError("That record is already matched to another statement line.");
  if (kind === "CLIENT_RECEIPT") {
    const r = await db.clientReceipt.findFirst({ where: { id: targetId, organizationId: ctx.orgId } });
    if (!r) throw new BusinessError("Client receipt not found.");
    await db.bankStatementLine.update({
      where: { id: lineId },
      data: {
        matchType: "CLIENT_RECEIPT",
        matchedClientReceiptId: targetId,
        matchedBy: ctx.name,
        matchedAt: new Date(),
      },
    });
  } else {
    const p = await db.vendorPayment.findFirst({ where: { id: targetId, organizationId: ctx.orgId } });
    if (!p) throw new BusinessError("Vendor payment not found.");
    await db.bankStatementLine.update({
      where: { id: lineId },
      data: {
        matchType: "VENDOR_PAYMENT",
        matchedVendorPaymentId: targetId,
        matchedBy: ctx.name,
        matchedAt: new Date(),
      },
    });
  }
  await logAudit(ctx, {
    action: "BANK_LINE_MATCH",
    entity: "BankStatementLine",
    entityId: lineId,
    newValue: { kind, targetId },
  });
}

export async function markStatementLineManual(ctx: Ctx, lineId: string, note: string) {
  assertCan(ctx, "payment.manage");
  if (!note || note.trim().length < 5)
    throw new BusinessError("Give a note explaining this bank item (at least 5 characters).");
  const line = await db.bankStatementLine.findFirst({ where: { id: lineId, organizationId: ctx.orgId } });
  if (!line) throw new BusinessError("Statement line not found.");
  if (line.matchType) throw new BusinessError("This line is already matched — unmatch it first.");
  await db.bankStatementLine.update({
    where: { id: lineId },
    data: { matchType: "MANUAL", matchNote: note.trim(), matchedBy: ctx.name, matchedAt: new Date() },
  });
  await logAudit(ctx, {
    action: "BANK_LINE_MARK_MANUAL",
    entity: "BankStatementLine",
    entityId: lineId,
    reason: note.trim(),
  });
}

export async function unmatchStatementLine(ctx: Ctx, lineId: string) {
  assertCan(ctx, "payment.manage");
  const line = await db.bankStatementLine.findFirst({ where: { id: lineId, organizationId: ctx.orgId } });
  if (!line) throw new BusinessError("Statement line not found.");
  if (!line.matchType) throw new BusinessError("This line is not matched.");
  await db.bankStatementLine.update({
    where: { id: lineId },
    data: {
      matchType: null,
      matchedClientReceiptId: null,
      matchedVendorPaymentId: null,
      matchNote: null,
      matchedBy: null,
      matchedAt: null,
    },
  });
  await logAudit(ctx, { action: "BANK_LINE_UNMATCH", entity: "BankStatementLine", entityId: lineId });
}

export async function listStatementLines(ctx: Ctx, bankAccountId: string) {
  return db.bankStatementLine.findMany({
    where: { organizationId: ctx.orgId, bankAccountId },
    include: {
      matchedClientReceipt: { include: { client: true } },
      matchedVendorPayment: { include: { vendor: true } },
    },
    orderBy: { date: "desc" },
  });
}

/**
 * Textbook bank-reconciliation-statement view: balance per bank statement, adjusted for items
 * recorded in the books but not yet cleared (deposits/payments in transit), should equal balance
 * per books, adjusted for items on the bank statement not yet recorded (bank-only charges/interest).
 */
export async function reconciliationSummary(ctx: Ctx, bankAccountId: string, asOf?: string) {
  assertCan(ctx, "gl.view");
  const acct = await db.bankAccount.findFirst({ where: { id: bankAccountId, organizationId: ctx.orgId } });
  if (!acct) throw new BusinessError("Bank account not found.");
  const cutoff = d(asOf && asOf.length >= 10 ? asOf : iso(new Date()));
  const lines = await db.bankStatementLine.findMany({
    where: { organizationId: ctx.orgId, bankAccountId, date: { lte: cutoff } },
    include: {
      matchedClientReceipt: { include: { client: true } },
      matchedVendorPayment: { include: { vendor: true } },
    },
    orderBy: { date: "asc" },
  });
  const statementBalance = round2(num(acct.openingBalance) + lines.reduce((a, l) => a + num(l.amount), 0));
  const matchedReceiptIds = new Set(
    lines.map((l) => l.matchedClientReceiptId).filter((x): x is string => !!x),
  );
  const matchedPaymentIds = new Set(
    lines.map((l) => l.matchedVendorPaymentId).filter((x): x is string => !!x),
  );
  const manualLines = lines.filter((l) => l.matchType === "MANUAL");
  const unmatchedLines = lines.filter((l) => !l.matchType);

  const [allReceipts, allPayments] = await Promise.all([
    db.clientReceipt.findMany({
      where: { organizationId: ctx.orgId, receivedDate: { lte: cutoff } },
      include: { client: true },
      orderBy: { receivedDate: "asc" },
    }),
    db.vendorPayment.findMany({
      where: { organizationId: ctx.orgId, paidDate: { lte: cutoff } },
      include: { vendor: true },
      orderBy: { paidDate: "asc" },
    }),
  ]);
  const bookBalance = round2(
    num(acct.openingBalance) +
      allReceipts.reduce((a, r) => a + num(r.amount), 0) -
      allPayments.reduce((a, p) => a + num(p.amount), 0),
  );
  const outstandingReceipts = allReceipts.filter((r) => !matchedReceiptIds.has(r.id));
  const outstandingPayments = allPayments.filter((p) => !matchedPaymentIds.has(p.id));

  const adjustedBankBalance = round2(
    statementBalance +
      outstandingReceipts.reduce((a, r) => a + num(r.amount), 0) -
      outstandingPayments.reduce((a, p) => a + num(p.amount), 0),
  );
  const adjustedBookBalance = round2(bookBalance + manualLines.reduce((a, l) => a + num(l.amount), 0));
  const difference = round2(adjustedBankBalance - adjustedBookBalance);

  return {
    bankAccount: acct,
    asOf: iso(cutoff),
    statementBalance,
    bookBalance,
    adjustedBankBalance,
    adjustedBookBalance,
    difference,
    fullyReconciled: unmatchedLines.length === 0 && Math.abs(difference) < TOLERANCE,
    lines,
    manualLines,
    unmatchedLines,
    outstandingReceipts,
    outstandingPayments,
  };
}
