import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { monthEnd, monthStart } from "@/lib/dates";
import { nextMonth } from "@/lib/loans";
import { createEmployee } from "@/server/services/employees";
import { todayUtc } from "@/server/services/hr-policy";
import { approveExit, completeExitTask, initiateExit } from "@/server/services/hr";
import {
  approveLoan,
  cancelLoan,
  employeeLoanBalances,
  getLoan,
  listLoans,
  loansSummary,
  recordCashRepayment,
  rejectLoan,
  requestLoan,
  scheduleInstallments,
  writeOffLoan,
} from "@/server/services/loans";
import {
  addLoanRecovery,
  approveSettlement,
  prepareSettlement,
  releaseSettlement,
  submitSettlement,
} from "@/server/services/settlements";
import { isolatedOrg } from "../helpers";

const next = () => nextMonth(todayUtc());

async function setup(withPay = true) {
  const t = await isolatedOrg();
  const emp = await createEmployee(t.ctx("HR_ADMIN"), { firstName: "Borrow", lastName: "Er", employmentDate: "2025-01-01", categoryId: t.officeId });
  if (withPay)
    await db.employeePayRate.create({
      data: { organizationId: t.org.id, employeeId: emp.id, monthlyGross: 100000, reason: "Test", approvedBy: "Test", effectiveFrom: new Date("2025-01-01T00:00:00Z") },
    });
  const n = next();
  const period = await db.payrollPeriod.create({
    data: { organizationId: t.org.id, name: `Period ${n.year}-${n.month}`, year: n.year, month: n.month, startDate: monthStart(n.year, n.month), endDate: monthEnd(n.year, n.month) },
  });
  return { t, emp, period, hr: t.ctx("HR_ADMIN"), fin: t.ctx("FINANCE"), pay: t.ctx("PAYROLL_ADMIN") };
}

const base = (employeeId: string) => ({ employeeId, type: "LOAN" as const, principal: 200000, installmentCount: 8, reason: "School fees" });

