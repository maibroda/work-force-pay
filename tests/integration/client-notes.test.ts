import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { billingWorld } from "../billing-fixture";
import { cancelInvoice, generateInvoices, receivablesSummary } from "@/server/services/billing";
import { checkLedgerIntegrity } from "@/server/services/ledger-integrity";
import { taxReport } from "@/server/services/tax-engine";
import { clientStatement, recordClientReceipt } from "@/server/services/receipts";
import { decideNote, getNote, listNotes, noteContext, raiseNote, withdrawNote } from "@/server/services/client-notes";

const findings = async (orgId: string) => (await checkLedgerIntegrity(orgId)).findings.filter((f) => f.check !== "PAYROLL_UNPOSTED"); // the fixture's locked runs have no payroll journals

/** One client billed 4,000,000 in each of June, July and August 2026, with VAT: 400,000 indirect charge, 30,000 VAT, 4,030,000 each. */
async function world() {
  const w = await billingWorld();
  const fin = w.t.ctx("FINANCE", null, 1);
  const fin2 = w.t.ctx("FINANCE", null, 2);
  const boss = w.t.ctx("COMPANY_ADMIN", null, 1);
  const boss2 = w.t.ctx("COMPANY_ADMIN", null, 2);
  const hr = w.t.ctx("HR_ADMIN", null, 1);
  const first = await w.addCharge(await w.newRun(2026, 6), 4_000_000);
  await w.addCharge(await w.newRun(2026, 7), 4_000_000, first);
  await w.addCharge(await w.newRun(2026, 8), 4_000_000, first);
  const runs = await db.payrollRun.findMany({ where: { organizationId: w.t.org.id }, orderBy: { period: { month: "asc" } } });
  for (const r of runs) await generateInvoices(fin, r.id, { vatPct: 7.5, whtPct: 0 });
  const [jun, jul, aug] = await db.clientInvoice.findMany({ where: { organizationId: w.t.org.id }, orderBy: { invoiceDate: "asc" } });
  const note = (over: Record<string, unknown> = {}, ctx = fin) =>
    raiseNote(ctx, { type: "CREDIT", invoiceId: jun.id, noteDate: "2026-09-15", reasonCode: "BILLING_ERROR", reason: "Two guards billed for a post that closed in June", netAmount: 1_000_000, vatAmount: 7_500, ...over } as never);
  /** Raise and approve. */
  const posted = async (over: Record<string, unknown> = {}) => {
    const n = await note(over);
    await decideNote(boss, n.id, true);
    return n;
  };
  const invoice = (id: string) => db.clientInvoice.findUniqueOrThrow({ where: { id } });
  const ledger = async (code: string) => {
    const a = await db.journalLine.aggregate({ where: { journal: { organizationId: w.t.org.id }, account: { organizationId: w.t.org.id, code } }, _sum: { debit: true, credit: true } });
    return num(a._sum.debit) - num(a._sum.credit);
  };
  return { ...w, fin, fin2, boss, boss2, hr, clientId: first.clientId, jun, jul, aug, note, posted, invoice, ledger };
}

