import { describe, expect, it } from "vitest";
import type { Ctx } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { createPriceBook, verifyPriceBook } from "@/server/services/price-book";
import { getBlueprint, listBlueprints, saveBlueprint, setBlueprintStatus } from "@/server/services/blueprints";
import { isolatedOrg, uid } from "../helpers";

/**
 * Step E4c of docs/plans/module-entitlements-e4.md: a blueprint, with the quote it was given, is saved so that what a prospect was told can be shown later, and linked to the
 * bureau's own lead or proposal (the founder's ruling of 2026-11-03). Nothing is sent and no subscription is made: marking a blueprint "sent" records that someone sent it.
 * **Every amount is a TEST value.** Verified price versions cannot be removed, so each test that needs one uses its own start year (2150 and later), after those of the price-book tests.
 */
const ctx = (orgId: string, role: Role, n = 1): Ctx => ({ userId: `${orgId}-${role}-${n}`, orgId, role, name: `${role} ${n}`, email: `${role.toLowerCase()}${n}@${orgId}.test`, employeeId: null });
const ANSWERS = { employees: 120, wants: { payroll: true } };

async function bureau() {
  const code = `B${uid()}${uid()}`;
  const org = await db.organization.create({ data: { name: `Bureau ${code}`, code, isBureau: true } });
  return { org, sales: ctx(org.id, "BUSINESS_DEV"), admin: ctx(org.id, "COMPANY_ADMIN") };
}
async function priceFrom(year: number, lines: Record<string, string>) {
  const t = await isolatedOrg();
  const a = ctx(t.org.id, "SUPER_ADMIN", 1);
  const b = ctx(t.org.id, "SUPER_ADMIN", 2);
  const book = await createPriceBook(a, { effectiveFrom: `${year}-01-01`, minimumMonthly: "50000.00", lines });
  await verifyPriceBook(b, book.id);
}
const lead = (organizationId: string, n = 1) => db.lead.create({ data: { organizationId, number: `L-${uid()}${n}`, company: "Prospect Co", contactName: "A Contact", ownerUserId: "u1", ownerName: "Owner", createdBy: "test" } });
const proposal = (organizationId: string, leadId: string) =>
  db.proposal.create({ data: { organizationId, leadId, number: `P-${uid()}`, packageKey: "PAYROLL_ESSENTIALS", headcount: 10, termMonths: 12, quote: {}, monthlyFee: 0, onboardingFee: 0, marginPct: 0, createdBy: "test", createdByUserId: "u1" } });

describe("who may save and see blueprints", () => {
  it("is for platform staff and for sales people and administrators in a bureau, and for nobody else, a sales role in an ordinary company included", async () => {
    const b = await bureau();
    const t = await isolatedOrg();
    const staff = ctx(t.org.id, "SUPER_ADMIN");
    for (const who of [staff, b.sales, b.admin]) expect((await saveBlueprint(who, { prospectName: "P", answers: ANSWERS, at: new Date("2150-06-01T00:00:00Z") })).id, who.role).toBeTruthy();
    for (const who of [ctx(t.org.id, "COMPANY_ADMIN"), ctx(t.org.id, "HR_ADMIN"), ctx(t.org.id, "BUSINESS_DEV")]) {
      await expect(saveBlueprint(who, { prospectName: "P", answers: ANSWERS }), who.role).rejects.toThrow(/permission/);
      await expect(listBlueprints(who), who.role).rejects.toThrow(/permission/);
    }
  });
});

