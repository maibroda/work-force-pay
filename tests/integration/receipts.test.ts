import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { billingWorld } from "../billing-fixture";
import { generateInvoices } from "@/server/services/billing";
import { checkLedgerIntegrity } from "@/server/services/ledger-integrity";
import { statementCsv } from "@/lib/statements";
import {
  applyAdvance,
  clientStatement,
  decideRefund,
  getClientReceipt,
  listClientReceipts,
  openInvoicesFor,
  receivablesAgeing,
  recordClientReceipt,
  requestRefund,
  reverseAllocation,
} from "@/server/services/receipts";

const findings = async (orgId: string) => (await checkLedgerIntegrity(orgId)).findings.filter((f) => f.check !== "PAYROLL_UNPOSTED"); // the fixture's locked runs have no payroll journals

/** One client billed 4,000,000 for each of June, July and August 2026 (invoices dated month end, due 30 days later). */
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
  for (const r of runs) await generateInvoices(fin, r.id, { vatPct: 0, whtPct: 0 });
  const invoices = await db.clientInvoice.findMany({ where: { organizationId: w.t.org.id }, orderBy: { invoiceDate: "asc" } });
  const [jun, jul, aug] = invoices;
  const receive = (over: Record<string, unknown> = {}, ctx = fin) =>
    recordClientReceipt(ctx, { clientId: first.clientId, amount: 1_000_000, receivedDate: "2026-10-05", method: "Transfer", allocations: [], ...over } as never);
  const ledger = async (code: string) => {
    const a = await db.journalLine.aggregate({ where: { journal: { organizationId: w.t.org.id }, account: { organizationId: w.t.org.id, code } }, _sum: { debit: true, credit: true } });
    return num(a._sum.debit) - num(a._sum.credit);
  };
  const invoice = (id: string) => db.clientInvoice.findUniqueOrThrow({ where: { id } });
  return { ...w, fin, fin2, boss, boss2, hr, clientId: first.clientId, jun, jul, aug, receive, ledger, invoice };
}

