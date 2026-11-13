import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { createEmployee } from "@/server/services/employees";
import { compileEmployeeData } from "@/server/services/data-requests";
import { anonymizeEmployee } from "@/server/services/employee-retention";
import { employeeTimeline } from "@/server/services/hr-overview";
import { todayUtc } from "@/server/services/hr-policy";
import { addSuccessionRole, removeSuccessor, setSuccessionRoleActive, setSuccessor as nominate, successionOverview } from "@/server/services/succession";
import { isolatedOrg, uid } from "../helpers";

// Governance step 2b: a new nomination by the only holder of the succession function in a company needs a written reason (tests/integration/second-person.test.ts covers the rule). These
// tests are about the list itself, in test companies that have one holder, so every nomination here gives one; permission and isolation failures happen before it matters.
const setSuccessor = (ctx: Ctx, raw: Parameters<typeof nominate>[1]) => nominate(ctx, { singleHolderReason: "The only holder of the succession function in this test company.", ...raw });

// Career and succession, step 1: the succession list (the founder's go of 2026-11-10; plan docs/plans/career-succession-plan.md).
// The most sensitive of the three: read and kept only by the HR administrator (the founder's decision of 2026-11-10, as for welfare). Nothing is scored or suggested.

async function login(t: Awaited<ReturnType<typeof isolatedOrg>>, role: Ctx["role"], employeeId: string | null = null): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: t.org.id, email: `${role.toLowerCase()}-${uid()}@suc.test`.toLowerCase(), name: `${role} ${uid()}`, role, passwordHash: "x", employeeId } });
  return { userId: u.id, orgId: t.org.id, role, name: u.name, email: u.email, employeeId };
}

const SECRET = "SECRET-SUCCESSION-REASON steady, trusted by the whole team";

async function world() {
  const t = await isolatedOrg();
  const hr = await login(t, "HR_ADMIN");
  const supEmp = await createEmployee(hr, { firstName: "Sade", lastName: "Holder", employmentDate: "2020-01-01", categoryId: t.officeId });
  const g = [] as Awaited<ReturnType<typeof createEmployee>>[];
  for (const n of ["One", "Two", "Three", "Four", "Five", "Six"]) g.push(await createEmployee(hr, { firstName: "Gbenga", lastName: n, employmentDate: "2023-01-05", categoryId: t.guardId }));
  const me = await login(t, "EMPLOYEE", g[0].id);
  const role = await addSuccessionRole(hr, t.officeId);
  return { t, hr, supEmp, g, me, role };
}
type W = Awaited<ReturnType<typeof world>>;
const others = async (w: W) => [await login(w.t, "COMPANY_ADMIN"), await login(w.t, "SUPER_ADMIN"), await login(w.t, "AUDITOR"), await login(w.t, "FINANCE"), await login(w.t, "SUPERVISOR", w.supEmp.id), w.me];

describe("who may keep and read it", () => {
  it("is the HR administrator alone: the administrators, the auditor, finance, a manager and the employee are all refused", async () => {
    const w = await world();
    for (const ctx of await others(w)) {
      await expect(successionOverview(ctx), ctx.role).rejects.toThrow(/permission/);
      await expect(addSuccessionRole(ctx, w.t.guardId), ctx.role).rejects.toThrow(/permission/);
      await expect(setSuccessor(ctx, { roleId: w.role.id, employeeId: w.g[1].id, readiness: "READY_NOW" }), ctx.role).rejects.toThrow(/permission/);
      await expect(setSuccessionRoleActive(ctx, w.role.id, false), ctx.role).rejects.toThrow(/permission/);
    }
    expect(await successionOverview(w.hr)).toHaveLength(1);
  });
  it("is the company's own: another company's HR sees nothing and cannot touch it", async () => {
    const w = await world();
    const o = await world();
    expect((await successionOverview(o.hr)).map((r) => r.id)).not.toContain(w.role.id);
    await expect(setSuccessor(o.hr, { roleId: w.role.id, employeeId: o.g[0].id, readiness: "READY_NOW" })).rejects.toThrow(/not found/i);
    const o2 = await isolatedOrg();
    await expect(addSuccessionRole(w.hr, o2.guardId)).rejects.toThrow(/not found/i);
  });
});

describe("critical roles", () => {
  it("are a role (category) of the company, named once, and can be switched off", async () => {
    const w = await world();
    await expect(addSuccessionRole(w.hr, w.t.officeId)).rejects.toThrow(/already/i);
    expect((await setSuccessionRoleActive(w.hr, w.role.id, false)).active).toBe(false);
    expect((await successionOverview(w.hr))[0].active).toBe(false);
  });
});

