/**
 * Credit and debit notes against client invoices.
 *
 * A credit note reduces what a client owes on an invoice (a billing error, a service credit, a discount); a debit note increases
 * it (an under-billing, a price adjustment, a fee). One person raises it and another approves it; approving it posts to the ledger
 * and moves the invoice's balance in one transaction. The invoice itself is never edited, and a decided note never changes (the
 * database refuses): a mistaken credit note is put right with a debit note, and the other way round.
 *
 *   Credit note:  Dr Revenue (spread over the invoice's contracts), Dr VAT payable;  Cr Receivables
 *   Debit note:   Dr Receivables;  Cr Revenue, Cr VAT payable
 *
 * A credit note can't take off more than is still owed, nor more of the invoice's net charge or VAT than was charged (less what
 * earlier credits have already taken). A client who has paid more than the corrected amount has overpaid: record that as an
 * advance and refund it.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { d } from "@/lib/dates";
import { num, round2 } from "@/lib/money";
import { invoiceStatus } from "@/lib/receipts";
import { amountDue, effectiveTotal, noteProblems, type NoteFacts, type NoteType } from "@/lib/notes";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";
import { postClientNote } from "./gl-posting";
import { nextNumber } from "./numbering";

const today = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

export const noteSchema = z.object({
  type: z.enum(["CREDIT", "DEBIT"]),
  invoiceId: z.string().min(1, "Choose the invoice"),
  noteDate: z.string().min(10, "Choose the date of the note"),
  reasonCode: z.enum(["BILLING_ERROR", "SERVICE_CREDIT", "DISCOUNT", "PRICE_ADJUSTMENT", "PENALTY_OR_FEE", "OTHER"]),
  reason: z.string().trim().default(""),
  netAmount: z.coerce.number(),
  vatAmount: z.coerce.number().default(0),
});
export type NoteInput = z.input<typeof noteSchema>;

const money = (inv: { totalAmount: unknown; totalDebits: unknown; totalCredits: unknown; amountPaid: unknown; totalDeductions: unknown }) => ({
  totalAmount: num(inv.totalAmount),
  totalDebits: num(inv.totalDebits),
  totalCredits: num(inv.totalCredits),
  amountPaid: num(inv.amountPaid),
  totalDeductions: num(inv.totalDeductions),
});

/** What a note can be checked against: the invoice, its balance, and how much of its net charge and VAT credits can still take. */
async function factsFor(tx: Tx, orgId: string, invoiceId: string, excludeNoteId?: string): Promise<{ invoice: NonNullable<Awaited<ReturnType<typeof loadInvoice>>>; facts: NoteFacts }> {
  const invoice = await loadInvoice(tx, orgId, invoiceId);
  if (!invoice) throw new BusinessError("Invoice not found.");
  if (invoice.status === "DRAFT" || invoice.status === "SUBMITTED") throw new BusinessError(`${invoice.invoiceNumber} has not been approved and posted yet, so no note can be raised against it.`);
  const approved = await tx.clientNote.findMany({ where: { invoiceId, status: "APPROVED", ...(excludeNoteId ? { id: { not: excludeNoteId } } : {}) } });
  const sum = (type: NoteType, f: "netAmount" | "vatAmount") => approved.filter((n) => n.type === type).reduce((s, n) => s + num(n[f]), 0);
  return {
    invoice,
    facts: {
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      cancelled: invoice.status === "CANCELLED",
      balance: round2(amountDue(money(invoice))),
      netLeft: round2(num(invoice.subtotal) + sum("DEBIT", "netAmount") - sum("CREDIT", "netAmount")),
      vatLeft: round2(num(invoice.vatAmount) + sum("DEBIT", "vatAmount") - sum("CREDIT", "vatAmount")),
    },
  };
}

const loadInvoice = (tx: Tx, orgId: string, id: string) =>
  tx.clientInvoice.findFirst({ where: { id, organizationId: orgId }, include: { lines: { select: { contractId: true, beatId: true, amount: true } }, client: { select: { name: true } } } });

