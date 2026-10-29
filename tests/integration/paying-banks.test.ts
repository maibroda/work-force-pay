import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { createPaymentBatches } from "@/server/services/payments";
import { exportPaymentFile, paymentFilePreview } from "@/server/services/payment-file";
import { createPayingBank, importCodeSet, listPayingBanks, previewCodeList, savePayingBank } from "@/server/services/paying-banks";
import { isolatedOrg } from "../helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
type Staff = { bank: string | null; account: string | null; net: number };

/** A locked October payroll with payment batches, for the (synthetic) people described. */
async function world(staff: Staff[]) {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const fin = t.ctx("FINANCE", null, 1);
  const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: "October 2026", year: 2026, month: 10, startDate: d("2026-10-01"), endDate: d("2026-10-31") } });
  const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: 1, status: "LOCKED" } });
  for (let i = 0; i < staff.length; i++) {
    const s = staff[i];
    const e = await createEmployee(hr, { firstName: "Staff", lastName: `Number${i + 1}`, employmentDate: "2025-01-01", categoryId: t.guardId });
    await db.payrollRecord.create({
      data: {
        organizationId: t.org.id, runId: run.id, employeeId: e.id, employeeNumber: e.employeeNumber, employeeName: `Staff Number${i + 1}`, categoryName: "Security Guard",
        bankName: s.bank, accountNumber: s.account, accountName: `STAFF NUMBER${i + 1}`,
        basisDays: 30, daysWorked: 30, monthlyGross: s.net, earnedGross: s.net, totalEarnings: s.net, pensionBase: 0, employeePension: 0, employerPension: 0,
        taxableIncome: s.net, paye: 0, totalDeductions: 0, netPay: s.net, employerCost: s.net, taxRuleVersion: "test", lines: [], locations: [],
      },
    });
  }
  await createPaymentBatches(fin, run.id);
  return { t, fin, run };
}

const sheet = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.worksheets[0];
  const rows: unknown[][] = [];
  ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  return { name: ws.name, rows, count: wb.worksheets.length };
};

describe("paying banks: setting one up", () => {
  it("starts a bank from the list the bank supplied, as version 1, with blocked entries counted and kept out of use", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE", null, 1);
    const first = await createPayingBank(fin, { name: "First Bank", builtIn: "FIRST_BANK", debitAccountNumber: "2000000001" });
    const access = await createPayingBank(fin, { name: "Access Bank", builtIn: "ACCESS_BANK" });
    const list = await listPayingBanks(fin);
    const f = list.find((b) => b.id === first.id)!;
    const a = list.find((b) => b.id === access.id)!;
    expect(f.latest).toMatchObject({ version: 1, entryCount: 651, blockedCount: 14 });
    expect(f.hasLayout).toBe(true);
    expect(a.latest?.blockedCount).toBe(6);
    expect(a.hasLayout).toBe(true);
    expect(a.layout?.columns.map((c) => c.header)).toEqual(["Beneficiary name", "bank code", "account number", "amount", "narration"]); // Access Bank's template as supplied
    expect(f.latest?.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: { in: ["PAYING_BANK_CREATE", "BANK_CODE_SET_IMPORT"] } } })).toBe(4);
    await expect(createPayingBank(fin, { name: "first bank" })).rejects.toThrow(/already/);
  });

  it("checks a layout and the debit account, and only people who manage payments may change them", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE", null, 1);
    const b = await createPayingBank(fin, { name: "Some Bank" });
    await expect(savePayingBank(fin, { id: b.id, layoutText: "Account = CREDIT_ACCOUNT" })).rejects.toThrow(/bank code/);
    await expect(savePayingBank(fin, { id: b.id, debitAccountNumber: "123" })).rejects.toThrow(/10 digits/);
    const saved = await savePayingBank(fin, { id: b.id, layoutText: "Acct = CREDIT_ACCOUNT\nCode = BANK_CODE\nAmt = AMOUNT\nCurrency = FIXED:NGN", sheetName: "Upload", narrationMax: 30, maxRows: 500 });
    expect(saved.layout).toMatchObject({ narrationMax: 30, maxRows: 500, sheetName: "Upload" });
    await expect(savePayingBank(t.ctx("AUDITOR", null, 1), { id: b.id, active: false })).rejects.toThrow(/permission/);
    await expect(createPayingBank(t.ctx("AUDITOR", null, 1), { name: "Nope" })).rejects.toThrow(/permission/);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "PAYING_BANK_UPDATE" } })).toBe(1);
  });

  it("is private to its organization", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const bank = await createPayingBank(a.ctx("FINANCE", null, 1), { name: "First Bank", builtIn: "FIRST_BANK" });
    expect(await listPayingBanks(b.ctx("FINANCE", null, 1))).toEqual([]);
    await expect(savePayingBank(b.ctx("FINANCE", null, 1), { id: bank.id, active: false })).rejects.toThrow(/not found/);
    await expect(importCodeSet(b.ctx("FINANCE", null, 1), bank.id, "bank_name,bank_code\nX BANK,123", "x.csv")).rejects.toThrow(/not found/);
  });
});

