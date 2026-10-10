import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { billingWorld } from "../billing-fixture";
import { generateInvoices } from "@/server/services/billing";
import { checkLedgerIntegrity } from "@/server/services/ledger-integrity";
import { decideRate, proposeRate, saveTaxCode } from "@/server/services/tax-engine";
import { assignServiceType, billingOverview, decideRule, installStandardBilling, proposeRule, saveServiceType, setServiceTypeActive } from "@/server/services/billing-rules";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
const findings = async (orgId: string) => (await checkLedgerIntegrity(orgId)).findings.filter((f) => f.check !== "PAYROLL_UNPOSTED"); // the fixture's locked runs have no payroll journals

async function world() {
  const w = await billingWorld();
  const fin = w.t.ctx("FINANCE", null, 1);
  const fin2 = w.t.ctx("FINANCE", null, 2);
  const boss = w.t.ctx("COMPANY_ADMIN", null, 1);
  const boss2 = w.t.ctx("COMPANY_ADMIN", null, 2);
  const hr = w.t.ctx("HR_ADMIN", null, 1);
  const rule = (over: Record<string, unknown> = {}) => ({ directPct: 80, indirectPct: 20, vatBase: "FULL", whtBase: "FULL", effectiveFrom: "2026-01-01", reason: "Agreed in the services agreement", ...over });
  const svc = (code = "GUARD") => saveServiceType(fin, { code, name: `Service ${code}` });
  /** A service type with an approved rule, proposed by Finance and approved by an administrator. */
  const approvedService = async (over: Record<string, unknown> = {}, code = "GUARD") => {
    const s = await svc(code);
    const r = await proposeRule(fin, { serviceTypeId: s.id }, rule(over));
    await decideRule(boss, r.id, true);
    return { s, r };
  };
  const approvedOverride = async (contractId: string, over: Record<string, unknown> = {}) => {
    const r = await proposeRule(fin, { contractId }, rule(over));
    await decideRule(boss, r.id, true);
    return r;
  };
  const putUnder = (contractId: string, serviceTypeId: string) => assignServiceType(boss, contractId, serviceTypeId, "Billed as this service");
  return { ...w, fin, fin2, boss, boss2, hr, rule, svc, approvedService, approvedOverride, putUnder };
}

describe("service types", () => {
  it("are made by Finance, refuse duplicates, and can't be deactivated while contracts are billed under them", async () => {
    const { fin, hr, boss, addCharge, newRun, svc, putUnder } = await world();
    const s = await svc("CONSULT");
    await expect(svc("CONSULT")).rejects.toThrow(/already a service type CONSULT/);
    await expect(saveServiceType(hr, { code: "X1", name: "Nope service" })).rejects.toThrow(/permission/i);
    await expect(saveServiceType(fin, { code: "bad code!", name: "Bad code" })).rejects.toThrow();
    const { contractId } = await addCharge(await newRun(2026, 8), 1_000_000);
    await expect(assignServiceType(fin, contractId, s.id, "Finance may not move contracts")).rejects.toThrow(/permission/i); // approver-level
    await expect(assignServiceType(boss, contractId, s.id, "no")).rejects.toThrow(/Say why/);
    await putUnder(contractId, s.id);
    await expect(setServiceTypeActive(fin, s.id, false)).rejects.toThrow(/1 contract\(s\) are billed under this/);
    await assignServiceType(boss, contractId, null, "Back to the default");
    await setServiceTypeActive(fin, s.id, false);
    await expect(assignServiceType(boss, contractId, s.id, "Inactive service")).rejects.toThrow(/inactive/);
  });

  it("installs the standard treatment once, as an approved rule, with every contract under it", async () => {
    const { t, fin, boss, addCharge, newRun } = await world();
    const a = await addCharge(await newRun(2026, 8), 1_000_000);
    await expect(installStandardBilling(fin)).rejects.toThrow(/permission/i);
    const s = await installStandardBilling(boss);
    await expect(installStandardBilling(boss)).rejects.toThrow(/already has service types/);
    expect((await db.contract.findUniqueOrThrow({ where: { id: a.contractId } })).serviceTypeId).toBe(s.id);
    const rule = await db.billingRule.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect([num(rule.directPct), num(rule.indirectPct), rule.vatBase, rule.whtBase, rule.status, iso(rule.effectiveFrom)]).toEqual([90, 10, "INDIRECT", "FULL", "APPROVED", "2000-01-01"]);
  });
});