describe("requesting a loan", () => {
  it("enforces the affordability limits from the HR policy, counting what is already owed", async () => {
    const { emp, hr } = await setup();
    await expect(requestLoan(hr, { ...base(emp.id), principal: 400000 })).rejects.toThrow(/3× monthly gross/);
    await expect(requestLoan(hr, { ...base(emp.id), installmentCount: 4 })).rejects.toThrow(/33% of monthly gross/); // 50,000 a month vs 33,000
    await expect(requestLoan(hr, { ...base(emp.id), type: "SALARY_ADVANCE", principal: 60000 })).rejects.toThrow(/50%/);
    const ok = await requestLoan(hr, base(emp.id)); // 200,000 over 8 = 25,000 a month
    expect(ok.loanNumber).toMatch(/^LN-/);
    expect(Number(ok.installmentAmount)).toBe(25000);
    expect(ok.status).toBe("PENDING_APPROVAL");
    // a second loan on top would pass 3× gross (200k + 150k > 300k)
    await expect(requestLoan(hr, { ...base(emp.id), principal: 150000, installmentCount: 12 })).rejects.toThrow(/3× monthly gross/);
    // an advance is measured separately and needs one instalment
    const adv = await requestLoan(hr, { employeeId: emp.id, type: "SALARY_ADVANCE", principal: 40000, installmentCount: 6, reason: "Emergency" });
    expect(adv.installmentCount).toBe(1);
  });

  it("can't lend without a pay reference, to someone who has left, or without permission", async () => {
    const none = await setup(false);
    await expect(requestLoan(none.hr, base(none.emp.id))).rejects.toThrow(/can borrow after their first payroll/);
    const { t, emp, hr } = await setup();
    await expect(requestLoan(t.ctx("AUDITOR"), base(emp.id))).rejects.toThrow();
    await db.employee.update({ where: { id: emp.id }, data: { status: "RESIGNED" } });
    await expect(requestLoan(hr, base(emp.id))).rejects.toThrow(/isn't a current employee/);
  });
});

describe("approving, paying out and the GL", () => {
  it("needs a different person, posts a balanced disbursement, and can be rejected or cancelled while pending", async () => {
    const { t, emp, hr, fin } = await setup();
    const loan = await requestLoan(hr, base(emp.id));
    await expect(approveLoan(hr, loan.id)).rejects.toThrow(); // HR can't approve
    await expect(approveLoan({ ...fin, userId: hr.userId }, loan.id)).rejects.toThrow(/someone else/);
    const a = await approveLoan(fin, loan.id, "Within policy");
    expect(a.status).toBe("ACTIVE");
    expect(a.disbursedOn).toBeTruthy();
    await expect(approveLoan(fin, loan.id)).rejects.toThrow(/already active/);

    const j = await db.journalEntry.findFirstOrThrow({ where: { organizationId: t.org.id, source: "LOAN_DISBURSEMENT" }, include: { lines: true } });
    expect(Number(j.totalDebit)).toBe(200000);
    expect(j.lines.find((l) => l.accountCode === "1210")!.debit.toString()).toBe("200000");
    expect(j.lines.find((l) => l.accountCode === "1230")!.credit.toString()).toBe("200000");

    const r = await requestLoan(hr, { employeeId: emp.id, type: "SALARY_ADVANCE", principal: 20000, reason: "Rent" });
    await expect(rejectLoan(fin, r.id, "")).rejects.toThrow(/reason/);
    expect((await rejectLoan(fin, r.id, "Already holding a loan")).status).toBe("REJECTED");
    const c = await requestLoan(hr, { employeeId: emp.id, type: "SALARY_ADVANCE", principal: 10000, reason: "Fares" });
    expect((await cancelLoan(hr, c.id)).status).toBe("CANCELLED");
    await expect(cancelLoan(hr, loan.id)).rejects.toThrow(/awaiting approval/);
  });
});

describe("repaying through payroll", () => {
  async function activeLoan() {
    const s = await setup();
    const loan = await requestLoan(s.hr, base(s.emp.id));
    await approveLoan(s.fin, loan.id);
    return { ...s, loan };
  }

  it("schedules each instalment as an approved deduction, once per period, and counts it repaid when payroll locks", async () => {
    const { emp, period, hr, loan } = await activeLoan();
    const r = await scheduleInstallments(hr, period.id);
    expect(r).toMatchObject({ scheduled: 1, total: 25000 });
    const ded = await db.deduction.findFirstOrThrow({ where: { employeeId: emp.id, periodId: period.id } });
    expect(ded).toMatchObject({ deductionType: "LOAN", status: "APPROVED", authorityReference: loan.loanNumber });
    expect(Number(ded.amount)).toBe(25000);
    expect(ded.reason).toMatch(/instalment 1 of 8/);

    expect((await scheduleInstallments(hr, period.id)).skipped[0].reason).toMatch(/already scheduled/); // safe to re-run
    expect(await db.deduction.count({ where: { employeeId: emp.id, periodId: period.id } })).toBe(1);

    let l = await getLoan(hr, loan.id);
    expect(l).toMatchObject({ repaid: 0, scheduled: 25000, outstanding: 200000, unscheduled: 175000 });

    await db.deduction.update({ where: { id: ded.id }, data: { status: "PROCESSED" } }); // what locking the payroll does
    l = await getLoan(hr, loan.id);
    expect(l).toMatchObject({ repaid: 25000, scheduled: 0, outstanding: 175000 });
  });

  it("frees a rejected deduction to be scheduled again, and won't schedule into a locked period", async () => {
    const { emp, period, hr, loan } = await activeLoan();
    await scheduleInstallments(hr, period.id);
    const ded = await db.deduction.findFirstOrThrow({ where: { employeeId: emp.id, periodId: period.id } });
    await db.deduction.update({ where: { id: ded.id }, data: { status: "REJECTED" } });
    expect((await getLoan(hr, loan.id))!.unscheduled).toBe(200000);
    expect((await scheduleInstallments(hr, period.id)).scheduled).toBe(1); // dead deduction ignored

    await db.payrollPeriod.update({ where: { id: period.id }, data: { status: "LOCKED" } });
    await expect(scheduleInstallments(hr, period.id)).rejects.toThrow(/open period/);
  });

  it("starts at the first deduction month, and skips people who have left", async () => {
    const { t, emp, hr, fin } = await setup();
    const n = next();
    const later = nextMonth(new Date(Date.UTC(n.year, n.month - 1, 15)));
    const loan = await requestLoan(hr, { ...base(emp.id), firstDeductionYear: later.year, firstDeductionMonth: later.month });
    await approveLoan(fin, loan.id);
    const early = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect((await scheduleInstallments(hr, early.id)).scheduled).toBe(0); // first repayment is a month later
    expect(await db.deduction.count({ where: { employeeId: emp.id } })).toBe(0);
  });
});

describe("cash repayment, completion and write-off", () => {
  it("takes cash repayments (and posts them), caps them at what isn't queued, and shows a repaid loan as completed", async () => {
    const s = await setup();
    const loan = await requestLoan(s.hr, { ...base(s.emp.id), principal: 90000, installmentCount: 6 });
    await approveLoan(s.fin, loan.id);
    await scheduleInstallments(s.hr, s.period.id); // 15,000 queued in payroll
    await expect(recordCashRepayment(s.hr, loan.id, { amount: 80000 })).rejects.toThrow(/Only 75000/);
    await recordCashRepayment(s.hr, loan.id, { amount: 75000, reference: "Transfer 4411" });
    expect(await getLoan(s.hr, loan.id)).toMatchObject({ repaid: 75000, scheduled: 15000, unscheduled: 0, outstanding: 15000 });
    await expect(recordCashRepayment(s.hr, loan.id, { amount: 1 })).rejects.toThrow(/already queued in payroll/);
    const j = await db.journalEntry.findFirstOrThrow({ where: { organizationId: s.t.org.id, source: "LOAN_REPAYMENT" } });
    expect(Number(j.totalDebit)).toBe(75000);

    const ded = await db.deduction.findFirstOrThrow({ where: { employeeId: s.emp.id } });
    await db.deduction.update({ where: { id: ded.id }, data: { status: "PROCESSED" } });
    const done = (await listLoans(s.hr, { status: "COMPLETED" })).find((l) => l.id === loan.id);
    expect(done).toBeTruthy();
    expect(done!.effectiveStatus).toBe("COMPLETED");
    await expect(recordCashRepayment(s.hr, loan.id, { amount: 1 })).rejects.toThrow(/Only 0/);
  });

  it("writes off a balance only with a reason, a second person, and nothing queued — and posts it", async () => {
    const s = await setup();
    const loan = await requestLoan(s.hr, base(s.emp.id));
    await approveLoan(s.fin, loan.id);
    await scheduleInstallments(s.hr, s.period.id);
    await expect(writeOffLoan(s.fin, loan.id, "No")).rejects.toThrow(/why/);
    await expect(writeOffLoan(s.fin, loan.id, "Employee untraceable")).rejects.toThrow(/queued in payroll/);
    const ded = await db.deduction.findFirstOrThrow({ where: { employeeId: s.emp.id } });
    await db.deduction.update({ where: { id: ded.id }, data: { status: "PROCESSED" } });
    await expect(writeOffLoan(s.hr, loan.id, "Employee untraceable")).rejects.toThrow(); // HR lacks loan.approve
    const w = await writeOffLoan(s.fin, loan.id, "Employee untraceable");
    expect(w.status).toBe("WRITTEN_OFF");
    expect(Number(w.writtenOffAmount)).toBe(175000);
    const j = await db.journalEntry.findFirstOrThrow({ where: { organizationId: s.t.org.id, source: "LOAN_WRITE_OFF" }, include: { lines: true } });
    expect(j.lines.find((l) => l.accountCode === "5420")!.debit.toString()).toBe("175000");
    expect(await employeeLoanBalances(s.t.org.id, s.emp.id)).toHaveLength(0);
  });

  it("summarizes what is owed and what is waiting", async () => {
    const s = await setup();
    const loan = await requestLoan(s.hr, base(s.emp.id));
    await requestLoan(s.hr, { employeeId: s.emp.id, type: "SALARY_ADVANCE", principal: 30000, reason: "Fares" });
    await approveLoan(s.fin, loan.id);
    await scheduleInstallments(s.hr, s.period.id);
    expect(await loansSummary(s.hr)).toMatchObject({ pending: 1, pendingValue: 30000, active: 1, outstanding: 200000, queuedInPayroll: 25000 });
  });
});

describe("loan balance at exit", () => {
  it("is recovered on the settlement as a deduction recorded against the loan", async () => {
    const s = await setup();
    const loan = await requestLoan(s.hr, base(s.emp.id));
    await approveLoan(s.fin, loan.id);
    await scheduleInstallments(s.hr, s.period.id); // 25,000 already queued; 175,000 is not

    const lwd = monthEnd(s.period.year, s.period.month).toISOString().slice(0, 10);
    const exit = await initiateExit(s.hr, { employeeId: s.emp.id, exitType: "RESIGNATION", noticeDate: lwd, lastWorkingDate: lwd, reason: "Moving abroad" });
    await approveExit(s.hr, exit.id);
    const st = await prepareSettlement(s.pay, exit.id, { monthlyGrossOverride: 100000 });

    await expect(addLoanRecovery(s.t.ctx("AUDITOR"), st.id)).rejects.toThrow();
    const lines = await addLoanRecovery(s.pay, st.id);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].amount)).toBe(175000);
    expect(lines[0]).toMatchObject({ code: "LOAN", kind: "DEDUCTION", manual: true, loanId: loan.id });
    await expect(addLoanRecovery(s.pay, st.id)).rejects.toThrow(/already on this settlement/);

    await submitSettlement(s.pay, st.id);
    for (const task of await db.exitTask.findMany({ where: { exitRecordId: exit.id, status: "PENDING", blocksSettlement: true } })) await completeExitTask(s.hr, task.id);
    await approveSettlement(s.fin, st.id);
    await releaseSettlement(s.fin, st.id, s.period.id);

    const inst = await db.loanInstallment.findFirstOrThrow({ where: { loanId: loan.id, kind: "SETTLEMENT" } });
    expect(Number(inst.amount)).toBe(175000);
    expect(inst.deductionId).toBeTruthy();
    // 25,000 + 175,000 are now both queued; nothing is left unscheduled
    expect(await getLoan(s.hr, loan.id)).toMatchObject({ scheduled: 200000, unscheduled: 0, outstanding: 200000 });
    await db.deduction.updateMany({ where: { employeeId: s.emp.id }, data: { status: "PROCESSED" } });
    expect((await getLoan(s.hr, loan.id))!.effectiveStatus).toBe("COMPLETED");
  });
});
