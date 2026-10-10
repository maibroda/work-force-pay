import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { billingWorld } from "../billing-fixture";
import {
  approveInvoice,
  cancelInvoice,
  discardDraft,
  generateInvoices,
  markInvoiceSent,
  proformaForRun,
  receivablesSummary,
  recordDeduction,
  recordReceipt,
  rejectInvoice,
  setInvoiceApprovalRequired,
  submitInvoice,
  unbilledRuns,
} from "@/server/services/billing";
import { periodFor, transitionPeriod } from "@/server/services/periods";
import { checkLedgerIntegrity } from "@/server/services/ledger-integrity";
import { raiseNote } from "@/server/services/client-notes";
import { clientStatement, openInvoicesFor, recordClientReceipt } from "@/server/services/receipts";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const findings = async (orgId: string) => (await checkLedgerIntegrity(orgId)).findings.filter((f) => f.check !== "PAYROLL_UNPOSTED"); // the fixture's locked runs have no payroll journals

/** An organization that requires approval, with one client billed 4,000,000 for August 2026. */
async function world(required = true) {
  const w = await billingWorld();
  const fin = w.t.ctx("FINANCE", null, 1);
  const fin2 = w.t.ctx("FINANCE", null, 2);
  const boss = w.t.ctx("COMPANY_ADMIN", null, 1);
  const boss2 = w.t.ctx("COMPANY_ADMIN", null, 2);
  if (required) await setInvoiceApprovalRequired(boss, true);
  const run = await w.newRun(2026, 8);
  const { clientId } = await w.addCharge(run, 4_000_000);
  const draft = async (ctx = fin, opts: Record<string, unknown> = { vatPct: 7.5 }) => {
    const [inv] = await generateInvoices(ctx, run.id, opts);
    return inv;
  };
  const invoice = (id: string) => db.clientInvoice.findUniqueOrThrow({ where: { id } });
  const journalsFor = (id: string) => db.journalEntry.count({ where: { organizationId: w.t.org.id, sourceType: "CLIENT_INVOICE", sourceId: id } });
  return { ...w, fin, fin2, boss, boss2, run, clientId, draft, invoice, journalsFor };
}

