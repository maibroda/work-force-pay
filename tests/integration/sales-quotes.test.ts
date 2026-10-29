import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { moveOpportunity } from "@/server/services/sales/deals";
import { createOpportunity, listPipelines } from "@/server/services/sales/pipelines";
import { approveBelowMargin, createQuote, designateApprover, listApprovers, removeApprover, decideQuote, estimateLine, getMinimumMargin, getQuote, listQuotes, quoteDocument, reviseQuote, saveQuote, sendQuote, setMinimumMargin } from "@/server/services/sales/quotes";
import { createAccount } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** An organization with the sales module on, a standard guard structure, and the pension and employer-cost rules at their starting values. */
async function world(withRules = true, opts: { standardMinimum?: boolean } = {}) {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  for (const c of [admin, repA, repB]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  if (!opts.standardMinimum) await setMinimumMargin(admin, 0); // new organizations start at 15%; tests that are not about it start from none
  const structure = await db.salaryStructure.create({
    data: {
      organizationId: t.org.id, code: "STD", name: "Standard guard", status: "ACTIVE", effectiveFrom: d("2020-01-01"), isDefault: true,
      components: { create: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: c.percentage, taxable: c.taxable, pensionable: c.pensionable, sortOrder: i })) },
    },
  });
  if (withRules) {
    await db.pensionRule.create({ data: { organizationId: t.org.id, version: "P1", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC", "HOUSING", "TRANSPORT"], effectiveFrom: d("2020-01-01") } });
    await db.employerCostRule.create({ data: { organizationId: t.org.id, version: "E1", effectiveFrom: d("2020-01-01") } });
  }
  const account = await createAccount(repA, { name: "Lekki Gardens Estate" });
  const deal = await createOpportunity(repA, { accountId: account.id, name: "24/7 guarding, 2 sites" });
  const stages = (await listPipelines(admin))[0].stages;
  return { t, admin, repA, repB, structure, account, deal, stage: (n: string) => stages.find((s) => s.name === n)!.id };
}

type W = Awaited<ReturnType<typeof world>>;
const lines = (w: W) => [
  { siteName: "Lekki Gardens Phase 1", siteAddress: "1 Admiralty Way", postLabel: "Main gate", shiftPattern: "24/7", salaryStructureId: w.structure.id, headcount: 12, billRatePerHead: "120000.00" },
  { siteName: "Lekki Gardens Phase 2", postLabel: "Supervisor", shiftPattern: "Day 12h", salaryStructureId: w.structure.id, headcount: 2, billRatePerHead: "150000.00", operativeSharePct: 60 },
];

describe("estimating what a guard costs", () => {
  it("uses the rules in force on the date, the structure's own split, and the payroll engine's figures", async () => {
    const w = await world();
    const e = await estimateLine(w.repA, { salaryStructureId: w.structure.id, billRatePerHead: "120000.00" });
    expect(e.cost).toMatchObject({ gross: "84000.00", employerPension: "3276.00", employerCosts: "25134.60", costPerHead: "109134.60", marginPerHead: "10865.40" });
    expect(e.versions).toEqual({ pension: "P1", employerCost: "E1" });
    expect((await estimateLine(w.repA, { salaryStructureId: w.structure.id, billRatePerHead: "120000.00", operativeSharePct: 60 })).cost.gross).toBe("72000.00");
    expect((await estimateLine(w.repA, { salaryStructureId: w.structure.id, billRatePerHead: "120000.00", businessLine: "OUTSOURCING" })).cost.addOns.outsourcingLeaveAllowance).toBe("1680.00");
  });

  it("says plainly when a rule is missing, refuses another organization's structure, and needs permission and the switch", async () => {
    const bare = await world(false);
    await expect(estimateLine(bare.repA, { salaryStructureId: bare.structure.id, billRatePerHead: "120000.00" })).rejects.toThrow(/No pension rule/);
    const w = await world();
    const other = await world();
    await expect(estimateLine(w.repA, { salaryStructureId: other.structure.id, billRatePerHead: "120000.00" })).rejects.toThrow(/structure not found/i);
    await expect(estimateLine(w.t.ctx("AUDITOR", null, 1), { salaryStructureId: w.structure.id, billRatePerHead: "120000.00" })).rejects.toThrow(/permission/);
    await expect(estimateLine(w.repA, { salaryStructureId: w.structure.id, billRatePerHead: "0" })).rejects.toThrow(/above zero/);
    await updateSalesSetting(w.admin, { enabled: false });
    await expect(estimateLine(w.repA, { salaryStructureId: w.structure.id, billRatePerHead: "120000.00" })).rejects.toThrow(/switched off/);
  });
});

describe("making a quote", () => {
  it("prices each line at its own cost, snapshots the figures and the rule versions, and totals exactly", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, validUntil: "2026-12-31", notes: "Prices exclude VAT.", lines: lines(w) });
    expect(q).toMatchObject({ versionNo: 1, status: "DRAFT", belowMinimum: false });
    expect(q.number).toMatch(/^SQ-?\d{5}$/);
    expect(Number(q.monthlyBill)).toBe(1740000);
    const full = await getQuote(w.repA, q.id);
    expect(full.lines).toHaveLength(2);
    expect(full.lines[0]).toMatchObject({ headcount: 12, structureName: "Standard guard", businessLine: "GUARDING" });
    expect([Number(full.lines[0].costPerHead), Number(full.lines[0].lineBill), Number(full.lines[0].lineCost), Number(full.lines[0].lineMargin)]).toEqual([109134.6, 1440000, 1309615.2, 130384.8]);
    expect(Number(full.lines[1].operativeSharePct)).toBe(60);
    expect(Number(full.lines[1].costPerHead)).toBe(130858.5); // gross 90,000 at a 60% share, plus 40,858.50 of employer costs
    expect(full.lines[0].ruleVersions).toEqual({ pension: "P1", employerCost: "E1" });
    expect(full.lines[0].costBreakdown).toMatchObject({ itf: "840.00", employerPension: "3276.00" });
    expect([Number(q.monthlyCost), Number(q.monthlyMargin), q.marginBps]).toEqual([1571332.2, 168667.8, 969]);
  });

  it("never changes a sent quote when the rules change later, but a new quote uses the new rules", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    await sendQuote(w.repA, q.id);
    await db.employerCostRule.updateMany({ where: { organizationId: w.t.org.id }, data: { itfPct: 3 } }); // a rule change
    expect(Number((await getQuote(w.repA, q.id)).lines[0].costPerHead)).toBe(109134.6);
    const again = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    expect(Number((await getQuote(w.repA, again.id)).lines[0].costPerHead)).toBeGreaterThan(109134.6);
  });

  it("can be edited while a draft, and is then frozen: the database refuses to change a sent quote's lines", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    await saveQuote(w.repA, q.id, { lines: [{ ...lines(w)[0], headcount: 20 }] });
    expect(Number((await getQuote(w.repA, q.id)).monthlyBill)).toBe(2400000);
    await sendQuote(w.repA, q.id);
    await expect(saveQuote(w.repA, q.id, { notes: "late edit" })).rejects.toThrow(/draft/i);
    const line = (await getQuote(w.repA, q.id)).lines[0];
    await expect(db.crmQuoteLine.update({ where: { id: line.id }, data: { headcount: 1 } })).rejects.toThrow(/cannot be changed/i);
    await expect(db.crmQuoteLine.delete({ where: { id: line.id } })).rejects.toThrow(/cannot be changed/i);
  });

  it("prices a quote of many lines in one go (the pricing only reads, so no database transaction is held open while it works), and saving or revising it works the same way", async () => {
    const w = await world();
    const many = Array.from({ length: 60 }, (_, i) => ({ ...lines(w)[0], siteName: `Site number ${i + 1}`, headcount: 2 }));
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: many });
    const full = await getQuote(w.repA, q.id);
    expect(full.lines).toHaveLength(60);
    expect(Number(q.monthlyBill)).toBe(60 * 2 * 120000);
    const saved = await saveQuote(w.repA, q.id, { lines: many.slice(0, 30) });
    expect(Number(saved.monthlyBill)).toBe(30 * 2 * 120000);
    await sendQuote(w.repA, q.id);
    const v2 = await reviseQuote(w.repA, q.id);
    expect((await getQuote(w.repA, v2.id)).lines).toHaveLength(30);
  });

  it("is checked: at least one line, a whole number of guards, a bill rate above zero, two decimals at most", async () => {
    const w = await world();
    await expect(createQuote(w.repA, { opportunityId: w.deal.id, lines: [] })).rejects.toThrow(/at least one line/i);
    await expect(createQuote(w.repA, { opportunityId: w.deal.id, lines: [{ ...lines(w)[0], headcount: 0 }] })).rejects.toThrow(/whole number from 1/);
    await expect(createQuote(w.repA, { opportunityId: w.deal.id, lines: [{ ...lines(w)[0], billRatePerHead: "120000.005" }] })).rejects.toThrow(/two decimals/i);
    await expect(createQuote(w.repA, { opportunityId: w.deal.id, lines: [{ ...lines(w)[0], operativeSharePct: 120 }] })).rejects.toThrow(/share/i);
    expect(await db.crmQuote.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });
});

