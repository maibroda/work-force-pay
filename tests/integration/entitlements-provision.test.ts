import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { MODULE_KEYS } from "@/lib/entitlements/catalogue";
import { getBlueprint, provisionFromBlueprint, saveBlueprint, setBlueprintStatus } from "@/server/services/blueprints";
import { periodFor } from "@/server/services/periods";
import { ensureSubscription, getSubscription, modulesOn } from "@/server/services/subscriptions";
import { isolatedOrg, uid } from "../helpers";

/**
 * Step E5c (the first part) of docs/plans/module-entitlements-e5.md: an accepted blueprint, whose lead has become one of the bureau's clients, is applied to that client: the plan, the
 * add-ons and the limits, in one transaction, with the blueprint recorded in the subscription's history. Nothing here sends anything; applying a plan only changes what the client
 * has. Changing a client's modules is subscription work, so it is for platform staff and a bureau's administrator, not for the sales person who made the blueprint.
 */
const ctx = (orgId: string, role: Role, n = 1, extra: Partial<Ctx> = {}): Ctx => ({ userId: `${orgId}-${role}-${n}`, orgId, role, name: `${role} ${n}`, email: `${role.toLowerCase()}${n}@${orgId}.test`, employeeId: null, ...extra });

/** A bureau with a client that a lead has become, and a blueprint for that lead, accepted. */
async function world(opts: { accept?: boolean; link?: boolean; plan?: "payroll_essentials" | "hr_payroll" } = {}) {
  const code = `B${uid()}${uid()}`;
  const bureau = await db.organization.create({ data: { name: `Bureau ${code}`, code, isBureau: true } });
  const client = await db.organization.create({ data: { name: `Client ${code}`, code: `C${code}`, bureauOrganizationId: bureau.id } });
  const platformOrg = await isolatedOrg();
  const platform = ctx(platformOrg.org.id, "SUPER_ADMIN");
  await ensureSubscription(db, platform, client.id, { planKey: "payroll_essentials", reason: "onboarded" }); // how onboarding leaves a new client
  const lead = await db.lead.create({ data: { organizationId: bureau.id, number: `L-${uid()}`, company: "Prospect Co", contactName: "A Contact", ownerUserId: "u1", ownerName: "Owner", createdBy: "test", clientOrganizationId: client.id } });
  const sales = ctx(bureau.id, "BUSINESS_DEV");
  const admin = ctx(bureau.id, "COMPANY_ADMIN");
  const wants = opts.plan === "payroll_essentials" ? { payroll: true } : { payroll: true, self_service: true, analytics: true };
  const bp = await saveBlueprint(sales, { prospectName: "Prospect Co", answers: { employees: 80, wants }, leadId: opts.link === false ? undefined : lead.id, at: new Date("2099-01-01T00:00:00Z") });
  if (opts.accept !== false) {
    await setBlueprintStatus(sales, bp.id, "SENT");
    await setBlueprintStatus(sales, bp.id, "ACCEPTED");
  }
  return { bureau, client, lead, sales, admin, platform, bp, bureauOrg: bureau.id };
}
const keysOf = async (clientId: string) => (await modulesOn(clientId))!;