describe("successors", () => {
  it("are named by HR with how ready they are, one entry per person, updated in place", async () => {
    const w = await world();
    const a = await setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[0].id, readiness: "READY_3_PLUS", reason: SECRET });
    const b = await setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[0].id, readiness: "READY_NOW", reason: SECRET });
    expect(b.id).toBe(a.id);
    expect(b.readiness).toBe("READY_NOW");
    expect(await db.successionCandidate.count({ where: { roleId: w.role.id } })).toBe(1);
  });
  it("are at most five per role, and a sixth is refused (while changing one of the five is fine)", async () => {
    const w = await world();
    for (const e of w.g.slice(0, 5)) await setSuccessor(w.hr, { roleId: w.role.id, employeeId: e.id, readiness: "READY_1_2_YEARS" });
    await expect(setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[5].id, readiness: "READY_NOW" })).rejects.toThrow(/at most 5/i);
    await expect(setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[0].id, readiness: "READY_NOW" })).resolves.toBeDefined();
  });
  it("cannot be someone already in the role, someone who has left, or someone of another company", async () => {
    const w = await world();
    await expect(setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.supEmp.id, readiness: "READY_NOW" })).rejects.toThrow(/already in this role/i);
    await db.employee.update({ where: { id: w.g[1].id }, data: { status: "EXITED" } });
    await expect(setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[1].id, readiness: "READY_NOW" })).rejects.toThrow(/no longer active/i);
    const o = await world();
    await expect(setSuccessor(w.hr, { roleId: w.role.id, employeeId: o.g[0].id, readiness: "READY_NOW" })).rejects.toThrow(/not found/i);
  });
  it("can be removed", async () => {
    const w = await world();
    const a = await setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[0].id, readiness: "READY_NOW" });
    await removeSuccessor(w.hr, a.id);
    expect(await db.successionCandidate.count({ where: { roleId: w.role.id } })).toBe(0);
    await expect(removeSuccessor(w.hr, a.id)).rejects.toThrow(/not found/i);
  });
});

describe("the overview", () => {
  it("shows each critical role's holders, those leaving soon, its successors, and whether anyone is ready now", async () => {
    const w = await world();
    let ov = (await successionOverview(w.hr))[0];
    expect(ov).toMatchObject({ holders: 1, leavingSoon: 0, covered: false, candidates: [] });
    await setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[0].id, readiness: "READY_3_PLUS" });
    ov = (await successionOverview(w.hr))[0];
    expect(ov.covered).toBe(false);
    await setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[1].id, readiness: "READY_NOW", reason: SECRET });
    ov = (await successionOverview(w.hr))[0];
    expect(ov.covered).toBe(true);
    expect(ov.candidates.map((c) => c.readiness).sort()).toEqual(["READY_3_PLUS", "READY_NOW"]);
    expect(JSON.stringify(ov.candidates)).toContain("SECRET-SUCCESSION-REASON");
    await db.exitRecord.create({
      data: { organizationId: w.t.org.id, employeeId: w.supEmp.id, exitType: "RESIGNATION", noticeDate: new Date(), lastWorkingDate: addDays(todayUtc(), 30), reason: "Moving", initiatedBy: "HR", status: "APPROVED" },
    });
    expect((await successionOverview(w.hr))[0].leavingSoon).toBe(1);
  });
});

describe("it is seen by no one else, in no other place", () => {
  it("is not in the employee's timeline or in the copy of their data, whether they are a successor or the holder", async () => {
    const w = await world();
    await setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[0].id, readiness: "READY_NOW", reason: SECRET });
    for (const id of [w.g[0].id, w.supEmp.id]) {
      expect(JSON.stringify(await employeeTimeline(w.hr, id))).not.toMatch(/SECRET|succession/i);
      expect(JSON.stringify(await compileEmployeeData(w.t.org.id, id))).not.toMatch(/SECRET|succession|READY_NOW/i);
    }
  });
});

describe("audit and erasure", () => {
  it("records every step by ids and the readiness level, never the reason", async () => {
    const w = await world();
    const a = await setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[0].id, readiness: "READY_NOW", reason: SECRET });
    await removeSuccessor(w.hr, a.id);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SUCCESSION_" } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["SUCCESSION_ROLE_ADD", "SUCCESSION_SUCCESSOR_REMOVE", "SUCCESSION_SUCCESSOR_SET"]);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET/);
  });
  it("erasing an employee removes the words in their entry, keeps the shape and the audit log, and touches no one else's", async () => {
    const w = await world();
    await setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[0].id, readiness: "READY_NOW", reason: SECRET });
    await setSuccessor(w.hr, { roleId: w.role.id, employeeId: w.g[1].id, readiness: "READY_NOW", reason: SECRET });
    const counts = await db.$transaction((tx) => anonymizeEmployee(tx, w.t.org.id, w.g[0].id, new Date()));
    expect(counts.successionEntries).toBe(1);
    const mine = await db.successionCandidate.findFirstOrThrow({ where: { employeeId: w.g[0].id } });
    expect(mine.reason ?? "").not.toMatch(/SECRET/);
    expect(mine.readiness).toBe("READY_NOW");
    expect((await db.successionCandidate.findFirstOrThrow({ where: { employeeId: w.g[1].id } })).reason).toMatch(/SECRET/);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "SUCCESSION_SUCCESSOR_SET" } })).toBe(2);
  });
});