describe("the minimum margin and its approval", () => {
  it("lets a quote above (or with no) minimum go straight out; one below needs a manager other than its maker", async () => {
    const w = await world();
    expect((await getMinimumMargin(w.repA)).percent).toBe("0.00");
    const ok = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    await sendQuote(w.repA, ok.id); // no minimum set: nothing to be below
    await expect(setMinimumMargin(w.repA, 12)).rejects.toThrow(/permission/);
    await setMinimumMargin(w.admin, 12);
    expect((await getMinimumMargin(w.repA)).percent).toBe("12.00");
    const low = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] }); // a margin of about 9.05%
    expect(low).toMatchObject({ belowMinimum: true, minMarginBpsAtQuote: 1200, marginBps: 905 });
    await expect(sendQuote(w.repA, low.id)).rejects.toThrow(/approval/i);
    await expect(approveBelowMargin(w.repA, low.id, "I approve my own quote")).rejects.toThrow(/designated approver/i);
    await expect(approveBelowMargin(w.admin, low.id, "")).rejects.toThrow(/reason/i);
    await expect(approveBelowMargin(w.admin, low.id, "Keeps the client")).rejects.toThrow(/designated approver/i); // a manager who has not been designated cannot approve
    await designateApprover(w.admin, w.admin.userId);
    await approveBelowMargin(w.admin, low.id, "Keeps the client; renegotiate rate at renewal");
    const sent = await sendQuote(w.repA, low.id);
    expect(sent.status).toBe("SENT");
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "SALES_QUOTE_APPROVE_BELOW_MARGIN" } })).toBe(1);
  });

  it("does not let the maker approve when the maker is a manager: someone else must", async () => {
    const w = await world();
    await setMinimumMargin(w.admin, 12);
    const q = await createQuote(w.admin, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    expect(q.belowMinimum).toBe(true);
    const second = w.t.ctx("COMPANY_ADMIN", null, 2);
    await db.user.create({ data: { id: second.userId, organizationId: w.t.org.id, email: second.email, name: second.name, passwordHash: "x", role: second.role } });
    await designateApprover(w.admin, w.admin.userId);
    await designateApprover(w.admin, second.userId);
    await expect(approveBelowMargin(w.admin, q.id, "approving my own")).rejects.toThrow(/someone else|own/i); // designated, but it is their own quote
    await approveBelowMargin(second, q.id, "Strategic client");
    expect((await sendQuote(w.admin, q.id)).status).toBe("SENT");
  });

  it("keeps a margin minimum between 0 and 100 percent with at most two decimals", async () => {
    const w = await world();
    await expect(setMinimumMargin(w.admin, 101)).rejects.toThrow(/between 0 and 100/);
    await expect(setMinimumMargin(w.admin, 12.345)).rejects.toThrow(/two decimals/);
    await setMinimumMargin(w.admin, 12.5);
    expect((await getMinimumMargin(w.admin)).percent).toBe("12.50");
  });
});

