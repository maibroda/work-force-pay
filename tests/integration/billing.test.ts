import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num, round2 } from "@/lib/money";
import {
  cancelInvoice,
  generateInvoices,
  getInvoice,
  listInvoices,
  receivablesSummary,
  recordDeduction,
  recordReceipt,
  unbilledRuns,
} from "@/server/services/billing";
import { contractProfitability, payrollByContractAndCategory } from "@/server/services/reports";
import { ctxFor, periodFor } from "../helpers";

describe("client billing / invoicing", () => {
  it("generates one invoice per billed client with category (Guard/Supervisor/…) lines split direct/indirect, VAT on indirect only, and expected WHT", async () => {
    const fin = await ctxFor("FINANCE");
    const auditor = await ctxFor("AUDITOR");
    const july = await periodFor(fin, 2026, 7);
    const run = await db.payrollRun.findFirstOrThrow({ where: { periodId: july.id, type: "REGULAR" } });

    await expect(generateInvoices(auditor, run.id)).rejects.toThrow(); // read-only role, no payment.manage
    await expect(
      generateInvoices(fin, run.id, { directChargePct: 60, indirectChargePct: 50 }),
    ).rejects.toThrow(/add up to 100/);
    const invoices = await generateInvoices(fin, run.id, { vatPct: 7.5, whtPct: 5 }); // direct/indirect default 90/10
    expect(invoices.length).toBeGreaterThan(0);

    const byContract = await payrollByContractAndCategory(fin, run.id);
    const revenueByClient = new Map<string, number>();
    for (const c of byContract)
      revenueByClient.set(c.clientId, (revenueByClient.get(c.clientId) ?? 0) + c.revenue);

    for (const inv of invoices) {
      const expectedSubtotal = revenueByClient.get(inv.clientId)!;
      expect(num(inv.subtotal)).toBeCloseTo(expectedSubtotal, 2);
      expect(num(inv.directChargePct)).toBe(90);
      expect(num(inv.indirectChargePct)).toBe(10);
      expect(num(inv.totalDirectCharge) + num(inv.totalIndirectCharge)).toBeCloseTo(expectedSubtotal, 0);
      expect(num(inv.totalDirectCharge)).toBeCloseTo(round2(expectedSubtotal * 0.9), 0);
      expect(num(inv.totalIndirectCharge)).toBeCloseTo(round2(expectedSubtotal * 0.1), 0);
      // VAT is on the indirect charge total only, not on the full subtotal
      expect(num(inv.vatPct)).toBe(7.5);
      expect(num(inv.vatAmount)).toBeCloseTo(round2(num(inv.totalIndirectCharge) * 0.075), 2);
      expect(num(inv.vatAmount)).toBeLessThan(round2(expectedSubtotal * 0.075)); // far less than VAT-on-everything would be
      expect(num(inv.totalAmount)).toBeCloseTo(round2(expectedSubtotal + num(inv.vatAmount)), 1);
      expect(num(inv.whtPct)).toBe(5);
      expect(num(inv.whtAmount)).toBeCloseTo(round2(expectedSubtotal * 0.05), 2);
      expect(num(inv.amountPaid)).toBe(0);
      expect(num(inv.totalDeductions)).toBe(0);
      expect(inv.status).toBe("ISSUED");
      expect(inv.invoiceNumber).toMatch(/^INV-\d{6}$/);
    }

    // idempotent guard — never double-bill a run
    await expect(generateInvoices(fin, run.id)).rejects.toThrow(/already exist/);
    expect((await unbilledRuns(fin)).some((r) => r.id === run.id)).toBe(false);

    const full = await getInvoice(fin, invoices[0].id);
    expect(full!.lines.length).toBeGreaterThan(0);
    const lineSum = full!.lines.reduce((a, l) => a + num(l.amount), 0);
    expect(lineSum).toBeCloseTo(num(full!.subtotal), 2);
    for (const l of full!.lines) {
      expect(l.headcount).toBeGreaterThan(0);
      expect(num(l.rate)).toBeGreaterThan(0);
      // quantity × rate reconciles exactly to the line amount (rate is the blended/effective rate)
      expect(round2(l.headcount * num(l.rate))).toBeCloseTo(num(l.amount), 0);
      expect(l.description.length).toBeGreaterThan(0);
      // direct + indirect reconciles to the line amount at 90/10
      expect(round2(num(l.directCharge) + num(l.indirectCharge))).toBeCloseTo(num(l.amount), 2);
      expect(num(l.directCharge)).toBeCloseTo(round2(num(l.amount) * 0.9), 1);
    }
  });

  it("records partial and full payments, updates status, and rejects overpayment", async () => {
    const fin = await ctxFor("FINANCE");
    const inv = await db.clientInvoice.findFirstOrThrow({ where: { organizationId: fin.orgId } });
    const total = num(inv.totalAmount);
    const half = Math.round((total / 2) * 100) / 100;

    await expect(
      recordReceipt(fin, { invoiceId: inv.id, amount: total + 1000, receivedDate: "2026-08-05" }),
    ).rejects.toThrow(/exceeds the outstanding balance/);

    await recordReceipt(fin, {
      invoiceId: inv.id,
      amount: half,
      receivedDate: "2026-08-05",
      method: "Bank transfer",
      reference: "TRF-001",
    });
    let updated = await getInvoice(fin, inv.id);
    expect(updated!.status).toBe("PARTIALLY_PAID");
    expect(num(updated!.amountPaid)).toBeCloseTo(half, 2);

    await recordReceipt(fin, {
      invoiceId: inv.id,
      amount: num(updated!.totalAmount) - num(updated!.amountPaid),
      receivedDate: "2026-08-20",
    });
    updated = await getInvoice(fin, inv.id);
    expect(updated!.status).toBe("PAID");
    expect(num(updated!.amountPaid)).toBeCloseTo(total, 2);
    expect(updated!.receipts).toHaveLength(2);

    // a fully paid invoice can no longer be cancelled or take a receipt
    await expect(cancelInvoice(fin, inv.id, "changed my mind")).rejects.toThrow(/payments or deductions/);
    await expect(
      recordReceipt(fin, { invoiceId: inv.id, amount: 100, receivedDate: "2026-08-21" }),
    ).rejects.toThrow(/exceeds/);
  });

  it("records a justified, evidenced deduction (WHT or other) which reduces the balance and can bring an invoice to PAID", async () => {
    const fin = await ctxFor("FINANCE");
    const inv = await db.clientInvoice.findFirstOrThrow({
      where: { organizationId: fin.orgId, status: "ISSUED" },
    });
    const total = num(inv.totalAmount);
    const wht = round2(num(inv.whtAmount));
    expect(wht).toBeGreaterThan(0);

    // reason and supporting document are both mandatory
    await expect(
      recordDeduction(fin, {
        invoiceId: inv.id,
        type: "WITHHOLDING_TAX",
        amount: wht,
        reason: "short",
        supportingDocument: "WHT-001",
      }),
    ).rejects.toThrow(/justification/);
    await expect(
      recordDeduction(fin, {
        invoiceId: inv.id,
        type: "WITHHOLDING_TAX",
        amount: wht,
        reason: "Withholding tax deducted per client's WHT credit note",
        supportingDocument: "",
      }),
    ).rejects.toThrow(/supporting document/);

    await recordDeduction(fin, {
      invoiceId: inv.id,
      type: "WITHHOLDING_TAX",
      amount: wht,
      reason: "Withholding tax deducted per client's WHT credit note",
      supportingDocument: "WHT-CREDIT-2026-0001",
    });
    let updated = await getInvoice(fin, inv.id);
    expect(num(updated!.totalDeductions)).toBeCloseTo(wht, 2);
    expect(updated!.status).toBe("PARTIALLY_PAID");
    expect(updated!.deductions).toHaveLength(1);
    expect(updated!.deductions[0].type).toBe("WITHHOLDING_TAX");

    // a second, justified deduction (e.g. an agreed leave-allowance credit) for the rest of the balance
    const remaining = round2(total - wht);
    await recordDeduction(fin, {
      invoiceId: inv.id,
      type: "LEAVE_ALLOWANCE",
      amount: remaining,
      reason: "Agreed leave-allowance credit per contract addendum",
      supportingDocument: "ADDENDUM-2026-07",
    });
    updated = await getInvoice(fin, inv.id);
    expect(updated!.status).toBe("PAID");
    expect(num(updated!.totalDeductions)).toBeCloseTo(total, 2);
    expect(num(updated!.amountPaid)).toBe(0); // no cash changed hands

    // exceeding the remaining balance is rejected, same as an over-large receipt
    await expect(
      recordDeduction(fin, {
        invoiceId: inv.id,
        type: "OTHER",
        amount: 1,
        reason: "Should not be accepted — invoice is already settled",
        supportingDocument: "N/A",
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it("cancelling an invoice with no receipts or deductions needs a reason and is excluded from receivables", async () => {
    const fin = await ctxFor("FINANCE");
    const inv = await db.clientInvoice.findFirstOrThrow({
      where: { organizationId: fin.orgId, amountPaid: 0, totalDeductions: 0, status: "ISSUED" },
    });
    await expect(cancelInvoice(fin, inv.id, "")).rejects.toThrow(/reason/);
    await cancelInvoice(fin, inv.id, "Duplicate invoice raised in error");
    const after = await getInvoice(fin, inv.id);
    expect(after!.status).toBe("CANCELLED");
    const summary = await receivablesSummary(fin);
    const clientRow = summary.rows.find((r) => r.clientName === after!.client.name);
    // the cancelled invoice must not inflate what that client is billed/owes
    const stillCounted = await listInvoices(fin, { clientId: after!.clientId });
    const nonCancelledTotal = stillCounted
      .filter((i) => i.status !== "CANCELLED")
      .reduce((a, i) => a + num(i.totalAmount), 0);
    if (clientRow) expect(clientRow.billed).toBeCloseTo(nonCancelledTotal, 2);
  });

  it("receivables summary totals reconcile to billed minus received minus deducted", async () => {
    const fin = await ctxFor("FINANCE");
    const summary = await receivablesSummary(fin);
    for (const r of summary.rows) expect(r.outstanding).toBeCloseTo(r.billed - r.received - r.deducted, 2);
    expect(summary.totals.outstanding).toBeCloseTo(
      summary.totals.billed - summary.totals.received - summary.totals.deducted,
      2,
    );
    expect(summary.totals.deducted).toBeGreaterThan(0); // from the WHT/leave-allowance deductions above
    expect(summary.totals.overdue).toBeLessThanOrEqual(summary.totals.outstanding + 0.01);
  });
});

describe("contract profitability", () => {
  it("revenue, cost and other costs reconcile to gross/net contribution, with a flat back-office overhead", async () => {
    const fin = await ctxFor("FINANCE");
    const july = await periodFor(fin, 2026, 7);
    const run = await db.payrollRun.findFirstOrThrow({ where: { periodId: july.id, type: "REGULAR" } });
    const rows = await contractProfitability(fin, run.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const c of rows) {
      expect(c.totalDirectCost).toBeCloseTo(c.cost, 2);
      expect(c.totalOtherCost).toBeCloseTo(c.otherCosts, 2);
      expect(c.totalCost).toBeCloseTo(round2(c.cost + c.otherCosts), 2);
      expect(c.grossContribution).toBeCloseTo(round2(c.revenue - c.cost - c.otherCosts), 2);
      expect(c.backOfficeCharges).toBeCloseTo(round2((c.revenue * c.backOfficeChargePct) / 100), 2);
      expect(c.totalCostInclBackOffice).toBeCloseTo(round2(c.cost + c.otherCosts + c.backOfficeCharges), 2);
      expect(c.netContribution).toBeCloseTo(round2(c.grossContribution - c.backOfficeCharges), 2);
      if (c.revenue) {
        expect(c.grossContributionPct).toBeCloseTo(round2((c.grossContribution / c.revenue) * 100), 1);
        expect(c.netContributionPct).toBeCloseTo(round2((c.netContribution / c.revenue) * 100), 1);
      }
      // every category's quantity × rate reconciles to its own revenue/cost
      for (const cat of c.categories) {
        if (cat.headcount) {
          expect(round2(cat.headcount * cat.revenueRate)).toBeCloseTo(cat.revenue, 0);
          expect(round2(cat.headcount * cat.costRate)).toBeCloseTo(cat.cost, 0);
        }
      }
      // guarding contracts carry the employer add-on costs (seeded contracts are all GUARDING)
      expect(c.otherCosts).toBeGreaterThan(0);
    }
  });

  it("can be scoped to a single contract", async () => {
    const fin = await ctxFor("FINANCE");
    const july = await periodFor(fin, 2026, 7);
    const run = await db.payrollRun.findFirstOrThrow({ where: { periodId: july.id, type: "REGULAR" } });
    const all = await contractProfitability(fin, run.id);
    const target = all[0];
    const scoped = await contractProfitability(fin, run.id, target.contractId);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].contractId).toBe(target.contractId);
    expect(scoped[0].revenue).toBeCloseTo(target.revenue, 2);
  });
});
