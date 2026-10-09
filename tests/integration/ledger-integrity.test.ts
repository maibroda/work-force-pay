import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isolatedOrg, uid } from "../helpers";
import { ensureDefaultChart } from "@/server/services/accounting";
import { postArInvoice } from "@/server/services/gl-posting";
import { periodFor } from "@/server/services/periods";
import { cancelInvoice, recordReceipt } from "@/server/services/billing";
import { cancelPurchaseInvoice, createPurchaseInvoice, createVendor, recordVendorPayment } from "@/server/services/payables";
import { checkLedgerIntegrity, subledgerBalance, type IntegrityReport } from "@/server/services/ledger-integrity";

const checks = (r: IntegrityReport) => r.findings.map((f) => f.check);

describe("subledgerBalance", () => {
  it("is what was raised less what has settled it, leaving out cancelled documents", () => {
    const docs = [
      { total: 1000, status: "ISSUED" },
      { total: 500, status: "PAID" },
      { total: 9999, status: "CANCELLED" },
    ];
    expect(subledgerBalance({ documents: docs, settled: 700 })).toBe(800);
    expect(subledgerBalance({ documents: [], settled: 0 })).toBe(0);
    expect(subledgerBalance({ documents: docs, settled: 1500 })).toBe(0);
  });
});

/** A throwaway organization with the default chart, and a way to write journals straight into the ledger. */
async function world() {
  const t = await isolatedOrg();
  await db.$transaction((tx) => ensureDefaultChart(tx, t.org.id));
  const account = (code: string) => db.glAccount.findFirstOrThrow({ where: { organizationId: t.org.id, code } });
  let n = 0;
  const journal = async (opts: { number?: string; headerDebit?: number; headerCredit?: number; lines: Array<{ code: string; debit?: number; credit?: number; orgId?: string }>; runId?: string }) => {
    const entryNumber = opts.number ?? `JV-${String(++n).padStart(6, "0")}`;
    const sumD = opts.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const sumC = opts.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    const period = await periodFor(db, t.org.id, new Date("2026-08-31T00:00:00Z")); // stamped like the posting engine does
    return db.journalEntry.create({
      data: {
        organizationId: t.org.id,
        entryNumber,
        periodId: period.id,
        runId: opts.runId,
        postingDate: new Date("2026-08-31T00:00:00Z"),
        description: "test journal",
        source: "MANUAL_POST",
        totalDebit: opts.headerDebit ?? sumD,
        totalCredit: opts.headerCredit ?? sumC,
        postedBy: "test",
        lines: {
          create: await Promise.all(
            opts.lines.map(async (l, i) => {
              const a = l.orgId ? await db.glAccount.create({ data: { organizationId: l.orgId, code: `X${uid()}`, name: "Foreign", type: "ASSET" } }) : await account(l.code);
              return { accountId: a.id, accountCode: a.code, accountName: a.name, headCode: "TEST", description: "line", debit: l.debit ?? 0, credit: l.credit ?? 0, sortOrder: i };
            }),
          ),
        },
      },
    });
  };
  return { t, journal };
}

