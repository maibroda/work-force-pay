import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { enableBureau, onboardClient } from "@/server/services/bureau";
import { createUser } from "@/server/services/users";
import { createLead, createPartner, crmAvailable, getLead, listLeads, listOutreach, logOutreach, moveLead, outreachToday, partnerSummary, pipelineOwners, recordPayout, salesDashboard, updateLead, updatePartner } from "@/server/services/crm";
import { isolatedOrg, uid } from "../helpers";

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@crm.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

async function world() {
  const t = await isolatedOrg();
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  const bd = await person(t.org.id, "BUSINESS_DEV", "sales");
  const bd2 = await person(t.org.id, "BUSINESS_DEV", "sales2");
  const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
  await enableBureau(founder);
  return { t, founder, bd, bd2, officer };
}
type W = Awaited<ReturnType<typeof world>>;
const lead = (w: W, over: Record<string, unknown> = {}, as: Ctx = w.bd) => createLead(as, { company: `Co ${uid()}${uid()}`, contactName: "Mr Okoro", ...over } as never);
const today = iso(new Date());

describe("adding leads", () => {
  it("numbers them, starts them qualified with a first entry in the history, and gives them to the person who added them", async () => {
    const w = await world();
    const l = await lead(w, { company: "Guardian Security Ltd", headcount: 80, segment: "SECURITY_FACILITIES", expectedMrr: 150000 });
    expect(l).toMatchObject({ number: "LD-00001", stage: "QUALIFIED", ownerUserId: w.bd.userId, ownerName: w.bd.name, headcount: 80, source: "OUTBOUND" });
    expect((await lead(w)).number).toBe("LD-00002");
    const h = await db.leadStageChange.findMany({ where: { leadId: l.id } });
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ fromStage: null, toStage: "QUALIFIED", byName: w.bd.name });
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "CRM_LEAD_CREATE", entityId: l.id } })).toBe(1);
  });

  it("refuses a company that is already in the pipeline, however it is spelt, and says if it was lost", async () => {
    const w = await world();
    const a = await lead(w, { company: "Acme Security Ltd." });
    await expect(lead(w, { company: "ACME  security ltd" })).rejects.toThrow(new RegExp(`already in the pipeline as ${a.number} \\(qualified\\)`));
    await moveLead(w.bd, a.id, { to: "LOST", lostReason: "Chose a competitor" });
    await expect(lead(w, { company: "acme security ltd" })).rejects.toThrow(/Reopen it instead/);
  });

  it("ties a referral to its partner, and refuses an inactive or unknown one", async () => {
    const w = await world();
    const p = await createPartner(w.bd, { name: "Ade & Co Accountants", kind: "ACCOUNTANT", commissionPct: 10, commissionMonths: 12 });
    const l = await lead(w, { partnerId: p.id });
    expect(l.source).toBe("REFERRAL");
    await expect(lead(w, { source: "REFERRAL" })).rejects.toThrow(/Choose the referral partner/);
    await expect(lead(w, { partnerId: "nope" })).rejects.toThrow(/not found/);
    await updatePartner(w.bd, p.id, { name: p.name, kind: "ACCOUNTANT", commissionPct: 10, commissionMonths: 12, active: false });
    await expect(lead(w, { partnerId: p.id })).rejects.toThrow(/no longer active/);
  });

  it("can be given to another person on the pipeline, and no one else", async () => {
    const w = await world();
    const l = await lead(w, { ownerUserId: w.bd2.userId });
    expect(l.ownerName).toBe(w.bd2.name);
    await expect(lead(w, { ownerUserId: w.officer.userId })).rejects.toThrow(/works on the pipeline/);
    expect((await pipelineOwners(w.bd)).map((o) => o.id).sort()).toEqual([w.founder.userId, w.bd.userId, w.bd2.userId].sort());
  });

  it("validates the details", async () => {
    const w = await world();
    await expect(createLead(w.bd, { company: "X", contactName: "Mr Okoro" } as never)).rejects.toThrow();
    await expect(lead(w, { contactEmail: "not-an-email" })).rejects.toThrow(/isn't valid/);
    await expect(lead(w, { headcount: 0 })).rejects.toThrow();
  });
});

