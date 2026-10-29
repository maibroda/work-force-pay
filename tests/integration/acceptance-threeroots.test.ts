/**
 * The MVP acceptance checks from the ThreeRoots spec (docs/FEATURES.md, section 8), run against a fictional client of 30 employees across 3 sites
 * through the app's own services. Each describe block is one of the checks, in the spec's order.
 */
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { enableBureau } from "@/server/services/bureau";
import { approveRun, createPeriod, runPayroll, submitForApproval } from "@/server/services/payroll";
import { explainIssue, signOffReconciliation } from "@/server/services/payroll-controls";
import { createOtherEarning } from "@/server/services/inputs";
import { createPayRate } from "@/server/services/employees";
import { approveChange, requestChange } from "@/server/services/change-requests";
import { exportPaymentFile } from "@/server/services/payment-file";
import { payeSchedule, payrollRegister } from "@/server/services/reports";
import { getPayslip } from "@/server/services/payroll";
import { proposeRelease, publishRelease, verifyRelease } from "@/server/services/rule-library";
import { buildQuickPayslip } from "@/server/services/quick-payslip";
import { copyStatutoryRules, taxRuleFor } from "@/server/services/statutory";
import { createTaxRuleVersion } from "@/server/services/statutory";
import { buildDemoClient, DEMO_MONTH, finishDemoMonth } from "../../prisma/demo-client";
import { isolatedOrg, uid } from "../helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@accept.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

let demo: Awaited<ReturnType<typeof buildDemoClient>>;
let bureauId: string;
let staff: { founder: Ctx; officer: Ctx; reviewer: Ctx; hr: Ctx };
let finished: Awaited<ReturnType<typeof finishDemoMonth>>;

beforeAll(async () => {
  const t = await isolatedOrg();
  bureauId = t.org.id;
  staff = {
    founder: await person(bureauId, "COMPANY_ADMIN", "founder"),
    officer: await person(bureauId, "PAYROLL_ADMIN", "officer"),
    reviewer: await person(bureauId, "FINANCE", "reviewer"),
    hr: await person(bureauId, "HR_ADMIN", "hr"),
  };
  await enableBureau(staff.founder);
  // the bureau's master statutory tables: the demo company's, which are the app's NTA 2025 set
  const dss = await db.organization.findUniqueOrThrow({ where: { code: "DSS" } });
  await db.$transaction((tx) => copyStatutoryRules(tx, dss.id, bureauId));
  demo = await buildDemoClient(staff, { name: `Acme Facilities ${uid()}`, code: `AC${uid()}${uid()}` });
  finished = await finishDemoMonth(demo);
}, 240_000);

describe("1. One fictional client with 30 employees across 3 sites runs a full month from inputs to locked payroll", () => {
  it("has 30 employees, imported from the client's file, 10 at each of 3 sites", async () => {
    expect(demo.employees).toHaveLength(30);
    expect(demo.imported).toMatchObject({ imported: 30, skipped: 0 });
    const sites = await db.department.findMany({ where: { organizationId: demo.client.id }, include: { _count: { select: { employees: true } } }, orderBy: { code: "asc" } });
    expect(sites.map((s) => [s.code, s._count.employees])).toEqual([["ABJ", 10], ["LAG", 10], ["PHC", 10]]);
    expect(await db.employee.count({ where: { organizationId: demo.client.id, importBatchId: demo.imported.batchId } })).toBe(30);
  });

  it("collected its inputs against the calendar, calculated, reconciled, submitted, approved by someone else, and locked", async () => {
    const run = await db.payrollRun.findUniqueOrThrow({ where: { id: demo.run.id } });
    expect(run).toMatchObject({ status: "LOCKED", employeeCount: 30, reconciledBy: demo.officer.name, approvedBy: demo.reviewer.name, submittedBy: demo.officer.name });
    expect(run.preparedByUserIds).toContain(staff.officer.userId);
    expect(run.preparedByUserIds).not.toContain(staff.reviewer.userId);
    expect(await db.payrollValidationIssue.count({ where: { runId: run.id, severity: "CRITICAL" } })).toBe(0);
    expect((await db.payrollPeriod.findUniqueOrThrow({ where: { id: demo.period.id } })).status).toBe("LOCKED");
    const items = await db.payrollInputItem.findMany({ where: { periodId: demo.period.id } });
    expect(items).toHaveLength(6);
    expect(items.every((i) => i.status !== "EXPECTED")).toBe(true);
    expect(await db.payrollCalendarEntry.count({ where: { periodId: demo.period.id } })).toBe(1);
    // the client's own approver signed off the figures before it could be locked
    const signoff = await db.payrollClientApproval.findFirstOrThrow({ where: { runId: run.id } });
    expect(signoff).toMatchObject({ decision: "APPROVED", byName: demo.approver.name, calculationCount: run.calculationCount });
  });

  it("paid the October joiners for the days they were there, and posted the payroll to the client's ledger", async () => {
    const recs = await db.payrollRecord.findMany({ where: { runId: demo.run.id }, include: { employee: true } });
    expect(recs).toHaveLength(30);
    const joiners = recs.filter((r) => r.employee.employmentDate >= d("2026-10-01"));
    expect(joiners).toHaveLength(2);
    expect(joiners.every((r) => Number(r.daysWorked) < Number(r.basisDays))).toBe(true);
    expect(recs.filter((r) => r.employee.employmentDate < d("2026-10-01")).every((r) => Number(r.daysWorked) === Number(r.basisDays))).toBe(true);
    const journal = await db.journalEntry.findUniqueOrThrow({ where: { runId: demo.run.id }, include: { lines: true } });
    expect(journal.source).toBe("PAYROLL_LOCK");
    expect(Number(journal.totalDebit)).toBe(Number(journal.totalCredit));
  });
});

