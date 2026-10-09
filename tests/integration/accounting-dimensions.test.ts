import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isolatedOrg, uid } from "../helpers";
import { createAccount, ensureDefaultChart, updateAccount } from "@/server/services/accounting";
import { mirrorLines, postJournal } from "@/server/services/posting";
import { postArInvoice, postLoanDisbursement } from "@/server/services/gl-posting";
import { cancelInvoice, recordReceipt } from "@/server/services/billing";
import { cancelPurchaseInvoice, createPurchaseInvoice, createVendor } from "@/server/services/payables";
import { createFixedAsset, disposeFixedAsset, postDepreciationForMonth } from "@/server/services/fixed-assets";
import { createEmployee } from "@/server/services/employees";
import { createBranch, createProfitCentre, createProject, createRegion, ledgerByDimension, listDimensionMasters, setDimensionActive } from "@/server/services/dimensions";
import { checkLedgerIntegrity } from "@/server/services/ledger-integrity";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

async function world() {
  const t = await isolatedOrg();
  await db.$transaction((tx) => ensureDefaultChart(tx, t.org.id));
  const fin = t.ctx("FINANCE");
  const hr = t.ctx("HR_ADMIN");
  const client = await db.client.create({ data: { organizationId: t.org.id, code: `C${uid()}`, name: "Alpha Bank" } });
  const client2 = await db.client.create({ data: { organizationId: t.org.id, code: `C${uid()}`, name: "Beta Foods" } });
  const contract = await db.contract.create({ data: { organizationId: t.org.id, clientId: client.id, contractNumber: `K${uid()}`, name: "Alpha guarding", startDate: day("2026-01-01") } });
  const contract2 = await db.contract.create({ data: { organizationId: t.org.id, clientId: client.id, contractNumber: `K${uid()}`, name: "Alpha events", startDate: day("2026-01-01") } });
  const betaContract = await db.contract.create({ data: { organizationId: t.org.id, clientId: client2.id, contractNumber: `K${uid()}`, name: "Beta guarding", startDate: day("2026-01-01") } });
  const beat = await db.beat.create({ data: { organizationId: t.org.id, clientId: client.id, contractId: contract.id, code: `B${uid()}`, name: "Alpha HQ" } });
  const cc = await db.costCenter.create({ data: { organizationId: t.org.id, code: `CC${uid()}`, name: "Lagos" } });
  const lines = (a: string, b: string, amount = 100) => [{ accountCode: a, description: "x", debit: amount, credit: 0 }, { accountCode: b, description: "x", debit: 0, credit: amount }];
  const post = (over: Record<string, unknown> = {}) =>
    postJournal(fin, db, { source: "MANUAL_POST", postingDate: day("2026-08-31"), description: "test", lines: lines("1230", "4100"), ...over } as never);
  return { t, fin, hr, client, client2, contract, contract2, betaContract, beat, cc, lines, post };
}

