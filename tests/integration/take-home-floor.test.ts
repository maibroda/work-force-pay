import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { num } from "@/lib/money";
import { createEmployee } from "@/server/services/employees";
import { approveLoan, getLoan, requestLoan, scheduleInstallments } from "@/server/services/loans";
import { approveRun, createPeriod, lockRun, runPayroll, submitForApproval } from "@/server/services/payroll";
import { copyStatutoryRules, createPayrollRule } from "@/server/services/statutory";
import { ctxFor, explainVariances, isolatedOrg, uid } from "../helpers";

/**
 * The take-home floor: a payroll-rule setting (% of gross, 0 = none) that limits loan and salary-advance recoveries. The part not taken is not lost: at lock the
 * recovery is recorded as what was really taken, so the loan book (which works its balance out from its instalments) still shows the rest as owed and the next
 * schedule picks it up. Everything here is invented.
 */
const cents = (n: number) => Math.round(n * 100);

describe("the take-home floor on the payroll rule", () => {
  it("is 0 unless set, validated, stored with the version, and copied to a new organization", async () => {
    const t = await isolatedOrg();
    const u = await db.user.create({ data: { organizationId: t.org.id, email: `floor.${uid()}@floor.test`.toLowerCase(), name: "Admin", role: "COMPANY_ADMIN", passwordHash: "x" } });
    const admin = { userId: u.id, orgId: t.org.id, role: "COMPANY_ADMIN" as const, name: u.name, email: u.email, employeeId: null };
    const base = { prorationBasis: "CALENDAR_DAYS", defaultOperativeSharePct: 70, standardHoursPerDay: 12, overtimeMultiplier: 1.5, maxOvertimeHoursPerMonth: 60, maxDeductionPctOfGross: 33.33, backOfficeChargePct: 15 };
    const none = await createPayrollRule(admin, { ...base, version: "a", effectiveFrom: "2027-01-01" } as never);
    expect(Number(none.minTakeHomePctOfGross)).toBe(0);
    const on = await createPayrollRule(admin, { ...base, version: "b", effectiveFrom: "2028-01-01", minTakeHomePctOfGross: 50 } as never);
    expect(Number(on.minTakeHomePctOfGross)).toBe(50);
    await expect(createPayrollRule(admin, { ...base, version: "c", effectiveFrom: "2029-01-01", minTakeHomePctOfGross: 101 } as never)).rejects.toThrow();
    const other = await isolatedOrg();
    await db.$transaction((tx) => copyStatutoryRules(tx, t.org.id, other.org.id));
    expect((await db.payrollRule.findMany({ where: { organizationId: other.org.id }, orderBy: { effectiveFrom: "asc" } })).map((r) => Number(r.minTakeHomePctOfGross))).toEqual([0, 50]);
  });
});

describe("a loan recovery cut by the floor", () => {
  it("is flagged at calculation, recorded as what was really taken at lock, the rest stays owed on the loan, and the next month's schedule picks it up", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const fin = await ctxFor("FINANCE");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: hr.orgId, code: "OFF" } });
    const emp = await createEmployee(hr, { firstName: "Floor", lastName: `Borrower${uid()}`, employmentDate: "2025-01-01", categoryId: cat.id, bankName: "GTBank", accountNumber: `75${String(Date.now()).slice(-8)}`, accountName: `FLOOR BORROWER ${uid()}`, taxId: `TINFLOOR${uid()}`, stateOfResidence: "Lagos" });
    await db.employeePayRate.create({ data: { organizationId: hr.orgId, employeeId: emp.id, monthlyGross: 100000, reason: "Test", approvedBy: "Test", effectiveFrom: new Date("2025-01-01T00:00:00Z") } });

    // a 200,000 loan over 8 months: 25,000 a month, first taken in February 2028
    const loan = await requestLoan(hr, { employeeId: emp.id, type: "LOAN", principal: 200000, installmentCount: 8, reason: "School fees", firstDeductionYear: 2028, firstDeductionMonth: 2 });
    await approveLoan(fin, loan.id);
    const feb = await createPeriod(payroll, 2028, 2);
    expect((await scheduleInstallments(hr, feb.id)).scheduled).toBeGreaterThanOrEqual(1);
    const ded = await db.deduction.findFirstOrThrow({ where: { employeeId: emp.id, periodId: feb.id } });
    expect(num(ded.amount)).toBe(25000);

    const rule = await db.payrollRule.findFirstOrThrow({ where: { organizationId: payroll.orgId, effectiveTo: null } });
    // a 90% floor leaves room for only a few thousand naira of the 25,000
    await db.payrollRule.update({ where: { id: rule.id }, data: { minTakeHomePctOfGross: 90 } });
    try {
      const run = await runPayroll(payroll, feb.id);
      const rec = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: emp.id } });
      const lines = rec.lines as Array<{ type: string; code: string; amount: number; deductionId?: string; deferred?: number; name: string }>;
      const loanLine = lines.find((l) => l.type === "DEDUCTION" && l.code === "LOAN")!;
      expect(loanLine.deductionId).toBe(ded.id);
      expect(loanLine.amount).toBeLessThan(25000);
      expect(loanLine.deferred).toBeCloseTo(25000 - loanLine.amount, 2);
      expect(loanLine.name).toMatch(/deferred: take-home floor/);
      // take-home is held at the floor, to the kobo
      expect(cents(num(rec.netPay))).toBe(cents(num(rec.totalEarnings) * 0.9));
      // the finding is a warning, so the payroll is not stopped
      const issue = await db.payrollValidationIssue.findFirst({ where: { runId: run.id, employeeId: emp.id, code: "DEDUCTION_DEFERRED" } });
      expect(issue?.severity).toBe("WARNING");
      // nothing about the loan has changed yet: it is only written back when the payroll is locked
      expect(num((await db.deduction.findUniqueOrThrow({ where: { id: ded.id } })).amount)).toBe(25000);

      await explainVariances(payroll, run.id);
      await submitForApproval(payroll, run.id);
      await approveRun(fin, run.id);
      await lockRun(fin, run.id);

      const taken = loanLine.amount;
      expect(num((await db.deduction.findUniqueOrThrow({ where: { id: ded.id } })).amount)).toBe(taken);
      expect((await db.deduction.findUniqueOrThrow({ where: { id: ded.id } })).status).toBe("PROCESSED");
      expect(num((await db.loanInstallment.findFirstOrThrow({ where: { deductionId: ded.id } })).amount)).toBe(taken);
      const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: payroll.orgId, action: "DEDUCTION_DEFERRED", entityId: ded.id } });
      expect(audit.oldValue).toMatchObject({ amount: 25000 });
      expect(audit.newValue).toMatchObject({ amount: taken });

      // the loan book: only what was taken is repaid; the rest is still owed and not yet scheduled
      const after = await getLoan(hr, loan.id);
      expect(after).toMatchObject({ repaid: taken, scheduled: 0, outstanding: 200000 - taken, unscheduled: 200000 - taken });

      // next month the schedule takes a full instalment again (the balance is still above one instalment)
      const mar = await createPeriod(payroll, 2028, 3);
      await scheduleInstallments(hr, mar.id);
      expect(num((await db.deduction.findFirstOrThrow({ where: { employeeId: emp.id, periodId: mar.id } })).amount)).toBe(25000);
    } finally {
      await db.payrollRule.update({ where: { id: rule.id }, data: { minTakeHomePctOfGross: 0 } });
    }
  });
});
