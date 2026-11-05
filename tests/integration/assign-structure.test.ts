import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { addContractRate, createClient, createContract } from "@/server/services/clients";
import { createEmployee } from "@/server/services/employees";
import { previewEmployeeImport } from "@/server/services/employee-import";
import { proposePayRate } from "@/server/services/pay-rate-proposals";
import { assignStructureToClient, createRoleStructure, createStructure } from "@/server/services/structures";
import { isolatedOrg } from "../helpers";

/**
 * The founder asked (2026-11-05) to be able to assign an EXISTING company-wide salary structure to a client (the demo data already has structures named for a client, such as "ABC Bank Guard
 * Structure", that sit as company-wide ones). The rule it must keep: a client's structure can be used only on that client's contracts. So a structure already used on ANOTHER client's
 * contract cannot be given to this client, and nor can one used for employees' personal pay rates (which are not tied to a client). A client's structure is also not offered for a
 * personal pay rate.
 */
const person = (orgId: string, role: Role, n = 1): Ctx => ({ userId: `${orgId}-${role}-${n}`, orgId, role, name: `${role} ${n}`, email: `${role.toLowerCase()}${n}@${orgId}.test`, employeeId: null });
const comps = [
  { code: "BASIC", name: "Basic", calcType: "PERCENTAGE" as const, percentage: 60, taxable: true, pensionable: true },
  { code: "HOUSING", name: "Housing", calcType: "PERCENTAGE" as const, percentage: 40, taxable: true, pensionable: true },
];
const struct = (code: string, over: Record<string, unknown> = {}) => ({ code, name: `Structure ${code}`, effectiveFrom: "2026-01-01", components: comps, activate: true, ...over });

async function setup() {
  const t = await isolatedOrg();
  const admin = person(t.org.id, "COMPANY_ADMIN");
  const abc = await createClient(admin, { name: "ABC Bank", code: "ABC" });
  const xyz = await createClient(admin, { name: "XYZ Plc", code: "XYZ" });
  const abcContract = await createContract(admin, { clientId: abc.id, name: "ABC guarding", startDate: "2026-01-01" });
  const xyzContract = await createContract(admin, { clientId: xyz.id, name: "XYZ guarding", startDate: "2026-01-01" });
  return { t, admin, abc, xyz, abcContract, xyzContract };
}
const rate = (contractId: string, categoryId: string, structureId: string) => ({ contractId, categoryId, salaryStructureId: structureId, agreedRate: 100000, effectiveFrom: "2026-11-01" });

