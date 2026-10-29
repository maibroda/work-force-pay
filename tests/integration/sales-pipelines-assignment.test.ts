import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getAssignment, removeAssignmentRule, setAssignmentMethod, setAssignmentRule } from "@/server/services/sales/assignment";
import { createOpportunity, listOpportunities, listPipelines } from "@/server/services/sales/pipelines";
import { createAccount, createLead } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

async function world() {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  for (const c of [admin, repA, repB]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  return { t, admin, repA, repB };
}

describe("the default pipeline", () => {
  it("is created once, when the module is first switched on, with the agreed stages and probabilities, and is private to the organization", async () => {
    const w = await world();
    const other = await world();
    await updateSalesSetting(w.admin, { enabled: false });
    await updateSalesSetting(w.admin, { enabled: true }); // switching again must not duplicate it
    const pipelines = await listPipelines(w.repA);
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]).toMatchObject({ name: "New business", kind: "NEW_BUSINESS", isDefault: true });
    expect(pipelines[0].stages.map((s) => [s.name, s.defaultProbability, s.stageType])).toEqual([
      ["Lead in", 10, "OPEN"],
      ["Qualified", 20, "OPEN"],
      ["Site survey", 35, "OPEN"],
      ["Proposal sent", 50, "OPEN"],
      ["Negotiation", 70, "OPEN"],
      ["Contract signing", 85, "OPEN"],
      ["Won", 100, "WON"],
      ["Lost", 0, "LOST"],
    ]);
    expect(pipelines[0].stages.find((s) => s.name === "Won")?.requiredFields).toEqual(["monthlyContractValue", "contractTermMonths", "expectedStartDate"]);
    expect(pipelines[0].id).not.toBe((await listPipelines(other.admin))[0].id);
    expect(await db.crmPipeline.count({ where: { organizationId: w.t.org.id } })).toBe(1);
  });

  it("is created on the first deal for an organization that switched the module on before pipelines existed", async () => {
    const w = await world();
    await db.crmStage.deleteMany({ where: { pipeline: { organizationId: w.t.org.id } } });
    await db.crmPipeline.deleteMany({ where: { organizationId: w.t.org.id } });
    const a = await createAccount(w.repA, { name: "Early Adopter Co" });
    const o = await createOpportunity(w.repA, { accountId: a.id, name: "First deal" });
    expect(await db.crmOpportunity.findUniqueOrThrow({ where: { id: o.id }, include: { stage: true } })).toMatchObject({ probability: 10, stage: { name: "Lead in" } });
    expect(await db.crmPipeline.count({ where: { organizationId: w.t.org.id } })).toBe(1);
  });

  it("shows a sales person only their own deals, a manager all, and nobody another organization's", async () => {
    const w = await world();
    const other = await world();
    const a = await createAccount(w.repA, { name: "A Co" });
    const b = await createAccount(w.repB, { name: "B Co" });
    const oa = await createOpportunity(w.repA, { accountId: a.id, name: "A deal" });
    await createOpportunity(w.repB, { accountId: b.id, name: "B deal" });
    expect((await listOpportunities(w.repA)).map((o) => o.id)).toEqual([oa.id]);
    expect(await listOpportunities(w.admin)).toHaveLength(2);
    expect(await listOpportunities(other.admin)).toEqual([]);
    await expect(createOpportunity(w.repB, { accountId: a.id, name: "Not mine" })).rejects.toThrow(/not found/); // repB cannot see A's account
  });
});

describe("assigning new leads to an owner", () => {
  it("does nothing until a method is chosen, and then only for a manager's leads with no owner given", async () => {
    const w = await world();
    expect((await getAssignment(w.admin)).method).toBe("NONE");
    expect((await createLead(w.admin, { companyName: "No method" })).ownerUserId).toBe(w.admin.userId);
    await setAssignmentMethod(w.admin, "ROUND_ROBIN");
    expect((await createLead(w.repA, { companyName: "Own entry" })).ownerUserId).toBe(w.repA.userId); // a sales person owns what they add
    expect((await createLead(w.admin, { companyName: "Explicit", ownerUserId: w.repB.userId })).ownerUserId).toBe(w.repB.userId);
    await expect(setAssignmentMethod(w.repA, "NONE")).rejects.toThrow(/permission/);
  });

  it("goes round the active sales people in turn, and audits each assignment with ids only", async () => {
    const w = await world();
    await setAssignmentMethod(w.admin, "ROUND_ROBIN");
    const owners: string[] = [];
    for (let i = 1; i <= 5; i++) owners.push((await createLead(w.admin, { companyName: `Lead number ${i}` })).ownerUserId);
    expect(owners).toEqual([w.repA.userId, w.repB.userId, w.repA.userId, w.repB.userId, w.repA.userId]);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SALES_LEAD_ASSIGN" } });
    expect(rows).toHaveLength(5);
    expect(JSON.stringify(rows)).not.toMatch(/Lead number/);
    // someone who has left is skipped
    await db.user.update({ where: { id: w.repB.userId }, data: { active: false } });
    expect((await createLead(w.admin, { companyName: "After B left" })).ownerUserId).toBe(w.repA.userId);
  });

  it("by state or by service, ignoring case, and falls back to the creator when no rule matches", async () => {
    const w = await world();
    await setAssignmentMethod(w.admin, "BY_STATE");
    const rule = await setAssignmentRule(w.admin, { kind: "STATE", key: "Lagos", userId: w.repB.userId });
    expect((await createLead(w.admin, { companyName: "In Lagos", state: "lagos" })).ownerUserId).toBe(w.repB.userId);
    expect((await createLead(w.admin, { companyName: "In Abuja", state: "Abuja" })).ownerUserId).toBe(w.admin.userId);
    expect((await createLead(w.admin, { companyName: "No state" })).ownerUserId).toBe(w.admin.userId);
    await removeAssignmentRule(w.admin, rule.id);
    expect((await createLead(w.admin, { companyName: "Lagos again", state: "Lagos" })).ownerUserId).toBe(w.admin.userId);

    await setAssignmentMethod(w.admin, "BY_SERVICE");
    await setAssignmentRule(w.admin, { kind: "SERVICE", key: "CLEANING", userId: w.repA.userId });
    expect((await createLead(w.admin, { companyName: "Cleaning", serviceInterest: "CLEANING" })).ownerUserId).toBe(w.repA.userId);
    expect((await createLead(w.admin, { companyName: "Guarding", serviceInterest: "GUARDING" })).ownerUserId).toBe(w.admin.userId);
  });

  it("only points a rule at an active user of the same organization who works in sales", async () => {
    const w = await world();
    const other = await world();
    await expect(setAssignmentRule(w.admin, { kind: "STATE", key: "Lagos", userId: other.repA.userId })).rejects.toThrow(/not an active user/);
    await db.user.create({ data: { id: "auditor-user-1", organizationId: w.t.org.id, email: "aud@x.test", name: "An Auditor", passwordHash: "x", role: "AUDITOR" } });
    await expect(setAssignmentRule(w.admin, { kind: "STATE", key: "Lagos", userId: "auditor-user-1" })).rejects.toThrow(/sales/);
    await expect(setAssignmentRule(w.repA, { kind: "STATE", key: "Lagos", userId: w.repB.userId })).rejects.toThrow(/permission/);
    expect((await getAssignment(w.admin)).rules).toEqual([]);
    expect((await getAssignment(other.admin)).rules).toEqual([]);
  });
});
