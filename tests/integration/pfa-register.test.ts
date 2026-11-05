import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { DEFAULT_PFAS } from "@/lib/pfas";
import { approveChange, requestChange } from "@/server/services/change-requests";
import { createEmployee, updateEmployee } from "@/server/services/employees";
import { createPfa, deletePfa, ensureDefaultPfas, listPfas, resolvePfa, setPfaActive, updatePfa } from "@/server/services/pfas";
import { isolatedOrg } from "../helpers";

/**
 * From the founder's review of the app (2026-11-04): "where to add or remove a Pension Fund Administrator, by the admin or the HR manager". The nine PFAs were a list in the code, so nobody
 * could add or remove one. They are now a list each company keeps (with an optional PenCom number), managed by the company administrator and the HR manager. An employee's PFA is chosen
 * from it. While a company's list is empty (an older company that has not been given one) a typed PFA is still accepted, so nothing that worked stops working.
 */
const person = (orgId: string, role: Role, n = 1): Ctx => ({ userId: `${orgId}-${role}-${n}`, orgId, role, name: `${role} ${n}`, email: `${role.toLowerCase()}${n}@${orgId}.test`, employeeId: null });
const emp = (categoryId: string, n: string, pfa?: string) => ({ firstName: "A", lastName: n, employmentDate: "2026-01-01", categoryId, ...(pfa !== undefined ? { pfa } : {}) });

describe("who may keep the list", () => {
  it("is the company administrator and the HR manager; everyone else may only look (if they may see employees at all)", async () => {
    const t = await isolatedOrg();
    for (const r of ["COMPANY_ADMIN", "HR_ADMIN"] as Role[]) expect((await createPfa(person(t.org.id, r), { name: `PFA of ${r}` })).name, r).toBe(`PFA of ${r}`);
    for (const r of ["PAYROLL_ADMIN", "FINANCE", "AUDITOR", "OPERATIONS", "SUPERVISOR", "EMPLOYEE"] as Role[]) await expect(createPfa(person(t.org.id, r), { name: "Nope" }), r).rejects.toThrow(/permission/);
    expect((await listPfas(person(t.org.id, "PAYROLL_ADMIN"))).map((p) => p.name)).toContain("PFA of HR_ADMIN"); // the people who run payroll can see the list
    await expect(listPfas(person(t.org.id, "EMPLOYEE"))).rejects.toThrow(/permission/);
  });
});

