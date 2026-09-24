import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eachDay, iso, monthEnd, monthStart } from "@/lib/dates";
import { num } from "@/lib/money";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { addContractRate, createBeat, createClient, createContract } from "@/server/services/clients";
import { createStructure } from "@/server/services/structures";
import { createEmployee } from "@/server/services/employees";
import { deployEmployee, recordAttendance } from "@/server/services/operations";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import {
  createRecurringDeductionRule,
  setRecurringDeductionRuleActive,
} from "@/server/services/deduction-rules";
import { ctxFor, uid } from "../helpers";

const pct = (arr: number[]) =>
  DEFAULT_EARNINGS.map((c, i) => ({
    code: c.code,
    name: c.name,
    calcType: "PERCENTAGE" as const,
    percentage: arr[i],
    taxable: true,
    pensionable: c.pensionable,
  }));

async function setUpBeat(
  admin: Awaited<ReturnType<typeof ctxFor>>,
  tag: string,
  year: number,
  month: number,
) {
  const from = iso(monthStart(year, month));
  const client = await createClient(admin, { name: `Recurring Ded Client ${tag}` });
  const structure = await createStructure(admin, {
    code: `RD-${tag}`,
    name: `Recurring Ded Structure ${tag}`,
    effectiveFrom: from,
    activate: true,
    components: pct([10, 14, 15, 5, 15, 20, 2.5, 5, 13.5]),
  });
  const contract = await createContract(admin, {
    clientId: client.id,
    name: `Contract ${tag}`,
    startDate: from,
    defaultStructureId: structure.id,
    operativeSharePct: 70,
    businessLine: "GUARDING",
  });
  const cat = await db.employeeCategory.findFirstOrThrow({
    where: { organizationId: admin.orgId, code: "GUARD" },
  });
  await addContractRate(admin, {
    contractId: contract.id,
    categoryId: cat.id,
    salaryStructureId: structure.id,
    agreedRate: 120000,
    effectiveFrom: from,
  });
  const beat = await createBeat(admin, {
    contractId: contract.id,
    name: `Site ${tag}`,
    approvedStrength: 1,
  });
  return { cat, beat };
}

async function hireAndDeploy(
  admin: Awaited<ReturnType<typeof ctxFor>>,
  ops: Awaited<ReturnType<typeof ctxFor>>,
  categoryId: string,
  beatId: string,
  tag: string,
  year: number,
  month: number,
) {
  const from = iso(monthStart(year, month));
  const emp = await createEmployee(admin, {
    firstName: "RecurringDed",
    lastName: `Staff${tag}`,
    employmentDate: from,
    categoryId,
    bankName: "GTBank",
    accountNumber: `71${String(Date.now()).slice(-8)}`,
    accountName: `RECURRING DED STAFF ${tag}`,
  });
  await deployEmployee(ops, { employeeId: emp.id, beatId, startDate: from });
  await recordAttendance(
    ops,
    eachDay(monthStart(year, month), monthEnd(year, month)).map((dt) => ({
      employeeId: emp.id,
      beatId,
      date: iso(dt),
      status: "PRESENT" as const,
    })),
  );
  return emp;
}

describe("recurring deduction rules (Global / Location / Individual)", () => {
  it("applies Global to every paid employee and Location only to employees who worked that beat", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const tag = uid();

    const siteA = await setUpBeat(admin, `A${tag}`, 2027, 4);
    const siteB = await setUpBeat(admin, `B${tag}`, 2027, 4);
    const empA = await hireAndDeploy(admin, ops, siteA.cat.id, siteA.beat.id, `A${tag}`, 2027, 4);
    const empB = await hireAndDeploy(admin, ops, siteB.cat.id, siteB.beat.id, `B${tag}`, 2027, 4);

    await createRecurringDeductionRule(admin, {
      name: "Development Levy",
      code: `DEV_LEVY_${tag}`,
      scope: "GLOBAL",
      calcType: "FIXED_AMOUNT",
      fixedAmount: 500,
      effectiveFrom: "2027-04-01",
      reason: "Company-wide development levy",
    });
    await createRecurringDeductionRule(admin, {
      name: `Site A Radio Rental`,
      code: `SITE_LEVY_${tag}`,
      scope: "LOCATION",
      beatId: siteA.beat.id,
      calcType: "FIXED_AMOUNT",
      fixedAmount: 300,
      effectiveFrom: "2027-04-01",
      reason: "Radio rental recovered from guards at Site A",
    });

    const period = await createPeriod(payroll, 2027, 4);
    const run = await runPayroll(payroll, period.id);

    const recA = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: empA.id } });
    const recB = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: empB.id } });

    const linesA = recA.lines as Array<{ code: string; amount: number }>;
    const linesB = recB.lines as Array<{ code: string; amount: number }>;

    // Global applies to both
    expect(linesA.find((l) => l.code === `DEV_LEVY_${tag}`)?.amount).toBe(500);
    expect(linesB.find((l) => l.code === `DEV_LEVY_${tag}`)?.amount).toBe(500);

    // Location applies only to the employee who worked at Site A
    expect(linesA.find((l) => l.code === `SITE_LEVY_${tag}`)?.amount).toBe(300);
    expect(linesB.find((l) => l.code === `SITE_LEVY_${tag}`)).toBeUndefined();

    // Both deductions reduce net pay
    expect(num(recA.totalDeductions)).toBeGreaterThanOrEqual(800);
  });

  it("Individual + percentage-of-gross computes off the employee's total earnings, and deactivating stops it", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const tag = uid();

    const site = await setUpBeat(admin, `I${tag}`, 2027, 5);
    const emp = await hireAndDeploy(admin, ops, site.cat.id, site.beat.id, `I${tag}`, 2027, 5);

    const rule = await createRecurringDeductionRule(admin, {
      name: "Cooperative Contribution",
      code: `COOP_${tag}`,
      scope: "INDIVIDUAL",
      employeeId: emp.id,
      calcType: "PERCENTAGE_OF_GROSS",
      percentage: 5,
      effectiveFrom: "2027-05-01",
      reason: "Employee opted into the staff cooperative",
    });

    const period = await createPeriod(payroll, 2027, 5);
    const run = await runPayroll(payroll, period.id);
    const rec = await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: emp.id } });
    const lines = rec.lines as Array<{ code: string; amount: number }>;
    const line = lines.find((l) => l.code === `COOP_${tag}`);
    expect(line).toBeTruthy();
    expect(line!.amount).toBeCloseTo(num(rec.totalEarnings) * 0.05, 2);

    await setRecurringDeductionRuleActive(admin, rule.id, false);
    const run2 = await runPayroll(payroll, period.id);
    const rec2 = await db.payrollRecord.findFirstOrThrow({ where: { runId: run2.id, employeeId: emp.id } });
    const lines2 = rec2.lines as Array<{ code: string; amount: number }>;
    expect(lines2.find((l) => l.code === `COOP_${tag}`)).toBeUndefined();
  });
});