describe("proposing and deciding rules", () => {
  it("needs a different person to approve, and the right permission", async () => {
    const { fin, fin2, boss, hr, svc, rule } = await world();
    const s = await svc();
    await expect(proposeRule(hr, { serviceTypeId: s.id }, rule())).rejects.toThrow(/permission/i);
    const r = await proposeRule(fin, { serviceTypeId: s.id }, rule());
    await expect(proposeRule(fin2, { serviceTypeId: s.id }, rule({ effectiveFrom: "2026-03-01" }))).rejects.toThrow(/already waiting for approval/);
    await expect(decideRule(fin2, r.id, true)).rejects.toThrow(/permission/i); // Finance proposes, an approver decides
    const mine = await proposeRule(boss, { serviceTypeId: (await svc("OTHER")).id }, rule());
    await expect(decideRule(boss, mine.id, true)).rejects.toThrow(/you proposed this rule/i);
    await expect(decideRule(boss, r.id, false)).rejects.toThrow(/Say why/);
    await decideRule(boss, r.id, false, "Not what was agreed");
    await expect(decideRule(boss, r.id, true)).rejects.toThrow(/already been decided/);
  });

  it("is checked: 100% split, a reason, real bases, an active tax code of the right type, and one scope", async () => {
    const { fin, svc, rule, t, addCharge, newRun } = await world();
    const s = await svc();
    await expect(proposeRule(fin, { serviceTypeId: s.id }, rule({ directPct: 70 }))).rejects.toThrow(/add up to 100%/);
    await expect(proposeRule(fin, { serviceTypeId: s.id }, rule({ reason: "short" }))).rejects.toThrow(/Say why/);
    await expect(proposeRule(fin, { serviceTypeId: s.id }, rule({ vatBase: "HALF" }))).rejects.toThrow(/Choose what VAT/);
    await expect(proposeRule(fin, {}, rule())).rejects.toThrow(/service type or for one contract/);
    const { contractId } = await addCharge(await newRun(2026, 8), 1_000_000);
    await expect(proposeRule(fin, { serviceTypeId: s.id, contractId }, rule())).rejects.toThrow(/service type or for one contract/);
    const wht = await saveTaxCode(fin, null, { code: "WHT-X", name: "Withholding X", type: "WHT" });
    await expect(proposeRule(fin, { serviceTypeId: s.id }, rule({ vatTaxCodeId: wht.id }))).rejects.toThrow(/isn't an active VAT code/);
    await expect(proposeRule(fin, { serviceTypeId: s.id }, rule({ vatTaxCodeId: "nope" }))).rejects.toThrow(/isn't an active VAT code/);
    // the database refuses a rule for both a service and a contract, or one that doesn't split 100%
    await expect(db.billingRule.create({ data: { organizationId: t.org.id, serviceTypeId: s.id, contractId, directPct: 90, indirectPct: 10, effectiveFrom: day("2026-01-01"), reason: "x", requestedBy: "x", requestedByUserId: "x" } })).rejects.toThrow();
    await expect(db.billingRule.create({ data: { organizationId: t.org.id, serviceTypeId: s.id, directPct: 90, indirectPct: 20, effectiveFrom: day("2026-01-01"), reason: "x", requestedBy: "x", requestedByUserId: "x" } })).rejects.toThrow();
  });

  it("ends the rule it replaces the day before, and a new one can't start on or before an existing one", async () => {
    const { fin, boss, approvedService, rule } = await world();
    const { s, r } = await approvedService({ effectiveFrom: "2026-01-01" });
    await expect(proposeRule(fin, { serviceTypeId: s.id }, rule({ effectiveFrom: "2026-01-01" }))).rejects.toThrow(/already starts on 2026-01-01/);
    await expect(proposeRule(fin, { serviceTypeId: s.id }, rule({ effectiveFrom: "2025-06-01" }))).rejects.toThrow(/earlier rules are history/);
    const next = await proposeRule(fin, { serviceTypeId: s.id }, rule({ directPct: 85, indirectPct: 15, effectiveFrom: "2026-11-01" }));
    await decideRule(boss, next.id, true);
    expect(iso((await db.billingRule.findUniqueOrThrow({ where: { id: r.id } })).effectiveTo)).toBe("2026-10-31");
  });

  it("is history the database protects: an approved rule can't be edited or deleted, even by SQL", async () => {
    const { fin, approvedService, rule } = await world();
    const { s, r } = await approvedService();
    await expect(db.billingRule.update({ where: { id: r.id }, data: { directPct: 99, indirectPct: 1 } })).rejects.toThrow(/cannot be edited/);
    await expect(db.billingRule.update({ where: { id: r.id }, data: { vatBase: "NONE" } })).rejects.toThrow(/cannot be edited/);
    await expect(db.billingRule.update({ where: { id: r.id }, data: { status: "REJECTED" } })).rejects.toThrow(/cannot change status/);
    await expect(db.billingRule.delete({ where: { id: r.id } })).rejects.toThrow(/cannot be deleted/);
    await expect(db.$executeRawUnsafe(`UPDATE "BillingRule" SET "whtBase" = 'NONE' WHERE id = '${r.id}'`)).rejects.toThrow(/cannot be edited/);
    const p = await proposeRule(fin, { serviceTypeId: s.id }, rule({ effectiveFrom: "2027-01-01" }));
    await db.billingRule.delete({ where: { id: p.id } }); // a waiting proposal can be withdrawn
  });
});

describe("invoicing reads the rules", () => {
  it("with no rule at all bills on the built-in default, exactly as it always did", async () => {
    const { t, fin, newRun, addCharge } = await world();
    const run = await newRun(2026, 8);
    await addCharge(run, 1_000_000);
    const [inv] = await generateInvoices(fin, run.id, { vatPct: 7.5, whtPct: 5 });
    expect([num(inv.directChargePct), num(inv.indirectChargePct), num(inv.totalDirectCharge), num(inv.totalIndirectCharge)]).toEqual([90, 10, 900_000, 100_000]);
    expect([num(inv.vatAmount), num(inv.whtAmount), num(inv.totalAmount)]).toEqual([7_500, 50_000, 1_007_500]);
    const basis = inv.taxBasis as { contracts: Array<{ source: string; ruleId: string | null }> };
    expect(basis.contracts[0]).toMatchObject({ source: "DEFAULT", ruleId: null });
    expect((await findings(t.org.id))).toEqual([]);
  });

  it("gives the same figures through the installed standard rule as through the built-in default", async () => {
    const plain = await world();
    const set = await world();
    const results = [];
    for (const [w, install] of [[plain, false], [set, true]] as const) {
      const run = await w.newRun(2026, 8);
      await w.addCharge(run, 1_234_567.89);
      await w.addCharge(run, 765_432.11);
      if (install) await installStandardBilling(w.boss);
      const invoices = await generateInvoices(w.fin, run.id, { vatPct: 7.5, whtPct: 5 });
      results.push(invoices.map((i) => [num(i.subtotal), num(i.totalDirectCharge), num(i.totalIndirectCharge), num(i.vatAmount), num(i.whtAmount), num(i.totalAmount)]).sort());
    }
    expect(results[1]).toEqual(results[0]);
    const via = await db.clientInvoice.findFirstOrThrow({ where: { organizationId: set.t.org.id }, include: { lines: true } });
    expect((via.taxBasis as { contracts: Array<{ source: string }> }).contracts[0].source).toBe("SERVICE_RULE");
    expect(via.lines.every((l) => l.billingRuleId)).toBe(true);
  });

  it("splits and taxes by the service rule: 80/20 with VAT on the whole amount", async () => {
    const { t, fin, newRun, addCharge, approvedService, putUnder } = await world();
    const { s, r } = await approvedService({ vatBase: "FULL", whtBase: "NONE" });
    const run = await newRun(2026, 8);
    const { contractId } = await addCharge(run, 1_000_000);
    await putUnder(contractId, s.id);
    const [inv] = await generateInvoices(fin, run.id, { vatPct: 7.5, whtPct: 5 });
    expect([num(inv.directChargePct), num(inv.totalDirectCharge), num(inv.totalIndirectCharge)]).toEqual([80, 800_000, 200_000]);
    expect(num(inv.vatAmount)).toBe(75_000); // 7.5% of the whole 1,000,000
    expect(num(inv.whtAmount)).toBe(0); // withholding base NONE
    const records = await db.taxTransaction.findMany({ where: { invoiceId: inv.id } });
    expect(records.map((x) => [x.kind, num(x.taxableAmount), num(x.taxAmount)])).toEqual([["OUTPUT_VAT", 1_000_000, 75_000]]);
    const lines = await db.clientInvoiceLine.findMany({ where: { invoiceId: inv.id } });
    expect(lines.every((l) => l.billingRuleId === r.id)).toBe(true);
    expect((await findings(t.org.id))).toEqual([]);
  });

  it("applies a contract's approved override from its date, and the service rule before it", async () => {
    const { t, fin, newRun, addCharge, approvedService, approvedOverride, putUnder } = await world();
    const { s } = await approvedService({ directPct: 90, indirectPct: 10, vatBase: "INDIRECT", whtBase: "FULL" });
    const aug = await newRun(2026, 8);
    const sep = await newRun(2026, 9);
    const first = await addCharge(aug, 1_000_000);
    await addCharge(sep, 1_000_000, first);
    await putUnder(first.contractId, s.id);
    const [augInv] = await generateInvoices(fin, aug.id, { vatPct: 10 });
    await approvedOverride(first.contractId, { directPct: 70, indirectPct: 30, vatBase: "FULL", effectiveFrom: "2026-09-01" });
    const [sepInv] = await generateInvoices(fin, sep.id, { vatPct: 10 });
    expect([num(augInv.totalDirectCharge), num(augInv.vatAmount)]).toEqual([900_000, 10_000]); // service rule: VAT on the 10% indirect
    expect([num(sepInv.totalDirectCharge), num(sepInv.vatAmount)]).toEqual([700_000, 100_000]); // override: 70/30, VAT on the whole
    expect((sepInv.taxBasis as { contracts: Array<{ source: string }> }).contracts[0].source).toBe("CONTRACT_OVERRIDE");
    // August is exactly as it was
    const augAfter = await db.clientInvoice.findUniqueOrThrow({ where: { id: augInv.id } });
    expect([num(augAfter.totalDirectCharge), num(augAfter.vatAmount), num(augAfter.totalAmount)]).toEqual([900_000, 10_000, 1_010_000]);
    expect((await findings(t.org.id))).toEqual([]);
  });

  it("ignores a proposal until it is approved, and won't let a rule start on or before an invoice already issued under it", async () => {
    const { fin, boss, newRun, addCharge, approvedService, putUnder, rule } = await world();
    const { s } = await approvedService({ directPct: 90, indirectPct: 10, vatBase: "INDIRECT" });
    const run = await newRun(2026, 8);
    const { contractId } = await addCharge(run, 1_000_000);
    await putUnder(contractId, s.id);
    const pending = await proposeRule(fin, { contractId }, rule({ directPct: 50, indirectPct: 50, effectiveFrom: "2026-09-01" }));
    const [inv] = await generateInvoices(fin, run.id, { vatPct: 10 });
    expect(num(inv.totalDirectCharge)).toBe(900_000); // the waiting proposal wasn't used
    await decideRule(boss, pending.id, true);
    await expect(proposeRule(fin, { contractId }, rule({ effectiveFrom: "2026-08-31" }))).rejects.toThrow(/already starts on 2026-09-01/);
    // a rule for the service can't start on or before the August invoice either
    await expect(proposeRule(fin, { serviceTypeId: s.id }, rule({ effectiveFrom: "2026-08-31" }))).rejects.toThrow(/invoice dated 2026-08-31 has already been issued/);
    await proposeRule(fin, { serviceTypeId: s.id }, rule({ effectiveFrom: "2026-09-01" }));
  });

  it("bills two contracts of one client on one invoice under their own rules, with tax worked out per code and rate", async () => {
    const { t, fin, boss, newRun, addCharge, approvedService, approvedOverride, putUnder } = await world();
    const vatA = await saveTaxCode(fin, null, { code: "VAT-A", name: "VAT A", type: "VAT" });
    const vatB = await saveTaxCode(fin, null, { code: "VAT-B", name: "VAT B", type: "VAT" });
    for (const [code, pct] of [[vatA, 7.5], [vatB, 10]] as const) await decideRate(boss, (await proposeRate(fin, code.id, { ratePct: pct, effectiveFrom: "2020-01-01", reason: "Notice" })).id, true);
    const { s } = await approvedService({ directPct: 90, indirectPct: 10, vatBase: "INDIRECT", whtBase: "NONE" });
    const run = await newRun(2026, 8);
    const one = await addCharge(run, 1_000_000);
    const client = one.clientId;
    const contract2 = await db.contract.create({ data: { organizationId: t.org.id, clientId: client, contractNumber: "K-SECOND", name: "Second site", startDate: day("2025-01-01") } });
    await addCharge(run, 500_000, { clientId: client, contractId: contract2.id });
    await putUnder(one.contractId, s.id);
    await putUnder(contract2.id, s.id);
    await approvedOverride(contract2.id, { directPct: 60, indirectPct: 40, vatBase: "FULL", whtBase: "NONE", vatTaxCodeId: vatB.id, effectiveFrom: "2026-01-01" });
    const invoices = await generateInvoices(fin, run.id); // nothing typed: rules and the engine decide
    expect(invoices).toHaveLength(1);
    const inv = invoices[0];
    // contract one: 10% indirect of 1,000,000 = 100,000 at the default VAT code's rate; contract two: whole 500,000 at 10% under VAT-B
    expect([num(inv.subtotal), num(inv.totalDirectCharge), num(inv.totalIndirectCharge)]).toEqual([1_500_000, 1_200_000, 300_000]);
    const records = await db.taxTransaction.findMany({ where: { invoiceId: inv.id, kind: "OUTPUT_VAT" }, orderBy: { ratePct: "asc" } });
    expect(records.map((x) => [num(x.ratePct), num(x.taxableAmount), num(x.taxAmount)])).toEqual([[7.5, 100_000, 7_500], [10, 500_000, 50_000]]);
    expect(num(inv.vatAmount)).toBe(57_500);
    expect(num(inv.totalAmount)).toBe(1_557_500);
    expect(num(inv.vatPct)).toBe(9.58); // the blended rate, for display
    expect(num(inv.directChargePct)).toBe(80); // 1,200,000 of 1,500,000
    expect((inv.taxBasis as { vat: { source: string } }).vat.source).toBe("MIXED");
    expect((await findings(t.org.id))).toEqual([]);
  });

  it("charges no tax, and needs no rate, where the rule says the base is nothing", async () => {
    const { t, fin, newRun, addCharge, approvedService, putUnder } = await world();
    const vat = await saveTaxCode(fin, null, { code: "VAT-STD", name: "VAT", type: "VAT" }); // a default code with no rate yet
    const { s } = await approvedService({ vatBase: "NONE", whtBase: "NONE" });
    const run = await newRun(2026, 8);
    const { contractId } = await addCharge(run, 1_000_000);
    await putUnder(contractId, s.id);
    const [inv] = await generateInvoices(fin, run.id); // would stop with "no rate in force" if VAT applied
    expect([num(inv.vatAmount), num(inv.whtAmount), num(inv.totalAmount)]).toEqual([0, 0, 1_000_000]);
    expect(await db.taxTransaction.count({ where: { invoiceId: inv.id } })).toBe(0);
    expect(vat.isDefault).toBe(true);
    expect((await findings(t.org.id))).toEqual([]);
  });

  it("lets a typed split win over every rule for the run, recorded as typed", async () => {
    const { fin, newRun, addCharge, approvedService, putUnder } = await world();
    const { s } = await approvedService({ directPct: 70, indirectPct: 30 });
    const run = await newRun(2026, 8);
    const { contractId } = await addCharge(run, 1_000_000);
    await putUnder(contractId, s.id);
    await expect(generateInvoices(fin, run.id, { directChargePct: 60, indirectChargePct: 50 })).rejects.toThrow(/add up to 100/);
    const [inv] = await generateInvoices(fin, run.id, { directChargePct: 95, indirectChargePct: 5, vatPct: 7.5 });
    expect([num(inv.totalDirectCharge), num(inv.totalIndirectCharge)]).toEqual([950_000, 50_000]);
    expect((inv.taxBasis as { contracts: Array<{ source: string }> }).contracts[0].source).toBe("TYPED");
  });

  it("shows what each contract is billed under today", async () => {
    const { fin, newRun, addCharge, approvedService, putUnder } = await world();
    const { s } = await approvedService({ directPct: 80, indirectPct: 20, effectiveFrom: "2020-01-01" });
    const a = await addCharge(await newRun(2026, 8), 1_000_000);
    const b = await addCharge(await newRun(2026, 9), 1_000_000);
    await putUnder(a.contractId, s.id);
    const o = await billingOverview(fin);
    expect(o.contracts.find((c) => c.id === a.contractId)!.now).toMatchObject({ source: "SERVICE_RULE", directPct: 80 });
    expect(o.contracts.find((c) => c.id === b.contractId)!.now).toMatchObject({ source: "DEFAULT", directPct: 90 });
  });

  it("is per organization", async () => {
    const mine = await world();
    const other = await world();
    await mine.approvedService();
    expect((await billingOverview(other.fin)).types).toEqual([]);
    const s = await other.svc("X-ORG");
    await expect(proposeRule(mine.fin, { serviceTypeId: s.id }, mine.rule())).rejects.toThrow(/Service type not found/);
  });
});