describe("the posting engine and dimensions", () => {
  it("stores the dimensions on the line and nowhere else", async () => {
    const { t, post, client, contract, beat, cc, lines } = await world();
    const l = lines("1230", "4100");
    const j = (await post({ lines: [l[0], { ...l[1], dimensions: { clientId: client.id, contractId: contract.id, beatId: beat.id, costCenterId: cc.id } }] }))!;
    const rows = await db.journalLine.findMany({ where: { journalId: j.id }, orderBy: { sortOrder: "asc" } });
    expect(rows[0].clientId).toBeNull();
    expect(rows[1]).toMatchObject({ clientId: client.id, contractId: contract.id, beatId: beat.id, costCenterId: cc.id, employeeId: null });
    expect(await db.journalEntry.count({ where: { organizationId: t.org.id } })).toBe(1);
  });

  it("refuses a dimension that doesn't exist, or that belongs to another organization", async () => {
    const { post, lines, client } = await world();
    const other = await world();
    const l = lines("1230", "4100");
    await expect(post({ lines: [l[0], { ...l[1], dimensions: { clientId: "no-such-client" } }] })).rejects.toThrow(/client that doesn't exist in this organization/);
    await expect(post({ lines: [l[0], { ...l[1], dimensions: { clientId: other.client.id } }] })).rejects.toThrow(/client that doesn't exist in this organization/);
    await expect(post({ lines: [l[0], { ...l[1], dimensions: { costCenterId: other.cc.id } }] })).rejects.toThrow(/cost centre that doesn't exist/);
    await expect(post({ lines: [l[0], { ...l[1], dimensions: { clientId: client.id } }] })).resolves.toBeTruthy();
  });

  it("refuses an inactive region, branch, profit centre or project, but still accepts an inactive client", async () => {
    const { t, fin, post, lines, client } = await world();
    const region = await createRegion(fin, { code: "SW", name: "South West" });
    const branch = await createBranch(fin, { code: "LAG", name: "Lagos" });
    const centre = await createProfitCentre(fin, { code: "GRD", name: "Guarding" });
    const project = await createProject(fin, { code: "P1", name: "Pilot" });
    const l = lines("1230", "4100");
    const withDim = (dimensions: Record<string, string>) => ({ lines: [l[0], { ...l[1], dimensions }] });
    for (const [key, id, kind] of [["regionId", region.id, "REGION"], ["branchId", branch.id, "BRANCH"], ["profitCentreId", centre.id, "PROFIT_CENTRE"], ["projectId", project.id, "PROJECT"]] as const) {
      await expect(post(withDim({ [key]: id }))).resolves.toBeTruthy();
      await setDimensionActive(fin, kind, id, false);
      await expect(post(withDim({ [key]: id }))).rejects.toThrow(/is inactive/);
      await setDimensionActive(fin, kind, id, true);
      await expect(post(withDim({ [key]: id }))).resolves.toBeTruthy();
    }
    await db.client.update({ where: { id: client.id }, data: { status: "INACTIVE" } });
    await expect(post(withDim({ clientId: client.id }))).resolves.toBeTruthy(); // a client who has left still has receipts to post
    expect(t.org.id).toBeTruthy();
  });

  it("refuses a contract that doesn't belong to the line's client", async () => {
    const { post, lines, client, contract, betaContract } = await world();
    const l = lines("1230", "4100");
    await expect(post({ lines: [l[0], { ...l[1], dimensions: { clientId: client.id, contractId: betaContract.id } }] })).rejects.toThrow(/contract that doesn't belong to its client/);
    await expect(post({ lines: [l[0], { ...l[1], dimensions: { clientId: client.id, contractId: contract.id } }] })).resolves.toBeTruthy();
    await expect(post({ lines: [l[0], { ...l[1], dimensions: { contractId: betaContract.id } }] })).resolves.toBeTruthy(); // no client named, nothing to contradict
  });

  it("enforces the dimensions an account requires, and the requirement can be set and cleared", async () => {
    const { t, fin, post, lines, client, contract } = await world();
    const rev = await db.glAccount.findUniqueOrThrow({ where: { organizationId_code: { organizationId: t.org.id, code: "4100" } } });
    await updateAccount(fin, rev.id, { requiredDimensions: ["CLIENT", "CONTRACT"] });
    const l = lines("1230", "4100");
    await expect(post({ lines: l })).rejects.toThrow(/Client Billing Revenue needs a client and a contract/);
    await expect(post({ lines: [l[0], { ...l[1], dimensions: { clientId: client.id } }] })).rejects.toThrow(/needs a contract/);
    await expect(post({ lines: [l[0], { ...l[1], dimensions: { clientId: client.id, contractId: contract.id } }] })).resolves.toBeTruthy();
    await expect(updateAccount(fin, rev.id, { requiredDimensions: ["CLIENT", "COLOUR"] })).rejects.toThrow(/COLOUR isn't an accounting dimension/);
    await updateAccount(fin, rev.id, { requiredDimensions: [] });
    await expect(post({ lines: l })).resolves.toBeTruthy();
    const made = await createAccount(fin, { code: "4600", name: "Project income", type: "INCOME", requiredDimensions: ["PROJECT"] } as never);
    expect(made.requiredDimensions).toEqual(["PROJECT"]);
  });

  it("makes a posted line's dimensions impossible to change, even through the database", async () => {
    const { post, lines, client, client2 } = await world();
    const l = lines("1230", "4100");
    const j = (await post({ lines: [l[0], { ...l[1], dimensions: { clientId: client.id } }] }))!;
    const line = await db.journalLine.findFirstOrThrow({ where: { journalId: j.id, clientId: client.id } });
    await expect(db.journalLine.update({ where: { id: line.id }, data: { clientId: client2.id } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.journalLine.update({ where: { id: line.id }, data: { clientId: null } })).rejects.toThrow(/cannot be changed/i);
  });

  it("mirrors a journal exactly, dimensions included, so a reversal cancels it in every dimension", async () => {
    const { t, fin, post, lines, client, contract } = await world();
    const l = lines("1230", "4100", 500);
    const j = (await post({ lines: [l[0], { ...l[1], dimensions: { clientId: client.id, contractId: contract.id } }] }))!;
    const original = await db.journalLine.findMany({ where: { journalId: j.id }, orderBy: { sortOrder: "asc" } });
    await postJournal(fin, db, { source: "MANUAL_POST", postingDate: day("2026-09-01"), description: "reversal", lines: mirrorLines(original) });
    const rows = (await ledgerByDimension(fin, { dimension: "CONTRACT" })).rows;
    expect(rows.find((r) => r.id === contract.id)?.net).toBe(0);
    expect((await ledgerByDimension(fin, { dimension: "CLIENT" })).totals).toMatchObject({ income: 0, net: 0 });
    expect((await checkLedgerIntegrity(t.org.id)).ok).toBe(true);
  });
});

describe("postings that carry dimensions", () => {
  it("a client invoice splits revenue by contract and beat, and cancelling it mirrors the split", async () => {
    const { t, fin, client, contract, contract2, beat } = await world();
    const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: "Aug 2026", year: 2026, month: 8, startDate: day("2026-08-01"), endDate: day("2026-08-31") } });
    const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: 1 } });
    const inv = await db.clientInvoice.create({
      data: {
        organizationId: t.org.id, clientId: client.id, runId: run.id, periodId: period.id, invoiceNumber: `INV-${uid()}`, invoiceDate: day("2026-08-31"), dueDate: day("2026-09-30"),
        subtotal: 1_000_000, vatPct: 7.5, vatAmount: 7_500, totalAmount: 1_007_500, createdBy: "test",
        lines: { create: [
          { contractId: contract.id, beatId: beat.id, description: "Guards", headcount: 10, amount: 600_000 },
          { contractId: contract.id, beatId: beat.id, description: "Supervisors", headcount: 2, amount: 100_000 },
          { contractId: contract2.id, description: "Events", headcount: 4, amount: 300_000 },
        ] },
      },
      include: { lines: true },
    });
    const j = (await db.$transaction((tx) => postArInvoice(fin, tx, inv)))!;
    const rows = await db.journalLine.findMany({ where: { journalId: j.id }, orderBy: { sortOrder: "asc" } });
    const revenue = rows.filter((r) => r.accountCode === "4100");
    expect(revenue.map((r) => [r.contractId, r.beatId, Number(r.credit)])).toEqual([[contract.id, beat.id, 700_000], [contract2.id, null, 300_000]]);
    expect(rows.find((r) => r.accountCode === "1200")).toMatchObject({ clientId: client.id, contractId: null });
    expect(rows.find((r) => r.accountCode === "2190")).toMatchObject({ clientId: client.id });
    expect(Number(j.totalDebit)).toBe(1_007_500);

    const byContract = await ledgerByDimension(fin, { dimension: "CONTRACT" });
    expect(byContract.rows.find((r) => r.id === contract.id)?.income).toBe(700_000);
    expect(byContract.rows.find((r) => r.id === contract2.id)?.income).toBe(300_000);
    expect(byContract.rows.find((r) => r.id === null)).toBeUndefined(); // VAT and the receivable aren't income, so nothing is left unanalysed

    await cancelInvoice(fin, inv.id, "Raised for the wrong period by mistake");
    const rev = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "AR_INVOICE_CANCEL" }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    expect(rev.lines.filter((r) => r.accountCode === "4100").map((r) => [r.contractId, r.beatId, Number(r.debit)])).toEqual([[contract.id, beat.id, 700_000], [contract2.id, null, 300_000]]);
    expect((await ledgerByDimension(fin, { dimension: "CONTRACT" })).totals.income).toBe(0);
    expect((await checkLedgerIntegrity(t.org.id)).findings).toEqual([]);
  });

  it("a receipt carries the client on both lines", async () => {
    const { t, fin, client } = await world();
    const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: "Aug 2026", year: 2026, month: 8, startDate: day("2026-08-01"), endDate: day("2026-08-31") } });
    const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: 1 } });
    const inv = await db.clientInvoice.create({ data: { organizationId: t.org.id, clientId: client.id, runId: run.id, periodId: period.id, invoiceNumber: `INV-${uid()}`, invoiceDate: day("2026-08-31"), dueDate: day("2026-09-30"), subtotal: 100_000, totalAmount: 100_000, createdBy: "test" }, include: { lines: true } });
    await db.$transaction((tx) => postArInvoice(fin, tx, inv));
    await recordReceipt(fin, { invoiceId: inv.id, amount: 40_000, receivedDate: "2026-09-05", method: "TRANSFER" } as never);
    const j = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "AR_RECEIPT" }, include: { lines: true } });
    expect(j.lines.map((l) => l.clientId)).toEqual([client.id, client.id]);
  });

  it("a vendor bill carries its cost centre, and its cancellation mirrors it", async () => {
    const { t, fin, cc } = await world();
    const vendor = await createVendor(fin, { name: `Supplier ${uid()}`, category: "OTHER" });
    const bill = await createPurchaseInvoice(fin, { vendorId: vendor.id, costCenterId: cc.id, description: "Kit", invoiceDate: "2026-09-01", dueDate: "2026-10-01", lines: [{ description: "Boots", quantity: 10, rate: 5000 }] });
    const j = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "AP_INVOICE" }, include: { lines: true } });
    expect(j.lines.find((l) => l.accountCode === "5400")?.costCenterId).toBe(cc.id);
    expect(j.lines.find((l) => l.accountCode === "2180")?.costCenterId).toBeNull();
    await cancelPurchaseInvoice(fin, bill.id, "Raised against the wrong supplier");
    const rev = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "AP_INVOICE_CANCEL" }, include: { lines: true } });
    expect(rev.lines.find((l) => l.accountCode === "5400")?.costCenterId).toBe(cc.id);
    expect((await ledgerByDimension(fin, { dimension: "COST_CENTER" })).rows.find((r) => r.id === cc.id)?.expense).toBe(0);
  });

  it("a fixed asset carries itself, its cost centre and its custodian through acquisition, depreciation and disposal", async () => {
    const { t, fin, hr, cc } = await world();
    const holder = await createEmployee(hr, { firstName: "Ada", lastName: "Okafor", employmentDate: "2025-01-10", categoryId: t.guardId } as never);
    const asset = await createFixedAsset(fin, { name: "Patrol van", category: "VEHICLE", costCenterId: cc.id, assignedToEmployeeId: holder.id, acquisitionDate: "2026-01-15", cost: 12_000_000, usefulLifeMonths: 60, salvageValue: 0 } as never);
    const dims = { fixedAssetId: asset.id, costCenterId: cc.id, employeeId: holder.id };
    const acq = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "FIXED_ASSET_ACQUISITION" }, include: { lines: true } });
    expect(acq.lines.find((l) => l.accountCode === "1240")).toMatchObject(dims);
    expect(acq.lines.find((l) => l.accountCode === "1230")?.fixedAssetId).toBeNull();

    await postDepreciationForMonth(fin, 2026, 3);
    const dep = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "DEPRECIATION" }, include: { lines: true } });
    const expense = dep.lines.find((l) => l.accountCode === "5410")!;
    const accumulated = dep.lines.find((l) => l.accountCode === "1250")!;
    expect(expense).toMatchObject(dims);
    expect(accumulated).toMatchObject(dims);
    expect(Number(expense.debit)).toBe(Number(accumulated.credit));
    expect(Number(expense.debit)).toBeGreaterThan(0);

    await disposeFixedAsset(fin, asset.id, { disposalDate: "2026-04-30", disposalProceeds: 9_000_000, disposalReason: "Sold at auction after the contract ended" } as never);
    const disp = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "FIXED_ASSET_DISPOSAL" }, include: { lines: true } });
    for (const code of ["1240", "1250"]) expect(disp.lines.find((l) => l.accountCode === code)?.fixedAssetId).toBe(asset.id);

    const byAsset = await ledgerByDimension(fin, { dimension: "ASSET" });
    expect(byAsset.rows.find((r) => r.id === asset.id)?.lines).toBe(2); // its profit-and-loss lines: depreciation, and the gain or loss on disposal
    expect((await checkLedgerIntegrity(t.org.id)).findings).toEqual([]);
  });

  it("staff loans carry the employee", async () => {
    const { t, fin, hr } = await world();
    const e = await createEmployee(hr, { firstName: "Bola", lastName: "Adeyemi", employmentDate: "2025-01-10", categoryId: t.guardId } as never);
    await db.$transaction((tx) => postLoanDisbursement(fin, tx, { id: "loan-1", employeeId: e.id, loanNumber: "LN-1", type: "STAFF_LOAN", principal: 50_000, disbursedOn: day("2026-09-01") }));
    const j = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "LOAN_DISBURSEMENT" }, include: { lines: true } });
    expect(j.lines.find((l) => l.accountCode === "1210")?.employeeId).toBe(e.id);
    expect(j.lines.find((l) => l.accountCode === "1230")?.employeeId).toBeNull();
  });
});

