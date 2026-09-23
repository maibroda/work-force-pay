import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { d } from "@/lib/dates";
import { num } from "@/lib/money";
import { STRUCTURE_TOTAL_ERROR, DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { createEmployee, findDuplicates, getEmployee, listEmployees } from "@/server/services/employees";
import { activateStructure, createStructure } from "@/server/services/structures";
import {
  addContractRate,
  createBeat,
  createClient,
  createContract,
  listClients,
} from "@/server/services/clients";
import {
  deployEmployee,
  createMovement,
  recordAttendance,
  CLIENT_MISMATCH,
  LOCATION_MISMATCH,
} from "@/server/services/operations";
import { beatByName, ctxFor, employeeByNumber, uid } from "../helpers";

const pct = (arr: number[]) =>
  DEFAULT_EARNINGS.map((c, i) => ({
    code: c.code,
    name: c.name,
    calcType: "PERCENTAGE" as const,
    percentage: arr[i],
    taxable: true,
    pensionable: c.pensionable,
  }));

describe("employee numbering", () => {
  it("#1 employee number is generated automatically from the numbering rule", async () => {
    const ctx = await ctxFor("HR_ADMIN");
    const cat = await db.employeeCategory.findFirstOrThrow({
      where: { organizationId: ctx.orgId, code: "GUARD" },
    });
    const rule = await db.numberingRule.findUniqueOrThrow({
      where: { organizationId_entity: { organizationId: ctx.orgId, entity: "EMPLOYEE" } },
    });
    const a = await createEmployee(ctx, {
      firstName: "Auto",
      lastName: "Number",
      employmentDate: "2026-09-01",
      categoryId: cat.id,
    });
    const b = await createEmployee(ctx, {
      firstName: "Auto",
      lastName: "Number2",
      employmentDate: "2026-09-01",
      categoryId: cat.id,
    });
    expect(a.employeeNumber).toBe(`EMP-${String(rule.nextNumber).padStart(6, "0")}`);
    expect(b.employeeNumber).toBe(`EMP-${String(rule.nextNumber + 1).padStart(6, "0")}`);
  });

  it("#2 employee numbers cannot duplicate — enforced by the database", async () => {
    const ctx = await ctxFor("HR_ADMIN");
    const cat = await db.employeeCategory.findFirstOrThrow({
      where: { organizationId: ctx.orgId, code: "GUARD" },
    });
    await expect(
      db.employee.create({
        data: {
          organizationId: ctx.orgId,
          employeeNumber: "EMP-000001",
          firstName: "Dup",
          lastName: "Dup",
          employmentDate: d("2026-01-01"),
          categoryId: cat.id,
        },
      }),
    ).rejects.toThrow();
    // concurrent creations still receive unique numbers
    const made = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createEmployee(ctx, {
          firstName: "Race",
          lastName: `T${i}`,
          employmentDate: "2026-09-01",
          categoryId: cat.id,
        }),
      ),
    );
    expect(new Set(made.map((m) => m.employeeNumber)).size).toBe(5);
  });

  it("employee number never changes on transfer", async () => {
    const ctx = await ctxFor("OPERATIONS");
    const e = await employeeByNumber(ctx, "EMP-000025");
    const hist = await getEmployee(ctx, e.id);
    expect(hist!.employeeNumber).toBe("EMP-000025");
    expect(hist!.movements.length).toBeGreaterThanOrEqual(3);
  });
});

