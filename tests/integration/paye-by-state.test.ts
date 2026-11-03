import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { d, eachDay, iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { STATE_NOT_RECORDED } from "@/lib/nigeria-states";
import { addContractRate, createBeat, createClient, createContract } from "@/server/services/clients";
import { createStructure } from "@/server/services/structures";
import { createEmployee, updateEmployee } from "@/server/services/employees";
import { deployEmployee, recordAttendance } from "@/server/services/operations";
import { generateRemittances, listRemittances } from "@/server/services/payments";
import { approveRun, createPeriod, lockRun, runPayroll, submitForApproval } from "@/server/services/payroll";
import { payeSchedule } from "@/server/services/reports";
import { ctxFor, explainVariances, isolatedOrg, uid } from "../helpers";

/**
 * PAYE goes to the tax authority of the worker's state of residence (CLAUDE.md). The state is kept on the worker, copied onto the payroll record
 * when the payroll is calculated, and the PAYE remittance is split by it. Everything here is invented.
 */
async function category() {
  const admin = await ctxFor("COMPANY_ADMIN");
  return db.employeeCategory.findFirstOrThrow({ where: { organizationId: admin.orgId, code: "GUARD" } });
}

describe("the state of residence on an employee", () => {
  it("is stored under its proper name whatever way it was typed, and can be cleared", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const cat = await category();
    const base = { firstName: "State", lastName: `Test${uid()}`, employmentDate: "2027-01-01", categoryId: cat.id };
    const typed = await createEmployee(hr, { ...base, stateOfResidence: "  ogun " });
    expect(typed.stateOfResidence).toBe("Ogun");
    const abuja = await createEmployee(hr, { ...base, lastName: `Test${uid()}`, stateOfResidence: "Abuja" });
    expect(abuja.stateOfResidence).toBe("FCT");
    const none = await createEmployee(hr, { ...base, lastName: `Test${uid()}` });
    expect(none.stateOfResidence).toBeNull();

    const updated = await updateEmployee(hr, typed.id, { ...base, lastName: typed.lastName, stateOfResidence: "lagos" }, "Moved house");
    expect(updated.stateOfResidence).toBe("Lagos");
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: hr.orgId, entity: "Employee", entityId: typed.id, action: "EMPLOYEE_UPDATE" }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(audit.oldValue)).toContain("Ogun");
    expect(JSON.stringify(audit.newValue)).toContain("Lagos");

    const cleared = await updateEmployee(hr, typed.id, { ...base, lastName: typed.lastName, stateOfResidence: "" }, "Unknown again");
    expect(cleared.stateOfResidence).toBeNull();
  });

  it("refuses a state that is not one of the 36 states or the FCT, with a plain message", async () => {
    const hr = await ctxFor("HR_ADMIN");
    const cat = await category();
    await expect(createEmployee(hr, { firstName: "Bad", lastName: `State${uid()}`, employmentDate: "2027-01-01", categoryId: cat.id, stateOfResidence: "Atlantis" })).rejects.toThrow(/state of residence/i);
  });
});

