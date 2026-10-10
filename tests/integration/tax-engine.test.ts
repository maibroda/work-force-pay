import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num, round2 } from "@/lib/money";
import { isolatedOrg, uid } from "../helpers";
import { cancelInvoice, generateInvoices } from "@/server/services/billing";
import { createEmployee } from "@/server/services/employees";
import { ensureDefaultChart } from "@/server/services/accounting";
import { checkLedgerIntegrity } from "@/server/services/ledger-integrity";
import {
  decideRate,
  defaultsOn,
  installStandardTax,
  listTaxCodes,
  pendingRates,
  proposeRate,
  resolveTax,
  saveTaxCode,
  setDefaultTaxCode,
  setTaxCodeActive,
  taxReport,
} from "@/server/services/tax-engine";

/** Integrity findings, leaving out the fixture's locked payroll runs, which have no payroll journals. */
const findings = async (orgId: string) => (await checkLedgerIntegrity(orgId)).findings.filter((f) => f.check !== "PAYROLL_UNPOSTED");
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

async function world() {
  const t = await isolatedOrg();
  await db.$transaction((tx) => ensureDefaultChart(tx, t.org.id));
  const fin = t.ctx("FINANCE", null, 1);
  const fin2 = t.ctx("FINANCE", null, 2);
  const boss = t.ctx("COMPANY_ADMIN", null, 1);
  const boss2 = t.ctx("COMPANY_ADMIN", null, 2);
  const hr = t.ctx("HR_ADMIN", null, 1);
  const vatCode = (over: Record<string, unknown> = {}) => saveTaxCode(fin, null, { code: "VAT-STD", name: "VAT standard", type: "VAT", accountCode: "2190", ...over } as never);
  /** A code with an approved rate from a date. */
  const approvedVat = async (ratePct: number, from: string) => {
    const code = (await db.taxCode.findFirst({ where: { organizationId: t.org.id, code: "VAT-STD" } })) ?? (await vatCode());
    const rate = await proposeRate(fin, code.id, { ratePct, effectiveFrom: from, reason: "Finance Act" });
    await decideRate(boss, rate.id, true);
    return { code, rate };
  };
  /** A locked payroll run with one client, one contract and 1,000,000 billed, ready to invoice. */
  let n = 0;
  const billable = async (year: number, month: number, amount = 1_000_000) => {
    const emp = await createEmployee(hr, { firstName: "Guard", lastName: `No${++n}`, employmentDate: "2025-01-01", categoryId: t.guardId });
    const client = await db.client.create({ data: { organizationId: t.org.id, code: `C${uid()}`, name: `Client ${uid()}` } });
    const contract = await db.contract.create({ data: { organizationId: t.org.id, clientId: client.id, contractNumber: `K${uid()}`, name: "Site guarding", startDate: day("2025-01-01") } });
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: `${year}-${month}`, year, month, startDate: day(`${year}-${String(month).padStart(2, "0")}-01`), endDate: day(`${year}-${String(month).padStart(2, "0")}-${last}`) } });
    const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: 1, status: "LOCKED" } });
    const dec = (v: number) => v;
    const rec = await db.payrollRecord.create({
      data: {
        organizationId: t.org.id, runId: run.id, employeeId: emp.id, employeeNumber: emp.employeeNumber, employeeName: "Guard", categoryName: "Security Guard",
        basisDays: 30, daysWorked: 30, monthlyGross: dec(100000), earnedGross: dec(100000), totalEarnings: dec(100000), pensionBase: dec(60000), employeePension: dec(4800), employerPension: dec(5400),
        taxableIncome: dec(90000), paye: dec(0), totalDeductions: dec(4800), netPay: dec(95200), employerCost: dec(105400), taxRuleVersion: "test", lines: [], locations: [],
      },
    });
    await db.payrollAllocation.create({ data: { organizationId: t.org.id, runId: run.id, recordId: rec.id, employeeId: emp.id, contractId: contract.id, days: 30, grossAmount: 100000, employerPension: 5400, clientBilling: amount, managementShare: 0 } });
    return { run, client, contract };
  };
  return { t, fin, fin2, boss, boss2, hr, vatCode, approvedVat, billable };
}

