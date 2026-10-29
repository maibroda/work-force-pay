import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { d, eachDay, iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { addContractRate, createBeat, createClient, createContract } from "@/server/services/clients";
import { createStructure } from "@/server/services/structures";
import { createEmployee, updateEmployee } from "@/server/services/employees";
import { deployEmployee, recordAttendance } from "@/server/services/operations";
import { generateRemittances, listRemittances, remittanceTiming } from "@/server/services/payments";
import { approveRun, createPeriod, lockRun, runPayroll, submitForApproval } from "@/server/services/payroll";
import { copyStatutoryRules, createPayrollRule } from "@/server/services/statutory";
import { ctxFor, explainVariances, isolatedOrg, uid } from "../helpers";

/**
 * The employee's NHF (National Housing Fund) contribution is VOLUNTARY: 2.5% of basic pay, taken only from an employee who has chosen to contribute, and
 * remitted to the appropriate authority by the end of the month. The payroll rule holds the rate (0 = none); each employee carries the choice and the date
 * they made it. Switched on for an employee it is its own payslip line, allowed against PAYE at the amount taken, posted to the ledger and scheduled for
 * remittance. Everything here is invented.
 */
const cents = (n: number) => Math.round(n * 100);

describe("the NHF rate on the payroll rule", () => {
  it("is the standard 2.5% unless set otherwise (it costs no one anything until they opt in), validated, stored with the version, and copied to a new organization", async () => {
    const t = await isolatedOrg();
    const u = await db.user.create({ data: { organizationId: t.org.id, email: `nhf.${uid()}@nhf.test`.toLowerCase(), name: "Admin", role: "COMPANY_ADMIN", passwordHash: "x" } });
    const admin = { userId: u.id, orgId: t.org.id, role: "COMPANY_ADMIN" as const, name: u.name, email: u.email, employeeId: null };
    const base = { prorationBasis: "CALENDAR_DAYS", defaultOperativeSharePct: 70, standardHoursPerDay: 12, overtimeMultiplier: 1.5, maxOvertimeHoursPerMonth: 60, maxDeductionPctOfGross: 33.33, backOfficeChargePct: 15 };
    const standard = await createPayrollRule(admin, { ...base, version: "a", effectiveFrom: "2027-01-01" } as never);
    expect(Number(standard.nhfEmployeeRatePct)).toBe(2.5);
    const off = await createPayrollRule(admin, { ...base, version: "b", effectiveFrom: "2028-01-01", nhfEmployeeRatePct: 0 } as never);
    expect(Number(off.nhfEmployeeRatePct)).toBe(0);
    await expect(createPayrollRule(admin, { ...base, version: "c", effectiveFrom: "2029-01-01", nhfEmployeeRatePct: 101 } as never)).rejects.toThrow();
    await expect(createPayrollRule(admin, { ...base, version: "c", effectiveFrom: "2029-01-01", nhfEmployeeRatePct: -1 } as never)).rejects.toThrow();
    const other = await isolatedOrg();
    await db.$transaction((tx) => copyStatutoryRules(tx, t.org.id, other.org.id));
    expect((await db.payrollRule.findMany({ where: { organizationId: other.org.id }, orderBy: { effectiveFrom: "asc" } })).map((r) => Number(r.nhfEmployeeRatePct))).toEqual([2.5, 0]);
  });
});

describe("an employee's choice to contribute to the NHF", () => {
  it("is off unless chosen, is stored with the date it was chosen, and the date is cleared when they stop (every change is in the audit log)", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: hr.orgId, code: "GUARD" } });
    const base = { firstName: "Nhf", lastName: `Choice${uid()}`, employmentDate: "2027-01-01", categoryId: cat.id };
    const none = await createEmployee(hr, base);
    expect([none.nhfContributes, none.nhfOptedInOn]).toEqual([false, null]);
    const chose = await createEmployee(hr, { ...base, lastName: `Choice${uid()}`, nhfContributes: true });
    expect(chose.nhfContributes).toBe(true);
    expect(chose.nhfOptedInOn?.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
    const stopped = await updateEmployee(hr, chose.id, { ...base, lastName: chose.lastName, nhfContributes: false }, "Asked to stop");
    expect([stopped.nhfContributes, stopped.nhfOptedInOn]).toEqual([false, null]);
    const again = await updateEmployee(hr, chose.id, { ...base, lastName: chose.lastName, nhfContributes: true }, "Asked to start again");
    expect(again.nhfContributes).toBe(true);
    const audit = await db.auditLog.findMany({ where: { organizationId: hr.orgId, entity: "Employee", entityId: chose.id, action: "EMPLOYEE_UPDATE" } });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit.map((a) => a.newValue))).toContain("nhfContributes");
  });
});