describe("a receipt across several invoices", () => {
  it("settles three invoices from one 10,000,000 receipt, in one journal, and the statement agrees with the ledger", async () => {
    const { t, fin, clientId, jun, jul, aug, receive, ledger, invoice } = await world();
    const r = await receive({ amount: 10_000_000, reference: "TRF-1", allocations: [{ invoiceId: jun.id, cash: 4_000_000 }, { invoiceId: jul.id, cash: 4_000_000 }, { invoiceId: aug.id, cash: 2_000_000 }] });
    expect(r.receiptNumber).toBe("RCT-000001");
    expect(r.invoiceId).toBeNull();
    expect([(await invoice(jun.id)).status, (await invoice(jul.id)).status, (await invoice(aug.id)).status]).toEqual(["PAID", "PAID", "PARTIALLY_PAID"]);
    expect(num((await invoice(aug.id)).amountPaid)).toBe(2_000_000);
    const journal = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, sourceType: "CLIENT_RECEIPT", sourceId: r.id }, include: { lines: true } });
    expect(journal.lines.map((l) => [l.accountCode, num(l.debit), num(l.credit)]).sort()).toEqual([["1200", 0, 10_000_000], ["1230", 10_000_000, 0]]);
    expect(await ledger("2192")).toBe(0); // nothing held
    const s = await clientStatement(fin, clientId, "2026-10-10");
    expect(s.closing).toBe(2_000_000);
    expect(s.closing).toBe(s.ledger); // the statement balance is the client's balance in the receivables account
    expect(s.advances).toBe(0);
    expect(await ledger("1200")).toBe(2_000_000);
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("splits tax the client withheld from cash: cash in, withholding receivable, receivables cleared at the gross", async () => {
    const { t, fin, jun, jul, receive, invoice } = await world();
    await expect(receive({ amount: 7_500_000, whtWithheld: 500_000, allocations: [{ invoiceId: jun.id, cash: 4_000_000 }, { invoiceId: jul.id, cash: 3_500_000, wht: 500_000 }] })).rejects.toThrow(/credit note or certificate number/);
    await expect(receive({ amount: 7_500_000, whtWithheld: 500_000, whtReference: "WHT-77", allocations: [{ invoiceId: jun.id, cash: 4_000_000 }, { invoiceId: jul.id, cash: 3_500_000 }] })).rejects.toThrow(/All of the tax withheld \(500000\.00\) has to be applied/);
    const r = await receive({ amount: 7_500_000, whtWithheld: 500_000, whtReference: "WHT-77", allocations: [{ invoiceId: jun.id, cash: 4_000_000 }, { invoiceId: jul.id, cash: 3_500_000, wht: 500_000 }] });
    const journal = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, sourceType: "CLIENT_RECEIPT", sourceId: r.id }, include: { lines: true } });
    expect(journal.lines.map((l) => [l.accountCode, num(l.debit), num(l.credit)]).sort()).toEqual([["1200", 0, 8_000_000], ["1220", 500_000, 0], ["1230", 7_500_000, 0]]);
    const jul2 = await invoice(jul.id);
    expect([jul2.status, num(jul2.amountPaid), num(jul2.totalDeductions)]).toEqual(["PAID", 3_500_000, 500_000]);
    expect(r.whtReference).toBe("WHT-77");
    expect(await findings(t.org.id)).toEqual([]);
    expect((await clientStatement(fin, r.clientId!, "2026-10-10")).lines.map((l) => l.type)).toContain("TAX_WITHHELD");
  });

  it("holds what isn't applied as an advance, applies it later, and refuses to over-apply", async () => {
    const { t, fin, boss, clientId, jun, jul, receive, ledger, invoice } = await world();
    const r = await receive({ amount: 5_000_000, allocations: [{ invoiceId: jun.id, cash: 3_000_000 }] });
    expect(await ledger("2192")).toBe(-2_000_000); // a liability: 2,000,000 held for the client
    const got = await getClientReceipt(fin, r.id);
    expect(got!.position).toMatchObject({ cashApplied: 3_000_000, cashLeft: 2_000_000, held: 2_000_000 });
    expect((await clientStatement(fin, clientId, "2026-10-10")).advances).toBe(2_000_000);
    await applyAdvance(fin, r.id, [{ invoiceId: jun.id, cash: 1_000_000, wht: 0 }, { invoiceId: jul.id, cash: 500_000, wht: 0 }], "2026-10-06");
    expect(num((await invoice(jun.id)).amountPaid)).toBe(4_000_000);
    expect((await invoice(jun.id)).status).toBe("PAID");
    expect(await ledger("2192")).toBe(-500_000);
    await expect(applyAdvance(fin, r.id, [{ invoiceId: jul.id, cash: 600_000, wht: 0 }])).rejects.toThrow(/more than the 500000\.00 the receipt has left/);
    await expect(applyAdvance(fin, r.id, [{ invoiceId: jun.id, cash: 100, wht: 0 }])).rejects.toThrow(/isn't open|more than/); // jun is paid in full
    await expect(applyAdvance(fin, r.id, [{ invoiceId: jul.id, cash: 100, wht: 0 }], "2026-09-01")).rejects.toThrow(/before the receipt date/);
    await applyAdvance(boss, r.id, [{ invoiceId: jul.id, cash: 500_000, wht: 0 }]);
    expect(await ledger("2192")).toBe(0);
    expect((await clientStatement(fin, clientId, "2026-10-10")).advances).toBe(0);
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("refunds an advance only when someone else approves, out of what is really held", async () => {
    const { t, fin, fin2, boss, boss2, clientId, jun, receive, ledger } = await world();
    const r = await receive({ amount: 5_000_000, allocations: [{ invoiceId: jun.id, cash: 3_000_000 }] }); // 2,000,000 held
    await expect(requestRefund(fin, r.id, { amount: 2_500_000, refundDate: "2026-10-08", reason: "Client asked for it back" })).rejects.toThrow(/Only 2000000\.00/);
    await expect(requestRefund(fin, r.id, { amount: 500_000, refundDate: "2026-10-08", reason: "short" })).rejects.toThrow(/Say why/);
    const req = await requestRefund(fin, r.id, { amount: 1_500_000, refundDate: "2026-10-08", method: "Transfer", reason: "Client asked for it back" });
    expect(req.refundNumber).toBe("RFD-000001");
    // the pending 1,500,000 counts as spent: only 500,000 more can be asked for, or applied
    await expect(requestRefund(fin2, r.id, { amount: 600_000, refundDate: "2026-10-08", reason: "Second request here" })).rejects.toThrow(/Only 500000\.00/);
    await expect(applyAdvance(fin, r.id, [{ invoiceId: jun.id, cash: 600_000, wht: 0 }])).rejects.toThrow();
    await expect(decideRefund(fin2, req.id, true)).rejects.toThrow(/permission/i);
    await expect(decideRefund(boss, req.id, false)).rejects.toThrow(/Say why/);
    const mine = await requestRefund(boss, r.id, { amount: 100_000, refundDate: "2026-10-08", reason: "Administrator's own request" });
    await expect(decideRefund(boss, mine.id, true)).rejects.toThrow(/You asked for this refund/);
    expect(await ledger("1230")).toBe(5_000_000); // nothing has gone out yet
    await decideRefund(boss2, req.id, true);
    expect(await ledger("1230")).toBe(3_500_000);
    expect(await ledger("2192")).toBe(-500_000);
    await expect(decideRefund(boss2, req.id, true)).rejects.toThrow(/already been decided/);
    await decideRefund(boss2, mine.id, false, "Not needed after all");
    expect((await clientStatement(fin, clientId, "2026-10-10")).advances).toBe(500_000);
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("takes an allocation back when it went to the wrong invoice, and applies it again", async () => {
    const { t, fin, jun, jul, receive, ledger, invoice } = await world();
    const r = await receive({ amount: 4_000_000, allocations: [{ invoiceId: jul.id, cash: 4_000_000 }] }); // meant for June
    const alloc = await db.receiptAllocation.findFirstOrThrow({ where: { receiptId: r.id } });
    await expect(reverseAllocation(fin, alloc.id, "short")).rejects.toThrow(/at least 10 characters/);
    await reverseAllocation(fin, alloc.id, "Applied to July by mistake; it was for June");
    expect((await invoice(jul.id)).status).toBe("ISSUED");
    expect(num((await invoice(jul.id)).amountPaid)).toBe(0);
    expect(await ledger("2192")).toBe(-4_000_000); // back with the receipt
    await expect(reverseAllocation(fin, alloc.id, "Trying to do it twice over")).rejects.toThrow(/already been reversed/);
    await applyAdvance(fin, r.id, [{ invoiceId: jun.id, cash: 4_000_000, wht: 0 }]);
    expect((await invoice(jun.id)).status).toBe("PAID");
    expect(await ledger("2192")).toBe(0);
    // the history stays: the reversed allocation is still on record
    expect((await getClientReceipt(fin, r.id))!.allocations.map((a) => !!a.reversedAt)).toEqual([true, false]);
    expect(await findings(t.org.id)).toEqual([]);
  });

  it("protects allocations in the database: no edit, no delete, only one reversal", async () => {
    const { receive, jun } = await world();
    const r = await receive({ amount: 1_000_000, allocations: [{ invoiceId: jun.id, cash: 1_000_000 }] });
    const alloc = await db.receiptAllocation.findFirstOrThrow({ where: { receiptId: r.id } });
    await expect(db.receiptAllocation.update({ where: { id: alloc.id }, data: { cashAmount: 1 } })).rejects.toThrow(/cannot be edited/);
    await expect(db.receiptAllocation.delete({ where: { id: alloc.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.$executeRawUnsafe(`UPDATE "ReceiptAllocation" SET "invoiceId" = "invoiceId" || 'x' WHERE id = '${alloc.id}'`)).rejects.toThrow();
  });

  it("refuses what doesn't add up: another client's or cancelled invoices, too much, a future date, a repeated reference, the wrong role", async () => {
    const { t, fin, hr, clientId, jun, jul, receive } = await world();
    await expect(receive({ amount: 1_000_000, receivedDate: "2999-01-01" })).rejects.toThrow(/future/);
    await expect(receive({ amount: 1_000_000, allocations: [{ invoiceId: jun.id, cash: 1_200_000 }] })).rejects.toThrow(/more than the 1000000\.00 the receipt has left/);
    await expect(receive({ amount: 5_000_000, allocations: [{ invoiceId: jun.id, cash: 4_500_000 }] })).rejects.toThrow(/more than the 4000000\.00 still owed/);
    await expect(receive({ amount: 1_000_000, allocations: [{ invoiceId: "nope", cash: 1_000_000 }] })).rejects.toThrow(/isn't open for this client/);
    await expect(receive({ amount: 1_000_000, allocations: [{ invoiceId: jun.id, cash: 500_000 }, { invoiceId: jun.id, cash: 500_000 }] })).rejects.toThrow(/appears twice/);
    await expect(receive({ amount: 1_000_000 }, hr)).rejects.toThrow(/permission/i);
    await receive({ amount: 1_000_000, reference: "TRF-9", allocations: [{ invoiceId: jun.id, cash: 1_000_000 }] });
    await expect(receive({ amount: 1_000_000, reference: "TRF-9", allocations: [{ invoiceId: jul.id, cash: 1_000_000 }] })).rejects.toThrow(/already recorded/);
    expect((await openInvoicesFor(fin, clientId)).map((i) => i.balance)).toEqual([3_000_000, 4_000_000, 4_000_000]);
    // a different client's invoice is not open to this client
    const alien = await db.client.create({ data: { organizationId: t.org.id, code: "ALIEN", name: "Another client" } });
    await expect(recordClientReceipt(fin, { clientId: alien.id, amount: 1_000_000, receivedDate: "2026-10-05", allocations: [{ invoiceId: jun.id, cash: 1_000_000 }] })).rejects.toThrow(/isn't open for this client/);
  });
});

describe("statements and ageing", () => {
  it("lists invoices and settlements in date order with a running balance, as at any date", async () => {
    const { fin, clientId, jun, jul, receive } = await world();
    await receive({ amount: 6_000_000, receivedDate: "2026-08-15", allocations: [{ invoiceId: jun.id, cash: 4_000_000 }, { invoiceId: jul.id, cash: 2_000_000 }] });
    const s = await clientStatement(fin, clientId, "2026-10-10");
    expect(s.lines.map((l) => [l.type, l.debit, l.credit, l.balance])).toEqual([
      ["INVOICE", 4_000_000, 0, 4_000_000], // 30 Jun
      ["INVOICE", 4_000_000, 0, 8_000_000], // 31 Jul
      ["RECEIPT", 0, 4_000_000, 4_000_000], // 15 Aug (the receipt is dated 15 Aug)
      ["RECEIPT", 0, 2_000_000, 2_000_000],
      ["INVOICE", 4_000_000, 0, 6_000_000], // 31 Aug
    ]);
    expect(s.closing).toBe(6_000_000);
    // as at the end of July the receipt hadn't happened and August hadn't been billed
    const july = await clientStatement(fin, clientId, "2026-07-31");
    expect([july.closing, july.lines.length]).toEqual([8_000_000, 2]);
    expect(july.closing).toBe(july.ledger);
    await expect(clientStatement(fin, "nope", "2026-10-10")).rejects.toThrow(/Client not found/);
  });

  it("ages what is owed by days past the due date, and the buckets add up to the balance", async () => {
    const { fin, clientId, jun, receive } = await world();
    await receive({ amount: 1_000_000, receivedDate: "2026-07-01", allocations: [{ invoiceId: jun.id, cash: 1_000_000 }] });
    const s = await clientStatement(fin, clientId, "2026-10-10");
    // June (due 30 Jul, 72 days) owes 3,000,000; July (due 30 Aug, 41 days) and August (due 30 Sep, 10 days) 4,000,000 each
    expect(s.ageing).toEqual({ "Not yet due": 0, "1–30 days": 4_000_000, "31–60 days": 4_000_000, "61–90 days": 3_000_000, "Over 90 days": 0 });
    expect(Object.values(s.ageing).reduce((a, b) => a + b, 0)).toBe(s.closing);
    const early = await clientStatement(fin, clientId, "2026-07-15");
    expect(early.ageing["Not yet due"]).toBe(early.closing);
    const all = await receivablesAgeing(fin, "2026-10-10");
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ clientId, closing: 11_000_000, ledger: 11_000_000 });
  });

  it("nets advances against what is owed, and exports to CSV", async () => {
    const { fin, clientId, receive } = await world();
    await receive({ amount: 2_000_000 }); // held entirely as an advance
    const s = await clientStatement(fin, clientId, "2026-10-10");
    expect([s.closing, s.advances, s.net]).toEqual([12_000_000, 2_000_000, 10_000_000]);
    const csv = statementCsv("Test client", s.asOf, s);
    expect(csv).toMatch(/"Closing balance",,,,,,12000000\.00/);
    expect(csv).toMatch(/"Net owed",,,,,,10000000\.00/);
    expect(csv.split("\r\n").filter((l) => l.startsWith('"2026-')).length).toBe(3);
  });

  it("is per organization and needs the right permission", async () => {
    const mine = await world();
    const other = await world();
    expect(await listClientReceipts(other.fin)).toEqual([]);
    await mine.receive({ amount: 1_000_000 });
    expect((await listClientReceipts(mine.fin)).map((r) => r.position.held)).toEqual([1_000_000]);
    await expect(clientStatement(other.fin, mine.clientId, "2026-10-10")).rejects.toThrow(/Client not found/);
    await expect(clientStatement(mine.t.ctx("EMPLOYEE"), mine.clientId, "2026-10-10")).rejects.toThrow(/permission/i);
  });
});