describe("PAYE by state on a payroll run", () => {
  it("copies the state onto each record, warns about a missing one, and splits the PAYE remittance by state with the lines adding up to the run's PAYE", async () => {
    const admin = await ctxFor("COMPANY_ADMIN");
    const hr = await ctxFor("HR_ADMIN");
    const ops = await ctxFor("OPERATIONS");
    const payroll = await ctxFor("PAYROLL_ADMIN");
    const fin = await ctxFor("FINANCE");
    const tag = uid();
    const cat = await category();

    const client = await createClient(admin, { name: `State Client ${tag}` });
    const structure = await createStructure(payroll, {
      code: `ST-${tag}`,
      name: `State Structure ${tag}`,
      effectiveFrom: "2027-01-01",
      activate: true,
      components: DEFAULT_EARNINGS.map((c, i) => ({
        code: c.code,
        name: c.name,
        calcType: "PERCENTAGE" as const,
        percentage: [10, 14, 15, 5, 15, 20, 2.5, 5, 13.5][i],
        taxable: true,
        pensionable: c.pensionable,
      })),
    });
    const contract = await createContract(admin, { clientId: client.id, name: "State Staff 2027", startDate: "2027-01-01", defaultStructureId: structure.id, operativeSharePct: 70 });
    await addContractRate(admin, { contractId: contract.id, categoryId: cat.id, salaryStructureId: structure.id, agreedRate: 300000, effectiveFrom: "2027-01-01" });
    const beat = await createBeat(admin, { contractId: contract.id, name: `State Site ${tag}`, approvedStrength: 4 });

    const states: Array<[string, string | undefined]> = [["Lagos", "Lagos"], ["Ogun", "ogun"], ["None", undefined], ["Lagos2", "LAGOS"]];
    const staff: Awaited<ReturnType<typeof createEmployee>>[] = [];
    for (const [label, state] of states) {
      const e = await createEmployee(hr, {
        firstName: "State",
        lastName: `${label}${tag}`,
        employmentDate: "2027-01-01",
        categoryId: cat.id,
        bankName: "GTBank",
        accountNumber: `71${String(Date.now()).slice(-8)}`,
        accountName: `STATE ${label} ${tag}`,
        taxId: `TIN${label}${tag}`,
        ...(state ? { stateOfResidence: state } : {}),
      });
      await deployEmployee(ops, { employeeId: e.id, beatId: beat.id, startDate: "2027-09-01" });
      await recordAttendance(ops, eachDay(d("2027-09-01"), d("2027-09-30")).map((dt) => ({ employeeId: e.id, beatId: beat.id, date: iso(dt), status: "PRESENT" as const })));
      staff.push(e);
    }

    const period = await createPeriod(payroll, 2027, 9);
    const run = await runPayroll(payroll, period.id);
    const records = await db.payrollRecord.findMany({ where: { runId: run.id, employeeId: { in: staff.map((s) => s.id) } } });
    const stateOf = (id: string) => records.find((r) => r.employeeId === id)!.payeState;
    expect(stateOf(staff[0].id)).toBe("Lagos");
    expect(stateOf(staff[1].id)).toBe("Ogun");
    expect(stateOf(staff[2].id)).toBeNull();
    expect(stateOf(staff[3].id)).toBe("Lagos");
    for (const r of records) expect(num(r.paye), "every test worker pays PAYE").toBeGreaterThan(0);

    // a worker with PAYE and no state is warned about (not blocked)
    const issues = await db.payrollValidationIssue.findMany({ where: { runId: run.id, code: "STATE_MISSING" } });
    expect(issues.map((i) => i.employeeId)).toContain(staff[2].id);
    expect(issues.map((i) => i.employeeId)).not.toContain(staff[0].id);
    expect(issues.every((i) => i.severity === "WARNING")).toBe(true);

    // the snapshot does not move when the worker's state changes later
    await db.employee.update({ where: { id: staff[0].id }, data: { stateOfResidence: "Kano" } });
    expect((await db.payrollRecord.findFirstOrThrow({ where: { runId: run.id, employeeId: staff[0].id } })).payeState).toBe("Lagos");

    await explainVariances(payroll, run.id);
    await submitForApproval(payroll, run.id);
    await approveRun(fin, run.id);
    await lockRun(fin, run.id);
    await generateRemittances(fin, run.id);

    const lines = (await listRemittances(fin, { runId: run.id })).filter((r) => r.type === "PAYE");
    const lagos = lines.find((l) => l.payee === "Lagos Internal Revenue Service (PAYE)")!;
    const ogun = lines.find((l) => l.payee === "Ogun Internal Revenue Service (PAYE)")!;
    expect(lagos).toBeDefined();
    expect(ogun).toBeDefined();
    const wanted = (state: string | null) => records.filter((r) => r.payeState === state).reduce((a, r) => a + Math.round(num(r.paye) * 100), 0);
    // this run also holds the seeded staff, so each state line is at least our workers' PAYE
    expect(Math.round(num(lagos.totalAmount) * 100)).toBeGreaterThanOrEqual(wanted("Lagos"));
    expect(Math.round(num(ogun.totalAmount) * 100)).toBeGreaterThanOrEqual(wanted("Ogun"));
    expect(lines.some((l) => l.payee === `${STATE_NOT_RECORDED} (PAYE)`)).toBe(true);

    // nothing is lost: the state lines add up to the run's PAYE exactly, and the head counts to the people taxed
    const total = lines.reduce((a, l) => a + Math.round(num(l.totalAmount) * 100), 0);
    const runAfter = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(total).toBe(Math.round(num(runAfter.totalPaye) * 100));
    const taxed = await db.payrollRecord.count({ where: { runId: run.id, paye: { gt: 0 } } });
    expect(lines.reduce((a, l) => a + l.headcount, 0)).toBe(taxed);
    for (const l of lines) expect(num(l.employeeAmount)).toBe(num(l.totalAmount));

    // the PAYE schedule shows each person's state
    const schedule = await payeSchedule(payroll, run.id);
    expect(schedule.find((r) => r.employeeNumber === staff[1].employeeNumber)?.payeState).toBe("Ogun");
    expect(schedule.find((r) => r.employeeNumber === staff[2].employeeNumber)?.payeState).toBe(STATE_NOT_RECORDED);

    // another organization sees none of it
    const other = await isolatedOrg();
    expect(await listRemittances(other.ctx("FINANCE"), { runId: run.id })).toEqual([]);
    expect(await payeSchedule(other.ctx("PAYROLL_ADMIN"), run.id)).toEqual([]);
  });
});