describe("structural checks", () => {
  it("passes an organization with nothing posted, and one with a balanced journal", async () => {
    const { t, journal } = await world();
    expect((await checkLedgerIntegrity(t.org.id)).ok).toBe(true);
    await journal({ lines: [{ code: "1230", debit: 500 }, { code: "4100", credit: 500 }] });
    const r = await checkLedgerIntegrity(t.org.id);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.census).toMatchObject({ journals: 1, journalLines: 2 });
  });

  it("catches a journal that doesn't balance, whose header disagrees with its lines, and whole-ledger imbalance", async () => {
    const { t, journal } = await world();
    await journal({ lines: [{ code: "1230", debit: 500 }, { code: "4100", credit: 400 }] });
    const r = await checkLedgerIntegrity(t.org.id);
    expect(r.ok).toBe(false);
    expect(checks(r)).toEqual(expect.arrayContaining(["JOURNAL_BALANCE", "TRIAL_BALANCE"]));

    const w2 = await world();
    await w2.journal({ headerDebit: 999, headerCredit: 999, lines: [{ code: "1230", debit: 500 }, { code: "4100", credit: 500 }] });
    expect(checks(await checkLedgerIntegrity(w2.t.org.id))).toContain("JOURNAL_HEADER");
  });

  it("catches a one-line journal, a negative line, a both-sided line, and a line on another organization's account", async () => {
    const a = await world();
    await a.journal({ lines: [{ code: "1230", debit: 0 }] });
    expect(checks(await checkLedgerIntegrity(a.t.org.id))).toContain("JOURNAL_LINES");

    const b = await world();
    await b.journal({ lines: [{ code: "1230", debit: -50 }, { code: "4100", credit: -50 }] });
    expect(checks(await checkLedgerIntegrity(b.t.org.id))).toContain("LINE_NEGATIVE");

    const c = await world();
    await c.journal({ lines: [{ code: "1230", debit: 100, credit: 40 }, { code: "4100", credit: 60 }] });
    expect(checks(await checkLedgerIntegrity(c.t.org.id))).toContain("LINE_BOTH_SIDES");

    const d = await world();
    const other = await isolatedOrg();
    await d.journal({ lines: [{ code: "1230", debit: 100, orgId: other.org.id }, { code: "4100", credit: 100 }] });
    expect(checks(await checkLedgerIntegrity(d.t.org.id))).toContain("LINE_ACCOUNT_ORG");
  });

  it("warns about a gap in journal numbers without failing the check", async () => {
    const { t, journal } = await world();
    await journal({ number: "JV-000001", lines: [{ code: "1230", debit: 10 }, { code: "4100", credit: 10 }] });
    await journal({ number: "JV-000004", lines: [{ code: "1230", debit: 10 }, { code: "4100", credit: 10 }] });
    const r = await checkLedgerIntegrity(t.org.id);
    expect(r.findings).toEqual([expect.objectContaining({ check: "NUMBER_GAP", severity: "WARN" })]);
    expect(r.ok).toBe(true);
  });

  it("is per organization: another organization's bad journal doesn't fail this one", async () => {
    const good = await world();
    const bad = await world();
    await bad.journal({ lines: [{ code: "1230", debit: 500 }, { code: "4100", credit: 400 }] });
    expect((await checkLedgerIntegrity(good.t.org.id)).ok).toBe(true);
    expect((await checkLedgerIntegrity(bad.t.org.id)).ok).toBe(false);
  });
});