describe("billable headcount and the personnel needed to cover the shifts", () => {
  it("bills the guards the client pays for, costs the people the roster needs, and shows the loss when a 24/7 post is under-priced", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [{ ...lines(w)[0], headcount: 6, requiredPersonnel: 7 }] });
    const full = await getQuote(w.repA, q.id);
    expect(full.lines[0]).toMatchObject({ headcount: 6, requiredPersonnel: 7 });
    expect([Number(full.lines[0].lineBill), Number(full.lines[0].lineCost), Number(full.lines[0].lineMargin)]).toEqual([720000, 763942.2, -43942.2]);
    expect([Number(q.monthlyBill), Number(q.monthlyCost), q.marginBps]).toEqual([720000, 763942.2, -610]);
    // a draft that loses money still saves (the minimum margin is what stops it going out)
    await setMinimumMargin(w.admin, 15);
    expect((await saveQuote(w.repA, q.id, { lines: [{ ...lines(w)[0], headcount: 6, requiredPersonnel: 7 }] })).belowMinimum).toBe(true);
  });

  it("gives the whole line when the numbers of guards are given: revenue on the billed, cost on the people needed", async () => {
    const w = await world();
    const e = await estimateLine(w.repA, { salaryStructureId: w.structure.id, billRatePerHead: "120000.00", headcount: 6, requiredPersonnel: 7 });
    expect(e.line).toEqual({ bill: "720000.00", cost: "763942.20", margin: "-43942.20", marginBps: -610 });
    expect((await estimateLine(w.repA, { salaryStructureId: w.structure.id, billRatePerHead: "120000.00" })).line).toBeNull();
  });

  it("takes the personnel to be the billed headcount when it is not given, keeps it through a new version, and refuses a number that is not whole", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0], { ...lines(w)[1], requiredPersonnel: 3 }] });
    const ls = (await getQuote(w.repA, q.id)).lines;
    expect([ls[0].headcount, ls[0].requiredPersonnel, ls[1].headcount, ls[1].requiredPersonnel]).toEqual([12, 12, 2, 3]);
    await sendQuote(w.repA, q.id);
    const v2 = await reviseQuote(w.repA, q.id);
    expect((await getQuote(w.repA, v2.id)).lines.map((l) => l.requiredPersonnel)).toEqual([12, 3]);
    await expect(createQuote(w.repA, { opportunityId: w.deal.id, lines: [{ ...lines(w)[0], requiredPersonnel: 0 }] })).rejects.toThrow(/personnel/i);
    await expect(createQuote(w.repA, { opportunityId: w.deal.id, lines: [{ ...lines(w)[0], requiredPersonnel: 2.5 }] })).rejects.toThrow(/personnel/i);
  });

  it("shows the client only the guards they are billed for, never how many people the roster needs", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [{ ...lines(w)[0], headcount: 6, requiredPersonnel: 9 }] });
    const doc = await quoteDocument(w.repA, q.id);
    expect(doc.rows[0].headcount).toBe(6);
    expect(doc.total).toBe("720000.00");
    expect(JSON.stringify(doc)).not.toMatch(/personnel|required|"9"|:9[,}]/i);
  });
});

