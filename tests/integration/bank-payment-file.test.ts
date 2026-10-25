import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { previewEmployeeImport } from "@/server/services/employee-import";
import { bankList, exportPaymentFile, listBankCodes, listExports, paymentFilePreview, saveBankCode } from "@/server/services/payment-file";
import { createPaymentBatches, markBatchPaid } from "@/server/services/payments";
import { isolatedOrg } from "../helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

type Staff = { bank: string | null; account: string | null; accountName?: string | null; net: number };

/** A locked October payroll with one payment batch per bank, for the people described. */
async function world(staff: Staff[], status: "LOCKED" | "CALCULATED" = "LOCKED") {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const fin = t.ctx("FINANCE", null, 1);
  const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: "October 2026", year: 2026, month: 10, startDate: d("2026-10-01"), endDate: d("2026-10-31") } });
  const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: 1, status } });
  const emps = [];
  for (let i = 0; i < staff.length; i++) {
    const s = staff[i];
    const e = await createEmployee(hr, { firstName: "Staff", lastName: `Number${i + 1}`, employmentDate: "2025-01-01", categoryId: t.guardId });
    await db.payrollRecord.create({
      data: {
        organizationId: t.org.id, runId: run.id, employeeId: e.id, employeeNumber: e.employeeNumber, employeeName: `Staff Number${i + 1}`, categoryName: "Security Guard",
        bankName: s.bank, accountNumber: s.account, accountName: s.accountName === undefined ? `STAFF NUMBER${i + 1}` : s.accountName,
        basisDays: 30, daysWorked: 30, monthlyGross: s.net, earnedGross: s.net, totalEarnings: s.net, pensionBase: 0, employeePension: 0, employerPension: 0,
        taxableIncome: s.net, paye: 0, totalDeductions: 0, netPay: s.net, employerCost: s.net, taxRuleVersion: "test", lines: [], locations: [],
      },
    });
    emps.push(e);
  }
  const batches = status === "LOCKED" ? await createPaymentBatches(fin, run.id) : [];
  return { t, hr, fin, run, emps, batches };
}

const read = async (buf: Buffer) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
};

describe("the bank payment file", () => {
  it("is one sheet of Name, Account Number, Bank Code, Amount and Payment Description, with account numbers kept as text", async () => {
    const w = await world([
      { bank: "GTBank", account: "0123456789", net: 95200.5 },
      { bank: "Zenith Bank Plc", account: "2000000001", net: 120000 },
      { bank: "uba", account: "3000000002", net: 80000.25, accountName: null },
    ]);
    const p = await paymentFilePreview(w.fin, w.run.id);
    expect(p.problems).toEqual([]);
    expect(p.rows).toHaveLength(3);
    expect(p.total).toBe(295200.75);
    expect(p.description).toBe("Salary October 2026");

    const f = await exportPaymentFile(w.fin, w.run.id);
    expect(f.fileName).toBe("bank-payment-October-2026.xlsx");
    const wb = await read(f.buffer);
    expect(wb.worksheets).toHaveLength(1);
    const ws = wb.worksheets[0];
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(["Name", "Account Number", "Bank Code", "Amount", "Payment Description"]);
    expect(ws.rowCount).toBe(4);
    const rows = [2, 3, 4].map((i) => (ws.getRow(i).values as unknown[]).slice(1));
    const gt = rows.find((r) => r[2] === "058")!;
    expect(gt).toEqual(["STAFF NUMBER1", "0123456789", "058", 95200.5, "Salary October 2026"]); // leading zero survives; amount is a number
    expect(typeof gt[1]).toBe("string");
    expect(rows.find((r) => r[2] === "033")?.[0]).toBe("Staff Number3"); // no account name: the employee's
    expect(rows.reduce((a, r) => a + (r[3] as number), 0)).toBeCloseTo(295200.75, 2);

    // recorded, with a fingerprint of the file itself
    expect(f.record).toMatchObject({ rowCount: 3, fileName: f.fileName, createdBy: w.fin.name });
    expect(Number(f.record.totalAmount)).toBe(295200.75);
    expect(f.record.checksum).toBe(createHash("sha256").update(f.buffer).digest("hex"));
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "PAYMENT_FILE_EXPORT" } })).toBe(1);
    expect((await listExports(w.fin, w.run.id)).map((x) => x.id)).toEqual([f.record.id]);
    await expect(db.paymentFileExport.update({ where: { id: f.record.id }, data: { rowCount: 1 } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.paymentFileExport.delete({ where: { id: f.record.id } })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("refuses to make a file while anyone's details are unusable, unless they are deliberately left out and named", async () => {
    const w = await world([
      { bank: "GTBank", account: "0123456789", net: 100000 },
      { bank: "GTBank", account: null, net: 90000 },
      { bank: "Moniepoint", account: "1111111111", net: 80000 },
      { bank: "Access Bank", account: "12345", net: 70000 },
    ]);
    const p = await paymentFilePreview(w.fin, w.run.id);
    expect(p.problems).toHaveLength(3);
    expect(p.rows).toHaveLength(1);
    await expect(exportPaymentFile(w.fin, w.run.id)).rejects.toThrow(/3 employee\(s\) cannot go in the file/);
    expect(await db.paymentFileExport.count({ where: { runId: w.run.id } })).toBe(0);

    const f = await exportPaymentFile(w.fin, w.run.id, { leaveOutProblems: true });
    expect(f.record.rowCount).toBe(1);
    const left = f.record.excluded as { employeeNumber: string; problems: string[] }[];
    expect(left.map((x) => x.employeeNumber)).toEqual(p.problems.map((x) => x.employeeNumber));
    expect(left[1].problems[0]).toMatch(/not in the bank list/);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "PAYMENT_FILE_EXPORT" } });
    expect(audit.reason).toMatch(/Left out 3 employee\(s\)/);
  });

  it("is made only from a locked payroll with its batches, only by someone who manages payments, and not again once paid", async () => {
    const open = await world([{ bank: "GTBank", account: "0123456789", net: 1000 }], "CALCULATED");
    await expect(paymentFilePreview(open.fin, open.run.id)).rejects.toThrow(/locked payroll/);

    const w = await world([{ bank: "GTBank", account: "0123456789", net: 1000 }]);
    await db.paymentTransaction.deleteMany({ where: { batch: { runId: w.run.id } } });
    await db.paymentBatch.deleteMany({ where: { runId: w.run.id } });
    await expect(paymentFilePreview(w.fin, w.run.id)).rejects.toThrow(/Create the payment batches/);

    const x = await world([{ bank: "GTBank", account: "0123456789", net: 1000 }]);
    await expect(exportPaymentFile(x.t.ctx("AUDITOR", null, 1), x.run.id)).rejects.toThrow(/permission/);
    await expect(paymentFilePreview(x.t.ctx("FINANCE", null, 2), w.run.id)).rejects.toThrow(/Payroll run not found/); // another organization's run
    await markBatchPaid(x.fin, x.batches[0].id);
    await expect(exportPaymentFile(x.fin, x.run.id)).rejects.toThrow(/already been marked paid/);
  });

  it("warns, without dropping anyone, when two people share an account", async () => {
    const w = await world([
      { bank: "GTBank", account: "0123456789", net: 1000 },
      { bank: "GTB", account: "0123456789", net: 2000 },
    ]);
    const p = await paymentFilePreview(w.fin, w.run.id);
    expect(p.rows).toHaveLength(2);
    expect(p.warnings).toHaveLength(1);
  });

  it("uses the details frozen with the payroll, not what the employee's record says now", async () => {
    const w = await world([{ bank: "GTBank", account: "0123456789", net: 1000 }]);
    await db.employee.update({ where: { id: w.emps[0].id }, data: { bankName: "Zenith Bank", accountNumber: "9999999999" } });
    const p = await paymentFilePreview(w.fin, w.run.id);
    expect(p.rows[0]).toMatchObject({ accountNumber: "0123456789", bankCode: "058" });
  });
});