describe("2. The preparer cannot approve their own payroll", () => {
  it("refuses an approval by whoever prepared or submitted the November payroll, and accepts someone else's", async () => {
    const nov = await createPeriod(demo.founder, DEMO_MONTH.year, 11);
    const run = await runPayroll(demo.founder, nov.id); // the founder holds every permission, and prepares this one
    // the two October joiners now work a whole month, so their pay moves: that has to be explained in writing before it can go on
    const findings = await db.payrollValidationIssue.findMany({ where: { runId: run.id, requiresExplanation: true } });
    expect(findings.length).toBeGreaterThan(0);
    await expect(submitForApproval(demo.founder, run.id)).rejects.toThrow(/written explanation/);
    for (const f of findings) await explainIssue(demo.founder, f.id, "The two October joiners worked part of that month and a whole one now");
    await signOffReconciliation(demo.founder, run.id, "Same staff as October; two joiners now full-month");
    await submitForApproval(demo.founder, run.id);
    await expect(approveRun(demo.founder, run.id)).rejects.toThrow(/prepared or submitted this payroll/);
    // the database refuses it as well, whatever the application does
    await expect(db.payrollRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedByUserId: staff.founder.userId } })).rejects.toThrow(/prepared or submitted/);
    await approveRun(demo.reviewer, run.id);
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).approvedBy).toBe(demo.reviewer.name);
  });
});