describe("the standard minimum margin of 15%, and who may approve below it", () => {
  it("starts at 15% for an organization, so a standard 70% share quote (a margin near 9%) needs approval while a leaner one does not", async () => {
    const w = await world(true, { standardMinimum: true });
    expect((await getMinimumMargin(w.repA)).percent).toBe("15.00");
    const standard = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    expect(standard).toMatchObject({ marginBps: 905, belowMinimum: true, minMarginBpsAtQuote: 1500 });
    await expect(sendQuote(w.repA, standard.id)).rejects.toThrow(/approval/i);
    // with a 50% share to the guard the margin is 16.47%, above the minimum
    const lean = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [{ ...lines(w)[0], operativeSharePct: 50 }] });
    expect(lean).toMatchObject({ marginBps: 1647, belowMinimum: false });
    expect((await sendQuote(w.repA, lean.id)).status).toBe("SENT");
  });

  it("can be approved only by a designated approver other than the maker, and says so when nobody has been designated", async () => {
    const w = await world(true, { standardMinimum: true });
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    await expect(approveBelowMargin(w.admin, q.id, "Strategic client")).rejects.toThrow(/No approver has been designated|designated approver/i);
    expect(await listApprovers(w.admin)).toEqual([]);
    const a = await designateApprover(w.admin, w.admin.userId);
    expect((await listApprovers(w.repA)).map((x) => x.userId)).toEqual([w.admin.userId]); // anyone in sales can see who the approvers are
    await approveBelowMargin(w.admin, q.id, "Strategic client; margin reviewed at renewal");
    expect((await sendQuote(w.repA, q.id)).status).toBe("SENT");
    await removeApprover(w.admin, a.id);
    expect(await listApprovers(w.admin)).toEqual([]);
    const next = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    await expect(approveBelowMargin(w.admin, next.id, "no longer an approver")).rejects.toThrow(/designated approver/i);
  });

  it("designates only an active manager of this organization, only by someone who configures sales, and audits it", async () => {
    const w = await world();
    const other = await world();
    await expect(designateApprover(w.repA, w.admin.userId)).rejects.toThrow(/permission/);
    await expect(designateApprover(w.admin, w.repA.userId)).rejects.toThrow(/manager/i); // a sales person who cannot see everyone's records
    await expect(designateApprover(w.admin, other.admin.userId)).rejects.toThrow(/not an active user/);
    await db.user.create({ data: { id: "aud-1", organizationId: w.t.org.id, email: "aud1@x.test", name: "An Auditor", passwordHash: "x", role: "AUDITOR" } });
    await expect(designateApprover(w.admin, "aud-1")).rejects.toThrow(/manager/i);
    await designateApprover(w.admin, w.admin.userId);
    await designateApprover(w.admin, w.admin.userId); // designating again changes nothing
    expect(await listApprovers(w.admin)).toHaveLength(1);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SALES_QUOTE_APPROVER" } } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rows.map((r) => r.newValue))).not.toMatch(/COMPANY_ADMIN 1/); // the approver is named by id, not by name, in what is recorded
  });

  it("checks a draft against the minimum in force when it is sent, not only when it was priced", async () => {
    const w = await world();
    await designateApprover(w.admin, w.admin.userId);
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] }); // priced when there was no minimum
    await setMinimumMargin(w.admin, 15); // the minimum is raised before it is sent
    await expect(sendQuote(w.repA, q.id)).rejects.toThrow(/approval/i);
    await setMinimumMargin(w.admin, 12);
    await approveBelowMargin(w.admin, q.id, "Approved against the 12% minimum");
    await setMinimumMargin(w.admin, 15); // raised again after the approval: it no longer covers this quote
    await expect(sendQuote(w.repA, q.id)).rejects.toThrow(/approval/i);
    await approveBelowMargin(w.admin, q.id, "Approved again against the 15% minimum");
    expect((await sendQuote(w.repA, q.id)).status).toBe("SENT");
    await setMinimumMargin(w.admin, 0);
  });
});