describe("a credit note", () => {
  it("reduces what is owed on the invoice, takes revenue and VAT back, and the books still agree", async () => {
    const { t, fin, boss, clientId, jun, note, invoice, ledger } = await world();
    const n = await note();
    expect(n.noteNumber).toBe("CN-000001");
    expect(num(n.totalAmount)).toBe(1_007_500);
    expect((await invoice(jun.id)).totalCredits.toString()).toBe("0"); // nothing moves until it is approved
    await decideNote(boss, n.id, true);
    const after = await invoice(jun.id);
    expect([num(after.totalAmount), num(after.totalCredits), after.status]).toEqual([4_030_000, 1_007_500, "ISSUED"]);
    const journal = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, sourceType: "CLIENT_NOTE", sourceId: n.id }, include: { lines: true } });
    expect(journal.lines.map((l) => [l.accountCode, num(l.debit), num(l.credit)]).sort()).toEqual([["1200", 0, 1_007_500], ["2190", 7_500, 0], ["4100", 1_000_000, 0]]);
    expect(await ledger("1200")).toBe(3 * 4_030_000 - 1_007_500);
    const s = await clientStatement(fin, clientId, "2026-10-10");
    expect(s.closing).toBe(3 * 4_030_000 - 1_007_500);
    expect(s.closing).toBe(s.ledger);
    expect(s.lines.map((l) => l.type)).toContain("CREDIT_NOTE");
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("is tracked in the VAT report: VAT charged falls by the credit, and still ties to the ledger", async () => {
    const { fin, posted } = await world();
    await posted();
    const r = await taxReport(fin, { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T00:00:00Z") });
    expect(r.months.reduce((s, m) => s + m.vat, 0)).toBe(3 * 30_000 - 7_500);
    expect(r.tieOut.difference).toBe(0);
  });

  it("spreads the revenue it takes back over the contracts the invoice was billed for", async () => {
    const { t, fin, boss, clientId, jun, addCharge } = await world();
    // a second contract on the June invoice's run is not possible after the fact, so check the dimension on the one contract
    const n = await (async () => {
      const x = await raiseNote(fin, { type: "CREDIT", invoiceId: jun.id, noteDate: "2026-09-15", reasonCode: "DISCOUNT", reason: "Volume discount agreed for the quarter", netAmount: 400_000, vatAmount: 0 } as never);
      await decideNote(boss, x.id, true);
      return x;
    })();
    const line = await db.journalLine.findFirstOrThrow({ where: { journal: { organizationId: t.org.id, sourceType: "CLIENT_NOTE", sourceId: n.id }, accountCode: "4100" } });
    expect(line.contractId).toBeTruthy();
    expect(line.clientId).toBe(clientId);
    void addCharge;
  });

  it("can settle the rest of an invoice with a receipt, and brings it to paid", async () => {
    const { t, fin, boss, clientId, jun, note, invoice } = await world();
    const n = await note({ netAmount: 1_000_000, vatAmount: 7_500 });
    await decideNote(boss, n.id, true);
    await expect(recordClientReceipt(fin, { clientId, amount: 3_100_000, receivedDate: "2026-10-05", allocations: [{ invoiceId: jun.id, cash: 3_100_000 }] } as never)).rejects.toThrow(/more than the 3022500\.00 still owed/);
    await recordClientReceipt(fin, { clientId, amount: 3_022_500, receivedDate: "2026-10-05", allocations: [{ invoiceId: jun.id, cash: 3_022_500 }] } as never);
    expect((await invoice(jun.id)).status).toBe("PAID");
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("is refused when it takes off more than is owed, than was charged, or than earlier credits left", async () => {
    const { fin, posted, note, jun } = await world();
    await expect(note({ netAmount: 4_100_000, vatAmount: 0 })).rejects.toThrow(/more than the 4030000\.00 still owed|more than the 4000000\.00 of the invoice/);
    await expect(note({ netAmount: 1_000_000, vatAmount: 40_000 })).rejects.toThrow(/VAT is more than the 30000\.00 charged/);
    await posted({ netAmount: 3_500_000, vatAmount: 26_250 });
    await expect(note({ netAmount: 600_000, vatAmount: 0 })).rejects.toThrow(/more than the 500000\.00 of the invoice that has not already been credited|more than the 503750\.00 still owed/);
    await expect(note({ netAmount: 500_000, vatAmount: 0 })).resolves.toBeTruthy();
    void fin;
    void jun;
  });
});

describe("a debit note", () => {
  it("increases what is owed, reopens a paid invoice, and posts revenue and VAT", async () => {
    const { t, fin, boss, clientId, jun, note, invoice, ledger } = await world();
    await recordClientReceipt(fin, { clientId, amount: 4_030_000, receivedDate: "2026-10-05", allocations: [{ invoiceId: jun.id, cash: 4_030_000 }] } as never);
    expect((await invoice(jun.id)).status).toBe("PAID");
    const n = await note({ type: "DEBIT", reasonCode: "PRICE_ADJUSTMENT", reason: "Rates for the quarter were under-billed", netAmount: 500_000, vatAmount: 3_750 });
    expect(n.noteNumber).toBe("DN-000001");
    await decideNote(boss, n.id, true);
    const after = await invoice(jun.id);
    expect([num(after.totalDebits), after.status]).toEqual([503_750, "PARTIALLY_PAID"]);
    const journal = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, sourceType: "CLIENT_NOTE", sourceId: n.id }, include: { lines: true } });
    expect(journal.lines.map((l) => [l.accountCode, num(l.debit), num(l.credit)]).sort()).toEqual([["1200", 503_750, 0], ["2190", 0, 3_750], ["4100", 0, 500_000]]);
    expect(await ledger("1200")).toBe(2 * 4_030_000 + 503_750);
    // settling the debit note brings the invoice back to paid
    await recordClientReceipt(fin, { clientId, amount: 503_750, receivedDate: "2026-10-06", allocations: [{ invoiceId: jun.id, cash: 503_750 }] } as never);
    expect((await invoice(jun.id)).status).toBe("PAID");
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("puts right a mistaken credit note", async () => {
    const { t, posted, note, boss, invoice, jun } = await world();
    await posted({ netAmount: 1_000_000, vatAmount: 7_500 });
    const fix = await note({ type: "DEBIT", reasonCode: "BILLING_ERROR", reason: "The credit note above was raised in error", netAmount: 1_000_000, vatAmount: 7_500 });
    await decideNote(boss, fix.id, true);
    const after = await invoice(jun.id);
    expect([num(after.totalCredits), num(after.totalDebits)]).toEqual([1_007_500, 1_007_500]);
    expect(await findings(t.org.id)).toEqual([]);
  });
});

describe("approval", () => {
  it("needs someone else with the approval right, and a reason to turn one down", async () => {
    const { fin, fin2, boss, boss2, hr, note } = await world();
    await expect(note({}, hr)).rejects.toThrow(/permission/i);
    const n = await note();
    await expect(decideNote(fin2, n.id, true)).rejects.toThrow(/permission/i); // Finance raises, an approver decides
    const mine = await note({ netAmount: 100_000, vatAmount: 0 }, boss);
    await expect(decideNote(boss, mine.id, true)).rejects.toThrow(/You raised this note/);
    await expect(decideNote(boss2, n.id, false)).rejects.toThrow(/Say why/);
    await decideNote(boss2, n.id, false, "Not what the client agreed");
    await expect(decideNote(boss2, n.id, true)).rejects.toThrow(/already been decided/);
    expect((await getNote(fin, n.id))!.status).toBe("REJECTED");
  });

  it("lets only the person who raised a waiting note withdraw it", async () => {
    const { fin, fin2, note } = await world();
    const n = await note();
    await expect(withdrawNote(fin2, n.id, "Not mine to withdraw")).rejects.toThrow(/Only the person who raised/);
    await expect(withdrawNote(fin, n.id, "no")).rejects.toThrow(/Say why/);
    await withdrawNote(fin, n.id, "Raised against the wrong invoice");
    expect((await getNote(fin, n.id))!.decisionNote).toMatch(/^Withdrawn: Raised against/);
  });

  it("checks again at approval: two credits that each fit alone can't both be approved", async () => {
    const { boss, note, jun, invoice } = await world();
    const a = await note({ netAmount: 2_500_000, vatAmount: 0 });
    const b = await note({ netAmount: 2_500_000, vatAmount: 0, reason: "A second credit for the same invoice" });
    await decideNote(boss, a.id, true);
    await expect(decideNote(boss, b.id, true)).rejects.toThrow(/can't be approved now/);
    expect(num((await invoice(jun.id)).totalCredits)).toBe(2_500_000);
    expect((await getNote(boss, b.id))!.status).toBe("PENDING");
  });
});

describe("validation and protection", () => {
  it("refuses a note with a short reason, a bad date, no amount, or against a cancelled invoice", async () => {
    const { fin, note, aug, jun } = await world();
    await expect(note({ reason: "short" })).rejects.toThrow(/at least 10 characters/);
    await expect(note({ noteDate: "2026-06-01" })).rejects.toThrow(/before the invoice/);
    await expect(note({ noteDate: "2999-01-01" })).rejects.toThrow(/future/);
    await expect(note({ netAmount: 0 })).rejects.toThrow(/greater than zero/);
    await expect(note({ invoiceId: "nope" })).rejects.toThrow(/Invoice not found/);
    await cancelInvoice(fin, aug.id, "Billed in error entirely");
    await expect(note({ invoiceId: aug.id })).rejects.toThrow(/was cancelled/);
    void jun;
  });

  it("stops an invoice with notes from being cancelled", async () => {
    const { fin, posted, jun } = await world();
    await posted();
    await expect(cancelInvoice(fin, jun.id, "Trying to cancel it after a credit")).rejects.toThrow(/credit or debit notes/);
  });

  it("is protected in the database: no edit, no delete, before or after a decision", async () => {
    const { note, posted } = await world();
    const waiting = await note();
    await expect(db.clientNote.update({ where: { id: waiting.id }, data: { netAmount: 1, totalAmount: 1 } })).rejects.toThrow();
    await expect(db.clientNote.update({ where: { id: waiting.id }, data: { reason: "Reworded after the fact" } })).rejects.toThrow(/cannot be edited/);
    await expect(db.clientNote.delete({ where: { id: waiting.id } })).rejects.toThrow(/cannot be deleted/);
    const done = await posted({ netAmount: 100_000, vatAmount: 0 });
    await expect(db.clientNote.update({ where: { id: done.id }, data: { decisionNote: "changed" } })).rejects.toThrow(/cannot be changed/);
    await expect(db.$executeRawUnsafe(`UPDATE "ClientNote" SET "status" = 'PENDING' WHERE id = '${done.id}'`)).rejects.toThrow(/cannot be changed/);
  });

  it("is per organization and visible to those who may see the ledger", async () => {
    const mine = await world();
    const other = await world();
    const n = await mine.note();
    expect(await listNotes(other.fin)).toEqual([]);
    expect((await listNotes(mine.fin, { status: "PENDING" })).map((x) => x.noteNumber)).toEqual(["CN-000001"]);
    expect(await getNote(other.fin, n.id)).toBeNull();
    await expect(noteContext(other.fin, mine.jun.id)).rejects.toThrow(/Invoice not found/);
    const ctx = await noteContext(mine.fin, mine.jun.id);
    expect([ctx.facts.balance, ctx.facts.netLeft, ctx.facts.vatLeft]).toEqual([4_030_000, 4_000_000, 30_000]);
    expect((await receivablesSummary(mine.fin)).totals.outstanding).toBeGreaterThan(0);
  });
});