describe("paying banks: code lists", () => {
  it("reads a list and says what would be blocked before anything is saved", async () => {
    const t = await isolatedOrg();
    const p = previewCodeList(t.ctx("FINANCE", null, 1), "bank_name,bank_code\nNIBSS TEST BANK,039\nGOOD BANK,100\nGOOD BANK,100\nTWIN ONE,200\nTWIN TWO,200\nSHORT BANK,95");
    expect(p).toMatchObject({ entryCount: 5, mergedRepeats: 1 });
    expect(p.blocked.map((b) => b.name).sort()).toEqual(["NIBSS TEST BANK", "SHORT BANK", "TWIN ONE", "TWIN TWO"]);
    expect(p.blocked.find((b) => b.name === "SHORT BANK")?.reason).toMatch(/leading zero/);
  });

  it("makes a newer list a new version and never edits the old one", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE", null, 1);
    const bank = await createPayingBank(fin, { name: "Some Bank" });
    const v1 = await importCodeSet(fin, bank.id, "bank_name,bank_code\nALPHA BANK,100\nBETA BANK,200", "list-a.csv");
    const v2 = await importCodeSet(fin, bank.id, "bank_name,bank_code\nALPHA BANK,101\nBETA BANK,200", "list-b.csv");
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(await db.payingBankCode.findMany({ where: { codeSetId: v1.id }, orderBy: { name: "asc" } }).then((x) => x.map((e) => e.code))).toEqual(["100", "200"]);
    await expect(importCodeSet(fin, bank.id, "bank_name,bank_code\n", "empty.csv")).rejects.toThrow(/no banks/);
    await expect(importCodeSet(fin, bank.id, "bank_name,bank_code\nONLY NAME,", "bad.csv")).rejects.toThrow(/needs both/);
    await expect(importCodeSet(t.ctx("AUDITOR", null, 1), bank.id, "bank_name,bank_code\nX,123", "x.csv")).rejects.toThrow(/permission/);
  });
});