describe("tax codes", () => {
  it("makes the first code of a type the default, refuses duplicates, bad accounts and the wrong role", async () => {
    const { fin, hr, vatCode } = await world();
    const first = await vatCode();
    expect(first.isDefault).toBe(true);
    await expect(vatCode()).rejects.toThrow(/already a tax code VAT-STD/);
    await expect(vatCode({ code: "VAT-X", accountCode: "9999" })).rejects.toThrow(/isn't in this organization's chart/);
    await expect(vatCode({ code: "bad code!" })).rejects.toThrow();
    await expect(saveTaxCode(hr, null, { code: "VAT-H", name: "x tax", type: "VAT" } as never)).rejects.toThrow(/permission/i);
    const second = await vatCode({ code: "VAT-ZERO", name: "VAT zero rated" });
    expect(second.isDefault).toBe(false);
    await expect(setTaxCodeActive(fin, first.id, false)).rejects.toThrow(/default code/);
    await setDefaultTaxCode(fin, second.id);
    const codes = await listTaxCodes(fin);
    expect(codes.find((c) => c.code === "VAT-ZERO")!.isDefault).toBe(true);
    expect(codes.find((c) => c.code === "VAT-STD")!.isDefault).toBe(false);
    await setTaxCodeActive(fin, first.id, false);
  });

  it("sets up VAT and withholding with proposed rates that nobody has approved yet", async () => {
    const { t, fin, boss } = await world();
    await installStandardTax(fin);
    await expect(installStandardTax(fin)).rejects.toThrow(/already has tax codes/);
    expect((await pendingRates(fin)).map((r) => `${r.taxCode.code}:${num(r.ratePct)}`).sort()).toEqual(["VAT-STD:7.5", "WHT-SERV:5"]);
    // until approved, a proposal isn't used
    await expect(resolveTax(db, t.org.id, "VAT", day("2026-08-31"))).rejects.toThrow(/No VAT rate is in force on 2026-08-31 for VAT-STD/);
    const vat = (await pendingRates(fin)).find((r) => r.taxCode.code === "VAT-STD")!;
    await decideRate(boss, vat.id, true);
    expect((await resolveTax(db, t.org.id, "VAT", day("2026-08-31"))).ratePct).toBe(7.5);
  });
});

