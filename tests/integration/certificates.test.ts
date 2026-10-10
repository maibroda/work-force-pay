import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { billingWorld } from "../billing-fixture";
import { generateInvoices, recordDeduction } from "@/server/services/billing";
import { recordClientReceipt } from "@/server/services/receipts";
import { certificateReconciliation, listCertificates, registerCertificate, voidCertificate } from "@/server/services/certificates";

/** One client billed 4,000,000 in each of June and July 2026, with no VAT, so each invoice is 4,000,000. */
async function world() {
  const w = await billingWorld();
  const fin = w.t.ctx("FINANCE", null, 1);
  const hr = w.t.ctx("HR_ADMIN", null, 1);
  const first = await w.addCharge(await w.newRun(2026, 6), 4_000_000);
  await w.addCharge(await w.newRun(2026, 7), 4_000_000, first);
  const runs = await db.payrollRun.findMany({ where: { organizationId: w.t.org.id }, orderBy: { period: { month: "asc" } } });
  for (const r of runs) await generateInvoices(fin, r.id, { vatPct: 0, whtPct: 5 });
  const [jun, jul] = await db.clientInvoice.findMany({ where: { organizationId: w.t.org.id }, orderBy: { invoiceDate: "asc" } });
  const withheld = (amount: number, ref: string, over: Record<string, unknown> = {}) =>
    recordClientReceipt(fin, { clientId: first.clientId, amount: 4_000_000 - amount, receivedDate: "2026-10-05", whtWithheld: amount, whtReference: ref, allocations: [{ invoiceId: jun.id, cash: 4_000_000 - amount, wht: amount }], ...over } as never);
  const cert = (over: Record<string, unknown> = {}, ctx = fin) =>
    registerCertificate(ctx, { clientId: first.clientId, certificateNumber: "WHT-77", issueDate: "2026-10-01", receivedDate: "2026-10-08", amount: 200_000, document: "Scans/2026/WHT-77.pdf", ...over } as never);
  const rows = async (ctx = fin) => (await certificateReconciliation(ctx)).rows;
  return { ...w, fin, hr, clientId: first.clientId, jun, jul, withheld, cert, rows };
}

