import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { board, getOpportunity, moveOpportunity, updateOpportunity } from "@/server/services/sales/deals";
import { createOpportunity, listPipelines } from "@/server/services/sales/pipelines";
import { createAccount, createContact } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

async function world() {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  for (const c of [admin, repA, repB]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  const stages = (await listPipelines(admin))[0].stages;
  const stage = (name: string) => stages.find((s) => s.name === name)!.id;
  return { t, admin, repA, repB, stage };
}

async function deal(w: Awaited<ReturnType<typeof world>>, name = "Secret Deal Name", value = "1000000.00") {
  const a = await createAccount(w.repA, { name: `${name} Account` });
  return { account: a, opp: await createOpportunity(w.repA, { accountId: a.id, name, monthlyContractValue: value }) };
}

describe("moving a deal between stages", () => {
  it("records the move, takes the new stage's probability, restarts the days in stage, and needs a next step every time", async () => {
    const w = await world();
    const { opp } = await deal(w);
    await expect(moveOpportunity(w.repA, opp.id, { stageId: w.stage("Qualified"), nextStep: "" })).rejects.toThrow(/next step/i);
    const moved = await moveOpportunity(w.repA, opp.id, { stageId: w.stage("Qualified"), nextStep: "Call the facility manager on Monday" });
    expect(moved).toMatchObject({ stageId: w.stage("Qualified"), probability: 20, nextStep: "Call the facility manager on Monday" });
    const h = await db.crmStageHistory.findMany({ where: { opportunityId: opp.id }, orderBy: { changedAt: "asc" } });
    expect(h).toHaveLength(2);
    expect(h[1]).toMatchObject({ fromStageId: w.stage("Lead in"), toStageId: w.stage("Qualified"), daysInPreviousStage: 0, changedBy: w.repA.name });
    await expect(moveOpportunity(w.repA, opp.id, { stageId: w.stage("Qualified"), nextStep: "Again" })).rejects.toThrow(/already in/i);
    await expect(db.crmStageHistory.update({ where: { id: h[1].id }, data: { toStageId: w.stage("Won") } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.crmStageHistory.delete({ where: { id: h[0].id } })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("lets the owner set the probability within the stage, and keeps it between 0 and 100", async () => {
    const w = await world();
    const { opp } = await deal(w);
    const m = await moveOpportunity(w.repA, opp.id, { stageId: w.stage("Qualified"), nextStep: "Visit", probability: 65 });
    expect(m.probability).toBe(65);
    await expect(moveOpportunity(w.repA, opp.id, { stageId: w.stage("Negotiation"), nextStep: "Send terms", probability: 101 })).rejects.toThrow(/0 to 100/);
    expect((await db.crmOpportunity.findUniqueOrThrow({ where: { id: opp.id } })).probability).toBe(65);
  });

  it("blocks entering a stage until its requirements are met, naming exactly what is missing, and writes nothing when blocked", async () => {
    const w = await world();
    const { account, opp } = await deal(w);
    await expect(moveOpportunity(w.repA, opp.id, { stageId: w.stage("Site survey"), nextStep: "Book survey" })).rejects.toThrow(/expected start date.*contact/is);
    expect(await db.crmStageHistory.count({ where: { opportunityId: opp.id } })).toBe(1);
    expect((await db.crmOpportunity.findUniqueOrThrow({ where: { id: opp.id } })).stageId).toBe(w.stage("Lead in"));
    await updateOpportunity(w.repA, opp.id, { expectedStartDate: "2027-02-01" });
    await createContact(w.repA, { accountId: account.id, firstName: "Ada", lastName: "Obi" }); // a contact on the account is enough
    const m = await moveOpportunity(w.repA, opp.id, { stageId: w.stage("Site survey"), nextStep: "Survey on the 10th" });
    expect(m.probability).toBe(35);
  });

  it("won needs a value, a term and a start date; it forces 100%, stamps the date and closes the deal", async () => {
    const w = await world();
    const { opp } = await deal(w, "Closing Deal", "0.00");
    await expect(moveOpportunity(w.repA, opp.id, { stageId: w.stage("Won"), nextStep: "Handover" })).rejects.toThrow(/monthly contract value.*start date.*term|term.*start date/is);
    await updateOpportunity(w.repA, opp.id, { monthlyContractValue: "2500000.50", contractTermMonths: 12, expectedStartDate: "2027-01-01" });
    const won = await moveOpportunity(w.repA, opp.id, { stageId: w.stage("Won"), nextStep: "Start the handover", probability: 40 });
    expect(won.probability).toBe(100); // an override is ignored for a won deal
    expect(won.wonAt).toBeInstanceOf(Date);
    await expect(moveOpportunity(w.repA, opp.id, { stageId: w.stage("Negotiation"), nextStep: "Back" })).rejects.toThrow(/closed/i);
    await expect(updateOpportunity(w.repA, opp.id, { name: "Renamed" })).rejects.toThrow(/closed/i);
  });

  it("lost needs a reason, forces 0%, keeps the detail and the competitor, and closes the deal", async () => {
    const w = await world();
    const { opp } = await deal(w);
    await expect(moveOpportunity(w.repA, opp.id, { stageId: w.stage("Lost"), nextStep: "Re-approach in 90 days" })).rejects.toThrow(/reason it was lost/i);
    const lost = await moveOpportunity(w.repA, opp.id, { stageId: w.stage("Lost"), nextStep: "Re-approach in 90 days", lostReason: "PRICE", lostReasonDetail: "Rival quoted 12% less", competitor: "SafeHands Security" });
    expect(lost).toMatchObject({ probability: 0, lostReason: "PRICE", lostReasonDetail: "Rival quoted 12% less", competitor: "SafeHands Security" });
    expect(lost.lostAt).toBeInstanceOf(Date);
    await expect(moveOpportunity(w.repA, opp.id, { stageId: w.stage("Qualified"), nextStep: "Reopen" })).rejects.toThrow(/closed/i);
  });

  it("is limited to the owner or a manager, to this organization, and to the deal's own pipeline", async () => {
    const w = await world();
    const other = await world();
    const { opp } = await deal(w);
    await expect(moveOpportunity(w.repB, opp.id, { stageId: w.stage("Qualified"), nextStep: "Check on it Monday" })).rejects.toThrow(/not found/);
    await expect(moveOpportunity(w.t.ctx("AUDITOR", null, 1), opp.id, { stageId: w.stage("Qualified"), nextStep: "Check on it Monday" })).rejects.toThrow(/permission/);
    await expect(moveOpportunity(w.t.ctx("OPERATIONS", null, 1), opp.id, { stageId: w.stage("Qualified"), nextStep: "Check on it Monday" })).rejects.toThrow(/permission/);
    await expect(moveOpportunity(w.admin, opp.id, { stageId: other.stage("Qualified"), nextStep: "Check on it Monday" })).rejects.toThrow(/stage not found/i);
    await expect(moveOpportunity(other.admin, opp.id, { stageId: other.stage("Qualified"), nextStep: "Check on it Monday" })).rejects.toThrow(/not found/);
    const second = await db.crmPipeline.create({ data: { organizationId: w.t.org.id, name: "Renewal", kind: "RENEWAL", stages: { create: [{ name: "Due", sortOrder: 1, stageType: "OPEN", defaultProbability: 50 }] } }, include: { stages: true } });
    await expect(moveOpportunity(w.admin, opp.id, { stageId: second.stages[0].id, nextStep: "Check on it Monday" })).rejects.toThrow(/stage not found/i);
    expect((await moveOpportunity(w.admin, opp.id, { stageId: w.stage("Qualified"), nextStep: "Manager moved it" })).stageId).toBe(w.stage("Qualified"));
    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SALES_OPPORTUNITY_MOVE" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/Secret Deal Name|Manager moved it/);
  });
});

describe("editing a deal", () => {
  it("changes its details, refuses a value with more than two decimals, and audits field names only", async () => {
    const w = await world();
    const { opp } = await deal(w);
    const u = await updateOpportunity(w.repA, opp.id, { name: "Renamed deal", monthlyContractValue: "1750000.25", probability: 55, expectedCloseDate: "2026-12-31", competitor: "RivalCo", contractTermMonths: 24 });
    expect(u).toMatchObject({ name: "Renamed deal", probability: 55, competitor: "RivalCo", contractTermMonths: 24 });
    expect(Number(u.monthlyContractValue)).toBe(1750000.25);
    await expect(updateOpportunity(w.repA, opp.id, { monthlyContractValue: "10.005" })).rejects.toThrow(/two decimals/i);
    await expect(updateOpportunity(w.repA, opp.id, { probability: 150 })).rejects.toThrow(/0 to 100/);
    await expect(updateOpportunity(w.repB, opp.id, { name: "Hijack" })).rejects.toThrow(/not found/);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: w.t.org.id, action: "SALES_OPPORTUNITY_UPDATE" } });
    expect(JSON.stringify(audit)).not.toMatch(/Renamed deal|RivalCo/);
    expect(JSON.stringify(audit)).toMatch(/competitor/);
    const view = await getOpportunity(w.repA, opp.id);
    expect(view.opportunity.name).toBe("Renamed deal");
    expect(view.history).toHaveLength(1);
    expect(view.stages.map((s) => s.name)[0]).toBe("Lead in");
  });
});

describe("the board", () => {
  it("shows a column per stage with each card, and exact totals of value and weighted value", async () => {
    const w = await world();
    const a = await deal(w, "Deal A", "1000000.00"); // Lead in, 10%
    const b = await deal(w, "Deal B", "2000000.00");
    await moveOpportunity(w.repA, b.opp.id, { stageId: w.stage("Qualified"), nextStep: "Visit", probability: 33 });
    const bd = await board(w.repA);
    expect(bd.pipeline.name).toBe("New business");
    expect(bd.columns.map((c) => c.stage.name)).toEqual(["Lead in", "Qualified", "Site survey", "Proposal sent", "Negotiation", "Contract signing", "Won", "Lost"]);
    const leadIn = bd.columns[0];
    expect(leadIn.deals.map((d) => d.id)).toEqual([a.opp.id]);
    expect(leadIn.totals).toEqual({ count: 1, value: "1000000.00", weighted: "100000.00" });
    expect(bd.columns[1].totals).toEqual({ count: 1, value: "2000000.00", weighted: "660000.00" });
    expect(bd.columns[1].deals[0]).toMatchObject({ name: "Deal B", accountName: "Deal B Account", probability: 33, weighted: "660000.00", rotting: false, daysInStage: 0 });
  });

  it("flags a deal with no activity for longer than its stage allows", async () => {
    const w = await world();
    const { opp } = await deal(w);
    await db.crmOpportunity.update({ where: { id: opp.id }, data: { lastActivityAt: new Date(Date.now() - 30 * 86_400_000) } });
    expect((await board(w.repA)).columns[0].deals[0].rotting).toBe(true);
    await updateOpportunity(w.repA, opp.id, { nextStep: "Called them today" }); // activity on the deal clears it
    expect((await board(w.repA)).columns[0].deals[0].rotting).toBe(false);
  });

  it("shows a sales person their own deals, a manager everyone's, and keeps won and lost deals out of the forecast", async () => {
    const w = await world();
    const a = await deal(w, "Mine");
    const b = await createAccount(w.repB, { name: "B Account" });
    await createOpportunity(w.repB, { accountId: b.id, name: "Theirs", monthlyContractValue: "500000.00", expectedCloseDate: "2026-12-10" });
    await db.crmOpportunity.update({ where: { id: a.opp.id }, data: { expectedCloseDate: new Date("2026-11-20T00:00:00Z") } });
    expect((await board(w.repA)).columns[0].deals.map((d) => d.name)).toEqual(["Mine"]);
    const all = await board(w.admin);
    expect(all.columns[0].deals.map((d) => d.name).sort()).toEqual(["Mine", "Theirs"]);
    expect(all.forecast).toEqual([
      { month: "2026-11", count: 1, value: "1000000.00", weighted: "100000.00" },
      { month: "2026-12", count: 1, value: "500000.00", weighted: "50000.00" },
    ]);
    await moveOpportunity(w.repA, a.opp.id, { stageId: w.stage("Lost"), nextStep: "Later", lostReason: "BUDGET" });
    expect((await board(w.admin)).forecast.map((f) => f.month)).toEqual(["2026-12"]);
    expect((await board(w.admin)).columns.find((c) => c.stage.name === "Lost")!.deals).toHaveLength(1);
    await expect(board(w.t.ctx("AUDITOR", null, 1))).rejects.toThrow(/permission/);
  });
});