describe("keeping it", () => {
  it("adds a PFA with an optional PenCom number, trims it, refuses a blank or too long name and a duplicate whatever its capitals", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const a = await createPfa(hr, { name: "  Stanbic IBTC Pension Managers  ", penComNumber: " PEN/001 " });
    expect(a).toMatchObject({ name: "Stanbic IBTC Pension Managers", penComNumber: "PEN/001", active: true, organizationId: t.org.id });
    expect((await createPfa(hr, { name: "ARM Pension" })).penComNumber).toBeNull();
    await expect(createPfa(hr, { name: "   " })).rejects.toThrow(/name/i);
    await expect(createPfa(hr, { name: "x".repeat(81) })).rejects.toThrow(/80/);
    await expect(createPfa(hr, { name: "stanbic ibtc PENSION managers" })).rejects.toThrow(/already on the list/i);
    await expect(createPfa(hr, { name: "New", penComNumber: "y".repeat(41) })).rejects.toThrow(/PenCom/i);
    expect(await db.pensionFundAdministrator.count({ where: { organizationId: t.org.id } })).toBe(2);
  });

  it("is audited by ids and the names of what changed", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const a = await createPfa(hr, { name: "Audited PFA" });
    await updatePfa(hr, a.id, { penComNumber: "PEN/9" });
    const rows = await db.auditLog.findMany({ where: { organizationId: t.org.id, entity: "PensionFundAdministrator" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["PFA_CREATED", "PFA_UPDATED"]);
    expect(rows[1].newValue).toMatchObject({ fields: ["penComNumber"] });
  });

  it("is each company's own: another company cannot see, change or delete it (it is simply not found)", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const mine = await createPfa(person(a.org.id, "HR_ADMIN"), { name: "Mine Only" });
    expect((await listPfas(person(b.org.id, "HR_ADMIN"))).map((p) => p.name)).not.toContain("Mine Only");
    await expect(updatePfa(person(b.org.id, "HR_ADMIN"), mine.id, { penComNumber: "X" })).rejects.toThrow(/not found/i);
    await expect(setPfaActive(person(b.org.id, "HR_ADMIN"), mine.id, false)).rejects.toThrow(/not found/i);
    await expect(deletePfa(person(b.org.id, "HR_ADMIN"), mine.id)).rejects.toThrow(/not found/i);
    await createPfa(person(b.org.id, "HR_ADMIN"), { name: "Mine Only" }); // the same name in another company is fine
  });

  it("renaming one renames it on the employees who have it, in this company only, and says how many", async () => {
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const hr = person(a.org.id, "HR_ADMIN");
    const pfa = await createPfa(hr, { name: "Old Name Pension" });
    await createPfa(person(b.org.id, "HR_ADMIN"), { name: "Old Name Pension" });
    const mine = await createEmployee(hr, emp(a.guardId, "One", "Old Name Pension"));
    const theirs = await createEmployee(person(b.org.id, "HR_ADMIN"), emp(b.guardId, "Two", "Old Name Pension"));
    const result = await updatePfa(hr, pfa.id, { name: "New Name Pension" });
    expect(result.employeesRenamed).toBe(1);
    expect((await db.employee.findUniqueOrThrow({ where: { id: mine.id } })).pfa).toBe("New Name Pension");
    expect((await db.employee.findUniqueOrThrow({ where: { id: theirs.id } })).pfa).toBe("Old Name Pension"); // another company's, untouched
    await expect(updatePfa(hr, pfa.id, { name: "new name PENSION" })).resolves.toBeDefined(); // the same name in other capitals is a change of capitals, not a duplicate of itself
    const other = await createPfa(hr, { name: "Some Other" });
    await expect(updatePfa(hr, other.id, { name: "New Name Pension" })).rejects.toThrow(/already on the list/i);
  });

  it("switches one off (it can no longer be chosen, but the people who have it keep it) and on again, and deletes one only if nobody has it", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const used = await createPfa(hr, { name: "Used PFA" });
    const unused = await createPfa(hr, { name: "Unused PFA" });
    await createEmployee(hr, emp(t.guardId, "Three", "Used PFA"));
    await expect(deletePfa(hr, used.id)).rejects.toThrow(/1 employee/);
    await setPfaActive(hr, used.id, false);
    expect((await listPfas(hr, { activeOnly: true })).map((p) => p.name)).not.toContain("Used PFA");
    expect((await listPfas(hr)).find((p) => p.id === used.id)).toMatchObject({ active: false, employeeCount: 1 }); // still listed, with how many have it
    await setPfaActive(hr, used.id, true);
    await deletePfa(hr, unused.id);
    expect(await db.pensionFundAdministrator.findUnique({ where: { id: unused.id } })).toBeNull();
  });
});

describe("choosing one for an employee", () => {
  it("accepts any typed PFA while the company has no list (an older company), so nothing that worked stops working", async () => {
    const t = await isolatedOrg();
    const e = await createEmployee(person(t.org.id, "HR_ADMIN"), emp(t.guardId, "Four", "  Some Typed PFA  "));
    expect(e.pfa).toBe("Some Typed PFA");
    expect(await resolvePfa(db, t.org.id, null)).toBeNull();
    expect(await resolvePfa(db, t.org.id, "   ")).toBeNull();
  });

  it("holds the employee to the list once the company has one: the PFA is stored as the list spells it, and one that is not on the list, or is switched off, is refused with where to add it", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    await createPfa(hr, { name: "Premium Pension Ltd" });
    const off = await createPfa(hr, { name: "Dormant Pension" });
    await setPfaActive(hr, off.id, false);
    expect((await createEmployee(hr, emp(t.guardId, "Five", "premium pension ltd"))).pfa).toBe("Premium Pension Ltd");
    await expect(createEmployee(hr, emp(t.guardId, "Six", "Unknown Pensions"))).rejects.toThrow(/not on your list.*Pension fund administrators/i);
    await expect(createEmployee(hr, emp(t.guardId, "Seven", "Dormant Pension"))).rejects.toThrow(/switched off/i);
    expect((await createEmployee(hr, emp(t.guardId, "Eight"))).pfa).toBeNull(); // none given is allowed
  });

  it("lets an employee keep a PFA that has since been switched off while other things about them change, but not be given one", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const pfa = await createPfa(hr, { name: "Leaving Pension" });
    await createPfa(hr, { name: "Other Pension" });
    const e = await createEmployee(hr, emp(t.guardId, "Nine", "Leaving Pension"));
    await setPfaActive(hr, pfa.id, false);
    const edit = { ...emp(t.guardId, "Nine", "Leaving Pension"), phone: "08030000001" };
    expect((await updateEmployee(hr, e.id, edit)).pfa).toBe("Leaving Pension"); // unchanged: allowed
    await expect(updateEmployee(hr, e.id, { ...edit, pfa: "Leaving Pension" })).resolves.toBeDefined();
    const e2 = await createEmployee(hr, emp(t.guardId, "Ten", "Other Pension"));
    await expect(updateEmployee(hr, e2.id, { ...emp(t.guardId, "Ten", "Leaving Pension") })).rejects.toThrow(/switched off/i); // moving someone onto a switched-off one
  });
});