describe("assigning an existing structure to a client", () => {
  it("gives an unused company-wide structure to the client, keeping its components, and audits it by ids", async () => {
    const { t, admin, abc } = await setup();
    const s = await createStructure(admin, struct("EXISTING"));
    const done = await assignStructureToClient(admin, s.id, abc.id);
    expect(done).toMatchObject({ id: s.id, clientId: abc.id, parentId: null, categoryId: null });
    expect(await db.salaryComponent.count({ where: { structureId: s.id } })).toBe(2);
    const rows = await db.auditLog.findMany({ where: { organizationId: t.org.id, entityId: s.id, action: "SALARY_STRUCTURE_ASSIGN_CLIENT" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].newValue).toMatchObject({ clientId: abc.id });
  });

  it("allows it when the structure is used only on that client's contracts", async () => {
    const { t, admin, abc, abcContract } = await setup();
    const s = await createStructure(admin, struct("USED-BY-ABC"));
    await addContractRate(admin, rate(abcContract.id, t.guardId, s.id));
    await expect(assignStructureToClient(admin, s.id, abc.id)).resolves.toMatchObject({ clientId: abc.id });
  });

  it("refuses it, naming the client, when the structure is used on another client's contract rate or is another client's contract's default", async () => {
    const { t, admin, abc, xyz, xyzContract } = await setup();
    const onRate = await createStructure(admin, struct("ON-XYZ-RATE"));
    await addContractRate(admin, rate(xyzContract.id, t.guardId, onRate.id));
    await expect(assignStructureToClient(admin, onRate.id, abc.id)).rejects.toThrow(/used on XYZ Plc/i);
    const asDefault = await createStructure(admin, struct("XYZ-DEFAULT"));
    await createContract(admin, { clientId: xyz.id, name: "XYZ second", startDate: "2026-01-01", defaultStructureId: asDefault.id });
    await expect(assignStructureToClient(admin, asDefault.id, abc.id)).rejects.toThrow(/used on XYZ Plc/i);
    expect((await db.salaryStructure.findUniqueOrThrow({ where: { id: onRate.id } })).clientId).toBeNull(); // nothing changed
    expect(xyz.id).toBeDefined();
  });

  it("refuses it when the structure is used for employees' personal pay rates (those are not tied to a client)", async () => {
    const { t, admin, abc } = await setup();
    const s = await createStructure(admin, struct("OFFICE-STAFF"));
    const e = await createEmployee(admin, { firstName: "A", lastName: "One", employmentDate: "2026-01-01", categoryId: t.officeId });
    await db.employeePayRate.create({ data: { organizationId: t.org.id, employeeId: e.id, monthlyGross: "200000", structureCode: "OFFICE-STAFF", reason: "x", approvedBy: "y", effectiveFrom: new Date("2026-01-01") } });
    await expect(assignStructureToClient(admin, s.id, abc.id)).rejects.toThrow(/personal pay rate/i);
  });

  it("refuses the default structure, one that already belongs to a client, a role structure, a client or structure that is not found, and anyone without the structure permission", async () => {
    const { t, admin, abc, xyz } = await setup();
    const def = await db.salaryStructure.create({ data: { organizationId: t.org.id, code: "STD", name: "Standard", isDefault: true, status: "ACTIVE", effectiveFrom: new Date("2026-01-01"), components: { create: [{ code: "BASIC", name: "Basic", calcType: "PERCENTAGE", percentage: 100, sortOrder: 1 }] } } });
    await expect(assignStructureToClient(admin, def.id, abc.id)).rejects.toThrow(/default structure/i);
    const owned = await createStructure(admin, struct("OWNED", { clientId: abc.id }));
    await expect(assignStructureToClient(admin, owned.id, xyz.id)).rejects.toThrow(/already belongs to ABC Bank/i);
    const role = await createRoleStructure(admin, { parentId: owned.id, categoryId: t.guardId, code: "OWNED-GUARD" });
    await expect(assignStructureToClient(admin, role.id, xyz.id)).rejects.toThrow(/already belongs to/i);
    const free = await createStructure(admin, struct("FREE"));
    await expect(assignStructureToClient(admin, free.id, "nope")).rejects.toThrow(/client not found/i);
    await expect(assignStructureToClient(admin, "nope", abc.id)).rejects.toThrow(/not found/i);
    await expect(assignStructureToClient(person(t.org.id, "AUDITOR"), free.id, abc.id)).rejects.toThrow(/permission/);
    const other = await isolatedOrg();
    await expect(assignStructureToClient(person(other.org.id, "COMPANY_ADMIN"), free.id, abc.id)).rejects.toThrow(/not found/i); // another company
  });

  it("keeps the rule afterwards: once assigned, the structure cannot be put on another client's contract", async () => {
    const { t, admin, abc, xyzContract } = await setup();
    const s = await createStructure(admin, struct("TO-ABC"));
    await assignStructureToClient(admin, s.id, abc.id);
    await expect(addContractRate(admin, rate(xyzContract.id, t.guardId, s.id))).rejects.toThrow(/belongs to ABC Bank/i);
  });
});

describe("a client's structure is not for a personal pay rate", () => {
  it("refuses it for a proposed personal gross, with the reason, and still accepts a company-wide one", async () => {
    const { t, admin, abc } = await setup();
    await createStructure(admin, struct("CLIENT-ONE", { clientId: abc.id }));
    await createStructure(admin, struct("COMPANY-ONE"));
    const e = await createEmployee(admin, { firstName: "A", lastName: "Two", employmentDate: "2026-01-01", categoryId: t.officeId });
    const ask = (code: string) => ({ employeeId: e.id, monthlyGross: "250000", reason: "Office staff on a personal gross", effectiveFrom: "2026-11-01", structureCode: code });
    await expect(proposePayRate(admin, ask("CLIENT-ONE"))).rejects.toThrow(/belongs to a client.*personal pay rate/i);
    await expect(proposePayRate(admin, ask("COMPANY-ONE"))).resolves.toMatchObject({ structureCode: "COMPANY-ONE" });
  });

  it("is not accepted in the import either: the row is still imported, without a pay rate, with a warning", async () => {
    const { t, admin, abc } = await setup();
    await createStructure(admin, struct("CLIENT-IMPORT", { clientId: abc.id }));
    const csv = "First Name,Last Name,Employment Date,Category,Monthly Gross,Salary Structure\nAda,Obi,01/11/2026,OFF,250000,CLIENT-IMPORT";
    const preview = await previewEmployeeImport(admin, csv);
    expect(preview.summary.errors).toBe(0);
    expect(preview.rows[0].employee?.monthlyGross).toBeUndefined();
    expect(preview.rows[0].warnings.join(" ")).toMatch(/Salary structure "CLIENT-IMPORT"/);
    expect(t.org.id).toBeDefined();
  });
});
