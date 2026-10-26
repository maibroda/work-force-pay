import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { iso } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";
import { enableBureau } from "@/server/services/bureau";
import { createLead, moveLead } from "@/server/services/crm";
import {
  approveBelowMargin,
  confirmRateCard,
  createProposal,
  decideProposal,
  getProposal,
  getRateCard,
  listProposals,
  proposalFile,
  reviseProposal,
  saveAddOn,
  savePackage,
  saveSetting,
  sendProposal,
  updateProposal,
  withdrawProposal,
} from "@/server/services/proposals";
import { addDays } from "@/lib/pricing";
import { isolatedOrg, uid } from "../helpers";

async function person(orgId: string, role: Ctx["role"], label: string): Promise<Ctx> {
  const u = await db.user.create({ data: { organizationId: orgId, email: `${label}.${uid()}${uid()}@prop.test`.toLowerCase(), name: `${label} ${role}`, role, passwordHash: "x" } });
  return { userId: u.id, orgId, role, name: u.name, email: u.email, employeeId: null };
}

async function world() {
  const t = await isolatedOrg();
  const founder = await person(t.org.id, "COMPANY_ADMIN", "founder");
  const bd = await person(t.org.id, "BUSINESS_DEV", "sales");
  const officer = await person(t.org.id, "PAYROLL_ADMIN", "officer");
  await enableBureau(founder);
  const lead = await createLead(bd, { company: `Guardian ${uid()}${uid()} Ltd`, contactName: "Col. Musa", contactRole: "MD", headcount: 100 } as never);
  return { t, founder, bd, officer, lead };
}
type W = Awaited<ReturnType<typeof world>>;
/** Enterprise at 100 staff: fee 450,000 against a cost of 236,400, so a 47.47% margin, above the 40% target. */
const GOOD = { packageKey: "ENTERPRISE", headcount: 100, termMonths: 12 } as const;
/** Payroll & Compliance at 50 staff: fee 125,000 against a cost of 105,000, so a 16% margin, below target. */
const THIN = { packageKey: "PAYROLL_COMPLIANCE", headcount: 50, termMonths: 12 } as const;
const confirm = (w: W) => confirmRateCard(w.founder, "Checked every price against our costs and the market");
const today = iso(new Date());