describe("an invoice generated where approval is required", () => {
  it("is a draft under a provisional number: not in the ledger, not a receivable, no tax records", async () => {
    const { t, fin, run, clientId, draft, journalsFor } = await world();
    const inv = await draft();
    expect(inv.status).toBe("DRAFT");
    expect(inv.invoiceNumber).toMatch(/^DRAFT-[A-Z0-9]+$/);
    expect(num(inv.totalAmount)).toBe(4_030_000); // worked out exactly as a posted invoice would be
    expect(await journalsFor(inv.id)).toBe(0);
    expect(await db.taxTransaction.count({ where: { invoiceId: inv.id } })).toBe(0);
    expect((await receivablesSummary(fin)).totals.billed).toBe(0);
    expect((await unbilledRuns(fin)).map((r) => r.id)).not.toContain(run.id);
    expect((await openInvoicesFor(fin, clientId)).length).toBe(0);
    expect((await clientStatement(fin, clientId, "2026-10-10")).closing).toBe(0);
    await expect(generateInvoices(fin, run.id)).rejects.toThrow(/already exist/);
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("is posted only when a different person approves it, then gets its number, its tax records and its ledger entry", async () => {
    const { t, fin, boss, draft, invoice, journalsFor, clientId } = await world();
    const inv = await draft();
    await expect(approveInvoice(boss, inv.id)).rejects.toThrow(/Only a submitted invoice/); // not yet submitted
    await submitInvoice(fin, inv.id);
    await expect(submitInvoice(fin, inv.id)).rejects.toThrow(/Only a draft/);
    await expect(approveInvoice(fin, inv.id)).rejects.toThrow(/permission/i); // Finance prepares, an approver decides
    const issued = await approveInvoice(boss, inv.id);
    expect(issued.invoiceNumber).toBe("INV-000001");
    expect(issued.status).toBe("ISSUED");
    expect(issued.approvedBy).toBe(boss.name);
    expect(await journalsFor(inv.id)).toBe(1);
    expect((await db.taxTransaction.findMany({ where: { invoiceId: inv.id } })).map((r) => [r.kind, num(r.taxAmount)])).toEqual([["OUTPUT_VAT", 30_000]]);
    const s = await clientStatement(fin, clientId, "2026-10-10");
    expect(s.closing).toBe(4_030_000);
    expect(s.closing).toBe(s.ledger);
    expect((await invoice(inv.id)).status).toBe("ISSUED");
    expect(await findings(t.org.id)).toEqual([]);
    // and now it takes receipts like any other
    await recordClientReceipt(fin, { clientId, amount: 4_030_000, receivedDate: "2026-10-05", allocations: [{ invoiceId: inv.id, cash: 4_030_000 }] } as never);
    expect((await invoice(inv.id)).status).toBe("PAID");
  });

  it("can't be approved by whoever generated or submitted it", async () => {
    const { boss, boss2, fin, draft } = await world();
    const mine = await draft(boss); // an administrator generates it
    await submitInvoice(fin, mine.id);
    await expect(approveInvoice(boss, mine.id)).rejects.toThrow(/You generated or submitted this invoice/);
    await approveInvoice(boss2, mine.id);
  });

  it("goes back to the preparer with a reason, and can be discarded so the run can be invoiced again", async () => {
    const { fin, boss, run, draft, invoice } = await world();
    const inv = await draft();
    await submitInvoice(fin, inv.id);
    await expect(rejectInvoice(boss, inv.id, "short")).rejects.toThrow(/at least 10 characters/);
    await rejectInvoice(boss, inv.id, "The rate for the Lekki post looks wrong");
    const back = await invoice(inv.id);
    expect([back.status, back.rejectionNote, back.submittedBy]).toEqual(["DRAFT", "The rate for the Lekki post looks wrong", null]);
    await expect(discardDraft(fin, inv.id, "no")).rejects.toThrow(/Say why/);
    await discardDraft(fin, inv.id, "Billing rule corrected, to be regenerated");
    expect(await db.clientInvoice.count({ where: { id: inv.id } })).toBe(0);
    expect(await db.clientInvoiceLine.count({ where: { invoiceId: inv.id } })).toBe(0);
    const again = await generateInvoices(fin, run.id, { vatPct: 10 });
    expect(num(again[0].vatAmount)).toBe(40_000); // regenerated under the corrected rate
    expect(await db.organization.findFirstOrThrow({ where: { id: fin.orgId } }).then((o) => o.invoiceApprovalRequired)).toBe(true);
  });

  it("leaves no gap in the invoice numbers when drafts are thrown away", async () => {
    const { fin, boss, run, draft } = await world();
    const first = await draft();
    await discardDraft(fin, first.id, "Generated by mistake");
    const second = (await generateInvoices(fin, run.id, { vatPct: 7.5 }))[0];
    await submitInvoice(fin, second.id);
    expect((await approveInvoice(boss, second.id)).invoiceNumber).toBe("INV-000001");
  });

  it("can't take a receipt, deduction, note or cancellation until it is posted", async () => {
    const { fin, clientId, draft } = await world();
    const inv = await draft();
    await expect(recordReceipt(fin, { invoiceId: inv.id, amount: 100, receivedDate: "2026-10-05" })).rejects.toThrow(/not been approved and posted/);
    await expect(recordDeduction(fin, { invoiceId: inv.id, type: "OTHER", amount: 100, reason: "A documented reason here", supportingDocument: "REF-1" })).rejects.toThrow(/not been approved and posted/);
    await expect(raiseNote(fin, { type: "CREDIT", invoiceId: inv.id, noteDate: "2026-09-15", reasonCode: "OTHER", reason: "Credit before it was posted", netAmount: 100, vatAmount: 0 } as never)).rejects.toThrow(/not been approved and posted/);
    await expect(cancelInvoice(fin, inv.id, "Cancel a draft please")).rejects.toThrow(/Discard the draft/);
    await expect(recordClientReceipt(fin, { clientId, amount: 100, receivedDate: "2026-10-05", allocations: [{ invoiceId: inv.id, cash: 100 }] } as never)).rejects.toThrow(/isn't open for this client/);
    await expect(markInvoiceSent(fin, inv.id, "email")).rejects.toThrow(/Only a posted invoice/);
  });

  it("is refused at approval if the accounting period has closed, and stays submitted with no number used", async () => {
    const { t, fin, boss, boss2, run, draft, invoice } = await world();
    const inv = await draft();
    await submitInvoice(fin, inv.id);
    const aug = await periodFor(db, t.org.id, day("2026-08-31"));
    await transitionPeriod(fin, aug.id, "SOFT_CLOSE");
    await transitionPeriod(boss, aug.id, "CLOSE");
    await expect(approveInvoice(boss2, inv.id)).rejects.toThrow(/Aug 2026 is closed/);
    const still = await invoice(inv.id);
    expect([still.status, still.invoiceNumber.startsWith("DRAFT-")]).toEqual(["SUBMITTED", true]);
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id } })).toBe(0);
    void run;
  });
});