describe("moving leads through the stages", () => {
  it("records every move with who and why, forward and back, and stamps won and lost", async () => {
    const w = await world();
    const l = await lead(w, { expectedMrr: 120000 });
    await moveLead(w.bd, l.id, { to: "DISCOVERY" });
    await moveLead(w.bd, l.id, { to: "PROPOSAL" });
    await expect(moveLead(w.bd, l.id, { to: "DISCOVERY" })).rejects.toThrow(/went back a stage/);
    await moveLead(w.bd, l.id, { to: "DISCOVERY", note: "They want another demo first" });
    await moveLead(w.bd, l.id, { to: "PILOT" });
    const won = await moveLead(w.bd, l.id, { to: "WON", note: "Signed" });
    expect(won.stage).toBe("WON");
    expect(won.wonAt).not.toBeNull();
    const h = await db.leadStageChange.findMany({ where: { leadId: l.id }, orderBy: { at: "asc" } });
    expect(h.map((x) => x.toStage)).toEqual(["QUALIFIED", "DISCOVERY", "PROPOSAL", "DISCOVERY", "PILOT", "WON"]);
    expect(h[3]).toMatchObject({ fromStage: "PROPOSAL", note: "They want another demo first" });
  });

  it("needs a reason to lose, and a lost lead can be reopened with a reason", async () => {
    const w = await world();
    const l = await lead(w);
    await expect(moveLead(w.bd, l.id, { to: "LOST" })).rejects.toThrow(/why it was lost/);
    const lost = await moveLead(w.bd, l.id, { to: "LOST", lostReason: "Already outsourced to a rival" });
    expect(lost).toMatchObject({ stage: "LOST", lostReason: "Already outsourced to a rival" });
    expect(lost.lostAt).not.toBeNull();
    await expect(moveLead(w.bd, l.id, { to: "QUALIFIED" })).rejects.toThrow(/reopening/);
    const back = await moveLead(w.bd, l.id, { to: "QUALIFIED", note: "Their contract ended early" });
    expect(back).toMatchObject({ stage: "QUALIFIED", lostReason: null, lostAt: null });
  });

  it("needs a monthly fee to win (given with the move or already on the lead), and a won lead is final", async () => {
    const w = await world();
    const l = await lead(w);
    await expect(moveLead(w.bd, l.id, { to: "WON" })).rejects.toThrow(/monthly fee/);
    const won = await moveLead(w.bd, l.id, { to: "WON", expectedMrr: 175000 });
    expect(Number(won.expectedMrr)).toBe(175000);
    await expect(moveLead(w.bd, l.id, { to: "LOST", lostReason: "Changed their mind later" })).rejects.toThrow(/final/);
    await expect(updateLead(w.bd, l.id, { company: won.company, contactName: "Mr Okoro", expectedMrr: 90000 } as never)).rejects.toThrow(/fee and referral partner can't change/);
    await updateLead(w.bd, l.id, { company: won.company, contactName: "Mrs Eze", expectedMrr: 175000, notes: "New contact after reshuffle" } as never);
    expect((await db.lead.findUniqueOrThrow({ where: { id: l.id } })).contactName).toBe("Mrs Eze");
  });

  it("links the client it became, only when won and only one of this bureau's own", async () => {
    const w = await world();
    const mine = (await onboardClient(w.founder, { name: `Client ${uid()}`, code: `K${uid()}${uid()}`, package: "PAYROLL_COMPLIANCE", startDate: "2026-11-01", termMonths: 12 } as never)).client;
    const other = await isolatedOrg();
    const l = await lead(w, { expectedMrr: 100000 });
    await expect(moveLead(w.bd, l.id, { to: "DISCOVERY", clientOrganizationId: mine.id })).rejects.toThrow(/only when the lead is won/);
    await expect(moveLead(w.bd, l.id, { to: "WON", clientOrganizationId: other.org.id })).rejects.toThrow(/not one of this bureau's/);
    expect((await moveLead(w.bd, l.id, { to: "WON", clientOrganizationId: mine.id })).clientOrganizationId).toBe(mine.id);
  });

  it("is held to its rules by the database too", async () => {
    const w = await world();
    const l = await lead(w, { expectedMrr: 100000 });
    const won = await moveLead(w.bd, l.id, { to: "WON" });
    await expect(db.lead.update({ where: { id: l.id }, data: { stage: "PILOT", wonAt: null } })).rejects.toThrow(/won lead is final/);
    await expect(db.lead.update({ where: { id: l.id }, data: { expectedMrr: 1 } })).rejects.toThrow(/won lead is final/);
    await expect(db.lead.delete({ where: { id: l.id } })).rejects.toThrow(/never deleted/);
    const open = await lead(w);
    await expect(db.lead.update({ where: { id: open.id }, data: { stage: "LOST", lostAt: new Date() } })).rejects.toThrow();
    await expect(db.lead.update({ where: { id: open.id }, data: { stage: "WON", wonAt: new Date() } })).rejects.toThrow();
    const h = await db.leadStageChange.findFirstOrThrow({ where: { leadId: won.id } });
    await expect(db.leadStageChange.update({ where: { id: h.id }, data: { note: "tidied" } })).rejects.toThrow(/cannot be changed or removed/);
    await expect(db.leadStageChange.delete({ where: { id: h.id } })).rejects.toThrow(/cannot be changed or removed/);
  });
});

describe("outreach", () => {
  it("logs an attempt against a lead or a company, and counts only real conversations towards the day's target", async () => {
    const w = await world();
    const l = await lead(w, { company: "Beta Facilities" });
    await logOutreach(w.bd, { leadId: l.id, channel: "CALL", outcome: "CONNECTED", note: "Asked for a proposal" });
    await logOutreach(w.bd, { company: "Gamma Ltd", channel: "EMAIL", outcome: "NO_ANSWER" });
    await logOutreach(w.bd, { company: "Delta Ltd", channel: "WHATSAPP", outcome: "MEETING_BOOKED" });
    await logOutreach(w.bd2, { company: "Epsilon Ltd", channel: "CALL", outcome: "NOT_INTERESTED" });
    const t = await outreachToday(w.bd);
    expect(t).toEqual({ target: 10, mine: 2, team: 2, attempts: 4 });
    expect((await outreachToday(w.bd2)).mine).toBe(0);
    const rows = await listOutreach(w.bd, { from: today, to: today });
    expect(rows.find((r) => r.leadId === l.id)).toMatchObject({ company: "Beta Facilities", byName: w.bd.name });
    expect((await listOutreach(w.bd, { from: today, to: today, userId: w.bd2.userId })).map((r) => r.company)).toEqual(["Epsilon Ltd"]);
  });

  it("puts a qualified first contact into the pipeline when asked, and only then", async () => {
    const w = await world();
    const r = await logOutreach(w.bd, { company: "Zeta Guards", contactName: "Mrs Bello", channel: "CALL", outcome: "QUALIFIED", addAsLead: true, headcount: 45 });
    expect(r.lead).toMatchObject({ company: "Zeta Guards", stage: "QUALIFIED", headcount: 45, contactName: "Mrs Bello", ownerUserId: w.bd.userId });
    expect(r.activity.leadId).toBe(r.lead!.id);
    await expect(logOutreach(w.bd, { company: "Eta Ltd", contactName: "X Y", channel: "CALL", outcome: "CONNECTED", addAsLead: true })).rejects.toThrow(/Only a qualified contact/);
    await expect(logOutreach(w.bd, { company: "Theta Ltd", channel: "CALL", outcome: "QUALIFIED", addAsLead: true })).rejects.toThrow(/decision-maker's name/);
    await expect(logOutreach(w.bd, { leadId: r.lead!.id, channel: "CALL", outcome: "QUALIFIED", addAsLead: true })).rejects.toThrow(/already a lead/);
  });

  it("can't be dated in the future or long ago, and can't be altered afterwards", async () => {
    const w = await world();
    const day = (offset: number) => iso(new Date(Date.now() + offset * 86_400_000));
    await expect(logOutreach(w.bd, { company: "Iota Ltd", channel: "CALL", outcome: "CONNECTED", date: day(1) })).rejects.toThrow(/future/);
    await expect(logOutreach(w.bd, { company: "Iota Ltd", channel: "CALL", outcome: "CONNECTED", date: day(-30) })).rejects.toThrow(/within 14 days/);
    await expect(logOutreach(w.bd, { channel: "CALL", outcome: "CONNECTED" })).rejects.toThrow(/which company/);
    const { activity } = await logOutreach(w.bd, { company: "Iota Ltd", channel: "CALL", outcome: "CONNECTED", date: day(-3) });
    await expect(db.outreachActivity.update({ where: { id: activity.id }, data: { outcome: "QUALIFIED" } })).rejects.toThrow(/cannot be changed or removed/);
    await expect(db.outreachActivity.delete({ where: { id: activity.id } })).rejects.toThrow(/cannot be changed or removed/);
  });
});

describe("referral commission", () => {
  async function wonViaPartner(w: W, mrr = 100000, partner?: { id: string }) {
    const p = partner ?? (await createPartner(w.bd, { name: `Partner ${uid()}${uid()}`, kind: "HR_CONSULTANT", commissionPct: 10, commissionMonths: 12 }));
    const l = await lead(w, { partnerId: p.id, expectedMrr: mrr });
    await moveLead(w.bd, l.id, { to: "WON" });
    return { p, l };
  }

  it("is earned on a won lead (10% of the monthly fee for 12 months), paid in parts, and shows what is still owed", async () => {
    const w = await world();
    const { p, l } = await wonViaPartner(w);
    const open = await lead(w, { partnerId: p.id, expectedMrr: 50000 }); // referred, not won: earns nothing yet
    let s = (await partnerSummary(w.bd)).find((x) => x.partner.id === p.id)!;
    expect(s).toMatchObject({ referred: 2, won: 1, earned: 120000, paid: 0, owed: 120000 });
    await recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: 50000, paidOn: today, reference: "Transfer 0042" });
    await recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: 20000, paidOn: today });
    s = (await partnerSummary(w.bd)).find((x) => x.partner.id === p.id)!;
    expect(s).toMatchObject({ earned: 120000, paid: 70000, owed: 50000 });
    expect(s.lines[0]).toMatchObject({ number: l.number, earned: 120000, paid: 70000, owed: 50000 });
    expect((await getLead(w.bd, l.id)).commission).toEqual({ earned: 120000, paid: 70000, owed: 50000 });
    expect((await getLead(w.bd, open.id)).commission.earned).toBe(0);
  });

  it("can't be paid on a lead that isn't won, to the wrong partner, or beyond what is owed", async () => {
    const w = await world();
    const { p, l } = await wonViaPartner(w);
    const other = await createPartner(w.bd, { name: `Other ${uid()}${uid()}`, kind: "ACCOUNTANT", commissionPct: 5, commissionMonths: 6 });
    const open = await lead(w, { partnerId: p.id });
    await expect(recordPayout(w.bd, { partnerId: p.id, leadId: open.id, amount: 1000, paidOn: today })).rejects.toThrow(/only on a lead that has been won/);
    await expect(recordPayout(w.bd, { partnerId: other.id, leadId: l.id, amount: 1000, paidOn: today })).rejects.toThrow(/did not refer/);
    await expect(recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: 120001, paidOn: today })).rejects.toThrow(/more than is owed/);
    await expect(recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: 1000, paidOn: iso(new Date(Date.now() + 86_400_000)) })).rejects.toThrow(/future/);
    await recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: 120000, paidOn: today });
    await expect(recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: 1, paidOn: today })).rejects.toThrow(/more than is owed/);
  });

  it("is corrected with a negative payout that says what it corrects, never more than was paid", async () => {
    const w = await world();
    const { p, l } = await wonViaPartner(w);
    await recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: 30000, paidOn: today });
    await expect(recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: -5000, paidOn: today })).rejects.toThrow(/needs a reference/);
    await expect(recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: -40000, paidOn: today, reference: "Paid twice by mistake" })).rejects.toThrow(/more than was paid/);
    await recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: -5000, paidOn: today, reference: "Overpaid on 20 Oct" });
    expect((await partnerSummary(w.bd)).find((x) => x.partner.id === p.id)!.paid).toBe(25000);
  });

  it("is held to its rules by the database, and the record can't be rewritten", async () => {
    const w = await world();
    const { p, l } = await wonViaPartner(w);
    const other = await createPartner(w.bd, { name: `Other ${uid()}${uid()}`, kind: "ACCOUNTANT", commissionPct: 5, commissionMonths: 6 });
    const base = { organizationId: w.t.org.id, leadId: l.id, amount: 10, paidOn: new Date(), byName: "x" };
    await expect(db.referralPayout.create({ data: { ...base, partnerId: other.id } })).rejects.toThrow(/partner who referred/);
    await expect(db.referralPayout.create({ data: { ...base, partnerId: p.id, amount: 0 } })).rejects.toThrow();
    const pay = await recordPayout(w.bd, { partnerId: p.id, leadId: l.id, amount: 1000, paidOn: today });
    await expect(db.referralPayout.update({ where: { id: pay.id }, data: { amount: 9999 } })).rejects.toThrow(/cannot be changed or removed/);
    await expect(db.referralPayout.delete({ where: { id: pay.id } })).rejects.toThrow(/cannot be changed or removed/);
  });

  it("has a unique name, and a rate between 0 and 100", async () => {
    const w = await world();
    await createPartner(w.bd, { name: "Dupe Partners", kind: "OTHER", commissionPct: 5, commissionMonths: 6 });
    await expect(createPartner(w.bd, { name: "dupe partners", kind: "OTHER", commissionPct: 5, commissionMonths: 6 })).rejects.toThrow(/already exists/);
    await expect(createPartner(w.bd, { name: "Too Generous", kind: "OTHER", commissionPct: 150, commissionMonths: 6 })).rejects.toThrow();
  });
});