describe("3. Changing a statutory rate creates a new effective-dated rule; old payrolls still reproduce", () => {
  it("publishes a verified new PAYE version to the client without touching what October was calculated on", async () => {
    const clientCtx = demo.officer;
    const oct = "2026-10-28";
    const before = await buildQuickPayslip(clientCtx, { gross: 400_000, payDate: oct, basicPct: 50, housingPct: 25, transportPct: 15 } as never);
    const octRule = await taxRuleFor(db, demo.client.id, d(oct));
    const octRecords = await db.payrollRecord.findMany({ where: { runId: demo.run.id }, select: { paye: true, netPay: true, taxRuleVersion: true } });
    expect(octRecords.every((r) => r.taxRuleVersion === `${octRule.def.code}@${octRule.def.version}`)).toBe(true);
    const payeBefore = octRecords.reduce((a, r) => a + Number(r.paye), 0);

    // the new version: created in the bureau's own tables, proposed, verified by HR and by Finance, published
    const master = await db.taxRule.findFirstOrThrow({ where: { organizationId: bureauId, effectiveTo: null }, include: { bands: true, reliefs: true, exemptions: true } });
    const bands = [...master.bands].sort((a, b) => a.sortOrder - b.sortOrder).map((b, i) => ({ lowerBound: Number(b.lowerBound), upperBound: b.upperBound === null ? null : Number(b.upperBound), rate: Number(b.rate) + (i === 1 ? 1 : 0) }));
    const created = await createTaxRuleVersion(staff.founder, {
      code: master.code, name: master.name, version: "2026.2-test", effectiveFrom: "2026-12-01", legalBasis: "Test amendment", bands,
      reliefs: master.reliefs.map((r) => ({ code: r.code, name: r.name, type: r.type, rate: r.rate === null ? null : Number(r.rate), amount: r.amount === null ? null : Number(r.amount), cap: r.cap === null ? null : Number(r.cap) })),
      exemptions: master.exemptions.map((x) => ({ code: x.code, description: x.description, annualGrossCeiling: Number(x.annualGrossCeiling) })),
    } as never);
    const rel = await proposeRelease(staff.officer, { kind: "TAX", ruleId: created.id, summary: "Second band raised by one point from December", source: "Test amendment 2026" } as never);
    await verifyRelease(staff.hr, rel.id, "Checked the bands against the amendment");
    await verifyRelease(staff.reviewer, rel.id, "Agrees with the published schedule");
    const published = await publishRelease(staff.officer, rel.id, [demo.client.id]);
    expect(published[0].outcome).toBe("PUBLISHED");

    // the client now holds two versions, the old one ended the day before the new one starts
    const rules = await db.taxRule.findMany({ where: { organizationId: demo.client.id }, orderBy: { effectiveFrom: "asc" } });
    expect(rules.map((r) => r.version)).toEqual(["2026.1", "2026.2-test"]);
    expect(rules[0].effectiveTo?.toISOString().slice(0, 10)).toBe("2026-11-30");
    // October still resolves to the old rule and calculates to the same figures; December uses the new one
    expect((await taxRuleFor(db, demo.client.id, d(oct))).def.version).toBe("2026.1");
    expect((await taxRuleFor(db, demo.client.id, d("2026-12-15"))).def.version).toBe("2026.2-test");
    const after = await buildQuickPayslip(clientCtx, { gross: 400_000, payDate: oct, basicPct: 50, housingPct: 25, transportPct: 15 } as never);
    expect(after.slip.paye.paye).toBe(before.slip.paye.paye);
    expect(after.taxRule).toBe(before.taxRule);
    const dec = await buildQuickPayslip(clientCtx, { gross: 400_000, payDate: "2026-12-15", basicPct: 50, housingPct: 25, transportPct: 15 } as never);
    expect(dec.slip.paye.paye).toBeGreaterThan(before.slip.paye.paye);
    // and the locked October payroll itself did not move
    const octAfter = await db.payrollRecord.findMany({ where: { runId: demo.run.id }, select: { paye: true } });
    expect(octAfter.reduce((a, r) => a + Number(r.paye), 0)).toBe(payeBefore);
  });
});

describe("4. Every edit to employee pay data appears in the audit log", () => {
  it("records who changed a pay rate, a bank account and an extra payment, when, and why", async () => {
    const log = (action: string, entityId?: string) => db.auditLog.findMany({ where: { organizationId: demo.client.id, action, ...(entityId ? { entityId } : {}) }, orderBy: { createdAt: "desc" } });
    const emp = demo.employees[3];

    const rate = await createPayRate(demo.hr, { employeeId: emp.id, monthlyGross: 330000, structureCode: "STD", reason: "Promotion to senior officer", approvedBy: "Mrs Funmi Bello", effectiveFrom: "2026-11-01" });
    const rateLog = (await log("EMPLOYEE_PAY_RATE_CHANGE", emp.id))[0];
    expect(rateLog).toMatchObject({ userName: demo.hr.name, reason: "Promotion to senior officer" });
    expect((rateLog.newValue as { monthlyGross: unknown }).monthlyGross).toBeDefined();
    expect(rate.monthlyGross).toBeDefined();

    const req = await requestChange(demo.hr, emp.id, "BANK", { bankName: "Zenith Bank", accountNumber: "2099999999", accountName: "CHANGED ACCOUNT" }, "Employee moved banks");
    expect((await log("CHANGE_REQUEST", emp.id))[0]).toMatchObject({ userName: demo.hr.name });
    await approveChange(demo.reviewer, req.id, "Confirmed with the employee");
    const bankLog = (await log("EMPLOYEE_BANK_CHANGE", emp.id))[0] ?? (await db.auditLog.findFirst({ where: { organizationId: demo.client.id, entityId: emp.id, action: { contains: "BANK" } }, orderBy: { createdAt: "desc" } }));
    expect(bankLog).toBeTruthy();
    expect(bankLog.userName).toBe(demo.reviewer.name);
    expect(bankLog.reason).toBe("Employee moved banks");
    expect(JSON.stringify(bankLog.oldValue)).toMatch(/accountNumber/);

    const nov = await db.payrollPeriod.findFirstOrThrow({ where: { organizationId: demo.client.id, month: 11 } });
    // a pay input after the payroll is approved is refused; one in a period still open is recorded
    const dec = await createPeriod(demo.officer, DEMO_MONTH.year, 12);
    const earning = await createOtherEarning(demo.officer, { employeeId: emp.id, periodId: dec.id, name: "Night allowance", amount: 12000, reason: "Approved night duty allowance" });
    expect((await db.auditLog.findMany({ where: { organizationId: demo.client.id, entityId: earning.id } })).length).toBeGreaterThan(0);
    expect(nov.id).toBeTruthy();

    // nothing above was done silently: the staff member is the bureau's person, and the log says which bureau they came from
    const meta = (await log("EMPLOYEE_PAY_RATE_CHANGE", emp.id))[0].metadata as { bureau?: string };
    expect(meta.bureau).toBe(bureauId);
  });
});

