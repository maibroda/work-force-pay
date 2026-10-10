/**
 * Client receipts, allocation and statements.
 *
 * A client receipt is cash in (and perhaps tax the client withheld on paying) that can settle several invoices at once. It is
 * recorded once, with the allocation to invoices, in one transaction and one journal:
 *
 *   Dr Cash                    cash received
 *   Dr Withholding tax receivable   tax withheld
 *     Cr Receivables           cash and tax applied to invoices
 *     Cr Client advances       whatever is not applied
 *
 * Whatever is held as an advance can later be applied to invoices (Dr Client advances, Cr Receivables), taken back if it was
 * applied to the wrong invoice (the reverse, with a reason), or refunded to the client (Dr Client advances, Cr Cash), which one
 * person asks for and another approves. An allocation is never edited or deleted; the database refuses.
 *
 * The receipts recorded before this existed settle exactly one invoice and have no allocations; they are untouched.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { allocationProblems, invoiceStatus, receiptPosition, type AllocationInput } from "@/lib/receipts";
import { amountDue, effectiveTotal } from "@/lib/notes";
import { buildStatement, type Statement, type StatementInvoice, type StatementSettlement } from "@/lib/statements";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { postAdvanceMovement, postClientReceipt, postClientRefund } from "./gl-posting";
import { nextNumber } from "./numbering";

const today = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const iso = (x: Date) => x.toISOString().slice(0, 10);

const allocationSchema = z.object({
  invoiceId: z.string().min(1),
  cash: z.coerce.number().min(0).default(0),
  wht: z.coerce.number().min(0).default(0),
});

export const clientReceiptSchema = z.object({
  clientId: z.string().min(1, "Choose the client"),
  amount: z.coerce.number().positive("The amount received must be greater than zero"),
  receivedDate: z.string().min(10, "Choose the date it was received"),
  method: z.string().trim().max(60).optional(),
  reference: z.string().trim().max(120).optional(),
  whtWithheld: z.coerce.number().min(0).default(0),
  whtReference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
  allocations: z.array(allocationSchema).max(200).default([]),
});
export type ClientReceiptInput = z.input<typeof clientReceiptSchema>;

// ───────────────────────────── Invoices a receipt can settle ─────────────────────────────

type Money = { totalAmount: unknown; totalDebits: unknown; totalCredits: unknown; amountPaid: unknown; totalDeductions: unknown };
const figures = (inv: Money) => ({ totalAmount: num(inv.totalAmount), totalDebits: num(inv.totalDebits), totalCredits: num(inv.totalCredits), amountPaid: num(inv.amountPaid), totalDeductions: num(inv.totalDeductions) });
const balanceOf = (inv: Money) => round2(amountDue(figures(inv)));

/** A client's invoices that still owe something, oldest due first. */
export async function openInvoicesFor(ctx: Ctx, clientId: string, tx: Tx = db) {
  const rows = await tx.clientInvoice.findMany({
    where: { organizationId: ctx.orgId, clientId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
    orderBy: [{ dueDate: "asc" }, { invoiceNumber: "asc" }],
  });
  return rows.map((r) => ({ id: r.id, invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate, dueDate: r.dueDate, total: num(r.totalAmount), balance: balanceOf(r) })).filter((r) => r.balance > 0);
}

/**
 * Moves an invoice's settled amounts by a change in cash and tax withheld, and its status with them. Written as a guarded
 * update so two receipts landing on the same invoice at once can't both fit into a balance that only holds one.
 */
async function applyToInvoice(tx: Tx, orgId: string, invoiceId: string, cash: number, wht: number) {
  const inv = await tx.clientInvoice.findFirst({ where: { id: invoiceId, organizationId: orgId } });
  if (!inv) throw new BusinessError("Invoice not found.");
  if (inv.status === "CANCELLED") throw new BusinessError(`${inv.invoiceNumber} was cancelled.`);
  const amountPaid = round2(num(inv.amountPaid) + cash);
  const totalDeductions = round2(num(inv.totalDeductions) + wht);
  if (amountPaid < 0 || totalDeductions < 0) throw new BusinessError(`${inv.invoiceNumber} would be left with a negative settlement.`);
  const due = effectiveTotal(figures(inv)); // the invoice's total once its credit and debit notes are counted
  if (round2(amountPaid + totalDeductions) > due + 0.005) throw new BusinessError(`${inv.invoiceNumber}: that is more than is owed on it.`);
  const moved = await tx.clientInvoice.updateMany({
    where: { id: invoiceId, amountPaid: inv.amountPaid, totalDeductions: inv.totalDeductions, totalCredits: inv.totalCredits, totalDebits: inv.totalDebits },
    data: { amountPaid, totalDeductions, status: invoiceStatus(due, amountPaid, totalDeductions) },
  });
  if (!moved.count) throw new BusinessError(`${inv.invoiceNumber} changed while this was being saved. Try again.`);
  return inv;
}

/** What a receipt still has to give. Pending refunds count as spent, so the same cash can't be promised twice. */
async function positionOf(tx: Tx, receipt: { id: string; amount: unknown; whtWithheld: unknown }) {
  const [allocations, refunds] = await Promise.all([
    tx.receiptAllocation.findMany({ where: { receiptId: receipt.id, reversedAt: null } }),
    tx.clientRefund.findMany({ where: { receiptId: receipt.id, status: { in: ["PENDING", "APPROVED"] } } }),
  ]);
  return receiptPosition(
    { amount: num(receipt.amount), whtWithheld: num(receipt.whtWithheld) },
    allocations.map((a) => ({ cash: num(a.cashAmount), wht: num(a.whtAmount) })),
    refunds.reduce((s, r) => s + num(r.amount), 0),
  );
}

const toAllocations = (raw: AllocationInput[]) => raw.map((a) => ({ invoiceId: a.invoiceId, cash: round2(a.cash), wht: round2(a.wht) })).filter((a) => a.cash !== 0 || a.wht !== 0);

// ───────────────────────────── Recording a receipt ─────────────────────────────

export async function recordClientReceipt(ctx: Ctx, raw: ClientReceiptInput) {
  assertCan(ctx, "payment.manage");
  const v = clientReceiptSchema.parse(raw);
  const received = d(v.receivedDate);
  if (Number.isNaN(received.getTime())) throw new BusinessError("The date received isn't a valid date.");
  if (received > today()) throw new BusinessError("A receipt can't be dated in the future.");
  const wht = round2(v.whtWithheld);
  if (wht > 0 && (v.whtReference ?? "").trim().length < 2) throw new BusinessError("Give the withholding tax credit note or certificate number, so the tax withheld is evidenced.");
  const allocations = toAllocations(v.allocations);

  return db.$transaction(async (tx) => {
    const client = await tx.client.findFirst({ where: { id: v.clientId, organizationId: ctx.orgId }, select: { id: true, name: true } });
    if (!client) throw new BusinessError("Client not found.");
    if (v.reference?.trim() && (await tx.clientReceipt.count({ where: { organizationId: ctx.orgId, clientId: client.id, reference: v.reference.trim(), amount: round2(v.amount) } })))
      throw new BusinessError(`A receipt of this amount with reference ${v.reference.trim()} is already recorded for ${client.name}.`);
    const open = new Map((await openInvoicesFor(ctx, client.id, tx)).map((i) => [i.id, i]));
    const problems = allocationProblems(allocations, open, { cash: round2(v.amount), wht }, true);
    if (problems.length) throw new BusinessError(problems.slice(0, 3).join(" "));

    const receipt = await tx.clientReceipt.create({
      data: {
        organizationId: ctx.orgId,
        clientId: client.id,
        receiptNumber: await nextNumber(tx, ctx.orgId, "CLIENT_RECEIPT"),
        amount: round2(v.amount),
        whtWithheld: wht,
        whtReference: v.whtReference?.trim() || null,
        receivedDate: received,
        method: v.method || null,
        reference: v.reference?.trim() || null,
        notes: v.notes || null,
        recordedBy: ctx.name,
      },
    });
    let gross = 0;
    for (const a of allocations) {
      await applyToInvoice(tx, ctx.orgId, a.invoiceId, a.cash, a.wht);
      await tx.receiptAllocation.create({ data: { organizationId: ctx.orgId, receiptId: receipt.id, invoiceId: a.invoiceId, cashAmount: a.cash, whtAmount: a.wht, appliedOn: received, createdBy: ctx.name } });
      gross = round2(gross + a.cash + a.wht);
    }
    await postClientReceipt(ctx, tx, { ...receipt, receiptNumber: receipt.receiptNumber! }, gross);
    await logAudit(ctx, { action: "CLIENT_RECEIPT_RECORD", entity: "ClientReceipt", entityId: receipt.id, newValue: { receiptNumber: receipt.receiptNumber, amount: round2(v.amount), whtWithheld: wht, applied: gross, held: round2(v.amount + wht - gross), invoices: allocations.length } }, tx);
    return receipt;
  });
}

// ───────────────────────────── Applying, reversing, refunding ─────────────────────────────

/** Applies some of the cash (and tax) a receipt is holding to invoices. */
export async function applyAdvance(ctx: Ctx, receiptId: string, rawAllocations: AllocationInput[], appliedOn?: string) {
  assertCan(ctx, "payment.manage");
  const allocations = toAllocations(rawAllocations.map((a) => allocationSchema.parse(a)));
  if (!allocations.length) throw new BusinessError("Choose the invoices to apply it to.");
  return db.$transaction(async (tx) => {
    const receipt = await tx.clientReceipt.findFirst({ where: { id: receiptId, organizationId: ctx.orgId } });
    if (!receipt || receipt.invoiceId) throw new BusinessError("Receipt not found.");
    const on = appliedOn ? d(appliedOn) : today();
    if (Number.isNaN(on.getTime()) || on < receipt.receivedDate) throw new BusinessError("It can't be applied before the receipt date.");
    if (on > today()) throw new BusinessError("It can't be applied on a future date.");
    const position = await positionOf(tx, receipt);
    const open = new Map((await openInvoicesFor(ctx, receipt.clientId!, tx)).map((i) => [i.id, i]));
    const problems = allocationProblems(allocations, open, { cash: position.cashLeft, wht: position.whtLeft }, false);
    if (problems.length) throw new BusinessError(problems.slice(0, 3).join(" "));
    for (const a of allocations) {
      const inv = await applyToInvoice(tx, ctx.orgId, a.invoiceId, a.cash, a.wht);
      const row = await tx.receiptAllocation.create({ data: { organizationId: ctx.orgId, receiptId, invoiceId: a.invoiceId, cashAmount: a.cash, whtAmount: a.wht, appliedOn: on, createdBy: ctx.name } });
      await postAdvanceMovement(ctx, tx, { source: "AR_ALLOCATION", sourceType: "RECEIPT_ALLOCATION", sourceId: row.id, clientId: receipt.clientId!, amount: round2(a.cash + a.wht), on, description: `${receipt.receiptNumber} applied to ${inv.invoiceNumber}` });
    }
    await logAudit(ctx, { action: "CLIENT_RECEIPT_APPLY", entity: "ClientReceipt", entityId: receiptId, newValue: { receiptNumber: receipt.receiptNumber, allocations: allocations.length, amount: round2(allocations.reduce((s, a) => s + a.cash + a.wht, 0)) } }, tx);
  });
}

/** Takes an allocation back (it was applied to the wrong invoice): the invoice owes it again and the receipt holds it. */
export async function reverseAllocation(ctx: Ctx, allocationId: string, reason: string) {
  assertCan(ctx, "payment.manage");
  if (!reason || reason.trim().length < 10) throw new BusinessError("Say why it is being taken back (at least 10 characters).");
  return db.$transaction(async (tx) => {
    const a = await tx.receiptAllocation.findFirst({ where: { id: allocationId, organizationId: ctx.orgId }, include: { receipt: true, invoice: { select: { invoiceNumber: true } } } });
    if (!a) throw new BusinessError("Allocation not found.");
    if (a.reversedAt) throw new BusinessError("This allocation has already been reversed.");
    const cash = num(a.cashAmount);
    const wht = num(a.whtAmount);
    await applyToInvoice(tx, ctx.orgId, a.invoiceId, -cash, -wht);
    const on = today();
    await tx.receiptAllocation.update({ where: { id: a.id }, data: { reversedAt: new Date(), reversedOn: on, reversedBy: ctx.name, reversalReason: reason.trim() } });
    await postAdvanceMovement(ctx, tx, { source: "AR_ALLOCATION_REVERSAL", sourceType: "RECEIPT_ALLOCATION", sourceId: a.id, clientId: a.receipt.clientId!, amount: round2(cash + wht), on, description: `${a.receipt.receiptNumber} taken back from ${a.invoice.invoiceNumber}` });
    await logAudit(ctx, { action: "CLIENT_RECEIPT_UNAPPLY", entity: "ReceiptAllocation", entityId: a.id, newValue: { receiptNumber: a.receipt.receiptNumber, invoice: a.invoice.invoiceNumber, cash, wht }, reason }, tx);
  });
}

export const refundSchema = z.object({
  amount: z.coerce.number().positive("The refund must be greater than zero"),
  refundDate: z.string().min(10, "Choose the refund date"),
  method: z.string().trim().max(60).optional(),
  reference: z.string().trim().max(120).optional(),
  reason: z.string().trim().default(""),
});
export type RefundInput = z.input<typeof refundSchema>;

export async function requestRefund(ctx: Ctx, receiptId: string, raw: RefundInput) {
  assertCan(ctx, "payment.manage");
  const v = refundSchema.parse(raw);
  if (v.reason.length < 10) throw new BusinessError("Say why the money is being returned (at least 10 characters).");
  const date = d(v.refundDate);
  return db.$transaction(async (tx) => {
    const receipt = await tx.clientReceipt.findFirst({ where: { id: receiptId, organizationId: ctx.orgId } });
    if (!receipt || receipt.invoiceId) throw new BusinessError("Receipt not found.");
    if (Number.isNaN(date.getTime()) || date < receipt.receivedDate) throw new BusinessError("A refund can't be dated before the receipt.");
    const position = await positionOf(tx, receipt);
    if (round2(v.amount) > position.cashLeft + 0.005) throw new BusinessError(`Only ${position.cashLeft.toFixed(2)} of this receipt is held as cash that can be returned.`);
    const refund = await tx.clientRefund.create({
      data: { organizationId: ctx.orgId, refundNumber: await nextNumber(tx, ctx.orgId, "CLIENT_REFUND"), receiptId, clientId: receipt.clientId!, amount: round2(v.amount), refundDate: date, method: v.method || null, reference: v.reference || null, reason: v.reason, requestedBy: ctx.name, requestedByUserId: ctx.userId },
    });
    await logAudit(ctx, { action: "CLIENT_REFUND_REQUEST", entity: "ClientRefund", entityId: refund.id, newValue: { refundNumber: refund.refundNumber, amount: round2(v.amount), receipt: receipt.receiptNumber }, reason: v.reason }, tx);
    return refund;
  });
}

export async function decideRefund(ctx: Ctx, refundId: string, approve: boolean, note?: string) {
  assertCan(ctx, "receipt.approve");
  if (!approve && (!note || note.trim().length < 5)) throw new BusinessError("Say why the refund is being turned down.");
  return db.$transaction(async (tx) => {
    const refund = await tx.clientRefund.findFirst({ where: { id: refundId, organizationId: ctx.orgId }, include: { receipt: true } });
    if (!refund) throw new BusinessError("Refund not found.");
    if (refund.status !== "PENDING") throw new BusinessError("This refund has already been decided.");
    if (refund.requestedByUserId === ctx.userId) throw new BusinessError("You asked for this refund, so someone else has to approve it.");
    const now = new Date();
    if (!approve) {
      const u = await tx.clientRefund.update({ where: { id: refundId }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: now, decisionNote: note!.trim() } });
      await logAudit(ctx, { action: "CLIENT_REFUND_REJECT", entity: "ClientRefund", entityId: refundId, reason: note }, tx);
      return u;
    }
    await postClientRefund(ctx, tx, refund);
    const u = await tx.clientRefund.update({ where: { id: refundId }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: now, decisionNote: note?.trim() || null } });
    await logAudit(ctx, { action: "CLIENT_REFUND_APPROVE", entity: "ClientRefund", entityId: refundId, newValue: { refundNumber: refund.refundNumber, amount: num(refund.amount) } }, tx);
    return u;
  });
}