describe("a posted invoice", () => {
  async function posted() {
    const w = await world();
    const inv = await w.draft();
    await submitInvoice(w.fin, inv.id);
    const issued = await approveInvoice(w.boss, inv.id);
    return { ...w, inv: issued };
  }

  it("is frozen in the database: no edit, no way back to a draft, no delete, even by SQL", async () => {
    const { inv } = await posted();
    await expect(db.clientInvoice.update({ where: { id: inv.id }, data: { subtotal: 1 } })).rejects.toThrow(/cannot be edited/);
    await expect(db.clientInvoice.update({ where: { id: inv.id }, data: { vatAmount: 0 } })).rejects.toThrow(/cannot be edited/);
    await expect(db.clientInvoice.update({ where: { id: inv.id }, data: { invoiceNumber: "INV-999999" } })).rejects.toThrow(/cannot be edited/);
    await expect(db.clientInvoice.update({ where: { id: inv.id }, data: { dueDate: day("2030-01-01") } })).rejects.toThrow(/cannot be edited/);
    await expect(db.clientInvoice.update({ where: { id: inv.id }, data: { status: "DRAFT" } })).rejects.toThrow(/cannot go back to a draft/);
    await expect(db.clientInvoice.delete({ where: { id: inv.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.$executeRawUnsafe(`UPDATE "ClientInvoice" SET "totalAmount" = 1 WHERE id = '${inv.id}'`)).rejects.toThrow(/cannot be edited/);
    await expect(db.$executeRawUnsafe(`DELETE FROM "ClientInvoice" WHERE id = '${inv.id}'`)).rejects.toThrow(/cannot be deleted/);
  });

  it("freezes its lines, while payments and notes still move its balance", async () => {
    const { t, fin, boss, inv, clientId } = await posted();
    const line = await db.clientInvoiceLine.findFirstOrThrow({ where: { invoiceId: inv.id } });
    await expect(db.clientInvoiceLine.update({ where: { id: line.id }, data: { amount: 1 } })).rejects.toThrow(/cannot be changed or removed/);
    await expect(db.clientInvoiceLine.delete({ where: { id: line.id } })).rejects.toThrow(/cannot be changed or removed/);
    await recordClientReceipt(fin, { clientId, amount: 1_000_000, receivedDate: "2026-10-05", allocations: [{ invoiceId: inv.id, cash: 1_000_000 }] } as never);
    const note = await raiseNote(fin, { type: "CREDIT", invoiceId: inv.id, noteDate: "2026-09-15", reasonCode: "DISCOUNT", reason: "Volume discount agreed for the quarter", netAmount: 100_000, vatAmount: 750 } as never);
    const { decideNote } = await import("@/server/services/client-notes");
    await decideNote(boss, note.id, true);
    const after = await db.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect([after.status, num(after.amountPaid), num(after.totalCredits), num(after.totalAmount)]).toEqual(["PARTIALLY_PAID", 1_000_000, 100_750, 4_030_000]);
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("can still be cancelled, which reverses its posting, and a cancelled invoice can't change", async () => {
    const { t, fin, inv, journalsFor } = await posted();
    await cancelInvoice(fin, inv.id, "Billed to the wrong client entirely");
    expect((await db.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("CANCELLED");
    expect(await journalsFor(inv.id)).toBe(2); // the posting and its reversal
    await expect(db.clientInvoice.update({ where: { id: inv.id }, data: { status: "ISSUED" } })).rejects.toThrow(/cancelled invoice cannot change/);
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("records when and how it was sent", async () => {
    const { fin, inv } = await posted();
    await markInvoiceSent(fin, inv.id, "Email to accounts@client.test");
    const sent = await db.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect([sent.sentBy, sent.sentVia, !!sent.sentAt]).toEqual([fin.name, "Email to accounts@client.test", true]);
  });
});

describe("the approval setting", () => {
  it("is off by default, where invoices post as they are made as they always have", async () => {
    const { t, fin, draft, journalsFor } = await world(false);
    const inv = await draft();
    expect([inv.status, inv.invoiceNumber]).toEqual(["ISSUED", "INV-000001"]);
    expect(await journalsFor(inv.id)).toBe(1);
    expect(await findings(t.org.id)).toEqual([]);
    void fin;
  });

  it("can be switched on and off only by a period approver, and each change is on the record", async () => {
    const { t, fin, boss } = await world(false);
    await expect(setInvoiceApprovalRequired(fin, true)).rejects.toThrow(/permission/i);
    await setInvoiceApprovalRequired(boss, true);
    await setInvoiceApprovalRequired(boss, false);
    const audits = await db.auditLog.findMany({ where: { organizationId: t.org.id, action: "INVOICE_APPROVAL_SETTING" }, orderBy: { createdAt: "asc" } });
    expect(audits).toHaveLength(2);
  });
});

describe("a proforma", () => {
  it("shows what a payroll run would be invoiced for, before it is locked, and saves nothing", async () => {
    const { t, fin, boss, hr, run, clientId } = await (async () => {
      const w = await world(false);
      return { ...w };
    })();
    await db.payrollRun.update({ where: { id: run.id }, data: { status: "CALCULATED" } });
    await expect(generateInvoices(fin, run.id)).rejects.toThrow(/locked payroll/);
    const pf = await proformaForRun(fin, run.id, { vatPct: 7.5 });
    expect(pf.runStatus).toBe("CALCULATED");
    expect(pf.alreadyInvoiced).toBe(false);
    expect(pf.plans).toHaveLength(1);
    expect(pf.plans[0]).toMatchObject({ clientId, subtotal: 4_000_000, totalIndirectCharge: 400_000, vatAmount: 30_000, totalAmount: 4_030_000 });
    expect(await db.clientInvoice.count({ where: { organizationId: t.org.id } })).toBe(0);
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id } })).toBe(0);
    // once locked, the invoice comes out exactly as the proforma said
    await db.payrollRun.update({ where: { id: run.id }, data: { status: "LOCKED" } });
    const [inv] = await generateInvoices(fin, run.id, { vatPct: 7.5 });
    expect([num(inv.subtotal), num(inv.vatAmount), num(inv.totalAmount)]).toEqual([4_000_000, 30_000, 4_030_000]);
    expect((await proformaForRun(fin, run.id, { vatPct: 7.5 })).alreadyInvoiced).toBe(true);
    void boss;
    void hr;
  });

  it("is per organization and needs the right permission", async () => {
    const mine = await world(false);
    const other = await world(false);
    await expect(proformaForRun(other.fin, mine.run.id)).rejects.toThrow(/Payroll run not found/);
    await expect(proformaForRun(mine.t.ctx("EMPLOYEE"), mine.run.id)).rejects.toThrow(/permission/i);
  });
});