describe("the ledger by dimension", () => {
  it("adds up to the whole ledger, shows what isn't analysed, honours dates, and is per organization", async () => {
    const { t, fin, post, lines, client, client2 } = await world();
    const l = lines("1230", "4100", 1000);
    const exp = lines("5400", "1230", 300);
    await post({ lines: [l[0], { ...l[1], dimensions: { clientId: client.id } }] });
    await post({ postingDate: day("2026-09-10"), lines: [{ ...l[0], debit: 400 }, { ...l[1], credit: 400, dimensions: { clientId: client2.id } }] });
    await post({ lines: [{ ...exp[0], dimensions: { clientId: client.id } }, exp[1]] }); // an expense for Alpha
    await post({ lines: lines("1230", "4100", 50) }); // income with no client at all

    const all = await ledgerByDimension(fin, { dimension: "CLIENT" });
    const alpha = all.rows.find((r) => r.id === client.id)!;
    expect([alpha.income, alpha.expense, alpha.net]).toEqual([1000, 300, 700]);
    expect(all.rows.find((r) => r.id === client2.id)?.income).toBe(400);
    const none = all.rows.find((r) => r.id === null)!;
    expect(none.label).toMatch(/Not analysed by client/);
    expect(none.income).toBe(50);
    expect(all.totals).toMatchObject({ income: 1450, expense: 300, net: 1150 });
    expect(all.rows.reduce((a, r) => a + r.net, 0)).toBe(1150);
    // the totals equal the ledger's own income and expense
    const lineSums = await db.journalLine.findMany({ where: { journal: { organizationId: t.org.id } }, include: { account: { select: { type: true } } } });
    const income = lineSums.filter((x) => x.account.type === "INCOME").reduce((a, x) => a + Number(x.credit) - Number(x.debit), 0);
    expect(all.totals.income).toBe(income);

    const september = await ledgerByDimension(fin, { dimension: "CLIENT", from: "2026-09-01", to: "2026-09-30" });
    expect(september.totals.income).toBe(400);
    expect(september.rows.map((r) => r.id)).toEqual([client2.id]);

    const other = await world();
    expect((await ledgerByDimension(other.fin, { dimension: "CLIENT" })).totals.lines).toBe(0);
    await expect(ledgerByDimension(fin, { dimension: "COLOUR" })).rejects.toThrow(/isn't an accounting dimension/);
    await expect(ledgerByDimension(fin, { dimension: "CLIENT", from: "not-a-date" })).rejects.toThrow(/isn't valid/);
    await expect(ledgerByDimension(t.ctx("EMPLOYEE"), { dimension: "CLIENT" })).rejects.toThrow(/permission/i);
    await expect(ledgerByDimension(t.ctx("AUDITOR"), { dimension: "CLIENT" })).resolves.toBeTruthy();
  });
});

describe("dimension masters", () => {
  it("creates regions, branches, profit centres and projects, and keeps them in the organization", async () => {
    const { t, fin, client, betaContract, contract } = await world();
    const zone = await createRegion(fin, { code: "SOUTH", name: "South zone" });
    const region = await createRegion(fin, { code: "SW", name: "South West", parentId: zone.id });
    await createBranch(fin, { code: "LAG", name: "Lagos", regionId: region.id });
    await createProfitCentre(fin, { code: "GRD", name: "Guarding" });
    await createProject(fin, { code: "P1", name: "Alpha pilot", clientId: client.id, contractId: contract.id, startDate: "2026-01-01", endDate: "2026-12-31" });
    const m = await listDimensionMasters(fin);
    expect(m.regions.find((r) => r.code === "SW")?.parent?.code).toBe("SOUTH");
    expect(m.branches[0].region?.code).toBe("SW");
    expect([m.profitCentres.length, m.projects.length]).toEqual([1, 1]);

    const other = await world();
    await expect(createRegion(fin, { code: "XX", name: "Foreign parent", parentId: (await createRegion(other.fin, { code: "OO", name: "Other" })).id })).rejects.toThrow(/parent region doesn't exist/);
    await expect(createBranch(fin, { code: "YY", name: "Foreign region", regionId: "nope" })).rejects.toThrow(/region doesn't exist/);
    await expect(createProject(fin, { code: "P2", name: "Mismatch", clientId: client.id, contractId: betaContract.id })).rejects.toThrow(/doesn't belong to the client/);
    await expect(createProject(fin, { code: "P3", name: "Backwards", startDate: "2026-12-31", endDate: "2026-01-01" })).rejects.toThrow(/can't end before it starts/);
    await expect(createRegion(fin, { code: "SW", name: "Duplicate code" })).rejects.toThrow();
    expect(t.org.id).toBeTruthy();
  });

  it("needs the manage permission to change, the view permission to read, and can't touch another organization's records", async () => {
    const a = await world();
    const b = await world();
    await expect(createRegion(a.hr, { code: "SW", name: "No" })).rejects.toThrow(/permission/i);
    await expect(createProfitCentre(a.t.ctx("AUDITOR"), { code: "GRD", name: "No" })).rejects.toThrow(/permission/i);
    await expect(listDimensionMasters(a.t.ctx("AUDITOR"))).resolves.toBeTruthy();
    const foreign = await createRegion(b.fin, { code: "SW", name: "B's region" });
    await expect(setDimensionActive(a.fin, "REGION", foreign.id, false)).rejects.toThrow(/not found/i);
    expect((await db.region.findUniqueOrThrow({ where: { id: foreign.id } })).active).toBe(true);
  });
});

describe("the integrity check and dimensions", () => {
  it("reports a line that points at another organization's client, or a contract that isn't its client's", async () => {
    const { t, client, contract, betaContract } = await world();
    const other = await world();
    const acct = await db.glAccount.findFirstOrThrow({ where: { organizationId: t.org.id, code: "1230" } });
    const period = await db.accountingPeriod.findFirst({ where: { organizationId: t.org.id } });
    const mk = (n: string, dims: Record<string, string>) =>
      db.journalEntry.create({
        data: { organizationId: t.org.id, entryNumber: n, periodId: period?.id, postingDate: day("2026-08-31"), description: "bad", source: "MANUAL_POST", totalDebit: 10, totalCredit: 10, postedBy: "test", lines: { create: [{ accountId: acct.id, accountCode: "1230", accountName: acct.name, headCode: "x", description: "a", debit: 10, credit: 0, ...dims }, { accountId: acct.id, accountCode: "1230", accountName: acct.name, headCode: "x", description: "b", debit: 0, credit: 10 }] } },
      });
    await mk("JV-D00001", { clientId: other.client.id });
    expect((await checkLedgerIntegrity(t.org.id)).findings.map((f) => f.check)).toContain("LINE_DIMENSION_ORG");

    const fresh = await world();
    const acct2 = await db.glAccount.findFirstOrThrow({ where: { organizationId: fresh.t.org.id, code: "1230" } });
    await db.journalEntry.create({
      data: { organizationId: fresh.t.org.id, entryNumber: "JV-D00002", postingDate: day("2026-08-31"), description: "bad", source: "MANUAL_POST", totalDebit: 10, totalCredit: 10, postedBy: "test", lines: { create: [{ accountId: acct2.id, accountCode: "1230", accountName: acct2.name, headCode: "x", description: "a", debit: 10, credit: 0, clientId: fresh.client.id, contractId: fresh.betaContract.id }, { accountId: acct2.id, accountCode: "1230", accountName: acct2.name, headCode: "x", description: "b", debit: 0, credit: 10 }] } },
    });
    expect((await checkLedgerIntegrity(fresh.t.org.id)).findings.map((f) => f.check)).toContain("LINE_DIMENSION_MISMATCH");
    expect([client.id, contract.id, betaContract.id]).toHaveLength(3);
  });
});
