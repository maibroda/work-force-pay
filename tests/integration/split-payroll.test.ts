import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { createPaymentBatches } from "@/server/services/payments";
import { exportPaymentFile, paymentFilePreview } from "@/server/services/payment-file";
import { assignPayingBank, createPayingBank, savePayingBank } from "@/server/services/paying-banks";
import { isolatedOrg } from "../helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** A locked October payroll of four (synthetic) people, no payment batches yet, and two paying banks. */
async function world() {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const fin = t.ctx("FINANCE", null, 1);
  const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: "October 2026", year: 2026, month: 10, startDate: d("2026-10-01"), endDate: d("2026-10-31") } });
  const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: 1, status: "LOCKED" } });
  const nets = [100000, 200000.5, 300000, 400000.25];
  const emps = [];
  for (let i = 0; i < nets.length; i++) {
    const e = await createEmployee(hr, { firstName: "Staff", lastName: `Number${i + 1}`, employmentDate: "2025-01-01", categoryId: t.guardId });
    await db.payrollRecord.create({
      data: {
        organizationId: t.org.id, runId: run.id, employeeId: e.id, employeeNumber: e.employeeNumber, employeeName: `Staff Number${i + 1}`, categoryName: "Security Guard",
        bankName: "GTBank", accountNumber: `012345678${i}`, accountName: `STAFF NUMBER${i + 1}`,
        basisDays: 30, daysWorked: 30, monthlyGross: nets[i], earnedGross: nets[i], totalEarnings: nets[i], pensionBase: 0, employeePension: 0, employerPension: 0,
        taxableIncome: nets[i], paye: 0, totalDeductions: 0, netPay: nets[i], employerCost: nets[i], taxRuleVersion: "test", lines: [], locations: [],
      },
    });
    emps.push(e);
  }
  const first = await createPayingBank(fin, { name: "First Bank", builtIn: "FIRST_BANK", debitAccountNumber: "3000000001" });
  const access = await createPayingBank(fin, { name: "Access Bank", builtIn: "ACCESS_BANK" });
  return { t, fin, run, emps, first, access, total: nets.reduce((a, b) => a + b, 0) };
}

