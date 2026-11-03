import { afterEach, describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { MODULE_KEYS } from "@/lib/entitlements/catalogue";
import { ensureSubscription, removeModule } from "@/server/services/subscriptions";
import { listSwitches, loadEntitlements, organizationsWithoutSubscription, setMode, switchHistory } from "@/server/services/entitlement-switch";
import { isolatedOrg, uid } from "../helpers";

/**
 * Step E3b of docs/plans/module-entitlements-e3.md: the platform setting that says, per module, whether a company's modules are checked (OFF, REPORT or ENFORCE). It is
 * platform staff's alone, it cannot be turned on while a company has no subscription, and it starts OFF everywhere, so nothing is checked until someone decides.
 */
const ctx = (orgId: string, role: Role, n = 1): Ctx => ({ userId: `${orgId}-${role}-${n}`, orgId, role, name: `${role} ${n}`, email: `${role.toLowerCase()}${n}@${orgId}.test`, employeeId: null });

async function world() {
  const t = await isolatedOrg();
  const platform = ctx(t.org.id, "SUPER_ADMIN");
  const code = `B${uid()}${uid()}`;
  const bureau = await db.organization.create({ data: { name: `Bureau ${code}`, code, isBureau: true } });
  return { t, platform, adminT: ctx(t.org.id, "COMPANY_ADMIN"), hrT: ctx(t.org.id, "HR_ADMIN"), bureauAdmin: ctx(bureau.id, "COMPANY_ADMIN") };
}

/** Every company in the test database gets a subscription (other tests make companies that have none), so the switch may be turned on. */
async function everyoneHasOne(by: Ctx) {
  for (const o of await organizationsWithoutSubscription()) await ensureSubscription(db, by, o.id, { planKey: "payroll_essentials", reason: "test" });
}

afterEach(async () => {
  await db.entitlementSwitch.deleteMany(); // back to OFF everywhere, for the other test files
});

describe("who may see and change the switch", () => {
  it("is platform staff's alone: a company's administrator, HR and a bureau's administrator are all refused, and nothing changes", async () => {
    const w = await world();
    await everyoneHasOne(w.platform);
    for (const who of [w.adminT, w.hrT, w.bureauAdmin]) {
      await expect(setMode(who, "crm", "REPORT", "I would like it")).rejects.toThrow(/permission/);
      await expect(listSwitches(who)).rejects.toThrow(/permission/);
      await expect(switchHistory(who)).rejects.toThrow(/permission/);
    }
    expect((await listSwitches(w.platform)).every((s) => s.mode === "OFF")).toBe(true);
  });
});

describe("the state today", () => {
  it("starts OFF for every module except the core, which cannot be switched, and gives a request nothing to check", async () => {
    const w = await world();
    const all = await listSwitches(w.platform);
    expect(all.find((s) => (s.moduleKey as string) === "core")).toBeUndefined();
    expect(all.find((s) => s.moduleKey === "crm")).toMatchObject({ mode: "OFF", name: "CRM" });
    expect(all.every((s) => s.mode === "OFF")).toBe(true);
    expect(await loadEntitlements(w.t.org.id)).toBeUndefined(); // not even a subscription lookup is needed
  });
});

describe("turning a module on", () => {
  it("refuses REPORT and ENFORCE while any company has no subscription, and says which, but always allows OFF", async () => {
    const w = await world();
    await everyoneHasOne(w.platform); // so that the only company without one is the next
    const lonely = await isolatedOrg(); // a company with no subscription
    const eventsBefore = (await switchHistory(w.platform)).length; // the history is global and never shrinks, so compare with what was there
    await expect(setMode(w.platform, "crm", "REPORT", "Trying")).rejects.toThrow(/no subscription/i);
    await expect(setMode(w.platform, "crm", "ENFORCE", "Trying")).rejects.toThrow(new RegExp(lonely.org.code));
    expect((await listSwitches(w.platform)).find((s) => s.moduleKey === "crm")!.mode).toBe("OFF");
    expect((await switchHistory(w.platform)).length).toBe(eventsBefore); // a refusal leaves nothing behind
    await everyoneHasOne(w.platform);
    await setMode(w.platform, "crm", "REPORT", "Trying it");
    await expect(setMode(w.platform, "crm", "OFF", "Back")).resolves.toBeUndefined();
  });

  it("refuses the core, a module that does not exist, a mode that does not exist, no reason, and the mode it is already in", async () => {
    const w = await world();
    await everyoneHasOne(w.platform);
    await expect(setMode(w.platform, "core", "ENFORCE", "x")).rejects.toThrow(/core/i);
    await expect(setMode(w.platform, "teleportation", "REPORT", "x")).rejects.toThrow(/no module called/i);
    await expect(setMode(w.platform, "crm", "LOUD" as never, "x")).rejects.toThrow(/OFF, REPORT or ENFORCE/);
    await expect(setMode(w.platform, "crm", "REPORT", "  ")).rejects.toThrow(/reason/i);
    await expect(setMode(w.platform, "crm", "OFF", "x")).rejects.toThrow(/already/i);
    await setMode(w.platform, "crm", "ENFORCE", "Go");
    await expect(setMode(w.platform, "crm", "ENFORCE", "Again")).rejects.toThrow(/already/i);
  });

  it("keeps every change as a history entry (from, to, who, why) that the database refuses to alter or delete, with nothing personal in it", async () => {
    const w = await world();
    await everyoneHasOne(w.platform);
    const eventsBefore = (await switchHistory(w.platform)).length;
    await setMode(w.platform, "analytics", "REPORT", "Looking first");
    await setMode(w.platform, "analytics", "ENFORCE", "Now");
    const h = (await switchHistory(w.platform)).slice(eventsBefore);
    expect(h.map((e) => [e.moduleKey, e.fromMode, e.toMode, e.reason, e.byName])).toEqual([
      ["analytics", "OFF", "REPORT", "Looking first", w.platform.name],
      ["analytics", "REPORT", "ENFORCE", "Now", w.platform.name],
    ]);
    expect(JSON.stringify(h)).not.toMatch(/@/);
    await expect(db.$executeRaw`UPDATE "EntitlementSwitchEvent" SET "reason" = 'tampered' WHERE id = ${h[0].id}`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM "EntitlementSwitchEvent" WHERE id = ${h[0].id}`).rejects.toThrow();
  });
});

describe("what a request is given to check", () => {
  it("is the company's modules today and the modules being checked, and nothing at all while every module is OFF", async () => {
    const w = await world();
    await everyoneHasOne(w.platform);
    const a = await isolatedOrg();
    await ensureSubscription(db, w.platform, a.org.id, { planKey: "hr_payroll", addOns: ["analytics"], reason: "test" });
    expect(await loadEntitlements(a.org.id)).toBeUndefined();
    await setMode(w.platform, "crm", "ENFORCE", "Go");
    await setMode(w.platform, "analytics", "REPORT", "Looking");
    const inCatalogueOrder = MODULE_KEYS.filter((k) => ["core", "hr", "payroll", "self_service", "analytics"].includes(k));
    expect(await loadEntitlements(a.org.id)).toEqual({ modules: inCatalogueOrder, modes: { crm: "ENFORCE", analytics: "REPORT" } });
  });

  it("does not count a module that has been ended, and gives a company that has no subscription the core only (null)", async () => {
    const w = await world();
    await everyoneHasOne(w.platform);
    const a = await isolatedOrg();
    await ensureSubscription(db, w.platform, a.org.id, { planKey: "payroll_essentials", addOns: ["analytics"], reason: "test" });
    await setMode(w.platform, "crm", "ENFORCE", "Go");
    await removeModule(w.platform, a.org.id, "analytics", "Cancelled");
    expect((await loadEntitlements(a.org.id))!.modules).toEqual(["core", "payroll"]);
    const later = await isolatedOrg(); // made after the switch was turned on, by some route that forgot a subscription
    expect(await loadEntitlements(later.org.id)).toEqual({ modules: null, modes: { crm: "ENFORCE" } });
  });
});

describe("the wiring", () => {
  it("has the session load a request's entitlements, so the guards built in E3a see them", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(readFileSync(join(process.cwd(), "src/lib/auth/session.ts"), "utf8")).toMatch(/entitlements: await loadEntitlements\(orgId\)/);
  });
});