describe("paying banks: the file", () => {
  const staff: Staff[] = [
    { bank: "Stanbic IBTC Bank", account: "0123456789", net: 100000.5 },
    { bank: "GTBank", account: "0234567891", net: 80000 },
  ];

  it("uses each bank's own code for the same employee bank: Stanbic is 039 for Access and 221 for First Bank", async () => {
    // two clients with the same payroll, one paying from each bank (the first bank an organization sets up is its default, which everyone without a bank of their own follows)
    const w = await world(staff);
    const first = await createPayingBank(w.fin, { name: "First Bank", builtIn: "FIRST_BANK", debitAccountNumber: "3000000001" });
    const w2 = await world(staff);
    const access = await createPayingBank(w2.fin, { name: "Access Bank", builtIn: "ACCESS_BANK" });
    const pf = await paymentFilePreview(w.fin, w.run.id, { payingBankId: first.id });
    const pa = await paymentFilePreview(w2.fin, w2.run.id, { payingBankId: access.id });
    expect(pf.problems).toEqual([]);
    expect(pa.problems).toEqual([]);
    expect(pf.rows.find((r) => r.accountNumber === "0123456789")?.bankCode).toBe("221");
    expect(pa.rows.find((r) => r.accountNumber === "0123456789")?.bankCode).toBe("039");
    expect(pf.rows.find((r) => r.accountNumber === "0234567891")?.bankCode).toBe("058");
  });

  it("writes First Bank's six headers in order, with the debit account on every row, text accounts and a numeric amount", async () => {
    const w = await world(staff);
    const first = await createPayingBank(w.fin, { name: "First Bank", builtIn: "FIRST_BANK", debitAccountNumber: "3000000001" });
    const f = await exportPaymentFile(w.fin, w.run.id, { payingBankId: first.id });
    const s = await sheet(f.buffer);
    expect(s.count).toBe(1);
    expect(s.rows[0]).toEqual(["DebitAccountNo", "CreditAccountNo", "CreditBankCode", "BeneficiaryName", "Narration", "Amount"]);
    expect(s.rows).toHaveLength(3);
    const r = s.rows.find((x) => x[1] === "0123456789")!;
    expect(r).toEqual(["3000000001", "0123456789", "221", "STAFF NUMBER1", "PAYMENT FOR OCTOBER 2026", 100000.5]);
    expect(typeof r[0]).toBe("string");
    expect(f.fileName).toBe("first-bank-payment-October-2026.xlsx");
    // the record names the bank, the list version and the headers the file used
    expect(f.record).toMatchObject({ payingBankId: first.id, codeSetVersion: 1, layoutHeaders: "DebitAccountNo|CreditAccountNo|CreditBankCode|BeneficiaryName|Narration|Amount" });
  });

  it("writes Access Bank's five headers in its order, with no debit account, text accounts and codes, and a numeric amount", async () => {
    const w = await world(staff);
    const access = await createPayingBank(w.fin, { name: "Access Bank", builtIn: "ACCESS_BANK" });
    const f = await exportPaymentFile(w.fin, w.run.id, { payingBankId: access.id }); // Access's template has no debit account, so none is needed
    const s = await sheet(f.buffer);
    expect(s.rows[0]).toEqual(["Beneficiary name", "bank code", "account number", "amount", "narration"]);
    expect(s.rows.find((x) => x[2] === "0123456789")).toEqual(["STAFF NUMBER1", "039", "0123456789", 100000.5, "PAYMENT FOR OCTOBER 2026"]);
    expect(f.fileName).toBe("access-bank-payment-October-2026.xlsx");
    expect(f.record).toMatchObject({ codeSetVersion: 1, layoutHeaders: "Beneficiary name|bank code|account number|amount|narration" });
  });

  it("keeps the version a past file used when a newer list arrives", async () => {
    const w = await world(staff);
    const first = await createPayingBank(w.fin, { name: "First Bank", builtIn: "FIRST_BANK", debitAccountNumber: "3000000001" });
    const one = await exportPaymentFile(w.fin, w.run.id, { payingBankId: first.id });
    const csv = (await db.payingBankCode.findMany({ where: { codeSet: { payingBankId: first.id, version: 1 } } })).map((e) => `${e.name},${e.code}`).join("\n");
    await importCodeSet(w.fin, first.id, `bank_name,bank_code\n${csv}`, "newer.csv");
    const two = await exportPaymentFile(w.fin, w.run.id, { payingBankId: first.id });
    expect(one.record.codeSetVersion).toBe(1);
    expect(two.record.codeSetVersion).toBe(2);
    expect((await db.paymentFileExport.findUniqueOrThrow({ where: { id: one.record.id } })).codeSetVersion).toBe(1);
  });

  it("never puts a blocked bank in a file: that employee is listed as a problem, with the reason", async () => {
    const w = await world([{ bank: "NIBSS TEST BANK", account: "0123456789", net: 1000 }, { bank: "GTBank", account: "0234567891", net: 2000 }]);
    const bank = await createPayingBank(w.fin, { name: "Test Paying Bank", debitAccountNumber: "3000000009" });
    await savePayingBank(w.fin, { id: bank.id, layoutText: "Debit = DEBIT_ACCOUNT\nAccount = CREDIT_ACCOUNT\nCode = BANK_CODE\nAmount = AMOUNT" });
    await importCodeSet(w.fin, bank.id, "bank_name,bank_code\nNIBSS TEST BANK,039\nGUARANTY TRUST BANK,058", "t.csv");
    const p = await paymentFilePreview(w.fin, w.run.id, { payingBankId: bank.id });
    expect(p.rows.map((r) => r.bankCode)).toEqual(["058"]);
    expect(p.problems).toHaveLength(1);
    expect(p.problems[0].problems.join(" ")).toMatch(/blocked.*test entry/i);
    await expect(exportPaymentFile(w.fin, w.run.id, { payingBankId: bank.id })).rejects.toThrow(/cannot go in the file/);
  });

  it("refuses, saying why, when the bank has no layout, no debit account, an inactive profile, too long a narration or too many rows", async () => {
    const w = await world(staff);
    const first = await createPayingBank(w.fin, { name: "First Bank", builtIn: "FIRST_BANK" }); // the first bank set up is the default
    const unset = await createPayingBank(w.fin, { name: "Some Other Bank" }); // a bank whose upload template is not known yet
    await expect(exportPaymentFile(w.fin, w.run.id, { payingBankId: unset.id })).rejects.toThrow(/upload template.*not been set up/i);
    await expect(exportPaymentFile(w.fin, w.run.id, { payingBankId: first.id })).rejects.toThrow(/debit account/i);

    await savePayingBank(w.fin, { id: first.id, debitAccountNumber: "3000000001", narrationMax: 10 });
    await expect(exportPaymentFile(w.fin, w.run.id, { payingBankId: first.id })).rejects.toThrow(/narration.*10 characters/i);
    await savePayingBank(w.fin, { id: first.id, narrationMax: "", maxRows: 1 });
    await expect(exportPaymentFile(w.fin, w.run.id, { payingBankId: first.id })).rejects.toThrow(/at most 1 row/i);
    await savePayingBank(w.fin, { id: first.id, maxRows: "", active: false });
    await expect(exportPaymentFile(w.fin, w.run.id, { payingBankId: first.id })).rejects.toThrow(/not in use/i);
    expect(await db.paymentFileExport.count({ where: { runId: w.run.id } })).toBe(0);
  });

  it("will not use another organization's paying bank, and the generic file is unchanged without one", async () => {
    const w = await world(staff);
    const other = await isolatedOrg();
    const foreign = await createPayingBank(other.ctx("FINANCE", null, 1), { name: "First Bank", builtIn: "FIRST_BANK", debitAccountNumber: "3000000001" });
    await expect(paymentFilePreview(w.fin, w.run.id, { payingBankId: foreign.id })).rejects.toThrow(/Paying bank not found/);
    const f = await exportPaymentFile(w.fin, w.run.id);
    expect((await sheet(f.buffer)).rows[0]).toEqual(["Name", "Account Number", "Bank Code", "Amount", "Payment Description"]);
    expect(f.record.payingBankId).toBeNull();
  });
});