describe("versions, acceptance and the stage requirement", () => {
  it("a sent quote can be revised into a new draft version, and the earlier one is superseded", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: lines(w) });
    await sendQuote(w.repA, q.id);
    const v2 = await reviseQuote(w.repA, q.id);
    expect(v2).toMatchObject({ number: q.number, versionNo: 2, status: "DRAFT" });
    expect((await getQuote(w.repA, v2.id)).lines).toHaveLength(2);
    expect((await db.crmQuote.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("SUPERSEDED");
    expect((await listQuotes(w.repA, w.deal.id)).map((x) => [x.versionNo, x.status])).toEqual([[2, "DRAFT"], [1, "SUPERSEDED"]]);
    await expect(reviseQuote(w.repA, q.id)).rejects.toThrow(/sent|rejected|accepted/i); // only the live version can be revised
  });

  it("accepting a quote copies its monthly total into the deal; only a sent quote can be decided, and only one can be accepted", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: lines(w) });
    await expect(decideQuote(w.repA, q.id, "ACCEPTED")).rejects.toThrow(/sent/i);
    await sendQuote(w.repA, q.id);
    const accepted = await decideQuote(w.repA, q.id, "ACCEPTED", "Signed by the estate manager");
    expect(accepted.status).toBe("ACCEPTED");
    expect(Number((await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id } })).monthlyContractValue)).toBe(1740000);
    await expect(decideQuote(w.repA, q.id, "REJECTED")).rejects.toThrow(/sent/i);
    const second = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    await sendQuote(w.repA, second.id);
    await expect(decideQuote(w.repA, second.id, "ACCEPTED")).rejects.toThrow(/already/i);
  });

  it("switches on the Proposal sent requirement: the deal cannot enter it until a quote has been sent", async () => {
    const w = await world();
    await expect(moveOpportunity(w.repA, w.deal.id, { stageId: w.stage("Proposal sent"), nextStep: "Send the proposal" })).rejects.toThrow(/a quote that has been sent or accepted/);
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    await expect(moveOpportunity(w.repA, w.deal.id, { stageId: w.stage("Proposal sent"), nextStep: "Send the proposal" })).rejects.toThrow(/a quote that has been sent or accepted/); // a draft does not count
    await sendQuote(w.repA, q.id);
    expect((await moveOpportunity(w.repA, w.deal.id, { stageId: w.stage("Proposal sent"), nextStep: "Follow up in 3 days" })).probability).toBe(50);
  });
});

