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
  assignCostCenter,
  costCenterActuals,
  createCostCenter,
  setCostCenterBudget,
} from "@/server/services/cost-centers";
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

describe("cost centers", () => {
  it("resolves each allocation to exactly one cost center — beat's own assignment beats its contract's", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const tag = uid();
    const year = 2027;
    const month = 6;
    const from = iso(monthStart(year, month));

    const client = await createClient(admin, { name: `CC Client ${tag}` });
    const structure = await createStructure(admin, {
      code: `CC-${tag}`,
      name: `CC Structure ${tag}`,
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
    const beat = await createBeat(admin, { contractId: contract.id, name: `Site ${tag}`, approvedStrength: 1 });

    const emp = await createEmployee(admin, {
      firstName: "CostCenter",
      lastName: `Staff${tag}`,
      employmentDate: from,
      categoryId: cat.id,
      bankName: "GTBank",
      accountNumber: `72${String(Date.now()).slice(-8)}`,
      accountName: `COST CENTER STAFF ${tag}`,
    });
    await deployEmployee(ops, { employeeId: emp.id, beatId: beat.id, startDate: from });
    await recordAttendance(
      ops,
      eachDay(monthStart(year, month), monthEnd(year, month)).map((dt) => ({
        employeeId: emp.id,
        beatId: beat.id,
        date: iso(dt),
        status: "PRESENT" as const,
      })),
    );

    const ccContract = await createCostCenter(admin, { code: `CC_CONTRACT_${tag}`, name: "Via Contract" });
    const ccBeat = await createCostCenter(admin, { code: `CC_BEAT_${tag}`, name: "Via Beat" });
    await assignCostCenter(admin, "CONTRACT", contract.id, ccContract.id);
    await assignCostCenter(admin, "BEAT", beat.id, ccBeat.id);

    const period = await createPeriod(payroll, year, month);
    const run = await runPayroll(payroll, period.id);
    const rows = await costCenterActuals(admin, run.id);

    const viaBeat = rows.find((r) => r.costCenterId === ccBeat.id)!;
    const viaContract = rows.find((r) => r.costCenterId === ccContract.id)!;
    expect(viaBeat.headcount).toBe(1);
    expect(viaBeat.revenue).toBeGreaterThan(0);
    // The beat's own assignment wins — nothing is attributed to the contract's cost center.
    expect(viaContract.headcount).toBe(0);
    expect(viaContract.revenue).toBe(0);

    await setCostCenterBudget(admin, {
      costCenterId: ccBeat.id,
      year,
      month,
      budgetedAmount: num(viaBeat.cost) - 1000,
    });
    const budgets = await db.costCenterBudget.findMany({ where: { costCenterId: ccBeat.id } });
    expect(budgets).toHaveLength(1);
    expect(num(budgets[0].budgetedAmount)).toBe(num(viaBeat.cost) - 1000);
  });

  it("groups unassigned allocations separately without dropping them from the total", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    // July 2026 is already locked/paid in the seed and has billed activity with no cost centers configured.
    const julyRun = await db.payrollRun.findFirstOrThrow({
      where: { organizationId: payroll.orgId, type: "REGULAR", status: { in: ["LOCKED", "PAID"] } },
      orderBy: [{ period: { year: "asc" } }, { period: { month: "asc" } }],
    });
    const rows = await costCenterActuals(admin, julyRun.id);
    const unassigned = rows.find((r) => r.costCenterId === "UNASSIGNED");
    expect(unassigned).toBeTruthy();
    expect(unassigned!.revenue).toBeGreaterThan(0);
  });
});