describe("rates", () => {
  it("are proposed by one person and approved by another, and an approved one ends the previous the day before", async () => {
    const { fin, fin2, boss, boss2, hr, approvedVat, vatCode } = await world();
    const { code, rate } = await approvedVat(5, "2020-02-01");
    const next = await proposeRate(fin, code.id, { ratePct: 7.5, effectiveFrom: "2026-06-01", reason: "Finance Act amendment" });
    await expect(proposeRate(fin, code.id, { ratePct: 8, effectiveFrom: "2026-07-01", reason: "Another one" })).rejects.toThrow(/already waiting for approval/);
    await expect(decideRate(fin2, next.id, true)).rejects.toThrow(/permission/i); // Finance can propose but not approve
    await expect(decideRate(hr, next.id, true)).rejects.toThrow(/permission/i);
    // an administrator who proposed it can't approve it
    const other = await vatCode({ code: "VAT-B", name: "VAT other" });
    const mine = await proposeRate(boss, other.id, { ratePct: 9, effectiveFrom: "2028-01-01", reason: "Budget notice" });
    await expect(decideRate(boss, mine.id, true)).rejects.toThrow(/you proposed this rate/i);
    await decideRate(boss2, mine.id, true);
    await decideRate(boss, next.id, true);
    const rates = (await listTaxCodes(boss)).find((c) => c.id === code.id)!.rates;
    const old = rates.find((r) => r.id === rate.id)!;
    expect(iso(old.effectiveTo)).toBe("2026-05-31");
    expect(rates.find((r) => r.id === next.id)!.status).toBe("APPROVED");
    await expect(decideRate(boss2, next.id, true)).rejects.toThrow(/already been decided/);
  });

  it("can't be backdated into history or slotted in before an approved one, and a turned-down one needs a reason", async () => {
    const { fin, boss, approvedVat } = await world();
    const { code } = await approvedVat(7.5, "2026-06-01");
    await expect(proposeRate(fin, code.id, { ratePct: 5, effectiveFrom: "2026-06-01", reason: "Same day" })).rejects.toThrow(/already starts on 2026-06-01/);
    await expect(proposeRate(fin, code.id, { ratePct: 5, effectiveFrom: "2026-01-01", reason: "Backdated" })).rejects.toThrow(/earlier rates are history/);
    await expect(proposeRate(fin, code.id, { ratePct: 150, effectiveFrom: "2027-01-01", reason: "Typo" })).rejects.toThrow(/between 0 and 100/);
    const p = await proposeRate(fin, code.id, { ratePct: 10, effectiveFrom: "2027-01-01", reason: "Proposed" });
    await expect(decideRate(boss, p.id, false)).rejects.toThrow(/Say why/);
    await decideRate(boss, p.id, false, "Not yet gazetted");
    expect((await resolveTax(db, code.organizationId, "VAT", day("2027-06-01"))).ratePct).toBe(7.5); // turned down: never used
    await proposeRate(fin, code.id, { ratePct: 10, effectiveFrom: "2027-01-01", reason: "Proposed again" }); // and can be proposed afresh
  });

  it("are history the database protects: an approved rate can't be edited or deleted, even by SQL", async () => {
    const { fin, approvedVat } = await world();
    const { code, rate } = await approvedVat(7.5, "2026-06-01");
    await expect(db.taxRate.update({ where: { id: rate.id }, data: { ratePct: 1 } })).rejects.toThrow(/cannot be edited/);
    await expect(db.taxRate.update({ where: { id: rate.id }, data: { effectiveFrom: day("2020-01-01") } })).rejects.toThrow(/cannot be edited/);
    await expect(db.taxRate.update({ where: { id: rate.id }, data: { status: "REJECTED" } })).rejects.toThrow(/cannot change status/);
    await expect(db.taxRate.delete({ where: { id: rate.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.$executeRawUnsafe(`UPDATE "TaxRate" SET "ratePct" = 0 WHERE id = '${rate.id}'`)).rejects.toThrow(/cannot be edited/);
    // a proposal that is still waiting can be withdrawn
    const p = await proposeRate(fin, code.id, { ratePct: 8, effectiveFrom: "2027-01-01", reason: "Maybe" });
    await db.taxRate.delete({ where: { id: p.id } });
  });
});

describe("reading a rate", () => {
  it("takes a typed rate over the engine, the engine's rate by date, and none when no code exists", async () => {
    const { t, approvedVat } = await world();
    expect(await resolveTax(db, t.org.id, "VAT", day("2026-08-31"))).toMatchObject({ source: "NONE", ratePct: 0, taxCodeId: null });
    expect(await resolveTax(db, t.org.id, "VAT", day("2026-08-31"), 7.5)).toMatchObject({ source: "TYPED", ratePct: 7.5 });
    await approvedVat(5, "2020-02-01");
    await approvedVat(7.5, "2026-06-01");
    expect(await resolveTax(db, t.org.id, "VAT", day("2026-05-31"))).toMatchObject({ source: "ENGINE", ratePct: 5, code: "VAT-STD" });
    expect(await resolveTax(db, t.org.id, "VAT", day("2026-06-01"))).toMatchObject({ source: "ENGINE", ratePct: 7.5 });
    expect(await resolveTax(db, t.org.id, "VAT", day("2026-06-01"), 0)).toMatchObject({ source: "TYPED", ratePct: 0, code: "VAT-STD" });
    await expect(resolveTax(db, t.org.id, "VAT", day("2019-01-01"))).rejects.toThrow(/No VAT rate is in force on 2019-01-01/);
  });

  it("tells the invoicing form what a blank field means, including when no rate applies", async () => {
    const { fin, approvedVat } = await world();
    expect((await defaultsOn(fin, day("2026-08-31"))).VAT).toMatchObject({ source: "NONE" });
    await approvedVat(7.5, "2026-06-01");
    expect((await defaultsOn(fin, day("2026-08-31"))).VAT).toMatchObject({ ratePct: 7.5 });
    expect((await defaultsOn(fin, day("2025-01-31"))).VAT).toHaveProperty("error");
  });
});

describe("invoicing reads the engine", () => {
  it("with no tax codes behaves as it always did: no tax unless a rate is typed, which is recorded as typed", async () => {
    const { t, fin, billable } = await world();
    const a = await billable(2026, 7);
    const [plain] = await generateInvoices(fin, a.run.id);
    expect(num(plain.vatAmount)).toBe(0);
    expect(plain.taxBasis).toMatchObject({ vat: { source: "NONE", ratePct: 0 }, wht: { source: "NONE" } });
    expect(await db.taxTransaction.count({ where: { organizationId: t.org.id } })).toBe(0);

    const b = await billable(2026, 8);
    const [typed] = await generateInvoices(fin, b.run.id, { vatPct: 7.5, whtPct: 5 });
    expect(num(typed.totalIndirectCharge)).toBe(100_000);
    expect(num(typed.vatAmount)).toBe(7_500); // 7.5% of the indirect 10%, as before
    expect(num(typed.whtAmount)).toBe(50_000);
    expect(num(typed.totalAmount)).toBe(1_007_500);
    expect(typed.taxBasis).toMatchObject({ vat: { source: "TYPED", ratePct: 7.5 }, wht: { source: "TYPED", ratePct: 5 } });
    const records = await db.taxTransaction.findMany({ where: { invoiceId: typed.id }, orderBy: { kind: "asc" } });
    expect(records.map((r) => [r.kind, num(r.taxableAmount), num(r.ratePct), num(r.taxAmount)])).toEqual([
      ["OUTPUT_VAT", 100_000, 7.5, 7_500],
      ["EXPECTED_WHT", 1_000_000, 5, 50_000],
    ]);
    expect((await findings(t.org.id))).toEqual([]);
  });

  it("charges the rate in force on the invoice date, and a later change of rate never touches an invoice already issued", async () => {
    const { t, fin, boss, billable, approvedVat } = await world();
    const { code } = await approvedVat(7.5, "2020-02-01");
    const aug = await billable(2026, 8);
    const [augInv] = await generateInvoices(fin, aug.run.id); // nothing typed: the engine decides
    expect(num(augInv.vatPct)).toBe(7.5);
    expect(num(augInv.vatAmount)).toBe(round2(num(augInv.totalIndirectCharge) * 0.075));
    expect(augInv.taxBasis).toMatchObject({ date: "2026-08-31", vat: { code: "VAT-STD", ratePct: 7.5, source: "ENGINE" } });
    const rec = await db.taxTransaction.findFirstOrThrow({ where: { invoiceId: augInv.id, kind: "OUTPUT_VAT" } });
    expect(rec.taxCodeId).toBe(code.id);
    expect(num(rec.taxAmount)).toBe(num(augInv.vatAmount));

    // the rate rises from 1 September
    const change = await proposeRate(fin, code.id, { ratePct: 10, effectiveFrom: "2026-09-01", reason: "Amending notice" });
    await decideRate(boss, change.id, true);
    const sep = await billable(2026, 9);
    const [sepInv] = await generateInvoices(fin, sep.run.id);
    expect(num(sepInv.vatPct)).toBe(10);
    expect(num(sepInv.vatAmount)).toBe(10_000);

    // August is exactly as it was
    const augAfter = await db.clientInvoice.findUniqueOrThrow({ where: { id: augInv.id } });
    expect(num(augAfter.vatPct)).toBe(7.5);
    expect(num(augAfter.vatAmount)).toBe(num(augInv.vatAmount));
    expect(num(augAfter.totalAmount)).toBe(num(augInv.totalAmount));
    expect((await findings(t.org.id))).toEqual([]);
  });

  it("books the VAT it recorded to VAT payable, and the report agrees with the ledger", async () => {
    const { t, fin, billable, approvedVat } = await world();
    await approvedVat(7.5, "2020-02-01");
    const [inv] = await generateInvoices(fin, (await billable(2026, 8)).run.id);
    const lines = await db.journalLine.findMany({ where: { journal: { organizationId: t.org.id, sourceId: inv.id }, account: { code: "2190" } } });
    expect(lines.reduce((s, l) => s + num(l.credit), 0)).toBe(7_500);
    const report = await taxReport(fin, { from: day("2026-01-01"), to: day("2026-12-31") });
    expect(report.months).toMatchObject([{ month: "2026-08", invoices: 1, vat: 7_500, vatTaxable: 100_000 }]);
    expect(report.tieOut.difference).toBe(0);
    expect(report.clients).toHaveLength(1);
  });

  it("stops with a message rather than charging nothing when a code exists but no rate is in force that day", async () => {
    const { fin, billable, approvedVat } = await world();
    await approvedVat(7.5, "2026-06-01");
    const early = await billable(2026, 3);
    await expect(generateInvoices(fin, early.run.id)).rejects.toThrow(/No VAT rate is in force on 2026-03-31 for VAT-STD/);
    expect(await db.clientInvoice.count({ where: { runId: early.run.id } })).toBe(0); // nothing half-made
    const [typed] = await generateInvoices(fin, early.run.id, { vatPct: 7.5 }); // typing a rate is the way round it, on the record
    expect(typed.taxBasis).toMatchObject({ vat: { source: "TYPED" } });
  });

  it("marks the tax records reversed when the invoice is cancelled, and the report leaves them out", async () => {
    const { t, fin, billable, approvedVat } = await world();
    await approvedVat(7.5, "2020-02-01");
    const [inv] = await generateInvoices(fin, (await billable(2026, 8)).run.id, { whtPct: 5 });
    await cancelInvoice(fin, inv.id, "Billed in error");
    const records = await db.taxTransaction.findMany({ where: { invoiceId: inv.id } });
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.reversed && r.reversedAt)).toBe(true);
    const report = await taxReport(fin, { from: day("2026-01-01"), to: day("2026-12-31") });
    expect(report.months).toEqual([]);
    expect(report.tieOut).toEqual({ taxRecords: 0, ledger: 0, difference: 0 });
    expect((await findings(t.org.id))).toEqual([]);
  });

  it("keeps its tax records beyond edit or deletion, and the integrity check notices one that goes missing", async () => {
    const { t, fin, billable } = await world();
    const [inv] = await generateInvoices(fin, (await billable(2026, 8)).run.id, { vatPct: 7.5 });
    const rec = await db.taxTransaction.findFirstOrThrow({ where: { invoiceId: inv.id } });
    await expect(db.taxTransaction.update({ where: { id: rec.id }, data: { taxAmount: 1 } })).rejects.toThrow(/cannot be changed/);
    await expect(db.taxTransaction.delete({ where: { id: rec.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.taxTransaction.update({ where: { id: rec.id }, data: { reversed: true } })).resolves.toBeTruthy(); // only this is allowed
    await expect(db.taxTransaction.update({ where: { id: rec.id }, data: { reversed: false } })).rejects.toThrow(/cannot be reinstated/);
    const found = (await findings(t.org.id)).filter((f) => f.check === "TAX_VAT_RECORDS");
    expect(found).toHaveLength(1); // the record was reversed while the invoice is live
  });

  it("is per organization", async () => {
    const mine = await world();
    const other = await world();
    await mine.approvedVat(7.5, "2020-02-01");
    expect(await listTaxCodes(other.fin)).toEqual([]);
    expect(await resolveTax(db, other.t.org.id, "VAT", day("2026-08-31"))).toMatchObject({ source: "NONE" });
    const rate = (await pendingRates(other.fin)).length;
    expect(rate).toBe(0);
  });
});
