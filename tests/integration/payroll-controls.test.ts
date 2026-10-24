import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createEmployee } from "@/server/services/employees";
import { approveRun, overrideIssue, returnRun, submitForApproval } from "@/server/services/payroll";
import { explainIssue, reconciliationFor, setVariancePolicy, signOffReconciliation, varianceIssues } from "@/server/services/payroll-controls";
import { isolatedOrg } from "../helpers";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

/** An isolated organisation with a locked June payroll (the previous one) and a calculated July payroll to prepare. */
async function world(opts: { julyNets?: number[]; junNets?: number[] } = {}) {
  const t = await isolatedOrg();
  const hr = t.ctx("HR_ADMIN", null, 1);
  const prep = t.ctx("PAYROLL_ADMIN", null, 1);
  const prep2 = t.ctx("PAYROLL_ADMIN", null, 2);
  const fin = t.ctx("FINANCE", null, 1);
  const fin2 = t.ctx("FINANCE", null, 2);
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const emps: { id: string; employeeNumber: string }[] = [];
  const junNets = opts.junNets ?? [100000, 100000, 100000];
  const julNets = opts.julyNets ?? [100000, 100000, 100000];
  for (let i = 0; i < Math.max(junNets.length, julNets.length); i++)
    emps.push(await createEmployee(hr, { firstName: "Staff", lastName: `No${i + 1}`, employmentDate: "2025-01-01", categoryId: t.guardId }));

  const mkPeriod = (month: number, name: string) =>
    db.payrollPeriod.create({ data: { organizationId: t.org.id, name, year: 2026, month, startDate: day(`2026-${String(month).padStart(2, "0")}-01`), endDate: day(`2026-${String(month).padStart(2, "0")}-${month === 6 ? 30 : 31}`) } });
  const record = (runId: string, e: { id: string; employeeNumber: string }, net: number) =>
    db.payrollRecord.create({
      data: {
        organizationId: t.org.id, runId, employeeId: e.id, employeeNumber: e.employeeNumber, employeeName: "Staff", categoryName: "Security Guard",
        basisDays: 30, daysWorked: 30, monthlyGross: net * 1.2, earnedGross: net * 1.2, totalEarnings: net * 1.2, pensionBase: 0, employeePension: 0, employerPension: 0,
        taxableIncome: net, paye: 0, totalDeductions: 0, netPay: net, employerCost: net * 1.3, taxRuleVersion: "test", lines: [], locations: [],
      },
    });

  const jun = await mkPeriod(6, "2026-06");
  const junRun = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: jun.id, runNumber: 1, status: "LOCKED", employeeCount: junNets.length } });
  for (let i = 0; i < junNets.length; i++) await record(junRun.id, emps[i], junNets[i]);

  const jul = await mkPeriod(7, "2026-07");
  const julRun = await db.payrollRun.create({
    data: { organizationId: t.org.id, periodId: jul.id, runNumber: 1, status: "CALCULATED", employeeCount: julNets.length, calculatedBy: prep.name, preparedByUserIds: [prep.userId] },
  });
  for (let i = 0; i < julNets.length; i++) await record(julRun.id, emps[i], julNets[i]);
  return { t, hr, prep, prep2, fin, fin2, admin, emps, jun, jul, junRun, julRun };
}