// ───────────────────────────── Raising and deciding ─────────────────────────────

export async function raiseNote(ctx: Ctx, raw: NoteInput) {
  assertCan(ctx, "note.manage");
  const v = noteSchema.parse(raw);
  const noteDate = d(v.noteDate);
  const net = round2(v.netAmount);
  const vat = round2(v.vatAmount);
  return db.$transaction(async (tx) => {
    const { invoice, facts } = await factsFor(tx, ctx.orgId, v.invoiceId);
    const problems = noteProblems({ type: v.type, netAmount: net, vatAmount: vat, noteDate, reason: v.reason }, facts, today());
    if (problems.length) throw new BusinessError(problems.slice(0, 2).join(" "));
    const note = await tx.clientNote.create({
      data: {
        organizationId: ctx.orgId,
        noteNumber: await nextNumber(tx, ctx.orgId, v.type === "CREDIT" ? "CREDIT_NOTE" : "DEBIT_NOTE"),
        type: v.type,
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        noteDate,
        reasonCode: v.reasonCode,
        reason: v.reason.trim(),
        netAmount: net,
        vatAmount: vat,
        totalAmount: round2(net + vat),
        requestedBy: ctx.name,
        requestedByUserId: ctx.userId,
      },
    });
    await logAudit(ctx, { action: "CLIENT_NOTE_RAISE", entity: "ClientNote", entityId: note.id, newValue: { noteNumber: note.noteNumber, type: v.type, invoice: invoice.invoiceNumber, total: round2(net + vat) }, reason: v.reason }, tx);
    return note;
  });
}

/** The person who raised a note can withdraw it while it is waiting. */
export async function withdrawNote(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "note.manage");
  if (!reason || reason.trim().length < 5) throw new BusinessError("Say why it is being withdrawn.");
  return db.$transaction(async (tx) => {
    const note = await tx.clientNote.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!note) throw new BusinessError("Note not found.");
    if (note.status !== "PENDING") throw new BusinessError("This note has already been decided.");
    if (note.requestedByUserId !== ctx.userId) throw new BusinessError("Only the person who raised a note can withdraw it. Anyone with approval rights can turn it down.");
    const u = await tx.clientNote.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: `Withdrawn: ${reason.trim()}` } });
    await logAudit(ctx, { action: "CLIENT_NOTE_WITHDRAW", entity: "ClientNote", entityId: id, reason }, tx);
    return u;
  });
}