describe("the dashboard", () => {
  it("adds up what happened in the range", async () => {
    const w = await world();
    const a = await lead(w, { expectedMrr: 200000 });
    const b = await lead(w, { expectedMrr: 60000 });
    const c = await lead(w);
    await moveLead(w.bd, a.id, { to: "DISCOVERY" });
    await moveLead(w.bd, a.id, { to: "PROPOSAL" });
    await moveLead(w.bd, a.id, { to: "WON" });
    await moveLead(w.bd, b.id, { to: "DISCOVERY" });
    await moveLead(w.bd, c.id, { to: "LOST", lostReason: "No budget this year" });
    await logOutreach(w.bd, { company: "One", channel: "CALL", outcome: "CONNECTED" });
    await logOutreach(w.bd2, { company: "Two", channel: "CALL", outcome: "QUALIFIED" });
    await logOutreach(w.bd2, { company: "Three", channel: "CALL", outcome: "NO_ANSWER" });
    const d = await salesDashboard(w.founder, { from: today, to: today });
    expect(d).toMatchObject({ attempts: 3, contacts: 2, newLeads: 3, discoveryMeetings: 2, proposals: 1, won: 1, lost: 1, conversion: 50, mrrWon: 200000, mrrTotal: 200000, pipelineMrr: 60000, target: 10 });
    expect(d.byStage.find((s) => s.stage === "DISCOVERY")).toEqual({ stage: "DISCOVERY", count: 1, mrr: 60000 });
    const person = (name: string) => d.byPerson.find((p) => p.name === name);
    expect(person(w.bd.name)).toEqual({ name: w.bd.name, attempts: 1, contacts: 1 });
    expect(person(w.bd2.name)).toEqual({ name: w.bd2.name, attempts: 2, contacts: 1 });
  });
});

