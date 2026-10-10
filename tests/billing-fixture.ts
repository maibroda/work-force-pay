import { db } from "@/lib/db";
import { ensureDefaultChart } from "@/server/services/accounting";
import { createEmployee } from "@/server/services/employees";
import { isolatedOrg, uid } from "./helpers";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

/**
 * An isolated organization with a chart of accounts and a way to make locked payroll runs with billable charges, so invoicing
 * can be exercised end to end without touching the shared seeded organization.
 */
export async function billingWorld() {
  const t = await isolatedOrg();
  await db.$transaction((tx) => ensureDefaultChart(tx, t.org.id));
  const hr = t.ctx("HR_ADMIN", null, 1);
  let n = 0;

  /** A locked payroll run for a month, to add charges to. */
  const newRun = async (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, "0");
    const period = await db.payrollPeriod.create({ data: { organizationId: t.org.id, name: `${year}-${mm}`, year, month, startDate: day(`${year}-${mm}-01`), endDate: day(`${year}-${mm}-${last}`) } });
    return db.payrollRun.create({ data: { organizationId: t.org.id, periodId: period.id, runNumber: 1, status: "LOCKED" } });
  };

  /** A client contract (new unless given) billed `amount` on a run. */
  const addCharge = async (run: { id: string }, amount: number, existing?: { clientId: string; contractId: string }) => {
    const emp = await createEmployee(hr, { firstName: "Guard", lastName: `No${++n}`, employmentDate: "2025-01-01", categoryId: t.guardId });
    const client = existing ? { id: existing.clientId } : await db.client.create({ data: { organizationId: t.org.id, code: `C${uid()}`, name: `Client ${uid()}` } });
    const contract = existing ? { id: existing.contractId } : await db.contract.create({ data: { organizationId: t.org.id, clientId: client.id, contractNumber: `K${uid()}`, name: `Site ${uid()}`, startDate: day("2025-01-01") } });
    const rec = await db.payrollRecord.create({
      data: {
        organizationId: t.org.id, runId: run.id, employeeId: emp.id, employeeNumber: emp.employeeNumber, employeeName: "Guard", categoryName: "Security Guard",
        basisDays: 30, daysWorked: 30, monthlyGross: 100000, earnedGross: 100000, totalEarnings: 100000, pensionBase: 60000, employeePension: 4800, employerPension: 5400,
        taxableIncome: 90000, paye: 0, totalDeductions: 4800, netPay: 95200, employerCost: 105400, taxRuleVersion: "test", lines: [], locations: [],
      },
    });
    await db.payrollAllocation.create({ data: { organizationId: t.org.id, runId: run.id, recordId: rec.id, employeeId: emp.id, contractId: contract.id, days: 30, grossAmount: 100000, employerPension: 5400, clientBilling: amount, managementShare: 0 } });
    return { clientId: client.id, contractId: contract.id };
  };

  return { t, hr, newRun, addCharge };
}