describe("a change of PFA through a change request is held to the list too", () => {
  it("is stored as the list spells it, refused if it is not on the list or is switched off, and checked again when someone else approves it (the list may have changed meanwhile)", async () => {
    const t = await isolatedOrg();
    const hr = person(t.org.id, "HR_ADMIN");
    const approver = person(t.org.id, "COMPANY_ADMIN", 2);
    await createPfa(hr, { name: "First Pension" });
    await createPfa(hr, { name: "Second Pension" });
    const e = await createEmployee(hr, emp(t.guardId, "Eleven", "First Pension"));
    await expect(requestChange(hr, e.id, "PENSION", { pensionPin: "", pfa: "Nowhere Pensions" }, "Employee changed fund")).rejects.toThrow(/not on your list/i);
    const r = await requestChange(hr, e.id, "PENSION", { pensionPin: "", pfa: "second PENSION" }, "Employee changed fund");
    expect(r.proposed).toMatchObject({ pfa: "Second Pension" });
    const second = (await listPfas(hr)).find((p) => p.name === "Second Pension")!;
    await setPfaActive(hr, second.id, false); // switched off after the request was made
    await expect(approveChange(approver, r.id)).rejects.toThrow(/switched off/i);
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).pfa).toBe("First Pension");
    await setPfaActive(hr, second.id, true);
    await approveChange(approver, r.id);
    expect((await db.employee.findUniqueOrThrow({ where: { id: e.id } })).pfa).toBe("Second Pension");
  });
});

describe("each company is given the starting list", () => {
  it("is the nine the form used to offer, added once, and left alone if the company already has a list", async () => {
    const t = await isolatedOrg();
    expect(DEFAULT_PFAS).toHaveLength(9);
    await ensureDefaultPfas(db, t.org.id);
    expect((await listPfas(person(t.org.id, "HR_ADMIN"))).map((p) => p.name).sort()).toEqual([...DEFAULT_PFAS].sort());
    await ensureDefaultPfas(db, t.org.id); // twice changes nothing
    expect(await db.pensionFundAdministrator.count({ where: { organizationId: t.org.id } })).toBe(9);
    const u = await isolatedOrg();
    await createPfa(person(u.org.id, "HR_ADMIN"), { name: "Only Mine" });
    await ensureDefaultPfas(db, u.org.id);
    expect(await db.pensionFundAdministrator.count({ where: { organizationId: u.org.id } })).toBe(1); // it already has a list
  });
});

describe("the migration's own step for existing companies", () => {
  it("gives a company that has employees with PFAs a list of the nine and of every PFA already typed on an employee (once, whatever the capitals), and leaves a company that already has one alone", async () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261121090000_pfa_register/migration.sql"), "utf8");
    const step = sql.slice(sql.indexOf("-- BEGIN seed"), sql.indexOf("-- END seed"));
    expect(step.length).toBeGreaterThan(100);
    const a = await isolatedOrg();
    const b = await isolatedOrg();
    const hr = person(a.org.id, "HR_ADMIN");
    await createEmployee(hr, emp(a.guardId, "Typed1", "Typed By Hand Pensions"));
    await createEmployee(hr, emp(a.guardId, "Typed2", "typed by hand pensions")); // the same PFA in other capitals
    await createEmployee(hr, emp(a.guardId, "Typed3", DEFAULT_PFAS[0]));
    await createPfa(person(b.org.id, "HR_ADMIN"), { name: "Existing List Only" });
    class Rollback extends Error {}
    await db
      .$transaction(
        async (tx) => {
          await tx.pensionFundAdministrator.deleteMany({ where: { organizationId: a.org.id } });
          await tx.$executeRawUnsafe(step); // the same SQL the migration ran
          const names = (await tx.pensionFundAdministrator.findMany({ where: { organizationId: a.org.id } })).map((p) => p.name);
          expect(names.filter((n) => n.toLowerCase() === "typed by hand pensions")).toHaveLength(1);
          expect(names).toEqual(expect.arrayContaining([...DEFAULT_PFAS]));
          expect(names.length).toBe(DEFAULT_PFAS.length + 1); // the nine, plus the one typed by hand (the default one typed on an employee is not added twice)
          expect((await tx.pensionFundAdministrator.findMany({ where: { organizationId: b.org.id } })).map((p) => p.name)).toEqual(["Existing List Only"]);
          throw new Rollback();
        },
        { timeout: 60_000 },
      )
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  });
});
