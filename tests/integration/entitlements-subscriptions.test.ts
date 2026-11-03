import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import { can, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { MODULE_KEYS, type ModuleKey } from "@/lib/entitlements/catalogue";
import {
  addModule,
  changePlan,
  createSubscription,
  ensureSubscription,
  getSubscription,
  historyOf,
  modulesOn,
  removeModule,
  setLimits,
} from "@/server/services/subscriptions";
import { isolatedOrg, uid } from "../helpers";

const DAY = 86_400_000;
class Rollback extends Error {}
const yesterday = () => new Date(Date.now() - DAY);

/** Two companies, a platform administrator, a bureau with one client (and an unrelated company), each with its own people. */
async function world() {
  const t = await isolatedOrg();
  const u = await isolatedOrg(); // another company, unrelated
  const code = `B${uid()}${uid()}`;
  const bureau = await db.organization.create({ data: { name: `Bureau ${code}`, code, isBureau: true } });
  const client = await db.organization.create({
    data: { name: `Client of ${code}`, code: `C${code}`, bureauOrganizationId: bureau.id },
  });
  const ctx = (orgId: string, role: Role, n = 1, extra: Partial<Ctx> = {}): Ctx => ({
    userId: `${orgId}-${role}-${n}`,
    orgId,
    role,
    name: `${role} ${n}`,
    email: `${role.toLowerCase()}${n}@${orgId}.test`,
    employeeId: null,
    ...extra,
  });
  return {
    t,
    u,
    bureau,
    client,
    platform: ctx(t.org.id, "SUPER_ADMIN"), // platform staff, working in company t's organization record
    adminT: ctx(t.org.id, "COMPANY_ADMIN"),
    adminU: ctx(u.org.id, "COMPANY_ADMIN"),
    hrT: ctx(t.org.id, "HR_ADMIN"),
    bureauAdmin: ctx(bureau.id, "COMPANY_ADMIN"), // at home in the bureau
    bureauAdminInClient: ctx(client.id, "COMPANY_ADMIN", 1, { homeOrgId: bureau.id }), // the same kind of person, working inside the client
    clientAdmin: ctx(client.id, "COMPANY_ADMIN", 2), // the client's own administrator
  };
}
type W = Awaited<ReturnType<typeof world>>;
const keysOf = async (w: W, org: string) =>
  (await getSubscription(w.platform, org))!.modules
    .filter((m) => m.active)
    .map((m) => m.moduleKey)
    .sort();

describe("who holds the subscription permissions (the trap: a company administrator holds every permission automatically)", () => {
  it("gives subscription.manage to platform staff only, and subscription.view to platform staff and a company's administrator", () => {
    expect(can("SUPER_ADMIN", "subscription.manage")).toBe(true);
    expect(can("SUPER_ADMIN", "subscription.view")).toBe(true);
    expect(can("COMPANY_ADMIN", "subscription.manage")).toBe(false); // or any company could give itself every module
    expect(can("COMPANY_ADMIN", "subscription.view")).toBe(true);
    const holders = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, "subscription.manage"));
    expect(holders).toEqual(["SUPER_ADMIN"]);
    for (const r of (Object.keys(ROLE_PERMISSIONS) as Role[]).filter(
      (x) => !["SUPER_ADMIN", "COMPANY_ADMIN"].includes(x),
    ))
      expect(can(r, "subscription.view"), r).toBe(false);
  });
});

