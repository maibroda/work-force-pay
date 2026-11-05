import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { createEmployee, updateEmployee } from "@/server/services/employees";
import { commitEmployeeImport, previewEmployeeImport } from "@/server/services/employee-import";
import { approvePayRate } from "@/server/services/pay-rate-proposals";
import { isolatedOrg } from "../helpers";

/**
 * The founder's decision of 2026-11-05: the monthly gross may be entered when adding an employee and in the bulk import, as a PROPOSAL that a payroll manager approves before it counts.
 * Nothing here makes a pay rate; only approval does (tests/integration/pay-rate-approval.test.ts).
 */
const person = (orgId: string, role: Role, n = 1): Ctx => ({ userId: `${orgId}-${role}-${n}`, orgId, role, name: `${role} ${n}`, email: `${role.toLowerCase()}${n}@${orgId}.test`, employeeId: null });
const base = (categoryId: string, n: string) => ({ firstName: "A", lastName: n, employmentDate: "2026-11-01", categoryId });

describe("adding an employee with a monthly gross", () => {
  it("saves the employee and a PENDING proposal that starts on the employment date, and makes no pay rate", async () => {
    const t = await isolatedOrg();
    await db.salaryStructure.create({ data: { organizationId: t.org.id, code: "OFFICE", name: "Office", status: "ACTIVE", effectiveFrom: new Date("2026-01-01") } });
    const hr = person(t.org.id, "HR_ADMIN");
    const e = await createEmployee(hr, { ...base(t.officeId, "One"), monthlyGross: "250000.50", salaryStructure: "OFFICE" });
    const props = await db.payRateProposal.findMany({ where: { employeeId: e.id } });
    expect(props).toHaveLength(1);
    expect(props[0]).toMatchObject({ status: "PENDING", source: "NEW_EMPLOYEE", structureCode: "OFFICE", proposedByUserId: hr.userId, reason: "Set when the employee was added" });
    expect(props[0].monthlyGross.toString()).toBe("250000.5");
    expect(props[0].effectiveFrom.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(await db.employeePayRate.count({ where: { employeeId: e.id } })).toBe(0);
    // and the payroll manager approves it like any other proposal
    await approvePayRate(person(t.org.id, "PAYROLL_ADMIN"), props[0].id);
    expect(await db.employeePayRate.count({ where: { employeeId: e.id } })).toBe(1);
  });

  it("saves nothing at all if the gross or the structure is refused (no half-added employee)", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const before = await db.employee.count({ where: { organizationId: t.org.id } });
    await expect(createEmployee(hr, { ...base(t.officeId, "Two"), monthlyGross: "3000000 per annum" })).rejects.toThrow(/monthly gross/i);
    await expect(createEmployee(hr, { ...base(t.officeId, "Three"), monthlyGross: "250000", salaryStructure: "NOPE" })).rejects.toThrow(/structure/i);
    expect(await db.employee.count({ where: { organizationId: t.org.id } })).toBe(before);
    expect(await db.payRateProposal.count({ where: { organizationId: t.org.id } })).toBe(0);
  });

  it("proposes nothing when no gross is given (most staff are paid from a contract rate), and editing an employee never proposes", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const e = await createEmployee(hr, base(t.officeId, "Four"));
    expect(await db.payRateProposal.count({ where: { employeeId: e.id } })).toBe(0);
    await updateEmployee(hr, e.id, { ...base(t.officeId, "Four"), monthlyGross: "999999" });
    expect(await db.payRateProposal.count({ where: { employeeId: e.id } })).toBe(0);
    expect(await db.employeePayRate.count({ where: { employeeId: e.id } })).toBe(0);
  });

  it("only people who may add employees can do it, so only they can propose this way", async () => {
    const t = await isolatedOrg();
    await expect(createEmployee(person(t.org.id, "AUDITOR"), { ...base(t.officeId, "Five"), monthlyGross: "250000" })).rejects.toThrow(/permission/);
  });
});

describe("the bulk import with Monthly Gross and Salary Structure columns", () => {
  const header = "First Name,Last Name,Employment Date,Category,Monthly Gross,Salary Structure";
  it("creates each employee, and a PENDING proposal for the rows with a usable gross; a row with an unusable gross is still imported, without a proposal, and says so", async () => {
    const t = await isolatedOrg();
    await db.salaryStructure.create({ data: { organizationId: t.org.id, code: "OFFICE", name: "Office", status: "ACTIVE", effectiveFrom: new Date("2026-01-01") } });
    const hr = person(t.org.id, "HR_ADMIN");
    const csv = [header, 'Ada,Good,01/11/2026,OFF,"₦250,000",office', "Bola,Annual,01/11/2026,OFF,3000000 per annum,", "Chi,NoStructure,01/11/2026,OFF,180000,NOPE", "Dayo,NoGross,01/11/2026,OFF,,"].join("\n");
    const preview = await previewEmployeeImport(hr, csv);
    expect(preview.summary.errors).toBe(0);
    expect(preview.rows[1].warnings.join(" ")).toMatch(/monthly gross/i);
    expect(preview.rows[2].warnings.join(" ")).toMatch(/structure/i);
    const result = await commitEmployeeImport(hr, { csv, fileName: "gross.csv" });
    expect(result.imported).toBe(4);
    const props = await db.payRateProposal.findMany({ where: { organizationId: t.org.id }, include: { employee: true } });
    expect(props).toHaveLength(1);
    expect(props[0]).toMatchObject({ status: "PENDING", source: "IMPORT", structureCode: "OFFICE", reason: "Set in the bulk import" });
    expect(props[0].employee.lastName).toBe("Good");
    expect(props[0].monthlyGross.toString()).toBe("250000");
    expect(await db.employeePayRate.count({ where: { organizationId: t.org.id } })).toBe(0);
  });

  it("another company's structure codes are not accepted (the structure list is the importing company's own)", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    await db.salaryStructure.create({ data: { organizationId: b.org.id, code: "THEIRS", name: "Theirs", status: "ACTIVE", effectiveFrom: new Date("2026-01-01") } });
    const preview = await previewEmployeeImport(person(a.org.id, "HR_ADMIN"), [header, "Ada,Good,01/11/2026,OFF,250000,THEIRS"].join("\n"));
    expect(preview.rows[0].warnings.join(" ")).toMatch(/Salary structure "THEIRS"/);
    expect(preview.rows[0].employee?.monthlyGross).toBeUndefined();
  });
});