describe("the rate card", () => {
  it("starts from placeholder values, unconfirmed, created once", async () => {
    const w = await world();
    const c = await getRateCard(w.founder);
    expect(c.confirmed).toBeNull();
    expect(c.packages.map((p) => p.key)).toEqual(["PAYROLL_ESSENTIALS", "PAYROLL_COMPLIANCE", "MANAGED_PAYROLL_PLUS", "ENTERPRISE"]);
    expect(c.addOns).toHaveLength(4);
    await getRateCard(w.bd);
    expect(await db.pricingSetting.count({ where: { organizationId: w.t.org.id } })).toBe(1);
    expect(await db.pricingPackage.count({ where: { organizationId: w.t.org.id } })).toBe(4);
  });

  it("shows the sales role the prices and the margin target but not the bureau's costs", async () => {
    const w = await world();
    const sales = await getRateCard(w.bd);
    expect(sales.costs).toBe(false);
    expect(sales.setting).toEqual({ targetMarginPct: 40, vatRatePct: 7.5, validityDays: 30 });
    expect(sales.packages[0].hours).toBeNull();
    expect(sales.packages[0].perEmployeeRate).toBeGreaterThan(0);
    const owner = await getRateCard(w.founder);
    expect(owner.costs).toBe(true);
    expect(owner.setting).toMatchObject({ hourlyCost: 3000, softwareFixed: 20000, overheadPct: 20 });
    expect(owner.packages[0].hours).not.toBeNull();
  });

  it("is changed only by whoever owns pricing, and a change takes the confirmation back", async () => {
    const w = await world();
    const same = { hourlyCost: 3000, softwareFixed: 20000, softwarePerEmployee: 150, overheadPct: 20, targetMarginPct: 40, vatRatePct: 7.5, validityDays: 30 };
    await expect(saveSetting(w.bd, same)).rejects.toThrow(/permission/);
    await expect(confirmRateCard(w.bd, "Looks right to me, honestly")).rejects.toThrow(/permission/);
    await expect(confirmRateCard(w.founder, "ok")).rejects.toThrow(/at least 10/);
    await confirm(w);
    expect((await getRateCard(w.founder)).confirmed?.by).toBe(w.founder.name);
    await saveSetting(w.founder, { ...same, hourlyCost: 3500 });
    expect((await getRateCard(w.founder)).confirmed).toBeNull();
    expect((await getRateCard(w.founder)).setting.hourlyCost).toBe(3500);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "PRICING_SETTING_SAVE" } })).toBe(1);
    await expect(saveSetting(w.founder, { ...same, targetMarginPct: 100 })).rejects.toThrow();
    await expect(saveSetting(w.founder, { ...same, overheadPct: -1 })).rejects.toThrow();
  });

  it("refuses wording that promises a result, in a package or an add-on", async () => {
    const w = await world();
    const body = { perEmployeeRate: 3000, monthlyMinimum: 90000, onboardingFee: 100000, baseHours: 10, minutesPerEmployee: 10, responsibilities: "Send inputs on time and approve each payroll.", active: true };
    await expect(savePackage(w.founder, "PAYROLL_COMPLIANCE", { ...body, scope: "Monthly payroll with a guarantee of zero errors" })).rejects.toThrow(/promise.*guarantee, zero errors/);
    await expect(savePackage(w.founder, "PAYROLL_COMPLIANCE", { ...body, scope: "Monthly payroll, reviewed by a second person", responsibilities: "We are fully compliant so you need do nothing." })).rejects.toThrow(/fully compliant/);
    await expect(saveAddOn(w.founder, { code: "SAFE", name: "Risk-free reporting", monthlyFee: 1000 } as never)).rejects.toThrow(/risk-free/);
    await confirm(w);
    await savePackage(w.founder, "PAYROLL_COMPLIANCE", { ...body, scope: "Monthly payroll, reviewed by a second person before it comes to you." });
    expect((await getRateCard(w.founder)).confirmed).toBeNull();
    expect((await getRateCard(w.founder)).packages.find((p) => p.key === "PAYROLL_COMPLIANCE")?.perEmployeeRate).toBe(3000);
    await expect(savePackage(w.founder, "HEALTH_CHECK", { ...body, scope: "Anything at all here" })).rejects.toThrow(/can't be quoted/);
    await expect(savePackage(w.bd, "ENTERPRISE", { ...body, scope: "Monthly payroll, reviewed by a second person." })).rejects.toThrow(/permission/);
  });

  it("can add and switch off add-ons", async () => {
    const w = await world();
    await saveAddOn(w.founder, { code: "extra_site", name: "Additional site set-up", description: "Set-up of one more site and pay group.", monthlyFee: 12000, perEmployeeFee: 0, onboardingFee: 30000, hours: 1, minutesPerEmployee: 0 } as never);
    const a = (await getRateCard(w.founder)).addOns.find((x) => x.code === "EXTRA_SITE")!;
    expect(a).toMatchObject({ monthlyFee: 12000, onboardingFee: 30000, active: true });
    await saveAddOn(w.founder, { code: "EXTRA_SITE", name: a.name, monthlyFee: 12000, active: false } as never);
    await expect(createProposal(w.bd, w.lead.id, { ...GOOD, addOnCodes: ["EXTRA_SITE"] })).rejects.toThrow(/not on offer: EXTRA_SITE/);
  });
});

