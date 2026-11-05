import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { addContractRate, createClient, createContract } from "@/server/services/clients";
import { activateStructure, cloneStructure, createRoleStructure, createStructure, deactivateStructure } from "@/server/services/structures";
import { isolatedOrg } from "../helpers";

/**
 * The founder's decisions of 2026-11-05 (docs/plans/client-salary-structures.md): a salary structure may be created for a CLIENT (for example "ABC Bank salary structure"), with
 * SUB-STRUCTURES under it for each job role (guard, supervisor, driver, cleaner: the existing employee categories), each a complete copy of its parent that can then be edited. A structure is
 * owned by one client or is company-wide (the existing ones, and the default, stay company-wide). The contract's rate card uses the sub-structure for the role. The payroll
 * calculation is not changed: the rate card still holds exactly one structure per contract, category and period.
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
  const supervisor = await db.employeeCategory.create({ data: { organizationId: t.org.id, code: "SUP", name: "Supervisor" } });
  const abcContract = await createContract(admin, { clientId: abc.id, name: "ABC guarding", startDate: "2026-01-01" });
  const xyzContract = await createContract(admin, { clientId: xyz.id, name: "XYZ guarding", startDate: "2026-01-01" });
  const abcStructure = await createStructure(admin, struct("ABC-BANK", { clientId: abc.id, name: "ABC Bank salary structure" }));
  return { t, admin, abc, xyz, supervisor, abcContract, xyzContract, abcStructure };
}
const rate = (contractId: string, categoryId: string, structureId: string | undefined, over: Record<string, unknown> = {}) => ({ contractId, categoryId, ...(structureId !== undefined ? { salaryStructureId: structureId } : {}), agreedRate: 100000, effectiveFrom: "2026-11-01", ...over });

describe("a structure owned by a client, with role sub-structures", () => {
  it("creates a client structure (owned by one client) beside the company-wide ones, which stay as they were", async () => {
    const { t, admin, abc, abcStructure } = await setup();
    expect(abcStructure).toMatchObject({ clientId: abc.id, parentId: null, categoryId: null, isDefault: false });
    const companyWide = await createStructure(admin, struct("COMPANY-WIDE"));
    expect(companyWide).toMatchObject({ clientId: null, parentId: null, categoryId: null });
    const other = await isolatedOrg();
    await expect(createStructure(admin, struct("X1", { clientId: (await createClient(person(other.org.id, "COMPANY_ADMIN"), { name: "Other Co" })).id }))).rejects.toThrow(/client.*not found/i);
    expect(t.org.id).toBeDefined();
  });

  it("creates a client's structure as a copy of a chosen structure (or the company's default), owned by the client, starting as a draft, and never touches the structure it copies", async () => {
    const { admin, abc, t } = await setup();
    const def = await db.salaryStructure.create({ data: { organizationId: t.org.id, code: "STD", name: "Standard", isDefault: true, status: "ACTIVE", effectiveFrom: new Date("2026-01-01"), components: { create: [{ code: "BASIC", name: "Basic", calcType: "PERCENTAGE", percentage: 100, sortOrder: 1 }] } } });
    const mine = await (await import("@/server/services/structures")).createClientStructure(admin, { clientId: abc.id, code: "ABC-2" });
    expect(mine).toMatchObject({ clientId: abc.id, parentId: null, categoryId: null, status: "DRAFT", isDefault: false });
    expect(mine.name).toBe("ABC Bank salary structure");
    expect((await db.salaryComponent.findMany({ where: { structureId: mine.id } })).map((c) => c.code)).toEqual(["BASIC"]);
    expect(await db.salaryStructure.findUniqueOrThrow({ where: { id: def.id } })).toMatchObject({ isDefault: true, clientId: null }); // the default is unchanged
    await expect((await import("@/server/services/structures")).createClientStructure(admin, { clientId: "nope", code: "ABC-3" })).rejects.toThrow(/client not found/i);
  });

  it("makes a role structure as a complete copy of its parent, in the same client and for the category, that can then be edited (it starts as a draft)", async () => {
    const { t, admin, abc, abcStructure } = await setup();
    const guard = await createRoleStructure(admin, { parentId: abcStructure.id, categoryId: t.guardId, code: "ABC-GUARD" });
    expect(guard).toMatchObject({ clientId: abc.id, parentId: abcStructure.id, categoryId: t.guardId, status: "DRAFT", isDefault: false });
    expect(guard.name).toMatch(/ABC Bank/);
    expect(guard.name).toMatch(/Security Guard/);
    const parentComps = await db.salaryComponent.findMany({ where: { structureId: abcStructure.id }, orderBy: { sortOrder: "asc" } });
    const childComps = await db.salaryComponent.findMany({ where: { structureId: guard.id }, orderBy: { sortOrder: "asc" } });
    expect(childComps.map((c) => [c.code, c.percentage?.toString(), c.pensionable])).toEqual(parentComps.map((c) => [c.code, c.percentage?.toString(), c.pensionable]));
    expect(childComps[0].id).not.toBe(parentComps[0].id); // a copy, not shared
    // a change to the parent later does not change the sub-structure
    await db.salaryComponent.update({ where: { id: parentComps[0].id }, data: { percentage: 55 } });
    expect((await db.salaryComponent.findFirstOrThrow({ where: { structureId: guard.id, code: "BASIC" } })).percentage?.toString()).toBe("60");
  });

  it("holds to the rules: a role structure needs a parent that belongs to a client, only two levels, a category of this company, and the parent's client; a category belongs only to a role structure", async () => {
    const { t, admin, abc, xyz, abcStructure } = await setup();
    const guard = await createRoleStructure(admin, { parentId: abcStructure.id, categoryId: t.guardId, code: "ABC-GUARD" });
    const companyWide = await createStructure(admin, struct("COMPANY-WIDE"));
    await expect(createRoleStructure(admin, { parentId: companyWide.id, categoryId: t.guardId, code: "R1" })).rejects.toThrow(/owned by a client/i);
    await expect(createRoleStructure(admin, { parentId: guard.id, categoryId: t.officeId, code: "R2" })).rejects.toThrow(/two levels/i);
    await expect(createRoleStructure(admin, { parentId: "nope", categoryId: t.guardId, code: "R3" })).rejects.toThrow(/not found/i);
    await expect(createRoleStructure(admin, { parentId: abcStructure.id, categoryId: "nope", code: "R4" })).rejects.toThrow(/category/i);
    await expect(createStructure(admin, struct("R5", { parentId: abcStructure.id, categoryId: t.officeId, clientId: xyz.id }))).rejects.toThrow(/same client/i);
    await expect(createStructure(admin, struct("R6", { categoryId: t.officeId }))).rejects.toThrow(/role structure/i);
    await expect(createStructure(admin, struct("R7", { parentId: abcStructure.id }))).rejects.toThrow(/category/i);
    expect(abc.id).toBeDefined();
  });

  it("allows only one ACTIVE role structure per client structure and category (switch the old one off first), and a different category is fine", async () => {
    const { t, admin, supervisor, abcStructure } = await setup();
    const a = await createRoleStructure(admin, { parentId: abcStructure.id, categoryId: t.guardId, code: "ABC-GUARD-1" });
    const b = await createRoleStructure(admin, { parentId: abcStructure.id, categoryId: t.guardId, code: "ABC-GUARD-2" });
    const s = await createRoleStructure(admin, { parentId: abcStructure.id, categoryId: supervisor.id, code: "ABC-SUP" });
    await activateStructure(admin, a.id);
    await expect(activateStructure(admin, b.id)).rejects.toThrow(/already an active/i);
    await expect(activateStructure(admin, s.id)).resolves.toBeDefined();
    await deactivateStructure(admin, a.id);
    await expect(activateStructure(admin, b.id)).resolves.toBeDefined();
  });

  it("keeps a clone in the hierarchy: a new version of a role structure stays under its parent, for its category", async () => {
    const { t, admin, abcStructure } = await setup();
    const a = await createRoleStructure(admin, { parentId: abcStructure.id, categoryId: t.guardId, code: "ABC-GUARD-1" });
    const copy = await cloneStructure(admin, a.id, "ABC-GUARD-V2", "ABC Bank Guard v2");
    expect(copy).toMatchObject({ clientId: a.clientId, parentId: abcStructure.id, categoryId: t.guardId, status: "DRAFT" });
  });

  it("needs the structure permission, and is audited", async () => {
    const { t, admin, abcStructure } = await setup();
    await expect(createRoleStructure(person(t.org.id, "AUDITOR"), { parentId: abcStructure.id, categoryId: t.guardId, code: "X" })).rejects.toThrow(/permission/);
    const g = await createRoleStructure(admin, { parentId: abcStructure.id, categoryId: t.guardId, code: "ABC-GUARD" });
    const rows = await db.auditLog.findMany({ where: { organizationId: t.org.id, entityId: g.id } });
    expect(rows.map((r) => r.action)).toContain("SALARY_STRUCTURE_CREATE");
  });
});

describe("the rate card and the contract's default structure", () => {
  it("lets a client's structure be used only on that client's contracts; a company-wide one on any; and a role structure only for its own category", async () => {
    const { t, admin, abcContract, xyzContract, abcStructure } = await setup();
    const companyWide = await createStructure(admin, struct("COMPANY-WIDE"));
    const guard = await createRoleStructure(admin, { parentId: abcStructure.id, categoryId: t.guardId, code: "ABC-GUARD" });
    await activateStructure(admin, guard.id);
    await expect(addContractRate(admin, rate(xyzContract.id, t.guardId, abcStructure.id))).rejects.toThrow(/belongs to ABC Bank/i);
    await expect(addContractRate(admin, rate(xyzContract.id, t.guardId, guard.id))).rejects.toThrow(/belongs to ABC Bank/i);
    await expect(addContractRate(admin, rate(abcContract.id, t.officeId, guard.id))).rejects.toThrow(/is for the Security Guard/i);
    await expect(addContractRate(admin, rate(abcContract.id, t.guardId, guard.id))).resolves.toBeDefined();
    await expect(addContractRate(admin, rate(abcContract.id, t.officeId, abcStructure.id))).resolves.toBeDefined(); // the client structure itself may be used directly
    await expect(addContractRate(admin, rate(xyzContract.id, t.guardId, companyWide.id))).resolves.toBeDefined();
  });

  it("picks the client's active role structure for the category when none is chosen, and says so when there is none", async () => {
    const { t, admin, abcContract, abcStructure } = await setup();
    await expect(addContractRate(admin, rate(abcContract.id, t.guardId, undefined))).rejects.toThrow(/no active.*Security Guard/i);
    const guard = await createRoleStructure(admin, { parentId: abcStructure.id, categoryId: t.guardId, code: "ABC-GUARD" });
    await activateStructure(admin, guard.id);
    const r = await addContractRate(admin, rate(abcContract.id, t.guardId, undefined));
    expect(r.salaryStructureId).toBe(guard.id);
  });

  it("applies the same client rule to a contract's default structure", async () => {
    const { admin, xyz, abcStructure } = await setup();
    await expect(createContract(admin, { clientId: xyz.id, name: "XYZ second", startDate: "2026-01-01", defaultStructureId: abcStructure.id })).rejects.toThrow(/belongs to ABC Bank/i);
  });

  it("leaves existing rate cards exactly as they were: a company-wide structure still works on any client's contract, with no category restriction", async () => {
    const { t, admin, abcContract, xyzContract } = await setup();
    const old = await createStructure(admin, struct("OLD-STYLE"));
    for (const c of [abcContract, xyzContract]) for (const cat of [t.guardId, t.officeId]) await expect(addContractRate(admin, rate(c.id, cat, old.id, { effectiveFrom: "2026-02-01" }))).resolves.toBeDefined();
  });
});

describe("company isolation", () => {
  it("another company cannot see or build under this company's structures (not found)", async () => {
    const { abcStructure } = await setup();
    const o = await isolatedOrg();
    const other = person(o.org.id, "COMPANY_ADMIN");
    await expect(createRoleStructure(other, { parentId: abcStructure.id, categoryId: o.guardId, code: "SNEAK" })).rejects.toThrow(/not found/i);
  });
});