describe("making a subscription", () => {
  it("records the plan, its modules (each from the plan, an add-on, or as needed by another) with the day they started, and an event", async () => {
    const w = await world();
    const s = await createSubscription(w.platform, w.t.org.id, {
      planKey: "payroll_essentials",
      addOns: ["analytics"],
      employeeLimit: 150,
      crmUserLimit: 5,
      reason: "Signed 3 November",
    });
    expect(s).toMatchObject({
      planKey: "payroll_essentials",
      status: "ACTIVE",
      employeeLimit: 150,
      crmUserLimit: 5,
    });
    expect(s.catalogueVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const view = (await getSubscription(w.platform, w.t.org.id))!;
    expect(view.modules.map((m) => [m.moduleKey, m.source]).sort()).toEqual([
      ["analytics", "ADD_ON"],
      ["core", "PLAN"],
      ["payroll", "PLAN"],
    ]);
    expect(view.modules.every((m) => m.active && !m.endsOn)).toBe(true);
    expect(view.events.map((e) => e.kind)).toEqual(["CREATED"]);
    expect(view.events[0]).toMatchObject({ reason: "Signed 3 November", byName: w.platform.name });
  });

  it("refuses an incomplete selection, a plan that does not exist, a module that does not exist, and a second subscription for the same company, saying why", async () => {
    const w = await world();
    await expect(
      createSubscription(w.platform, w.t.org.id, { planKey: "crm", addOns: ["production_pay"] }),
    ).rejects.toThrow(/Production pay needs Payroll/);
    await expect(
      createSubscription(w.platform, w.t.org.id, { planKey: "nonsense" as never }),
    ).rejects.toThrow(/no plan called/i);
    await expect(
      createSubscription(w.platform, w.t.org.id, { planKey: "crm", addOns: ["teleportation" as never] }),
    ).rejects.toThrow(/no module called/i);
    expect(await db.subscription.count({ where: { organizationId: w.t.org.id } })).toBe(0); // nothing was left behind
    await createSubscription(w.platform, w.t.org.id, { planKey: "crm" });
    await expect(createSubscription(w.platform, w.t.org.id, { planKey: "crm" })).rejects.toThrow(
      /already has a subscription/i,
    );
  });

  it("is audited by ids and keys, never by anything else", async () => {
    const w = await world();
    await createSubscription(w.platform, w.t.org.id, { planKey: "hr_payroll" });
    const rows = await db.auditLog.findMany({
      where: { organizationId: w.t.org.id, action: { startsWith: "SUBSCRIPTION_" } },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ entity: "Subscription", userName: w.platform.name });
  });
});

describe("who may change a subscription", () => {
  it("refuses a company's own administrator and every other role, for their own company and any other, and changes nothing", async () => {
    const w = await world();
    await createSubscription(w.platform, w.t.org.id, { planKey: "payroll_essentials" });
    for (const who of [w.adminT, w.hrT, w.adminU]) {
      await expect(addModule(who, w.t.org.id, "analytics", "I would like it")).rejects.toThrow(
        /permission|not allowed/i,
      );
      await expect(changePlan(who, w.t.org.id, { planKey: "workforce_suite" })).rejects.toThrow(
        /permission|not allowed/i,
      );
      await expect(createSubscription(who, w.u.org.id, { planKey: "crm" })).rejects.toThrow(
        /permission|not allowed/i,
      );
    }
    expect(await keysOf(w, w.t.org.id)).toEqual(["core", "payroll"]);
  });

  it("lets platform staff change any company's, and a bureau's administrator change its own clients' (at home or working inside the client) and nobody else's", async () => {
    const w = await world();
    await createSubscription(w.platform, w.client.id, { planKey: "payroll_essentials" });
    await createSubscription(w.platform, w.t.org.id, { planKey: "payroll_essentials" });
    await addModule(w.platform, w.t.org.id, "analytics", "Platform staff");
    await addModule(w.bureauAdmin, w.client.id, "hr", "The bureau, from home");
    await addModule(w.bureauAdminInClient, w.client.id, "analytics", "The bureau, working inside the client");
    expect(await keysOf(w, w.client.id)).toEqual(["analytics", "core", "hr", "payroll"]);
    await expect(addModule(w.bureauAdmin, w.t.org.id, "hr", "Not its client")).rejects.toThrow(
      /permission|not allowed|client/i,
    ); // an unrelated company
    await expect(addModule(w.bureauAdmin, w.bureau.id, "hr", "Itself")).rejects.toThrow(); // a bureau's own subscription is platform staff's
    await expect(
      addModule(w.clientAdmin, w.client.id, "crm", "The client's own administrator"),
    ).rejects.toThrow(/permission|not allowed/i);
    expect(await keysOf(w, w.t.org.id)).toEqual(["analytics", "core", "payroll"]);
  });

  it("lets a company's administrator see its own subscription and no one else's, and a bureau see its clients'", async () => {
    const w = await world();
    await createSubscription(w.platform, w.t.org.id, { planKey: "crm" });
    await createSubscription(w.platform, w.client.id, { planKey: "payroll_essentials" });
    expect((await getSubscription(w.adminT, w.t.org.id))!.modules.map((m) => m.moduleKey).sort()).toEqual([
      "core",
      "crm",
    ]);
    expect((await getSubscription(w.adminT))!.planKey).toBe("crm"); // by default, its own
    await expect(getSubscription(w.adminU, w.t.org.id)).rejects.toThrow(/permission|not allowed|not found/i);
    await expect(getSubscription(w.hrT, w.t.org.id)).rejects.toThrow(/permission|not allowed/i);
    expect((await getSubscription(w.bureauAdmin, w.client.id))!.planKey).toBe("payroll_essentials");
    await expect(getSubscription(w.bureauAdmin, w.t.org.id)).rejects.toThrow(
      /permission|not allowed|not found/i,
    );
  });
});

describe("changing what a company has", () => {
  it("adds a module whose needs are met, and refuses one whose needs are not, one already there, and the core", async () => {
    const w = await world();
    await createSubscription(w.platform, w.t.org.id, { planKey: "crm" });
    await addModule(w.platform, w.t.org.id, "client_billing", "Wants invoices"); // the CRM is one of its either-or choices
    await expect(addModule(w.platform, w.t.org.id, "production_pay", "x")).rejects.toThrow(
      /Production pay needs Payroll/,
    );
    await expect(addModule(w.platform, w.t.org.id, "crm", "x")).rejects.toThrow(/already/i);
    await expect(addModule(w.platform, w.t.org.id, "core", "x")).rejects.toThrow(/already|core/i);
    expect(await keysOf(w, w.t.org.id)).toEqual(["client_billing", "core", "crm"]);
  });

  it("ends a module by giving it an end date and keeping the row (and may say how long it stays read-only), refuses what would break another module, and never removes the core", async () => {
    const w = await world();
    await createSubscription(w.platform, w.t.org.id, { planKey: "hr_payroll", addOns: ["analytics"] });
    await expect(removeModule(w.platform, w.t.org.id, "payroll", "x")).resolves.toBeUndefined(); // self-service survives on HR
    await expect(removeModule(w.platform, w.t.org.id, "hr", "x")).rejects.toThrow(
      /Employee self-service needs one of/,
    ); // the last choice
    await expect(removeModule(w.platform, w.t.org.id, "core", "x")).rejects.toThrow(/always on/i);
    await removeModule(w.platform, w.t.org.id, "analytics", "Cancelled it", { readOnlyDays: 90 });
    const rows = await db.subscriptionModule.findMany({
      where: { organizationId: w.t.org.id, moduleKey: "analytics" },
    });
    expect(rows).toHaveLength(1); // kept, not deleted
    expect(rows[0].endsOn).not.toBeNull();
    expect(rows[0].readOnlyUntil!.getTime()).toBeGreaterThan(Date.now() + 80 * DAY);
    expect(await keysOf(w, w.t.org.id)).toEqual(["core", "hr", "self_service"]);
    expect(await removeModule(w.platform, w.t.org.id, "analytics", "again").catch((e) => e.message)).toMatch(
      /not part of|not on/i,
    );
  });

  it("moves to another plan, ending what it no longer has and starting what is new, and refuses a plan that would leave something incomplete", async () => {
    const w = await world();
    await createSubscription(w.platform, w.t.org.id, { planKey: "payroll_essentials" });
    await changePlan(w.platform, w.t.org.id, { planKey: "hr_payroll", reason: "Upgraded" });
    expect(await keysOf(w, w.t.org.id)).toEqual(["core", "hr", "payroll", "self_service"]);
    await expect(
      changePlan(w.platform, w.t.org.id, { planKey: "crm", addOns: ["production_pay"] }),
    ).rejects.toThrow(/Production pay needs Payroll/);
    expect(await keysOf(w, w.t.org.id)).toEqual(["core", "hr", "payroll", "self_service"]); // unchanged by the refusal
    await changePlan(w.platform, w.t.org.id, { planKey: "crm" });
    expect(await keysOf(w, w.t.org.id)).toEqual(["core", "crm"]);
    expect((await getSubscription(w.platform, w.t.org.id))!.planKey).toBe("crm");
  });

  it("stores the limits, refuses nonsense ones, and does not check them (that is a later step)", async () => {
    const w = await world();
    await createSubscription(w.platform, w.t.org.id, { planKey: "payroll_essentials" });
    await setLimits(w.platform, w.t.org.id, { employeeLimit: 200, crmUserLimit: null }, "Contract");
    expect(await getSubscription(w.platform, w.t.org.id)).toMatchObject({
      employeeLimit: 200,
      crmUserLimit: null,
    });
    await expect(setLimits(w.platform, w.t.org.id, { employeeLimit: -1 }, "x")).rejects.toThrow(
      /whole number/i,
    );
    await expect(setLimits(w.platform, w.t.org.id, { employeeLimit: 1.5 }, "x")).rejects.toThrow(
      /whole number/i,
    );
  });
});

describe("history", () => {
  it("can say which modules a company had on any day, from the dates on the rows", async () => {
    const w = await world();
    await createSubscription(w.platform, w.t.org.id, { planKey: "payroll_essentials" });
    // pretend the subscription began a month ago and analytics was on for ten days of it
    const longAgo = new Date(Date.now() - 30 * DAY);
    await db.subscriptionModule.updateMany({
      where: { organizationId: w.t.org.id },
      data: { startsOn: longAgo },
    });
    await db.subscriptionModule.create({
      data: {
        organizationId: w.t.org.id,
        subscriptionId: (await db.subscription.findFirstOrThrow({ where: { organizationId: w.t.org.id } }))
          .id,
        moduleKey: "analytics",
        source: "ADD_ON",
        startsOn: new Date(Date.now() - 20 * DAY),
        endsOn: new Date(Date.now() - 10 * DAY),
      },
    });
    expect(await modulesOn(w.t.org.id, new Date(Date.now() - 25 * DAY))).toEqual(["core", "payroll"]);
    expect(await modulesOn(w.t.org.id, new Date(Date.now() - 15 * DAY))).toEqual(
      ["core", "payroll", "analytics"].sort(
        (a, b) => MODULE_KEYS.indexOf(a as ModuleKey) - MODULE_KEYS.indexOf(b as ModuleKey),
      ),
    );
    expect(await modulesOn(w.t.org.id, new Date())).toEqual(["core", "payroll"]);
    expect(await modulesOn(w.t.org.id, new Date(Date.now() - 40 * DAY))).toEqual([]); // before it began
  });

  it("returns null, not an empty list, for a company with no subscription, so the caller can decide what that means", async () => {
    const w = await world();
    expect(await modulesOn(w.u.org.id)).toBeNull();
  });

  it("keeps every change as an event that the database itself refuses to change or delete", async () => {
    const w = await world();
    await createSubscription(w.platform, w.t.org.id, { planKey: "crm" });
    await addModule(w.platform, w.t.org.id, "client_billing", "Wants invoices");
    const events = await historyOf(w.platform, w.t.org.id);
    expect(events.map((e) => e.kind)).toEqual(["CREATED", "MODULE_ADDED"]);
    expect(events[1].detail).toMatchObject({ added: ["client_billing"] });
    expect(JSON.stringify(events)).not.toMatch(/@|password/i); // keys and plans only
    const id = events[0].id;
    await expect(
      db.$executeRaw`UPDATE "SubscriptionEvent" SET "reason" = 'tampered' WHERE id = ${id}`,
    ).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM "SubscriptionEvent" WHERE id = ${id}`).rejects.toThrow();
    expect((await historyOf(w.platform, w.t.org.id))[0].reason).not.toBe("tampered");
  });
});

describe("a company that was made without one", () => {
  it("is given one by ensureSubscription, once, and the second call changes nothing", async () => {
    const w = await world();
    const a = await ensureSubscription(db, w.platform, w.u.org.id, {
      planKey: "payroll_essentials",
      reason: "Onboarded",
    });
    const b = await ensureSubscription(db, w.platform, w.u.org.id, {
      planKey: "workforce_suite",
      reason: "again",
    });
    expect(b.id).toBe(a.id);
    expect(a.planKey).toBe("payroll_essentials");
    expect(await keysOf(w, w.u.org.id)).toEqual(["core", "payroll"]);
    expect(await db.subscriptionEvent.count({ where: { organizationId: w.u.org.id } })).toBe(1);
  });
});

describe("the migration's own step for existing companies", () => {
  it("gives a company that has no subscription the Custom plan with every built or partly built module (not the planned ones), each marked grandfathered, plus one event", async () => {
    const w = await world();
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20261116090000_subscriptions/migration.sql"),
      "utf8",
    );
    const step = sql.slice(sql.indexOf("-- BEGIN grandfathering"), sql.indexOf("-- END grandfathering"));
    expect(step.length).toBeGreaterThan(200); // the markers are really there
    // inside a transaction that is rolled back at the end: the step gives EVERY company without a subscription one, and the other test files' companies must not get one from here
    await db
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(step); // the same SQL the migration ran for the companies that existed then
          const sub = await tx.subscription.findFirstOrThrow({
            where: { organizationId: w.t.org.id },
            include: { modules: true, events: true },
          });
          expect(sub).toMatchObject({ planKey: "custom", status: "ACTIVE", createdBy: "migration" });
          const keys = sub.modules.map((m) => m.moduleKey).sort();
          expect(keys).toEqual([
            "accounting",
            "analytics",
            "client_billing",
            "client_portal",
            "contracts_deployment",
            "core",
            "crm",
            "hr",
            "inventory",
            "payables_procurement",
            "payroll",
            "self_service",
            "time_attendance",
          ]);
          for (const planned of ["production_pay", "service_charge_pay", "integrations"])
            expect(keys).not.toContain(planned);
          expect(sub.modules.every((m) => m.source === "GRANDFATHERED" && m.endsOn === null)).toBe(true);
          expect(sub.events.map((e) => e.kind)).toEqual(["GRANDFATHERED"]);
          // and it leaves a company that already has one alone, and is safe to run again
          await tx.$executeRawUnsafe(step);
          expect(await tx.subscription.count({ where: { organizationId: w.t.org.id } })).toBe(1);
          expect(await tx.subscriptionModule.count({ where: { organizationId: w.t.org.id } })).toBe(13);
          throw new Rollback();
        },
        { timeout: 60_000 },
      )
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
    expect(await db.subscription.count({ where: { organizationId: w.t.org.id } })).toBe(0); // and it really was rolled back
  });

  it("matches the catalogue: the grandfathered modules are exactly those that are built or partly built", async () => {
    const { MODULES } = await import("@/lib/entitlements/catalogue");
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20261116090000_subscriptions/migration.sql"),
      "utf8",
    );
    const listed = [
      ...sql
        .slice(sql.indexOf("-- BEGIN grandfathering"), sql.indexOf("-- END grandfathering"))
        .matchAll(/'([a-z_]+)'/g),
    ]
      .map((m) => m[1])
      .filter((k) => (MODULE_KEYS as readonly string[]).includes(k));
    const expected = MODULE_KEYS.filter((k) => MODULES[k].status !== "planned");
    expect([...new Set(listed)].sort()).toEqual([...expected].sort());
  });
});

describe("a blueprint", () => {
  it("has a table of its own that keeps what was proposed, tied to the selling organization and, if there is one, a CRM deal", async () => {
    const w = await world();
    const b = await db.clientBlueprint.create({
      data: {
        organizationId: w.t.org.id,
        prospectName: "Lekki Gardens Estate",
        planKey: "payroll_essentials",
        modules: ["core", "payroll"],
        answers: { headcount: 120 },
        reasons: [],
        createdBy: "Test",
      },
    });
    expect(b).toMatchObject({ status: "DRAFT", prospectName: "Lekki Gardens Estate" });
    expect(await db.clientBlueprint.count({ where: { organizationId: w.u.org.id } })).toBe(0);
  });
});