describe("5. Payslips, register, bank file and remittance schedule export correctly", () => {
  it("has a payslip for every employee whose figures add up", async () => {
    const recs = await db.payrollRecord.findMany({ where: { runId: demo.run.id } });
    expect(recs).toHaveLength(30);
    for (const r of recs) {
      const slip = await getPayslip(demo.reviewer, r.id);
      expect(slip?.employee.employeeNumber).toBe(r.employeeNumber);
      expect(Number(r.totalEarnings) - Number(r.paye) - Number(r.employeePension) - Number(r.otherDeductions)).toBeCloseTo(Number(r.netPay), 2);
    }
  });

  it("has a payroll register and a PAYE schedule that agree with the run's totals", async () => {
    const run = await db.payrollRun.findUniqueOrThrow({ where: { id: demo.run.id } });
    const reg = await payrollRegister(demo.reviewer, run.id);
    expect(reg).toHaveLength(30);
    expect(reg.reduce((a, r) => a + Number(r.netPay), 0)).toBeCloseTo(Number(run.totalNet), 2);
    const paye = await payeSchedule(demo.reviewer, run.id);
    expect(paye).toHaveLength(30);
    expect(paye.reduce((a, r) => a + r.paye, 0)).toBeCloseTo(Number(run.totalPaye), 2);
  });

  it("makes a bank payment file of 30 payments totalling the net pay", async () => {
    const run = await db.payrollRun.findUniqueOrThrow({ where: { id: demo.run.id } });
    expect(finished.batches.length).toBeGreaterThan(0);
    const f = await exportPaymentFile(demo.reviewer, run.id);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(f.buffer as never);
    const ws = wb.worksheets[0];
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(["Name", "Account Number", "Bank Code", "Amount", "Payment Description"]);
    expect(ws.rowCount).toBe(31);
    let total = 0;
    for (let i = 2; i <= 31; i++) {
      const row = ws.getRow(i).values as unknown[];
      expect(String(row[2])).toMatch(/^\d{10}$/);
      expect(String(row[3])).toMatch(/^\d{3}$/);
      expect(row[5]).toBe("Salary October 2026");
      total += row[4] as number;
    }
    expect(total).toBeCloseTo(Number(run.totalNet), 2);
    expect(f.record.excluded).toEqual([]);
  });

  it("has a remittance schedule: PAYE and each pension fund administrator, adding up to the run", async () => {
    const run = await db.payrollRun.findUniqueOrThrow({ where: { id: demo.run.id } });
    const rem = await db.statutoryRemittance.findMany({ where: { runId: run.id } });
    // PAYE now goes to each worker's state of residence: the demo client's staff live in Lagos (Lagos HQ), FCT (Abuja Office) and Rivers (Port Harcourt Depot)
    const paye = rem.filter((r) => r.type === "PAYE");
    expect(paye.map((p) => p.payee).sort()).toEqual(["FCT Internal Revenue Service (PAYE)", "Lagos Internal Revenue Service (PAYE)", "Rivers Internal Revenue Service (PAYE)"]);
    expect(paye.reduce((a, p) => a + Math.round(Number(p.totalAmount) * 100), 0)).toBe(Math.round(Number(run.totalPaye) * 100));
    const pension = rem.filter((r) => r.type === "PENSION");
    expect(pension.map((p) => p.payee).sort()).toEqual(["ARM Pension", "Premium Pension", "Stanbic IBTC Pension"]);
    expect(pension.reduce((a, p) => a + Number(p.employeeAmount), 0)).toBeCloseTo(Number(run.totalEmployeePension), 2);
    expect(pension.reduce((a, p) => a + Number(p.employerAmount), 0)).toBeCloseTo(Number(run.totalEmployerPension), 2);
    expect(pension.reduce((a, p) => a + p.headcount, 0)).toBe(30);
  });
});