describe("saving one", () => {
  it("keeps the answers, the modules and the reasons, the proposed plan and the quote it was given, as a draft by the person who made it, with the price version used", async () => {
    await priceFrom(2151, { payroll: "1500.00" });
    const b = await bureau();
    const saved = await saveBlueprint(b.sales, { prospectName: "Lekki Gardens Estate", answers: ANSWERS, at: new Date("2151-06-01T00:00:00Z") });
    const got = await getBlueprint(b.sales, saved.id);
    expect(got).toMatchObject({ prospectName: "Lekki Gardens Estate", status: "DRAFT", planKey: "payroll_essentials", createdBy: b.sales.name, organizationId: b.org.id });
    expect(got.modules).toEqual(["core", "payroll"]);
    expect(got.answers).toEqual(ANSWERS);
    expect((got.configured as { proposed: { planKey: string } }).proposed.planKey).toBe("payroll_essentials");
    expect(got.quote).toMatchObject({ ok: true, monthly: "180000.00", priceBookFrom: "2151-01-01" });
  });

  it("saves a blueprint whose quote is incomplete (a module with no price) and records that, rather than refusing or inventing a total", async () => {
    await priceFrom(2152, { payroll: "1500.00" });
    const b = await bureau();
    const saved = await saveBlueprint(b.sales, { prospectName: "P", answers: { employees: 50, wants: { payroll: true, inventory: true } }, at: new Date("2152-06-01T00:00:00Z") });
    expect((await getBlueprint(b.sales, saved.id)).quote).toMatchObject({ ok: false, monthly: null, unpriced: ["inventory"] });
  });

  it("refuses answers that cannot be used, saying why, and saves nothing; and a prospect with no name", async () => {
    const b = await bureau();
    await expect(saveBlueprint(b.sales, { prospectName: "P", answers: { employees: 0, wants: { payroll: true } } })).rejects.toThrow(/employees/i);
    await expect(saveBlueprint(b.sales, { prospectName: "  ", answers: ANSWERS })).rejects.toThrow(/prospect/i);
    expect(await db.clientBlueprint.count({ where: { organizationId: b.org.id } })).toBe(0);
  });

  it("is a snapshot: a later price version never changes what a saved blueprint was quoted", async () => {
    await priceFrom(2153, { payroll: "1500.00" });
    const b = await bureau();
    const saved = await saveBlueprint(b.sales, { prospectName: "P", answers: ANSWERS, at: new Date("2153-06-01T00:00:00Z") });
    await priceFrom(2154, { payroll: "9999.00" }); // a newer price book
    expect((await getBlueprint(b.sales, saved.id)).quote).toMatchObject({ monthly: "180000.00", priceBookFrom: "2153-01-01" });
  });

  it("is audited by id and plan key, not by what the prospect is called", async () => {
    const b = await bureau();
    const saved = await saveBlueprint(b.sales, { prospectName: "A Very Identifiable Prospect Ltd", answers: ANSWERS, at: new Date("2099-01-01T00:00:00Z") });
    const rows = await db.auditLog.findMany({ where: { organizationId: b.org.id, action: "BLUEPRINT_CREATED" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "ClientBlueprint", entityId: saved.id });
    expect(JSON.stringify(rows[0])).not.toMatch(/Identifiable/);
  });
});

describe("linking to the bureau's own lead or proposal", () => {
  it("links to a lead and a proposal of the same bureau, and the proposal must be that lead's", async () => {
    const b = await bureau();
    const l1 = await lead(b.org.id, 1);
    const l2 = await lead(b.org.id, 2);
    const p1 = await proposal(b.org.id, l1.id);
    const ok = await saveBlueprint(b.sales, { prospectName: "P", answers: ANSWERS, leadId: l1.id, proposalId: p1.id, at: new Date("2099-01-01T00:00:00Z") });
    expect(await getBlueprint(b.sales, ok.id)).toMatchObject({ leadId: l1.id, proposalId: p1.id });
    await expect(saveBlueprint(b.sales, { prospectName: "P", answers: ANSWERS, leadId: l2.id, proposalId: p1.id })).rejects.toThrow(/proposal.*lead/i);
    const onlyLead = await saveBlueprint(b.sales, { prospectName: "P", answers: ANSWERS, leadId: l2.id, at: new Date("2099-01-01T00:00:00Z") });
    expect(await getBlueprint(b.sales, onlyLead.id)).toMatchObject({ leadId: l2.id, proposalId: null });
  });

  it("will not link to another bureau's lead or proposal, and says it was not found (no hint that it exists)", async () => {
    const a = await bureau();
    const other = await bureau();
    const theirLead = await lead(other.org.id);
    const theirProposal = await proposal(other.org.id, theirLead.id);
    await expect(saveBlueprint(a.sales, { prospectName: "P", answers: ANSWERS, leadId: theirLead.id })).rejects.toThrow(/lead was not found/i);
    await expect(saveBlueprint(a.sales, { prospectName: "P", answers: ANSWERS, proposalId: theirProposal.id })).rejects.toThrow(/proposal was not found/i);
    expect(await db.clientBlueprint.count({ where: { organizationId: a.org.id } })).toBe(0);
  });
});

describe("who sees which blueprint", () => {
  it("is the bureau that made it: another bureau cannot list, read or change it", async () => {
    const a = await bureau();
    const other = await bureau();
    const saved = await saveBlueprint(a.sales, { prospectName: "P", answers: ANSWERS, at: new Date("2099-01-01T00:00:00Z") });
    expect((await listBlueprints(a.admin)).map((x) => x.id)).toContain(saved.id); // the whole bureau's, not only the maker's
    expect((await listBlueprints(other.sales)).map((x) => x.id)).not.toContain(saved.id);
    await expect(getBlueprint(other.sales, saved.id)).rejects.toThrow(/not found/i);
    await expect(setBlueprintStatus(other.sales, saved.id, "SENT")).rejects.toThrow(/not found/i);
  });

  it("is seen by a bureau's staff working inside one of its clients, as the bureau's", async () => {
    const a = await bureau();
    const client = await db.organization.create({ data: { name: `Client ${uid()}`, code: `C${uid()}${uid()}`, bureauOrganizationId: a.org.id } });
    const saved = await saveBlueprint(a.sales, { prospectName: "P", answers: ANSWERS, at: new Date("2099-01-01T00:00:00Z") });
    const inClient: Ctx = { ...ctx(client.id, "BUSINESS_DEV", 9), homeOrgId: a.org.id };
    expect((await listBlueprints(inClient)).map((x) => x.id)).toContain(saved.id);
  });
});

describe("its status", () => {
  it("goes draft, sent, accepted; or is dropped from draft or sent; and nothing else, with each change audited", async () => {
    const b = await bureau();
    const make = () => saveBlueprint(b.sales, { prospectName: "P", answers: ANSWERS, at: new Date("2099-01-01T00:00:00Z") });
    const a = await make();
    await expect(setBlueprintStatus(b.sales, a.id, "ACCEPTED")).rejects.toThrow(/draft.*accepted|cannot go/i); // not straight from draft
    await setBlueprintStatus(b.sales, a.id, "SENT");
    await setBlueprintStatus(b.sales, a.id, "ACCEPTED");
    await expect(setBlueprintStatus(b.sales, a.id, "DROPPED")).rejects.toThrow(/cannot go/i); // accepted is final
    expect((await getBlueprint(b.sales, a.id)).status).toBe("ACCEPTED");
    const d = await make();
    await setBlueprintStatus(b.sales, d.id, "DROPPED");
    await expect(setBlueprintStatus(b.sales, d.id, "SENT")).rejects.toThrow(/cannot go/i); // dropped is final
    await expect(setBlueprintStatus(b.sales, d.id, "NONSENSE" as never)).rejects.toThrow(/status/i);
    const audit = await db.auditLog.findMany({ where: { organizationId: b.org.id, action: "BLUEPRINT_STATUS_CHANGED" } });
    expect(audit.length).toBe(3); // sent, accepted, dropped
  });

  it("makes no subscription and sends nothing: accepting only records the status", async () => {
    const b = await bureau();
    const saved = await saveBlueprint(b.sales, { prospectName: "P", answers: ANSWERS, at: new Date("2099-01-01T00:00:00Z") });
    await setBlueprintStatus(b.sales, saved.id, "SENT");
    await setBlueprintStatus(b.sales, saved.id, "ACCEPTED");
    expect(await db.subscription.count({ where: { organizationId: b.org.id } })).toBe(0);
  });
});