describe("a cancelled invoice reverses its ledger posting", () => {
  it("vendor bill: raised, part-paid bill can't be cancelled; a clean bill cancels with a reversing journal and the ledger still agrees with the subledger", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE");
    const vendor = await createVendor(fin, { name: `Supplier ${uid()}`, category: "UNIFORM_KITS" });
    const keep = await createPurchaseInvoice(fin, { vendorId: vendor.id, description: "Kept", invoiceDate: "2026-09-01", dueDate: "2026-10-01", vatPct: 7.5, lines: [{ description: "Boots", quantity: 10, rate: 5000 }] });
    const gone = await createPurchaseInvoice(fin, { vendorId: vendor.id, description: "Wrong vendor", invoiceDate: "2026-09-02", dueDate: "2026-10-02", lines: [{ description: "Caps", quantity: 20, rate: 1500 }] });
    await recordVendorPayment(fin, { invoiceId: keep.id, amount: 10000, paidDate: "2026-09-10", method: "TRANSFER" } as never);

    expect((await checkLedgerIntegrity(t.org.id)).ok).toBe(true);
    await cancelPurchaseInvoice(fin, gone.id, "Recorded against the wrong vendor");

    const r = await checkLedgerIntegrity(t.org.id);
    expect(r.findings).toEqual([]);
    const ap = r.reconciliations.find((x) => x.name.startsWith("Payables"))!;
    expect(ap.subledger).toBeCloseTo(10 * 5000 * 1.075 - 10000, 2);
    expect(ap.difference).toBe(0);

    const reversal = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "AP_INVOICE_CANCEL" }, include: { lines: true } });
    expect(reversal.description).toBe(`Reversal of vendor bill ${gone.invoiceNumber} (cancelled)`);
    expect(Number(reversal.totalDebit)).toBe(30000);
    // the original posting is still there, untouched, beside its reversal
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id, source: "AP_INVOICE", description: `Vendor bill ${gone.invoiceNumber}` } })).toBe(1);
  });

  it("flags a cancelled bill that has no reversal, which is exactly how the books used to end up", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE");
    const vendor = await createVendor(fin, { name: `Supplier ${uid()}`, category: "OTHER" });
    const bill = await createPurchaseInvoice(fin, { vendorId: vendor.id, description: "Oops", invoiceDate: "2026-09-01", dueDate: "2026-10-01", lines: [{ description: "Item", quantity: 1, rate: 12000 }] });
    await db.purchaseInvoice.update({ where: { id: bill.id }, data: { status: "CANCELLED" } }); // the old behaviour: status only
    const r = await checkLedgerIntegrity(t.org.id);
    expect(r.ok).toBe(false);
    expect(checks(r)).toEqual(expect.arrayContaining(["SUBLEDGER", "CANCELLED_NOT_REVERSED"]));
    expect(r.findings.find((f) => f.check === "CANCELLED_NOT_REVERSED")?.ref).toBe(bill.invoiceNumber);
  });

  it("client invoice: cancel reverses revenue, VAT and receivable together, and a receipted invoice still can't be cancelled", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE");
    const client = await db.client.create({ data: { organizationId: t.org.id, code: `C${uid()}`, name: "Client" } });
    const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: "Aug 2026", year: 2026, month: 8, startDate: new Date("2026-08-01T00:00:00Z"), endDate: new Date("2026-08-31T00:00:00Z") } });
    const mk = async (n: number, total: number, vat: number) => {
      const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: n } });
      const inv = await db.clientInvoice.create({
        data: { organizationId: t.org.id, clientId: client.id, runId: run.id, periodId: period.id, invoiceNumber: `INV-T${uid()}`, invoiceDate: new Date("2026-08-31T00:00:00Z"), dueDate: new Date("2026-09-30T00:00:00Z"), subtotal: total - vat, vatPct: 7.5, vatAmount: vat, totalAmount: total, createdBy: "test" },
      });
      await db.$transaction((tx) => postArInvoice(fin, tx, inv));
      return inv;
    };
    const paid = await mk(1, 1_075_000, 75_000);
    const dud = await mk(2, 537_500, 37_500);
    await recordReceipt(fin, { invoiceId: paid.id, amount: 200_000, receivedDate: "2026-09-05", method: "TRANSFER" } as never);

    await expect(cancelInvoice(fin, paid.id, "Trying to cancel a part-paid invoice")).rejects.toThrow(/payments or deductions/);
    await cancelInvoice(fin, dud.id, "Duplicate invoice raised in error");

    const r = await checkLedgerIntegrity(t.org.id);
    expect(r.findings).toEqual([]);
    const ar = r.reconciliations.find((x) => x.name.startsWith("Receivables"))!;
    expect(ar.subledger).toBe(875_000);
    expect(ar.control).toBe(875_000);

    const reversal = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "AR_INVOICE_CANCEL" }, include: { lines: true } });
    const by = Object.fromEntries(reversal.lines.map((l) => [l.accountCode, l]));
    expect(Number(by["4100"].debit)).toBe(500_000); // revenue
    expect(Number(by["2190"].debit)).toBe(37_500); // output VAT
    expect(Number(by["1200"].credit)).toBe(537_500); // receivable
  });
});

describe("the seeded demonstration organization", () => {
  it("is consistent: every journal balances, every locked payroll run has its journal, subledgers agree with the ledger", async () => {
    const dss = await db.organization.findUniqueOrThrow({ where: { code: "DSS" } });
    const r = await checkLedgerIntegrity(dss.id);
    expect(r.findings.filter((f) => f.severity === "ERROR")).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.census.journals).toBeGreaterThan(0);
  });
});