describe("a payroll with the employee NHF", () => {
  it("is taken only from employees who chose it, as its own line off net pay, posted to the NHF payable account and scheduled for remittance by month end; the rate at 0 takes nothing", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const hr = await ctxFor("HR_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: admin.orgId, code: "GUARD" } });
    const client = await createClient(admin, { name: `NHF Client ${tag}` });
    const structure = await createStructure(payroll, {
      code: `NH-${tag}`, name: `NHF Structure ${tag}`, effectiveFrom: "2027-01-01", activate: true,
      components: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i], taxable: true, pensionable: c.pensionable })),
    });
    const contract = await createContract(admin, { clientId: client.id, name: "NHF Staff 2027", startDate: "2027-01-01", defaultStructureId: structure.id, operativeSharePct: 70 });
    await addContractRate(admin, { contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: 300000, effectiveFrom: "2027-01-01" });
    const beat = await createBeat(admin, { contractId: contract.id, name: `NHF Site ${tag}`, approvedStrength: 2 });
    const staff: Awaited<ReturnType<typeof createEmployee>>[] = [];
    for (const label of ["One", "Two"]) {
      const e = await createEmployee(hr, { firstName: "Nhf", lastName: `${label}${tag}`, employmentDate: "2027-01-01", categoryId: cat.id, bankName: "GTBank", accountNumber: `74${String(Date.now()).slice(-8)}`, accountName: `NHF ${label} ${tag}`, taxId: `TIN${label}${tag}`, stateOfResidence: "Lagos" });
      await deployEmployee(ops, { employeeId: e.id, beatId: beat.id, startDate: "2027-11-01" });
      await recordAttendance(ops, eachDay(d("2027-11-01"), d("2027-11-30")).map((dt) => ({ employeeId: e.id, beatId: beat.id, date: iso(dt), status: "PRESENT" as const })));
      staff.push(e);
    }
    const [one, two] = staff;
    const period = await createPeriod(payroll, 2027, 11);
    const mine = (runId: string) => db.payrollRecord.findMany({ where: { runId, employeeId: { in: staff.map((s) => s.id) } } });
    const nhfOf = (r: { lines: unknown }) => (r.lines as Array<{ type: string; code: string; amount: number }>).find((l) => l.type === "DEDUCTION" && l.code === "NHF");
    const rule = await db.payrollRule.findFirstOrThrow({ where: { organizationId: payroll.orgId, effectiveTo: null } });
    expect(Number(rule.nhfEmployeeRatePct)).toBe(2.5); // the shipped rate: 2.5% of basic, for those who choose it

    try {
      // as shipped, NOBODY has chosen it, so nothing is taken even though the rule has a rate
      const before = await runPayroll(payroll, period.id);
      const plain = await mine(before.id);
      expect(plain.every((r) => !nhfOf(r))).toBe(true);
      const plainNet = new Map(plain.map((r) => [r.employeeId, num(r.netPay)]));

      // One chooses to contribute; Two does not
      await db.employee.update({ where: { id: one.id }, data: { nhfContributes: true, nhfOptedInOn: d("2027-11-01") } });
      // ...but with the rule's rate at 0 nothing is taken from anyone
      await db.payrollRule.update({ where: { id: rule.id }, data: { nhfEmployeeRatePct: 0 } });
      expect((await mine((await runPayroll(payroll, period.id)).id)).every((r) => !nhfOf(r))).toBe(true);
      await db.payrollRule.update({ where: { id: rule.id }, data: { nhfEmployeeRatePct: 2.5 } });

      const run = await runPayroll(payroll, period.id);
      const records = await mine(run.id);
      const recOne = records.find((r) => r.employeeId === one.id)!;
      const recTwo = records.find((r) => r.employeeId === two.id)!;
      expect(nhfOf(recTwo)).toBeUndefined(); // did not choose it
      expect(num(recTwo.netPay)).toBe(plainNet.get(two.id)); // and is paid exactly as before
      const lines = recOne.lines as Array<{ type: string; code: string; amount: number }>;
      const basic = lines.find((l) => l.type === "EARNING" && l.code === "BASIC")!.amount;
      const nhf = nhfOf(recOne)!;
      expect(cents(nhf.amount)).toBe(Math.floor((cents(basic) * 2.5 + 50) / 100)); // 2.5% of basic, half up to the kobo
      expect(nhf.amount).toBeGreaterThan(0);
      // net pay = earnings - PAYE - pension - NHF - other deductions, and totalDeductions says the same
      expect(cents(num(recOne.netPay))).toBe(cents(num(recOne.totalEarnings)) - cents(num(recOne.paye)) - cents(num(recOne.employeePension)) - cents(nhf.amount) - cents(num(recOne.otherDeductions)));
      expect(cents(num(recOne.totalDeductions))).toBe(cents(num(recOne.paye)) + cents(num(recOne.employeePension)) + cents(nhf.amount) + cents(num(recOne.otherDeductions)));
      // the relief for NHF reduces PAYE, so net pay falls by LESS than the NHF taken
      expect(num(recOne.netPay)).toBeLessThan(plainNet.get(one.id)!);
      expect(plainNet.get(one.id)! - num(recOne.netPay)).toBeLessThanOrEqual(nhf.amount);

      await explainVariances(payroll, run.id);
      await submitForApproval(payroll, run.id);
      await approveRun(fin, run.id);
      await lockRun(fin, run.id);

      // the ledger: the journal balances, and the NHF head is credited to the NHF payable account
      const all = await db.payrollRecord.findMany({ where: { runId: run.id } });
      const nhfAll = all.map(nhfOf).filter((x): x is NonNullable<typeof x> => !!x);
      const nhfTotal = nhfAll.reduce((a, l) => a + cents(l.amount), 0);
      expect(nhfAll.length).toBeGreaterThanOrEqual(1);
      const journal = await db.journalEntry.findUniqueOrThrow({ where: { runId: run.id }, include: { lines: true } });
      expect(journal.lines.reduce((a, l) => a + cents(num(l.debit)) - cents(num(l.credit)), 0)).toBe(0);
      const head = journal.lines.filter((l) => l.headCode === "NHF");
      expect(head).toHaveLength(1);
      expect(head[0].accountCode).toBe("2148");
      expect(cents(num(head[0].credit))).toBe(nhfTotal);

      // the remittance schedule: one line for the authority, the employee share only, due at the end of the pay month
      await generateRemittances(fin, run.id);
      const lines2 = await listRemittances(fin, { runId: run.id });
      const rem = lines2.find((r) => r.payee.startsWith("Federal Mortgage Bank"));
      expect(rem).toBeDefined();
      expect(rem!.type).toBe("NHF_MEDICAL");
      expect(cents(num(rem!.employeeAmount))).toBe(nhfTotal);
      expect(num(rem!.employerAmount)).toBe(0);
      expect(rem!.headcount).toBe(nhfAll.length);
      const timing = await remittanceTiming(fin, lines2, "2027-12-01");
      expect(timing.get(rem!.id)).toMatchObject({ dueDate: "2027-11-30", overdue: true, daysLate: 1, penalty: null });
      expect((await remittanceTiming(fin, lines2, "2027-11-30")).get(rem!.id)).toMatchObject({ dueDate: "2027-11-30", overdue: false });
    } finally {
      await db.payrollRule.update({ where: { id: rule.id }, data: { nhfEmployeeRatePct: 2.5 } });
    }
  });
});