describe("the bank list", () => {
  it("starts from the standard list for each organization and is corrected or extended there", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE", null, 1);
    const list = await listBankCodes(fin);
    expect(list.find((b) => b.name === "GTBank")?.code).toBe("058");
    expect((await bankList(db, t.org.id)).length).toBe(list.length); // not started twice

    await saveBankCode(fin, { name: "Moniepoint MFB", code: "50515", aliases: "Moniepoint, Monie Point" } as never);
    expect((await listBankCodes(fin)).find((b) => b.name === "Moniepoint MFB")).toMatchObject({ code: "50515", aliases: ["Moniepoint", "Monie Point"], active: true });
    // naming an existing bank corrects it
    await saveBankCode(fin, { name: "gtbank", code: "999", aliases: "GTB" } as never);
    expect((await listBankCodes(fin)).find((b) => b.name === "GTBank")?.code).toBe("999");
    await expect(saveBankCode(fin, { name: "Bad", code: "12" } as never)).rejects.toThrow(/3 to 6 digits/);
    await expect(saveBankCode(t.ctx("AUDITOR", null, 1), { name: "Nope Bank", code: "123" } as never)).rejects.toThrow(/permission/);
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: { in: ["BANK_CODE_CREATE", "BANK_CODE_UPDATE"] } } })).toBe(2);
  });

  it("won't let one name answer to two different codes", async () => {
    const t = await isolatedOrg();
    const fin = t.ctx("FINANCE", null, 1);
    await expect(saveBankCode(fin, { name: "Another Bank", code: "777", aliases: "Zenith" } as never)).rejects.toThrow(/already uses a name that this entry would also answer to/);
    await saveBankCode(fin, { name: "Another Bank", code: "777", aliases: "Another" } as never);
  });

  it("is what employee import checks bank names against", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN", null, 1);
    const csv = "First Name,Last Name,Employment Date,Category,Bank Name,Account Number,Account Name\nAda,Obi,01/02/2026,GUARD,Moniepoint,0123456789,ADA OBI\nBayo,Ade,01/02/2026,GUARD,GTBank,0123456780,BAYO ADE";
    const before = await previewEmployeeImport(hr, csv);
    expect(before.rows[0].warnings.join(" ")).toMatch(/Bank "Moniepoint" is not in the bank list/);
    expect(before.rows[1].warnings.join(" ")).not.toMatch(/bank list/);
    await saveBankCode(t.ctx("FINANCE", null, 1), { name: "Moniepoint MFB", code: "50515", aliases: "Moniepoint" } as never);
    expect((await previewEmployeeImport(hr, csv)).rows[0].warnings.join(" ")).not.toMatch(/bank list/);
  });
});