describe("payroll maker-checker", () => {
  it("won't let whoever prepared or submitted a payroll approve it", async () => {
    const w = await world();
    // the preparer holds both permissions here: a finance user who also calculated the run
    await db.payrollRun.update({ where: { id: w.julRun.id }, data: { preparedByUserIds: [w.prep.userId, w.fin.userId] } });
    await submitForApproval(w.prep, w.julRun.id);
    await expect(approveRun(w.fin, w.julRun.id)).rejects.toThrow(/prepared or submitted this payroll/);

    // and someone who only submitted it can't either
    await returnRun(w.fin2, w.julRun.id, "Back to the preparer for a recheck");
    await submitForApproval(w.admin, w.julRun.id);
    await expect(approveRun(w.admin, w.julRun.id)).rejects.toThrow(/prepared or submitted this payroll/);

    // a different person can, and it is recorded
    await approveRun(w.fin2, w.julRun.id);
    const after = await db.payrollRun.findUniqueOrThrow({ where: { id: w.julRun.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.approvedBy).toBe(w.fin2.name);
    expect(after.approvedByUserId).toBe(w.fin2.userId);
    expect(after.submittedByUserId).toBe(w.admin.userId);
  });

  it("is backed by the database, which refuses an approval by a preparer or with no approver recorded", async () => {
    const w = await world();
    await submitForApproval(w.prep, w.julRun.id);
    await expect(
      db.payrollRun.update({ where: { id: w.julRun.id }, data: { status: "APPROVED", approvedByUserId: w.prep.userId } }),
    ).rejects.toThrow(/prepared or submitted this payroll/);
    await expect(db.payrollRun.update({ where: { id: w.julRun.id }, data: { status: "APPROVED" } })).rejects.toThrow(/must record who approved/);
    await db.payrollRun.update({ where: { id: w.julRun.id }, data: { status: "APPROVED", approvedByUserId: w.fin2.userId } });
  });

  it("returning a payroll clears its submission and approval", async () => {
    const w = await world();
    await submitForApproval(w.prep, w.julRun.id);
    await approveRun(w.fin, w.julRun.id);
    await returnRun(w.fin2, w.julRun.id, "Returned for a correction to overtime");
    const r = await db.payrollRun.findUniqueOrThrow({ where: { id: w.julRun.id } });
    expect(r).toMatchObject({ status: "CALCULATED", submittedBy: null, approvedBy: null, approvedByUserId: null });
  });

  it("won't let the preparer override a validation error on their own payroll", async () => {
    const w = await world();
    await db.payrollRun.update({ where: { id: w.julRun.id }, data: { preparedByUserIds: [w.prep.userId, w.fin.userId] } });
    const issue = await db.payrollValidationIssue.create({
      data: { organizationId: w.t.org.id, runId: w.julRun.id, category: "BANK", severity: "CRITICAL", code: "BANK_MISSING", message: "No bank details" },
    });
    await expect(overrideIssue(w.fin, issue.id, "Payment withheld pending HR bank verification")).rejects.toThrow(/someone else has to override/);
    await overrideIssue(w.fin2, issue.id, "Payment withheld pending HR bank verification");
    expect((await db.payrollValidationIssue.findUniqueOrThrow({ where: { id: issue.id } })).overridden).toBe(true);
  });
});

describe("payroll variance findings and explanations", () => {
  it("raises findings against the previous payroll and holds submission until each is explained", async () => {
    const w = await world({ junNets: [100000, 100000, 100000, 100000], julyNets: [100000, 160000, 100000, 100000] });
    const period = { year: 2026, month: 7, startDate: day("2026-07-01"), endDate: day("2026-07-31") };
    const current = w.emps.slice(0, 4).map((e, i) => ({ id: e.id, label: `${e.employeeNumber} Staff`, net: [100000, 160000, 100000, 100000][i], gross: 0 }));
    const found = await varianceIssues(w.t.org.id, period, current, w.emps.map((e) => ({ id: e.id, status: "ACTIVE", employmentDate: day("2025-01-01"), exitDate: null })));
    expect(found.map((f) => f.code).sort()).toEqual(["EMPLOYEE_NET_VARIANCE", "TOTAL_NET_VARIANCE"]);
    expect(found.every((f) => f.requiresExplanation && f.severity === "WARNING")).toBe(true);

    const rows = [];
    for (const f of found)
      rows.push(await db.payrollValidationIssue.create({ data: { organizationId: w.t.org.id, runId: w.julRun.id, employeeId: f.employeeId, category: f.category, severity: f.severity, code: f.code, message: f.message, requiresExplanation: true } }));

    await expect(submitForApproval(w.prep, w.julRun.id)).rejects.toThrow(/2 variance finding\(s\) still need a written explanation/);
    await expect(explainIssue(w.prep, rows[0].id, "short")).rejects.toThrow(/at least 10/);
    await expect(explainIssue(w.t.ctx("AUDITOR", null, 1), rows[0].id, "A proper explanation here")).rejects.toThrow(/permission/);
    await explainIssue(w.prep, rows[0].id, "Backdated allowance paid with this month's salary");
    await expect(submitForApproval(w.prep, w.julRun.id)).rejects.toThrow(/1 variance finding\(s\)/);
    await explainIssue(w.prep, rows[1].id, "Same cause as the individual change");
    await submitForApproval(w.prep, w.julRun.id);

    // once submitted, explanations are no longer edited
    await expect(explainIssue(w.prep, rows[0].id, "Changing my story afterwards")).rejects.toThrow(/before it is submitted/);
    const stored = await db.payrollValidationIssue.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(stored.explainedBy).toBe(w.prep.name);
    expect(stored.explainedByUserId).toBe(w.prep.userId);
  });

  it("raises nothing for the first payroll, and uses the latest earlier approved payroll", async () => {
    const t = await isolatedOrg();
    const period = { year: 2026, month: 7, startDate: day("2026-07-01"), endDate: day("2026-07-31") };
    expect(await varianceIssues(t.org.id, period, [{ id: "x", label: "x", net: 1, gross: 1 }], [])).toEqual([]);
  });

  it("follows the organisation's limits, which only someone who manages settings can change", async () => {
    const w = await world({ junNets: [100000, 100000], julyNets: [100000, 130000] });
    const period = { year: 2026, month: 7, startDate: day("2026-07-01"), endDate: day("2026-07-31") };
    const current = [{ id: w.emps[0].id, label: "a", net: 100000, gross: 0 }, { id: w.emps[1].id, label: "b", net: 130000, gross: 0 }];
    const emps = w.emps.slice(0, 2).map((e) => ({ id: e.id, status: "ACTIVE", employmentDate: day("2025-01-01"), exitDate: null }));
    expect((await varianceIssues(w.t.org.id, period, current, emps)).length).toBe(2); // +30% person and +15% total
    await expect(setVariancePolicy(w.fin, { headcountPct: 5, employeePct: 50, totalPct: 50, minAmount: 5000, reconciliationRequired: false })).rejects.toThrow(/permission/);
    await setVariancePolicy(w.admin, { headcountPct: 5, employeePct: 50, totalPct: 50, minAmount: 5000, reconciliationRequired: false });
    expect(await varianceIssues(w.t.org.id, period, current, emps)).toEqual([]);
    await expect(setVariancePolicy(w.admin, { headcountPct: -1, employeePct: 50, totalPct: 50, minAmount: 5000, reconciliationRequired: false })).rejects.toThrow();
  });
});

describe("reconciliation to the previous payroll", () => {
  it("bridges headcount and pay, and calls out people who appear or drop out without a record", async () => {
    // June paid staff 1-3; July pays staff 1, 2 and 4
    const w = await world({ junNets: [100000, 100000, 100000], julyNets: [100000, 100000, 100000] });
    await db.payrollRecord.deleteMany({ where: { runId: w.julRun.id, employeeId: w.emps[2].id } });
    await db.employee.update({ where: { id: w.emps[2].id }, data: { status: "RESIGNED", exitDate: day("2026-07-10") } });
    const extra = await createEmployee(w.hr, { firstName: "Late", lastName: "Joiner", employmentDate: "2026-07-05", categoryId: w.t.guardId });
    const ghost = await createEmployee(w.hr, { firstName: "Back", lastName: "Again", employmentDate: "2024-01-01", categoryId: w.t.guardId });
    for (const e of [extra, ghost])
      await db.payrollRecord.create({
        data: { organizationId: w.t.org.id, runId: w.julRun.id, employeeId: e.id, employeeNumber: e.employeeNumber, employeeName: "x", categoryName: "c", basisDays: 30, daysWorked: 30, monthlyGross: 1, earnedGross: 1, totalEarnings: 60000, pensionBase: 0, employeePension: 0, employerPension: 0, taxableIncome: 1, paye: 0, totalDeductions: 0, netPay: 50000, employerCost: 1, taxRuleVersion: "t", lines: [], locations: [] },
      });

    const view = await reconciliationFor(w.prep, w.julRun.id);
    expect(view.prior?.periodName).toBe("2026-06");
    expect(view.bridge.priorHeadcount).toBe(3);
    expect(view.bridge.currentHeadcount).toBe(4);
    expect(view.bridge.joiners.map((x) => x.id)).toEqual([extra.id]);
    expect(view.bridge.leavers.map((x) => x.id)).toEqual([w.emps[2].id]);
    expect(view.bridge.otherAdded.map((x) => x.id)).toEqual([ghost.id]);
    expect(view.unexplainedMovements).toBe(1);
    expect(view.bridge.balanced).toBe(true);
    expect(view.bridge.net).toMatchObject({ prior: 300000, joiners: 50000, leavers: -100000, otherAdded: 50000, current: 300000 });

    await expect(signOffReconciliation(w.prep, w.julRun.id, "")).rejects.toThrow(/without a joiner or leaver record/);
    await signOffReconciliation(w.prep, w.julRun.id, "Back Again returned from unpaid leave on the 1st");
    const r = await db.payrollRun.findUniqueOrThrow({ where: { id: w.julRun.id } });
    expect(r.reconciledBy).toBe(w.prep.name);
    expect(r.reconciliationNote).toMatch(/unpaid leave/);
  });

  it("holds submission until it is signed off, when the organisation requires it", async () => {
    const w = await world();
    await submitForApproval(w.prep, w.julRun.id); // not required: goes through
    await returnRun(w.fin, w.julRun.id, "Back for one more look at this");
    await setVariancePolicy(w.admin, { headcountPct: 5, employeePct: 20, totalPct: 10, minAmount: 5000, reconciliationRequired: true });
    await expect(submitForApproval(w.prep, w.julRun.id)).rejects.toThrow(/not been reconciled/);
    await signOffReconciliation(w.prep, w.julRun.id, "Nobody joined or left");
    await submitForApproval(w.prep, w.julRun.id);
    await expect(signOffReconciliation(w.prep, w.julRun.id, "Again after submission")).rejects.toThrow(/before it is submitted/);
  });

  it("needs a note when there is nothing to reconcile to", async () => {
    const t = await isolatedOrg();
    const hr = t.ctx("HR_ADMIN", null, 1);
    const prep = t.ctx("PAYROLL_ADMIN", null, 1);
    const e = await createEmployee(hr, { firstName: "Only", lastName: "One", employmentDate: "2026-01-01", categoryId: t.guardId });
    const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: "2026-01", year: 2026, month: 1, startDate: day("2026-01-01"), endDate: day("2026-01-31") } });
    const run = await db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: 1, status: "CALCULATED", preparedByUserIds: [prep.userId] } });
    await db.payrollRecord.create({
      data: { organizationId: t.org.id, runId: run.id, employeeId: e.id, employeeNumber: e.employeeNumber, employeeName: "x", categoryName: "c", basisDays: 30, daysWorked: 30, monthlyGross: 1, earnedGross: 1, totalEarnings: 1, pensionBase: 0, employeePension: 0, employerPension: 0, taxableIncome: 1, paye: 0, totalDeductions: 0, netPay: 1, employerCost: 1, taxRuleVersion: "t", lines: [], locations: [] },
    });
    const view = await reconciliationFor(prep, run.id);
    expect(view.prior).toBeNull();
    expect(view.bridge.hasPrior).toBe(false);
    await expect(signOffReconciliation(prep, run.id, "")).rejects.toThrow(/no earlier payroll/);
    await signOffReconciliation(prep, run.id, "First payroll for this client; opening run");
  });
});