describe("who may see and change quotes, and what the client is shown", () => {
  it("limits a quote to the deal's owner or a manager, to the organization, and to people who manage sales", async () => {
    const w = await world();
    const other = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: [lines(w)[0]] });
    await expect(getQuote(w.repB, q.id)).rejects.toThrow(/not found/);
    await expect(sendQuote(w.repB, q.id)).rejects.toThrow(/not found/);
    await expect(getQuote(other.admin, q.id)).rejects.toThrow(/not found/);
    await expect(createQuote(w.repB, { opportunityId: w.deal.id, lines: [lines(w)[0]] })).rejects.toThrow(/not found/);
    await expect(createQuote(w.t.ctx("FINANCE", null, 1), { opportunityId: w.deal.id, lines: [lines(w)[0]] })).rejects.toThrow(/permission/);
    expect((await getQuote(w.t.ctx("FINANCE", null, 1), q.id)).id).toBe(q.id); // finance may read
    expect((await getQuote(w.admin, q.id)).id).toBe(q.id);
  });

  it("gives the client a document with the bill rates and totals and nothing of the company's cost or margin", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, validUntil: "2026-12-31", notes: "Prices exclude VAT.", lines: lines(w) });
    const doc = await quoteDocument(w.repA, q.id);
    expect(doc).toMatchObject({ number: q.number, accountName: "Lekki Gardens Estate", total: "1740000.00", validUntil: "2026-12-31", notes: "Prices exclude VAT.", draft: true });
    expect(doc.rows).toHaveLength(2);
    expect(JSON.stringify(doc)).not.toMatch(/cost|margin|109134|itf|pension|130858/i);
  });

  it("audits each step with ids and statuses only, never amounts or site names", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: lines(w) });
    await sendQuote(w.repA, q.id);
    await decideQuote(w.repA, q.id, "ACCEPTED", "Signed");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SALES_QUOTE" } } });
    expect(rows.map((r) => r.action).sort()).toEqual(["SALES_QUOTE_CREATE", "SALES_QUOTE_DECIDE", "SALES_QUOTE_SEND"]);
    expect(JSON.stringify(rows)).not.toMatch(/Lekki|1740000|1440000|Signed/);
  });
});
