import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eachDay, iso, monthEnd, monthStart } from "@/lib/dates";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { addContractRate, createBeat, createClient, createContract } from "@/server/services/clients";
import { createStructure } from "@/server/services/structures";
import { createEmployee } from "@/server/services/employees";
import { deployEmployee, recordAttendance } from "@/server/services/operations";
import { createPeriod, runPayroll } from "@/server/services/payroll";
import { approveChange, requestChange } from "@/server/services/change-requests";
import { ctxFor, uid } from "../helpers";

/**
 * Runs real payroll for an employee whose bank details were just changed, in a period no other test uses,
 * and checks that payroll validation asks for a second look — and only for that employee.
 */
const pct = (arr: number[]) =>
  DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: arr[i], taxable: true, pensionable: c.pensionable }));

describe("payroll validation: recently changed bank details", () => {
  it("warns for an employee whose account changed inside the watch window, not for one whose account didn't", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const hr = await ctxFor("HR_ADMIN");
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const [year, month] = [2029, 6];
    const from = iso(monthStart(year, month));

    const client = await createClient(admin, { name: `Change Control Client ${tag}` });
    const structure = await createStructure(admin, { code: `CC-${tag}`, name: `CC Structure ${tag}`, effectiveFrom: from, activate: true, components: pct([10, 14, 15, 5, 15, 20, 2.5, 5, 13.5]) });
    const contract = await createContract(admin, { clientId: client.id, name: `CC Contract ${tag}`, startDate: from, defaultStructureId: structure.id, operativeSharePct: 70, businessLine: "GUARDING" });
    const cat = await db.employeeCategory.findFirstOrThrow({ where: { organizationId: admin.orgId, code: "GUARD" } });
    await addContractRate(admin, { contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: 120000, effectiveFrom: from });
    const beat = await createBeat(admin, { contractId: contract.id, name: `CC Site ${tag}`, approvedStrength: 2 });

    const hire = async (label: string, account: string) => {
      const emp = await createEmployee(admin, { firstName: "ChangeCtl", lastName: `${label}${tag}`, employmentDate: from, categoryId: cat.id, bankName: "GTBank", accountNumber: account, accountName: `CHANGECTL ${label.toUpperCase()}${tag}` });
      await deployEmployee(ops, { employeeId: emp.id, beatId: beat.id, startDate: from });
      await recordAttendance(ops, eachDay(monthStart(year, month), monthEnd(year, month)).map((dt) => ({ employeeId: emp.id, beatId: beat.id, date: iso(dt), status: "PRESENT" as const })));
      return emp;
    };
    const stamp = String(Date.now()).slice(-7);
    const mover = await hire("Mover", `61${stamp}1`);
    const steady = await hire("Steady", `61${stamp}2`);

    const r = await requestChange(hr, mover.id, "BANK", { bankName: "Zenith Bank", accountNumber: `62${stamp}3`, accountName: `CHANGECTL MOVER${tag}` }, "Employee opened a new account");
    await approveChange(fin, r.id, "Confirmed with the employee");

    const period = await createPeriod(payroll, year, month);
    const run = await runPayroll(payroll, period.id);
    const issues = await db.payrollValidationIssue.findMany({ where: { runId: run.id, code: "BANK_RECENTLY_CHANGED" } });
    expect(issues.map((i) => i.employeeId)).toEqual([mover.id]);
    expect(issues[0]).toMatchObject({ severity: "WARNING", category: "BANK" });
    expect(issues[0].message).toMatch(/Bank details changed on \d{4}-\d{2}-\d{2} \(requested by .+, approved by .+\) — confirm with the employee/);
    expect(issues.some((i) => i.employeeId === steady.id)).toBe(false);
    // a warning, not a blocker
    expect(await db.payrollValidationIssue.count({ where: { runId: run.id, employeeId: mover.id, severity: "CRITICAL" } })).toBe(0);
  });
});