// ───────────────────────────── Reading ─────────────────────────────

export async function listClientReceipts(ctx: Ctx, filter: { clientId?: string } = {}) {
  assertCan(ctx, "gl.view");
  const rows = await db.clientReceipt.findMany({
    where: { organizationId: ctx.orgId, invoiceId: null, ...(filter.clientId ? { clientId: filter.clientId } : {}) },
    include: { client: { select: { id: true, name: true } }, allocations: { where: { reversedAt: null } }, refunds: { where: { status: { in: ["PENDING", "APPROVED"] } } } },
    orderBy: [{ receivedDate: "desc" }, { receiptNumber: "desc" }],
    take: 300,
  });
  return rows.map((r) => ({
    ...r,
    position: receiptPosition({ amount: num(r.amount), whtWithheld: num(r.whtWithheld) }, r.allocations.map((a) => ({ cash: num(a.cashAmount), wht: num(a.whtAmount) })), r.refunds.reduce((s, x) => s + num(x.amount), 0)),
  }));
}

export async function getClientReceipt(ctx: Ctx, id: string) {
  assertCan(ctx, "gl.view");
  const r = await db.clientReceipt.findFirst({
    where: { id, organizationId: ctx.orgId, invoiceId: null },
    include: {
      client: { select: { id: true, name: true } },
      allocations: { orderBy: { createdAt: "asc" }, include: { invoice: { select: { id: true, invoiceNumber: true } } } },
      refunds: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!r) return null;
  const position = await positionOf(db, r);
  return { ...r, position, open: position.held > 0 ? await openInvoicesFor(ctx, r.clientId) : [] };
}

/** Refunds waiting for approval, across the organization. */
export async function pendingRefunds(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  return db.clientRefund.findMany({ where: { organizationId: ctx.orgId, status: "PENDING" }, include: { client: { select: { name: true } }, receipt: { select: { id: true, receiptNumber: true } } }, orderBy: { createdAt: "asc" } });
}

// ───────────────────────────── Statements and ageing ─────────────────────────────

export interface ClientStatement extends Statement {
  client: { id: string; name: string };
  asOf: Date;
  /** The client's balance in the receivables control account at the same date, from the ledger. */
  ledger: number;
}

/** A client's statement as at a date, with its balance tied to the receivables control account. */
export async function clientStatement(ctx: Ctx, clientId: string, asOfRaw?: string): Promise<ClientStatement> {
  assertCan(ctx, "gl.view");
  const asOf = asOfRaw ? d(asOfRaw) : today();
  if (Number.isNaN(asOf.getTime())) throw new BusinessError("The statement date isn't a valid date.");
  const client = await db.client.findFirst({ where: { id: clientId, organizationId: ctx.orgId }, select: { id: true, name: true } });
  if (!client) throw new BusinessError("Client not found.");

  const [invoices, legacy, deductions, allocations, newReceipts, refunds, ledgerLines, notes] = await Promise.all([
    db.clientInvoice.findMany({ where: { organizationId: ctx.orgId, clientId, status: { notIn: ["CANCELLED", "DRAFT", "SUBMITTED"] } } }),
    db.clientReceipt.findMany({ where: { organizationId: ctx.orgId, clientId, invoiceId: { not: null } } }),
    db.clientInvoiceDeduction.findMany({ where: { organizationId: ctx.orgId, clientId } }),
    db.receiptAllocation.findMany({ where: { organizationId: ctx.orgId, invoice: { clientId } }, include: { receipt: { select: { receiptNumber: true } } } }),
    db.clientReceipt.findMany({ where: { organizationId: ctx.orgId, clientId, invoiceId: null, receivedDate: { lte: asOf } } }),
    db.clientRefund.findMany({ where: { organizationId: ctx.orgId, clientId, status: "APPROVED", refundDate: { lte: asOf } } }),
    db.journalLine.aggregate({ where: { journal: { organizationId: ctx.orgId, postingDate: { lte: asOf } }, account: { organizationId: ctx.orgId, code: "1200" }, clientId }, _sum: { debit: true, credit: true } }),
    db.clientNote.findMany({ where: { organizationId: ctx.orgId, clientId, status: "APPROVED", noteDate: { lte: asOf } } }),
  ]);

  const stInvoices: StatementInvoice[] = invoices.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate, dueDate: i.dueDate, total: num(i.totalAmount) }));
  const settlements: StatementSettlement[] = [
    ...legacy.map((r) => ({ id: r.id, invoiceId: r.invoiceId!, date: r.receivedDate, kind: "RECEIPT" as const, reference: r.reference ?? "Receipt", amount: num(r.amount) })),
    ...notes.filter((n) => n.type === "CREDIT").map((n) => ({ id: n.id, invoiceId: n.invoiceId, date: n.noteDate, kind: "CREDIT_NOTE" as const, reference: n.noteNumber, amount: num(n.totalAmount) })),
    ...deductions.map((x) => ({ id: x.id, invoiceId: x.invoiceId, date: d(iso(x.createdAt)), kind: (x.type === "WITHHOLDING_TAX" ? "TAX_WITHHELD" : "DEDUCTION") as "TAX_WITHHELD" | "DEDUCTION", reference: x.supportingDocument, amount: num(x.amount) })),
    ...allocations.flatMap((a) => [
      ...(num(a.cashAmount) > 0 ? [{ id: `${a.id}:c`, invoiceId: a.invoiceId, date: a.appliedOn, reversedOn: a.reversedOn, kind: "RECEIPT" as const, reference: a.receipt.receiptNumber ?? "Receipt", amount: num(a.cashAmount) }] : []),
      ...(num(a.whtAmount) > 0 ? [{ id: `${a.id}:w`, invoiceId: a.invoiceId, date: a.appliedOn, reversedOn: a.reversedOn, kind: "TAX_WITHHELD" as const, reference: a.receipt.receiptNumber ?? "Receipt", amount: num(a.whtAmount) }] : []),
    ]),
  ];
  // advances held at the date: what new-style receipts brought in, less what was applied by then, less refunds paid
  const applied = (a: (typeof allocations)[number]) => a.appliedOn <= asOf && (!a.reversedOn || a.reversedOn > asOf);
  const brought = newReceipts.reduce((s, r) => s + num(r.amount) + num(r.whtWithheld), 0);
  const advances = round2(brought - allocations.filter(applied).reduce((s, a) => s + num(a.cashAmount) + num(a.whtAmount), 0) - refunds.reduce((s, r) => s + num(r.amount), 0));
  const charges = notes.filter((n) => n.type === "DEBIT").map((n) => ({ id: n.id, invoiceId: n.invoiceId, date: n.noteDate, reference: n.noteNumber, amount: num(n.totalAmount) }));
  const statement = buildStatement(stInvoices, settlements, advances, asOf, charges);
  return { ...statement, client, asOf, ledger: round2(num(ledgerLines._sum.debit) - num(ledgerLines._sum.credit)) };
}

/** Every client with a balance or an advance, with ageing buckets, as at a date. */
export async function receivablesAgeing(ctx: Ctx, asOfRaw?: string) {
  assertCan(ctx, "gl.view");
  const clients = await db.client.findMany({ where: { organizationId: ctx.orgId, invoices: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const rows = [];
  for (const c of clients) {
    const s = await clientStatement(ctx, c.id, asOfRaw);
    if (s.closing !== 0 || s.advances !== 0) rows.push({ clientId: c.id, name: c.name, closing: s.closing, advances: s.advances, ageing: s.ageing, ledger: s.ledger });
  }
  return rows;
}