export async function decideNote(ctx: Ctx, id: string, approve: boolean, noteText?: string) {
  assertCan(ctx, "note.approve");
  if (!approve && (!noteText || noteText.trim().length < 5)) throw new BusinessError("Say why the note is being turned down.");
  return db.$transaction(async (tx) => {
    const note = await tx.clientNote.findFirst({ where: { id, organizationId: ctx.orgId } });
    if (!note) throw new BusinessError("Note not found.");
    if (note.status !== "PENDING") throw new BusinessError("This note has already been decided.");
    if (note.requestedByUserId === ctx.userId) throw new BusinessError("You raised this note, so someone else has to approve it.");
    const now = new Date();
    if (!approve) {
      const u = await tx.clientNote.update({ where: { id }, data: { status: "REJECTED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: now, decisionNote: noteText!.trim() } });
      await logAudit(ctx, { action: "CLIENT_NOTE_REJECT", entity: "ClientNote", entityId: id, reason: noteText }, tx);
      return u;
    }
    // the books may have moved since it was raised: check it again against the invoice as it is now
    const { invoice, facts } = await factsFor(tx, ctx.orgId, note.invoiceId, note.id);
    const problems = noteProblems({ type: note.type, netAmount: num(note.netAmount), vatAmount: num(note.vatAmount), noteDate: note.noteDate, reason: note.reason }, facts, today());
    if (problems.length) throw new BusinessError(`It can't be approved now: ${problems[0]}`);

    const total = num(note.totalAmount);
    const credit = note.type === "CREDIT";
    const totalCredits = round2(num(invoice.totalCredits) + (credit ? total : 0));
    const totalDebits = round2(num(invoice.totalDebits) + (credit ? 0 : total));
    const due = effectiveTotal({ totalAmount: num(invoice.totalAmount), totalDebits, totalCredits });
    // a guarded update, so a receipt landing on the invoice at the same moment can't leave it over- or under-settled
    const moved = await tx.clientInvoice.updateMany({
      where: { id: invoice.id, amountPaid: invoice.amountPaid, totalDeductions: invoice.totalDeductions, totalCredits: invoice.totalCredits, totalDebits: invoice.totalDebits },
      data: { totalCredits, totalDebits, status: invoiceStatus(due, num(invoice.amountPaid), num(invoice.totalDeductions)) },
    });
    if (!moved.count) throw new BusinessError(`${invoice.invoiceNumber} changed while this was being saved. Try again.`);
    await postClientNote(ctx, tx, note, invoice);
    if (num(note.vatAmount) > 0) {
      // VAT charged is reduced by a credit note and increased by a debit note; the tax records follow, so the VAT reports agree with the ledger
      const sign = credit ? -1 : 1;
      await tx.taxTransaction.create({
        data: {
          organizationId: ctx.orgId,
          kind: "OUTPUT_VAT",
          sourceType: "CLIENT_NOTE",
          invoiceId: invoice.id,
          clientId: invoice.clientId,
          taxDate: note.noteDate,
          taxableAmount: sign * num(note.netAmount),
          ratePct: Math.round((num(note.vatAmount) / num(note.netAmount)) * 100000) / 1000,
          taxAmount: sign * num(note.vatAmount),
        },
      });
    }
    const u = await tx.clientNote.update({ where: { id }, data: { status: "APPROVED", decidedBy: ctx.name, decidedByUserId: ctx.userId, decidedAt: now, decisionNote: noteText?.trim() || null } });
    await logAudit(ctx, { action: "CLIENT_NOTE_APPROVE", entity: "ClientNote", entityId: id, newValue: { noteNumber: note.noteNumber, type: note.type, invoice: invoice.invoiceNumber, total } }, tx);
    return u;
  });
}

// ───────────────────────────── Reading ─────────────────────────────

export async function listNotes(ctx: Ctx, filter: { status?: string; invoiceId?: string; clientId?: string } = {}) {
  assertCan(ctx, "gl.view");
  return db.clientNote.findMany({
    where: { organizationId: ctx.orgId, ...(filter.status ? { status: filter.status as never } : {}), ...(filter.invoiceId ? { invoiceId: filter.invoiceId } : {}), ...(filter.clientId ? { clientId: filter.clientId } : {}) },
    include: { client: { select: { name: true } }, invoice: { select: { id: true, invoiceNumber: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
}

export async function getNote(ctx: Ctx, id: string) {
  assertCan(ctx, "gl.view");
  const note = await db.clientNote.findFirst({ where: { id, organizationId: ctx.orgId }, include: { client: { select: { id: true, name: true } }, invoice: { select: { id: true, invoiceNumber: true, subtotal: true, vatAmount: true, totalAmount: true } } } });
  if (!note) return null;
  const journal = note.status === "APPROVED" ? await db.journalEntry.findFirst({ where: { organizationId: ctx.orgId, sourceType: "CLIENT_NOTE", sourceId: id }, select: { id: true, entryNumber: true } }) : null;
  return { ...note, journal };
}

/** What the form needs to know about an invoice before a note is raised against it. */
export async function noteContext(ctx: Ctx, invoiceId: string) {
  assertCan(ctx, "gl.view");
  const { invoice, facts } = await factsFor(db, ctx.orgId, invoiceId);
  return { invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, clientName: invoice.client.name, subtotal: num(invoice.subtotal), vatAmount: num(invoice.vatAmount), totalAmount: num(invoice.totalAmount) }, facts };
}