describe("splitting one payroll across paying banks", () => {
  it("makes one file per bank from the people assigned to it, and together the files pay everyone exactly once", async () => {
    const w = await world();
    // the first bank created is the default; people with no bank of their own are paid from it
    await assignPayingBank(w.fin, { payingBankId: w.access.id, employeeNumbers: `${w.emps[2].employeeNumber}, ${w.emps[3].employeeNumber}` });
    await assignPayingBank(w.fin, { payingBankId: w.first.id, employeeNumbers: w.emps[0].employeeNumber });
    await createPaymentBatches(w.fin, w.run.id);

    const pf = await paymentFilePreview(w.fin, w.run.id, { payingBankId: w.first.id });
    const pa = await paymentFilePreview(w.fin, w.run.id, { payingBankId: w.access.id });
    // staff 1 chose First, staff 2 chose nobody (so the default, First), staff 3 and 4 chose Access
    expect(pf.rows.map((r) => r.name)).toEqual(["STAFF NUMBER1", "STAFF NUMBER2"]);
    expect(pa.rows.map((r) => r.name)).toEqual(["STAFF NUMBER3", "STAFF NUMBER4"]);
    expect(pf.total).toBe(300000.5);
    expect(pa.total).toBe(700000.25);
    expect(pf.total + pa.total).toBeCloseTo(w.total, 2);
    expect(pf.split.map((s) => [s.name, s.count, s.total])).toEqual([["Access Bank", 2, 700000.25], ["First Bank", 2, 300000.5]]);
    expect(pf.unplaced).toBe(0);

    const ff = await exportPaymentFile(w.fin, w.run.id, { payingBankId: w.first.id });
    const fa = await exportPaymentFile(w.fin, w.run.id, { payingBankId: w.access.id });
    expect([ff.record.rowCount, fa.record.rowCount]).toEqual([2, 2]);
    expect([ff.record.payingBankId, fa.record.payingBankId]).toEqual([w.first.id, w.access.id]);
    expect(Number(ff.record.totalAmount) + Number(fa.record.totalAmount)).toBeCloseTo(w.total, 2);
    // the general file still pays everyone
    expect((await paymentFilePreview(w.fin, w.run.id)).rows).toHaveLength(4);
  });

  it("freezes who is paid from which bank when the payment batches are made", async () => {
    const w = await world();
    await assignPayingBank(w.fin, { payingBankId: w.access.id, employeeNumbers: w.emps[0].employeeNumber });
    await createPaymentBatches(w.fin, w.run.id);
    await assignPayingBank(w.fin, { payingBankId: w.first.id, employeeNumbers: w.emps[0].employeeNumber }); // changed afterwards
    expect((await paymentFilePreview(w.fin, w.run.id, { payingBankId: w.access.id })).rows.map((r) => r.name)).toEqual(["STAFF NUMBER1"]);
    expect((await paymentFilePreview(w.fin, w.run.id, { payingBankId: w.first.id })).rows.map((r) => r.name)).toEqual(["STAFF NUMBER2", "STAFF NUMBER3", "STAFF NUMBER4"]);
  });

  it("says how many people no bank has been chosen for, instead of quietly leaving them out", async () => {
    const w = await world();
    await db.payingBank.updateMany({ where: { organizationId: w.t.org.id }, data: { isDefault: false } }); // no default bank
    await assignPayingBank(w.fin, { payingBankId: w.first.id, employeeNumbers: w.emps[0].employeeNumber });
    await createPaymentBatches(w.fin, w.run.id);
    const p = await paymentFilePreview(w.fin, w.run.id, { payingBankId: w.first.id });
    expect(p.rows).toHaveLength(1);
    expect(p.unplaced).toBe(3);
    expect(p.split.find((s) => s.payingBankId === null)).toMatchObject({ count: 3 });
  });

  it("a default can be chosen, and everyone without a bank of their own follows it", async () => {
    const w = await world();
    await savePayingBank(w.fin, { id: w.access.id, isDefault: true });
    await createPaymentBatches(w.fin, w.run.id);
    expect((await paymentFilePreview(w.fin, w.run.id, { payingBankId: w.access.id })).rows).toHaveLength(4);
    expect((await paymentFilePreview(w.fin, w.run.id, { payingBankId: w.first.id })).rows).toHaveLength(0);
  });

  it("assigns by category too, reports numbers it does not know, and can clear an assignment", async () => {
    const w = await world();
    const r = await assignPayingBank(w.fin, { payingBankId: w.access.id, categoryId: w.t.guardId, employeeNumbers: "EMP-999999" });
    expect(r.notFound).toEqual(["EMP-999999"]);
    expect(r.assigned).toBeGreaterThanOrEqual(4);
    expect((await db.employee.findUniqueOrThrow({ where: { id: w.emps[0].id } })).payingBankId).toBe(w.access.id);
    await assignPayingBank(w.fin, { payingBankId: null, employeeNumbers: w.emps[0].employeeNumber });
    expect((await db.employee.findUniqueOrThrow({ where: { id: w.emps[0].id } })).payingBankId).toBeNull();
    await expect(assignPayingBank(w.fin, { payingBankId: w.access.id })).rejects.toThrow(/Say who/);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "PAYING_BANK_ASSIGN" } })).toBe(2);
  });

  it("will not use another organization's bank or people, and only for those who manage payments", async () => {
    const w = await world();
    const other = await world();
    await expect(assignPayingBank(w.fin, { payingBankId: other.first.id, employeeNumbers: w.emps[0].employeeNumber })).rejects.toThrow(/Paying bank not found/);
    // employee numbers repeat from one organization to the next: a number only ever finds the caller's own person
    const r = await assignPayingBank(w.fin, { payingBankId: w.first.id, employeeNumbers: other.emps[0].employeeNumber });
    expect(r.assigned).toBe(other.emps[0].employeeNumber === w.emps[0].employeeNumber ? 1 : 0);
    expect((await db.employee.findUniqueOrThrow({ where: { id: other.emps[0].id } })).payingBankId).toBeNull();
    await expect(assignPayingBank(w.t.ctx("AUDITOR", null, 1), { payingBankId: w.first.id, employeeNumbers: w.emps[0].employeeNumber })).rejects.toThrow(/permission/);
  });
});