describe("making a proposal", () => {
  it("prices it from the rate card, numbers it, and shows cost, margin and the floor", async () => {
    const w = await world();
    const p = await createProposal(w.bd, w.lead.id, GOOD);
    expect(p).toMatchObject({ number: "PR-00001", status: "DRAFT", belowTarget: false, headcount: 100, termMonths: 12 });
    expect(Number(p.monthlyFee)).toBe(450000);
    expect(Number(p.onboardingFee)).toBe(300000);
    expect(Number(p.marginPct)).toBe(47.47);
    const full = await getProposal(w.bd, p.id);
    expect(full.q.cost).toMatchObject({ hours: 54, labour: 162000, software: 35000, overhead: 39400, total: 236400 });
    expect(full.q.floorMonthly).toBe(394000);
    expect((await createProposal(w.bd, w.lead.id, GOOD)).number).toBe("PR-00002");
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "PROPOSAL_CREATE" } })).toBe(2);
  });

  it("flags a price below the target margin, and a discount that pushes it there", async () => {
    const w = await world();
    const thin = await createProposal(w.bd, w.lead.id, THIN);
    expect(thin).toMatchObject({ belowTarget: true });
    expect(Number(thin.marginPct)).toBe(16);
    const pushed = await createProposal(w.bd, w.lead.id, { ...GOOD, discountPct: 20, discountReason: "Pilot customer, launch offer" });
    expect(Number(pushed.monthlyFee)).toBe(360000);
    expect(pushed.belowTarget).toBe(true); // (360,000 − 236,400) / 360,000 = 34.3%
  });

  it("adds add-ons and extra hours to the price and the cost", async () => {
    const w = await world();
    const p = await getProposal(w.bd, (await createProposal(w.bd, w.lead.id, { ...GOOD, addOnCodes: ["REPORTS"], extraHours: 10 })).id);
    expect(p.q.addOns.map((a) => a.code)).toEqual(["REPORTS"]);
    expect(p.q.listMonthly).toBe(475000);
    expect(p.q.cost.hours).toBe(66); // 54 + 2 (add-on) + 10 (extra)
  });

  it("needs a reason for a discount, a package on offer, and a lead that is still live", async () => {
    const w = await world();
    await expect(createProposal(w.bd, w.lead.id, { ...GOOD, discountPct: 10 })).rejects.toThrow(/why there is a discount/);
    await expect(createProposal(w.bd, w.lead.id, { ...GOOD, termMonths: 9 })).rejects.toThrow(/6 or 12 months/);
    await expect(createProposal(w.bd, w.lead.id, { ...GOOD, headcount: 0 })).rejects.toThrow();
    const lead2 = await createLead(w.bd, { company: `Beta ${uid()}${uid()} Ltd`, contactName: "Mr B" } as never);
    await getRateCard(w.founder);
    await db.pricingPackage.update({ where: { organizationId_key: { organizationId: w.t.org.id, key: "ENTERPRISE" } }, data: { active: false } });
    await expect(createProposal(w.bd, lead2.id, GOOD)).rejects.toThrow(/isn't on offer/);
    await moveLead(w.bd, lead2.id, { to: "LOST", lostReason: "No budget this year" });
    await expect(createProposal(w.bd, lead2.id, THIN)).rejects.toThrow(/was lost/);
    await moveLead(w.bd, w.lead.id, { to: "WON", expectedMrr: 100000 });
    await expect(createProposal(w.bd, w.lead.id, THIN)).rejects.toThrow(/already won/);
  });

  it("is for the sales role and the founder only, and stays inside its own bureau", async () => {
    const w = await world();
    await expect(createProposal(w.officer, w.lead.id, GOOD)).rejects.toThrow(/permission/);
    const rival = await world();
    await expect(createProposal(rival.bd, w.lead.id, GOOD)).rejects.toThrow(/Lead not found/);
    const p = await createProposal(w.bd, w.lead.id, GOOD);
    await expect(getProposal(rival.bd, p.id)).rejects.toThrow(/Proposal not found/);
    expect(await listProposals(rival.bd)).toEqual([]);
  });

  it("is repriced when edited, and an earlier approval goes with the old price", async () => {
    const w = await world();
    await confirm(w);
    const p = await createProposal(w.bd, w.lead.id, THIN);
    await approveBelowMargin(w.founder, p.id, "Strategic client, we will review the price at renewal");
    expect((await db.proposal.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("APPROVED");
    const u = await updateProposal(w.bd, p.id, { ...THIN, headcount: 60 });
    expect(u).toMatchObject({ status: "DRAFT", approvedAt: null, approvalNote: null, headcount: 60 });
    expect(Number(u.monthlyFee)).toBe(150000);
  });

  it("keeps the extra delivery hours when the sales role edits a proposal without that field", async () => {
    const w = await world();
    const p = await createProposal(w.founder, w.lead.id, { ...GOOD, extraHours: 12 });
    await updateProposal(w.bd, p.id, { packageKey: "ENTERPRISE", headcount: 90, termMonths: 12 });
    const u = await db.proposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(Number(u.extraHours)).toBe(12);
    expect((u.quote as { cost: { extraHours: number } }).cost.extraHours).toBe(12);
  });
});

describe("sending", () => {
  it("is refused while the rate card is unconfirmed", async () => {
    const w = await world();
    const p = await createProposal(w.bd, w.lead.id, GOOD);
    await expect(sendProposal(w.bd, p.id)).rejects.toThrow(/hasn't been confirmed/);
    await confirm(w);
    await sendProposal(w.bd, p.id);
  });

  it("dates it, stamps who sent it, moves the lead to the proposal stage and fills in its expected fee", async () => {
    const w = await world();
    await confirm(w);
    const p = await createProposal(w.bd, w.lead.id, GOOD);
    await sendProposal(w.bd, p.id);
    const sent = await db.proposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(sent).toMatchObject({ status: "SENT", sentBy: w.bd.name });
    expect(iso(sent.validUntil!)).toBe(addDays(today, 30));
    const lead = await db.lead.findUniqueOrThrow({ where: { id: w.lead.id } });
    expect(lead.stage).toBe("PROPOSAL");
    expect(Number(lead.expectedMrr)).toBe(450000);
    const move = await db.leadStageChange.findFirstOrThrow({ where: { leadId: w.lead.id, toStage: "PROPOSAL" } });
    expect(move.note).toBe("Proposal PR-00001 sent");
    await expect(sendProposal(w.bd, p.id)).rejects.toThrow(/already been sent/);
  });

  it("can't go out below the target margin without the pricing owner's reasoned approval", async () => {
    const w = await world();
    await confirm(w);
    const p = await createProposal(w.bd, w.lead.id, THIN);
    await expect(sendProposal(w.bd, p.id)).rejects.toThrow(/needs the pricing owner's approval/);
    await expect(approveBelowMargin(w.bd, p.id, "I think it is fine really")).rejects.toThrow(/permission/);
    await expect(approveBelowMargin(w.founder, p.id, "ok")).rejects.toThrow(/at least 10/);
    const fine = await createProposal(w.bd, w.lead.id, GOOD);
    await expect(approveBelowMargin(w.founder, fine.id, "Not needed but trying anyway")).rejects.toThrow(/meets the target margin/);
    await approveBelowMargin(w.founder, p.id, "Strategic client; margin recovers once headcount grows");
    await expect(approveBelowMargin(w.founder, p.id, "Second approval attempt here")).rejects.toThrow(/already approved/);
    await sendProposal(w.bd, p.id);
    const sent = await db.proposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(sent).toMatchObject({ status: "SENT", approvedBy: w.founder.name });
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "PROPOSAL_APPROVE_BELOW_MARGIN" } })).toBe(1);
  });

  it("is refused if the rate card has changed since it was priced", async () => {
    const w = await world();
    await confirm(w);
    const p = await createProposal(w.bd, w.lead.id, GOOD);
    // the cost of an officer's hour goes up, but the card stays confirmed (as if confirmed again afterwards)
    await db.pricingSetting.update({ where: { organizationId: w.t.org.id }, data: { hourlyCost: 9000 } });
    await expect(sendProposal(w.bd, p.id)).rejects.toThrow(/rate card has changed since this was priced/);
    await updateProposal(w.bd, p.id, GOOD);
    await expect(sendProposal(w.bd, p.id)).rejects.toThrow(/needs the pricing owner's approval/); // repriced, now below target
  });

  it("is held to its rules by the database: no sending below target unapproved, and a sent proposal is frozen", async () => {
    const w = await world();
    await confirm(w);
    const thin = await createProposal(w.bd, w.lead.id, THIN);
    await expect(db.proposal.update({ where: { id: thin.id }, data: { status: "SENT", sentAt: new Date(), validUntil: new Date() } })).rejects.toThrow();
    const good = await createProposal(w.bd, w.lead.id, GOOD);
    await sendProposal(w.bd, good.id);
    await expect(db.proposal.update({ where: { id: good.id }, data: { monthlyFee: 1 } })).rejects.toThrow(/cannot change; make a new proposal/);
    await expect(db.proposal.update({ where: { id: good.id }, data: { quote: { cooked: true } } })).rejects.toThrow(/cannot change/);
    await expect(db.proposal.update({ where: { id: good.id }, data: { status: "DRAFT" } })).rejects.toThrow(/only be accepted, declined or superseded/);
    await expect(db.proposal.delete({ where: { id: good.id } })).rejects.toThrow(/never deleted/);
    await expect(updateProposal(w.bd, good.id, GOOD)).rejects.toThrow(/can't be changed/);
  });
});

describe("what happens to a sent proposal", () => {
  async function sent(w: W, over: Record<string, unknown> = {}) {
    await confirm(w);
    const p = await createProposal(w.bd, w.lead.id, { ...GOOD, ...over } as never);
    await sendProposal(w.bd, p.id);
    return p;
  }

  it("when accepted, the lead's expected fee and headcount become the proposal's", async () => {
    const w = await world();
    const p = await sent(w, { headcount: 80 });
    await decideProposal(w.bd, p.id, "ACCEPTED", "Signed by their MD on Monday");
    expect(await db.proposal.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "ACCEPTED", decisionNote: "Signed by their MD on Monday" });
    const lead = await db.lead.findUniqueOrThrow({ where: { id: w.lead.id } });
    expect(Number(lead.expectedMrr)).toBe(360000);
    expect(lead.headcount).toBe(80);
    expect(lead.stage).toBe("PROPOSAL"); // winning is a separate, deliberate step
    await expect(decideProposal(w.bd, p.id, "DECLINED", "Changed our mind later")).rejects.toThrow(/already accepted/);
  });

  it("when declined, says why", async () => {
    const w = await world();
    const p = await sent(w);
    await expect(decideProposal(w.bd, p.id, "DECLINED")).rejects.toThrow(/Say why/);
    await decideProposal(w.bd, p.id, "DECLINED", "Went with an in-house payroll clerk");
    expect((await getProposal(w.bd, p.id)).status).toBe("DECLINED");
  });

  it("can't be accepted after it has expired, but shows as expired", async () => {
    const w = await world();
    await confirm(w);
    const past = new Date(`${addDays(today, -3)}T00:00:00Z`);
    const q = (await getProposal(w.bd, (await createProposal(w.bd, w.lead.id, GOOD)).id)).quote;
    const old = await db.proposal.create({ data: { organizationId: w.t.org.id, leadId: w.lead.id, number: "PR-OLD", packageKey: "ENTERPRISE", headcount: 100, termMonths: 12, quote: q as never, monthlyFee: 450000, onboardingFee: 300000, marginPct: 47.47, status: "SENT", sentAt: new Date(), validUntil: past, createdBy: "x", createdByUserId: "x" } });
    expect((await getProposal(w.bd, old.id)).state).toBe("EXPIRED");
    expect((await listProposals(w.bd, { status: "EXPIRED" })).map((x) => x.number)).toEqual(["PR-OLD"]);
    await expect(decideProposal(w.bd, old.id, "ACCEPTED")).rejects.toThrow(/expired on/);
  });

  it("is revised into a new draft that supersedes it", async () => {
    const w = await world();
    const p = await sent(w);
    const fresh = await reviseProposal(w.bd, p.id);
    expect(fresh).toMatchObject({ status: "DRAFT", number: "PR-00002", headcount: 100 });
    expect(await db.proposal.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "SUPERSEDED", decisionNote: "Replaced by PR-00002" });
    await expect(reviseProposal(w.bd, fresh.id)).rejects.toThrow(/Only a sent proposal/);
  });

  it("can be withdrawn while unsent, with a reason, but not once sent", async () => {
    const w = await world();
    const d = await createProposal(w.bd, w.lead.id, GOOD);
    await expect(withdrawProposal(w.bd, d.id, "no")).rejects.toThrow(/at least 5/);
    await withdrawProposal(w.bd, d.id, "Client changed the scope");
    expect((await getProposal(w.bd, d.id)).status).toBe("WITHDRAWN");
    const p = await sent(w);
    await expect(withdrawProposal(w.bd, p.id, "Trying to take it back")).rejects.toThrow(/Only an unsent proposal/);
  });
});

describe("the document", () => {
  it("is a PDF, stamped as a draft until it is sent, and every download is recorded", async () => {
    const w = await world();
    await confirm(w);
    const p = await createProposal(w.bd, w.lead.id, { ...GOOD, addOnCodes: ["REPORTS"] });
    const draft = await proposalFile(w.bd, p.id);
    expect(Buffer.from(draft.bytes.subarray(0, 4)).toString()).toBe("%PDF");
    expect(draft.fileName).toMatch(/^PR-00001-Guardian-.*\.pdf$/);
    await sendProposal(w.bd, p.id);
    const final = await proposalFile(w.founder, p.id);
    expect(final.bytes.length).toBeGreaterThan(1500);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: "PROPOSAL_PDF_DOWNLOAD", entityId: p.id } })).toBe(2);
    await expect(proposalFile(w.officer, p.id)).rejects.toThrow(/permission/);
  });
});