describe("registering a certificate", () => {
  it("records the evidence once, refusing a repeat of the same number for the client, however it is written", async () => {
    const { fin, hr, cert, clientId } = await world();
    const c = await cert();
    expect(c.numberKey).toBe("WHT77");
    await expect(cert({ certificateNumber: "wht 77" })).rejects.toThrow(/already on the register/);
    await expect(cert({}, hr)).rejects.toThrow(/permission/i);
    await expect(cert({ certificateNumber: "WHT-78", receivedDate: "2026-09-01" })).rejects.toThrow(/before it was issued/);
    await expect(cert({ certificateNumber: "WHT-78", receivedDate: "2999-01-01", issueDate: "2999-01-01" })).rejects.toThrow(/future/);
    await expect(cert({ certificateNumber: "WHT-78", amount: 0 })).rejects.toThrow(/greater than zero/);
    await expect(cert({ certificateNumber: "--", })).rejects.toThrow();
    await expect(cert({ clientId: "nope", certificateNumber: "WHT-79" })).rejects.toThrow(/Client not found/);
    expect((await listCertificates(fin, { clientId })).map((x) => x.certificateNumber)).toEqual(["WHT-77"]);
  });

  it("is evidence the database protects: no edit, no delete, voided once with a reason", async () => {
    const { fin, cert } = await world();
    const c = await cert();
    await expect(db.taxCertificate.update({ where: { id: c.id }, data: { amount: 1 } })).rejects.toThrow(/cannot be edited/);
    await expect(db.taxCertificate.update({ where: { id: c.id }, data: { certificateNumber: "WHT-99" } })).rejects.toThrow(/cannot be edited/);
    await expect(db.taxCertificate.delete({ where: { id: c.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.$executeRawUnsafe(`UPDATE "TaxCertificate" SET amount = 1 WHERE id = '${c.id}'`)).rejects.toThrow(/cannot be edited/);
    await expect(voidCertificate(fin, c.id, "short")).rejects.toThrow(/at least 10 characters/);
    await voidCertificate(fin, c.id, "Entered with the wrong amount, to be re-entered");
    await expect(voidCertificate(fin, c.id, "Trying to void it a second time")).rejects.toThrow(/already been voided/);
    await expect(db.taxCertificate.update({ where: { id: c.id }, data: { voidReason: "changed" } })).rejects.toThrow(/only be voided once/);
    expect(await listCertificates(fin)).toEqual([]); // voided ones are hidden
    expect((await listCertificates(fin, { includeVoided: true })).map((x) => !!x.voidedAt)).toEqual([true]);
    // and the number can be entered again
    expect((await cert({ amount: 250_000 })).certificateNumber).toBe("WHT-77");
  });
});

describe("matching certificates to the tax clients withheld", () => {
  it("is matched when the certificate covers exactly what a receipt recorded under that number", async () => {
    const { fin, withheld, cert, rows } = await world();
    await withheld(200_000, "WHT-77");
    expect((await rows()).map((r) => [r.label, r.withheld, r.certified, r.status])).toEqual([["WHT-77", 200_000, 0, "MISSING"]]); // withheld, no certificate yet
    await cert({ amount: 200_000 });
    const r = await rows();
    expect(r.map((x) => [x.label, x.withheld, x.certified, x.difference, x.status])).toEqual([["WHT-77", 200_000, 200_000, 0, "MATCHED"]]);
    expect(r[0].sources).toEqual([expect.stringMatching(/^Receipt RCT-/)]);
    const t = (await certificateReconciliation(fin)).totals;
    expect(t).toMatchObject({ withheld: 200_000, certified: 200_000, uncertified: 0, ledger: 200_000 }); // account 1220 agrees with what was recorded
  });

  it("matches however the number is written, and says when the certificate is short or over", async () => {
    const { withheld, cert, rows } = await world();
    await withheld(200_000, "wht 77");
    await cert({ certificateNumber: "WHT-77", amount: 150_000 });
    expect((await rows())[0]).toMatchObject({ label: "WHT-77", status: "CERT_SHORT", difference: -50_000 });
    await cert({ certificateNumber: "WHT-77/B", amount: 300_000 });
    const r = await rows();
    expect(r.find((x) => x.label === "WHT-77/B")).toMatchObject({ status: "NOT_RECORDED", withheld: 0, certified: 300_000 });
  });

  it("reports a certificate larger than what was recorded", async () => {
    const { withheld, cert, rows } = await world();
    await withheld(100_000, "WHT-5");
    await cert({ certificateNumber: "WHT-5", amount: 120_000 });
    expect((await rows())[0]).toMatchObject({ status: "CERT_EXCEEDS", difference: 20_000 });
  });

  it("counts a withholding deduction on an invoice by the document reference it quoted", async () => {
    const { fin, jul, cert, rows } = await world();
    await recordDeduction(fin, { invoiceId: jul.id, type: "WITHHOLDING_TAX", amount: 200_000, reason: "Tax withheld by the client at 5%", supportingDocument: "WHT 41" });
    expect((await rows())[0]).toMatchObject({ withheld: 200_000, status: "MISSING" });
    await cert({ certificateNumber: "WHT-41", amount: 200_000 });
    expect((await rows())[0]).toMatchObject({ status: "MATCHED", sources: [expect.stringMatching(/Deduction on INV-/)] });
  });

  it("adds up the tax withheld under one number across receipts, and treats a voided certificate as not received", async () => {
    const { fin, jun, jul, clientId, cert, rows } = await world();
    await recordClientReceipt(fin, { clientId, amount: 3_900_000, receivedDate: "2026-10-05", whtWithheld: 100_000, whtReference: "WHT-9", allocations: [{ invoiceId: jun.id, cash: 3_900_000, wht: 100_000 }] } as never);
    await recordClientReceipt(fin, { clientId, amount: 3_900_000, receivedDate: "2026-10-06", whtWithheld: 100_000, whtReference: "WHT 9", allocations: [{ invoiceId: jul.id, cash: 3_900_000, wht: 100_000 }] } as never);
    const c = await cert({ certificateNumber: "WHT-9", amount: 200_000 });
    expect((await rows())[0]).toMatchObject({ withheld: 200_000, certified: 200_000, status: "MATCHED" });
    await voidCertificate(fin, c.id, "The certificate was for another client");
    expect((await rows())[0]).toMatchObject({ certified: 0, status: "MISSING" });
    expect((await certificateReconciliation(fin)).totals.uncertified).toBe(200_000);
  });
});

describe("per organization", () => {
  it("keeps one organization's certificates and reconciliation from another's", async () => {
    const mine = await world();
    const other = await world();
    await mine.withheld(200_000, "WHT-77");
    await mine.cert();
    expect(await listCertificates(other.fin)).toEqual([]);
    expect((await certificateReconciliation(other.fin)).rows).toEqual([]);
    await expect(registerCertificate(other.fin, { clientId: mine.clientId, certificateNumber: "WHT-77", issueDate: "2026-10-01", receivedDate: "2026-10-08", amount: 1 } as never)).rejects.toThrow(/Client not found/);
    await expect(voidCertificate(other.fin, (await listCertificates(mine.fin))[0].id, "Not theirs to void at all")).rejects.toThrow(/Certificate not found/);
  });
});