describe("salary structures", () => {
  it("#3 / #4 a new structure can be created and the default structure stays unchanged", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    const before = await db.salaryStructure.findFirstOrThrow({
      where: { organizationId: ctx.orgId, isDefault: true },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
    const s = await createStructure(ctx, {
      code: `T-${uid()}`,
      name: "ABC Bank Guard Structure v2",
      effectiveFrom: "2026-10-01",
      activate: true,
      components: pct([12, 15, 13, 5, 15, 20, 3, 5, 12]),
    });
    expect(s.status).toBe("ACTIVE");
    const after = await db.salaryStructure.findFirstOrThrow({
      where: { id: before.id },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
    expect(after.components.map((c) => [c.code, num(c.percentage)])).toEqual(
      before.components.map((c) => [c.code, num(c.percentage)]),
    );
    expect(after.components.map((c) => num(c.percentage))).toEqual([10, 14, 15, 5, 15, 20, 2.5, 5, 13.5]);
  });

  it("#8 activation is blocked when percentages do not total 100% (98% / 102%) unless PARTIAL", async () => {
    const ctx = await ctxFor("PAYROLL_ADMIN");
    await expect(
      createStructure(ctx, {
        code: `B-${uid()}`,
        name: "Bad 98",
        effectiveFrom: "2026-10-01",
        activate: true,
        components: pct([8, 14, 15, 5, 15, 20, 2.5, 5, 13.5]),
      }),
    ).rejects.toThrow(STRUCTURE_TOTAL_ERROR);
    const draft = await createStructure(ctx, {
      code: `B-${uid()}`,
      name: "Bad 102",
      effectiveFrom: "2026-10-01",
      activate: false,
      components: pct([12, 14, 15, 5, 15, 20, 2.5, 5, 13.5]),
    });
    await expect(activateStructure(ctx, draft.id)).rejects.toThrow(STRUCTURE_TOTAL_ERROR);
    const partial = await createStructure(ctx, {
      code: `P-${uid()}`,
      name: "Partial",
      isPartial: true,
      effectiveFrom: "2026-10-01",
      activate: true,
      components: pct([10, 14, 15, 0, 0, 0, 0, 0, 0]),
    });
    expect(partial.status).toBe("ACTIVE");
  });
});

describe("tenancy", () => {
  it("#30 organization A cannot access organization B data", async () => {
    const a = await ctxFor("COMPANY_ADMIN", "DSS");
    const b = await ctxFor("COMPANY_ADMIN", "NGL");
    const bEmp = await db.employee.findFirstOrThrow({ where: { organizationId: b.orgId } });
    expect(await getEmployee(a, bEmp.id)).toBeNull();
    const aList = await listEmployees(a, { take: 1000 });
    expect(aList.rows.every((e) => e.organizationId === a.orgId)).toBe(true);
    const bClients = await listClients(b);
    expect(bClients.map((c) => c.name)).toEqual(["Northern Cement"]);
    // Both orgs have an EMP-000001 — numbers are unique only within an organization.
    expect(await db.employee.count({ where: { employeeNumber: "EMP-000001" } })).toBe(2);
  });
});

describe("clients, contracts, beats, deployment and movement", () => {
  it("#5 / #9 / #10 client-specific structure, deployment to a beat and movement between beats", async () => {
    const ctx = await ctxFor("COMPANY_ADMIN");
    const client = await createClient(ctx, { name: `Test Client ${uid()}` });
    const structure = await createStructure(ctx, {
      code: `CL-${uid()}`,
      name: "Client structure",
      effectiveFrom: "2026-01-01",
      activate: true,
      components: pct([11, 14, 14, 5, 16, 20, 2.5, 5, 12.5]),
    });
    const contract = await createContract(ctx, {
      clientId: client.id,
      name: "Guarding 2026",
      startDate: "2026-01-01",
      defaultStructureId: structure.id,
    });
    const cat = await db.employeeCategory.findFirstOrThrow({
      where: { organizationId: ctx.orgId, code: "GUARD" },
    });
    await addContractRate(ctx, {
      contractId: contract.id,
      categoryId: cat.id,
      salaryStructureId: structure.id,
      agreedRate: 150000,
      effectiveFrom: "2026-01-01",
    });
    const b1 = await createBeat(ctx, { contractId: contract.id, name: "Beat One", approvedStrength: 1 });
    const b2 = await createBeat(ctx, { contractId: contract.id, name: "Beat Two", approvedStrength: 1 });
    expect(b1.status).toBe("UNMAPPED");
    const emp = await createEmployee(ctx, {
      firstName: "Mover",
      lastName: "Test",
      employmentDate: "2026-12-01",
      categoryId: cat.id,
    });
    const dep = await deployEmployee(ctx, { employeeId: emp.id, beatId: b1.id, startDate: "2026-12-01" });
    expect(dep.deployment.beatId).toBe(b1.id);
    expect((await db.beat.findUniqueOrThrow({ where: { id: b1.id } })).status).toBe("MAPPED");
    await createMovement(ctx, {
      employeeId: emp.id,
      toBeatId: b2.id,
      movementType: "LOCATION_TRANSFER",
      movementDate: "2026-12-20",
      effectiveDate: "2026-12-20",
      reason: "test move",
      approve: true,
    });
    const deps = await db.deployment.findMany({
      where: { employeeId: emp.id },
      orderBy: { startDate: "asc" },
    });
    expect(deps.map((x) => [x.beatId, x.endDate?.toISOString().slice(0, 10) ?? null])).toEqual([
      [b1.id, "2026-12-19"],
      [b2.id, null],
    ]);
  });

  it("#13 / #25 work register captures attendance per location and flags location mismatch", async () => {
    const ctx = await ctxFor("OPERATIONS");
    const emp = await employeeByNumber(ctx, "EMP-000003");
    const marina = await beatByName(ctx, "Marina Branch");
    const res = await recordAttendance(ctx, [
      { employeeId: emp.id, beatId: marina.id, date: "2026-11-02", status: "PRESENT" },
    ]);
    expect(res.saved).toBe(1);
    expect(res.mismatches[0].message).toBe(LOCATION_MISMATCH);
    const row = await db.workRegister.findFirstOrThrow({
      where: { employeeId: emp.id, date: d("2026-11-02") },
    });
    expect(row.beatId).toBe(marina.id);
    expect(row.locationMismatch).toBe(true);
  });

  it("#24 wrong client mapping is flagged as a client mismatch", async () => {
    const ctx = await ctxFor("OPERATIONS");
    const emp = await employeeByNumber(ctx, "EMP-000003"); // ABC Bank
    const mall = await beatByName(ctx, "Lekki Mall"); // Retail Client
    const res = await recordAttendance(ctx, [
      { employeeId: emp.id, beatId: mall.id, date: "2026-11-03", status: "PRESENT" },
    ]);
    expect(res.mismatches[0].message).toBe(CLIENT_MISMATCH);
  });

  it("#22 suspected duplicate personnel are flagged, not deleted", async () => {
    const ctx = await ctxFor("HR_ADMIN");
    const flags = await findDuplicates(ctx);
    const types = flags.map((f) => f.type);
    expect(types).toContain("BANK_ACCOUNT");
    expect(types).toContain("PENSION_PIN");
    expect(types).toContain("NAME_SIMILAR");
    expect(await employeeByNumber(ctx, "EMP-000091")).toBeTruthy();
  });
});