describe("applying an accepted blueprint to the client", () => {
  it("makes the client's plan, add-ons and limits what the blueprint proposed, in the history under the blueprint, and marks the blueprint as applied", async () => {
    const w = await world();
    expect(await keysOf(w.client.id)).toEqual(["core", "payroll"]);
    await provisionFromBlueprint(w.admin, w.bp.id);
    const sub = (await getSubscription(w.platform, w.client.id))!;
    expect(sub.planKey).toBe("hr_payroll"); // payroll + self-service + analytics: the closest plan is HR + Payroll with Analytics added on
    expect(await keysOf(w.client.id)).toEqual(MODULE_KEYS.filter((k) => ["core", "hr", "payroll", "self_service", "analytics"].includes(k))); // the plan's four plus the Analytics add-on, in catalogue order
    expect(sub.employeeLimit).toBe(80);
    const ev = sub.events[sub.events.length - 1];
    expect(ev).toMatchObject({ kind: "PLAN_CHANGED" });
    expect(ev.detail).toMatchObject({ blueprintId: w.bp.id });
    const after = await getBlueprint(w.admin, w.bp.id);
    expect(after).toMatchObject({ provisionedOrganizationId: w.client.id });
    expect(after.provisionedAt).not.toBeNull();
    expect(after.status).toBe("ACCEPTED"); // still accepted: applying it is recorded, not a new status
  });

  it("creates the subscription when the client has none", async () => {
    const w = await world();
    const bare = await db.organization.create({ data: { name: `Bare ${uid()}`, code: `X${uid()}${uid()}`, bureauOrganizationId: w.bureau.id } });
    await db.lead.update({ where: { id: w.lead.id }, data: { clientOrganizationId: bare.id } });
    await provisionFromBlueprint(w.admin, w.bp.id);
    const sub = (await getSubscription(w.platform, bare.id))!;
    expect(sub.planKey).toBe("hr_payroll");
    expect(sub.events.map((e) => e.kind)).toEqual(["CREATED"]);
    expect(sub.events[0].detail).toMatchObject({ blueprintId: w.bp.id });
  });

  it("is refused for a blueprint that is not accepted, one that is dropped, and one already applied, and changes nothing", async () => {
    const draft = await world({ accept: false });
    await expect(provisionFromBlueprint(draft.admin, draft.bp.id)).rejects.toThrow(/only an accepted blueprint/i);
    const dropped = await world({ accept: false });
    await setBlueprintStatus(dropped.sales, dropped.bp.id, "DROPPED");
    await expect(provisionFromBlueprint(dropped.admin, dropped.bp.id)).rejects.toThrow(/only an accepted blueprint/i);
    expect(await keysOf(draft.client.id)).toEqual(["core", "payroll"]);
    const w = await world();
    await provisionFromBlueprint(w.admin, w.bp.id);
    await expect(provisionFromBlueprint(w.admin, w.bp.id)).rejects.toThrow(/already been applied/i);
    expect((await getSubscription(w.platform, w.client.id))!.events.filter((e) => e.kind === "PLAN_CHANGED")).toHaveLength(1);
  });

  it("needs a lead that has become a client, and that client must be one of this bureau's own", async () => {
    const noLead = await world({ link: false });
    await expect(provisionFromBlueprint(noLead.admin, noLead.bp.id)).rejects.toThrow(/lead.*client/i);
    const notClient = await world();
    await db.lead.update({ where: { id: notClient.lead.id }, data: { clientOrganizationId: null } });
    await expect(provisionFromBlueprint(notClient.admin, notClient.bp.id)).rejects.toThrow(/lead.*client/i);
    const other = await world();
    const stranger = await db.organization.create({ data: { name: `Stranger ${uid()}`, code: `S${uid()}${uid()}`, bureauOrganizationId: other.bureau.id } });
    await db.lead.update({ where: { id: notClient.lead.id }, data: { clientOrganizationId: stranger.id } });
    await expect(provisionFromBlueprint(notClient.admin, notClient.bp.id)).rejects.toThrow(/not one of this bureau's clients/i);
  });
});

describe("who may apply one", () => {
  it("is platform staff and a bureau's administrator; not the sales person who made it, not an ordinary company's administrator, not another bureau's", async () => {
    const w = await world();
    await expect(provisionFromBlueprint(w.sales, w.bp.id)).rejects.toThrow(/permission/);
    const other = await world();
    await expect(provisionFromBlueprint(other.admin, w.bp.id)).rejects.toThrow(/not found/i); // another bureau cannot even see it
    const t = await isolatedOrg();
    await expect(provisionFromBlueprint(ctx(t.org.id, "COMPANY_ADMIN"), w.bp.id)).rejects.toThrow(/permission/);
    expect(await keysOf(w.client.id)).toEqual(["core", "payroll"]);
    await expect(provisionFromBlueprint(w.admin, w.bp.id)).resolves.toBeUndefined();
  });

  it("works for a bureau administrator who is working inside the client at the time", async () => {
    const w = await world();
    const inClient = ctx(w.client.id, "COMPANY_ADMIN", 7, { homeOrgId: w.bureau.id });
    await expect(provisionFromBlueprint(inClient, w.bp.id)).resolves.toBeUndefined();
    expect((await getBlueprint(w.admin, w.bp.id)).provisionedOrganizationId).toBe(w.client.id);
  });
});

describe("it never strands work, and it is all or nothing", () => {
  it("refuses, and changes nothing (the client keeps its plan, the blueprint stays unapplied), when it would end a module that has work in progress", async () => {
    const w = await world({ plan: "payroll_essentials" });
    // the client has Accounting (not in the blueprint) and a period still being closed
    await db.subscriptionModule.create({ data: { organizationId: w.client.id, subscriptionId: (await db.subscription.findUniqueOrThrow({ where: { organizationId: w.client.id } })).id, moduleKey: "accounting", source: "ADD_ON", startsOn: new Date(Date.now() - 86_400_000) } });
    const period = await periodFor(db, w.client.id, new Date());
    await db.accountingPeriod.update({ where: { id: period.id }, data: { status: "SOFT_CLOSED" } });
    await expect(provisionFromBlueprint(w.admin, w.bp.id)).rejects.toThrow(/Accounting: 1 accounting period/);
    expect(await keysOf(w.client.id)).toContain("accounting");
    expect((await getBlueprint(w.admin, w.bp.id)).provisionedAt).toBeNull();
    expect((await getSubscription(w.platform, w.client.id))!.events.filter((e) => e.kind === "PLAN_CHANGED")).toHaveLength(0);
  });

  it("is audited in both organizations: the blueprint's in the bureau's log, the plan change in the client's, by ids and keys", async () => {
    const w = await world();
    await provisionFromBlueprint(w.admin, w.bp.id);
    const mine = await db.auditLog.findMany({ where: { organizationId: w.bureau.id, action: "BLUEPRINT_PROVISIONED" } });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ entity: "ClientBlueprint", entityId: w.bp.id });
    expect(JSON.stringify(mine[0])).not.toMatch(/Prospect Co/);
    expect(await db.auditLog.count({ where: { organizationId: w.client.id, action: "SUBSCRIPTION_PLAN_CHANGED" } })).toBe(1);
  });
});