describe("who can reach it", () => {
  it("is for the sales role and the founder, not for payroll staff", async () => {
    const w = await world();
    await expect(lead(w, {}, w.officer)).rejects.toThrow(/permission/);
    await expect(listLeads(w.officer)).rejects.toThrow(/permission/);
    await expect(salesDashboard(w.officer, { from: today, to: today })).rejects.toThrow(/permission/);
    await expect(lead(w, {}, w.founder)).resolves.toMatchObject({ ownerName: w.founder.name });
  });

  it("is the bureau's own business: not an ordinary company's, and not available while working inside a client", async () => {
    const w = await world();
    const plain = await isolatedOrg();
    const admin = await person(plain.org.id, "COMPANY_ADMIN", "plain");
    expect(await crmAvailable(admin)).toBe(false);
    await expect(createLead(admin, { company: "Nope Ltd", contactName: "Mr No" } as never)).rejects.toThrow(/payroll bureau/);
    const client = (await onboardClient(w.founder, { name: `Client ${uid()}`, code: `Q${uid()}${uid()}`, package: "PAYROLL_COMPLIANCE", startDate: "2026-11-01", termMonths: 12 } as never)).client;
    const inside = { ...w.founder, orgId: client.id, homeOrgId: w.t.org.id };
    expect(await crmAvailable(inside)).toBe(false);
    await expect(listLeads(inside)).rejects.toThrow(/own organization/);
    expect(await crmAvailable(w.bd)).toBe(true);
  });

  it("is kept apart between bureaus", async () => {
    const w = await world();
    const rival = await world();
    const mine = await lead(w, { company: "Shared Name Ltd" });
    expect(await listLeads(rival.bd)).toEqual([]);
    await expect(getLead(rival.bd, mine.id)).rejects.toThrow(/Lead not found/);
    await expect(moveLead(rival.bd, mine.id, { to: "DISCOVERY" })).rejects.toThrow(/Lead not found/);
    await expect(lead(rival, { company: "Shared Name Ltd" })).resolves.toBeTruthy(); // the same company can be in two bureaus' pipelines
  });

  it("can be given to a user only in a bureau", async () => {
    const w = await world();
    const plain = await isolatedOrg();
    const plainAdmin = await person(plain.org.id, "COMPANY_ADMIN", "plain");
    await expect(createUser(plainAdmin, { name: "Sales Person", email: `s.${uid()}@x.test`, role: "BUSINESS_DEV", password: "Password123!" })).rejects.toThrow(/payroll bureau's own sales people/);
    const u = await createUser(w.founder, { name: "Sales Person", email: `s.${uid()}@x.test`, role: "BUSINESS_DEV", password: "Password123!" });
    expect(u.role).toBe("BUSINESS_DEV");
  });

  it("filters the leads", async () => {
    const w = await world();
    const a = await lead(w, { company: "Alpha Guard" });
    const b = await lead(w, { company: "Beta Cleaners", ownerUserId: w.bd2.userId, source: "EVENT" });
    await moveLead(w.bd, a.id, { to: "DISCOVERY" });
    expect((await listLeads(w.bd, { stage: "DISCOVERY" })).map((l) => l.id)).toEqual([a.id]);
    expect((await listLeads(w.bd, { ownerUserId: w.bd2.userId })).map((l) => l.id)).toEqual([b.id]);
    expect((await listLeads(w.bd, { source: "EVENT" })).map((l) => l.id)).toEqual([b.id]);
    expect((await listLeads(w.bd, { q: "cleaners" })).map((l) => l.id)).toEqual([b.id]);
    expect((await listLeads(w.bd, { open: true })).length).toBe(2);
  });
});
