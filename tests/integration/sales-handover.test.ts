import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { acceptHandover, createHandoverForQuote, designateAcceptor, getHandover, getHandoverForDeal, listAcceptors, listHandovers, removeAcceptor, returnHandover, saveHandover, submitHandover } from "@/server/services/sales/handover";
import { createOpportunity } from "@/server/services/sales/pipelines";
import { createQuote, decideQuote, reviseQuote, sendQuote, setMinimumMargin } from "@/server/services/sales/quotes";
import { createAccount } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

/** An organization with the sales module on, a guard structure, the payroll rules, two employee categories, a sales rep, and two Operations people. */
async function world(opts: { noRules?: boolean } = {}) {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  const ops1 = t.ctx("OPERATIONS", null, 1);
  const ops2 = t.ctx("OPERATIONS", null, 2);
  for (const c of [admin, repA, repB, ops1, ops2]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  await setMinimumMargin(admin, 0);
  const structure = await db.salaryStructure.create({
    data: {
      organizationId: t.org.id, code: "STD", name: "Standard guard", status: "ACTIVE", effectiveFrom: d("2020-01-01"), isDefault: true,
      components: { create: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: c.percentage, taxable: c.taxable, pensionable: c.pensionable, sortOrder: i })) },
    },
  });
  if (!opts.noRules) {
    await db.pensionRule.create({ data: { organizationId: t.org.id, version: "P1", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC", "HOUSING", "TRANSPORT"], effectiveFrom: d("2020-01-01") } });
    await db.employerCostRule.create({ data: { organizationId: t.org.id, version: "E1", effectiveFrom: d("2020-01-01") } });
  }
  const guard = await db.employeeCategory.create({ data: { organizationId: t.org.id, code: "GRD", name: "Guard" } });
  const sup = await db.employeeCategory.create({ data: { organizationId: t.org.id, code: "SUP", name: "Supervisor" } });
  const account = await createAccount(repA, { name: "Lekki Gardens Estate" });
  const deal = await createOpportunity(repA, { accountId: account.id, name: "24/7 guarding, 2 sites" });
  return { t, admin, repA, repB, ops1, ops2, structure, guard, sup, account, deal };
}
type W = Awaited<ReturnType<typeof world>>;

const quoteLines = (w: W) => [
  { siteName: "Lekki Gardens Phase 1", siteAddress: "1 Admiralty Way", postLabel: "Main gate", shiftPattern: "24/7", salaryStructureId: w.structure.id, headcount: 12, requiredPersonnel: 14, billRatePerHead: "120000.00" },
  { siteName: "Lekki Gardens Phase 2", postLabel: "Supervisor", shiftPattern: "Day 12h", salaryStructureId: w.structure.id, headcount: 2, billRatePerHead: "150000.00", operativeSharePct: 60 },
];

/** A quote sent and accepted by the client, which starts the handover. */
async function acceptedQuote(w: W) {
  const q = await createQuote(w.repA, { opportunityId: w.deal.id, validUntil: "2026-12-31", lines: quoteLines(w) });
  await sendQuote(w.repA, q.id);
  await decideQuote(w.repA, q.id, "ACCEPTED");
  const h = await getHandoverForDeal(w.repA, w.deal.id);
  if (!h) throw new Error("no handover");
  return { q, h };
}

/** Everything the handover needs, entered by the salesperson. */
async function fill(w: W, id: string, over: Record<string, unknown> = {}) {
  const h = await getHandover(w.repA, id);
  return saveHandover(w.repA, id, {
    scope: "24/7 manned guarding of two estate phases",
    clientRequirements: "Uniformed, licensed guards; daily written report",
    startDate: "2027-01-01",
    termMonths: 12,
    serviceLevels: [{ obligation: "Replace an absent guard", measure: "within 2 hours", consequence: "5% credit on the month's fee" }],
    sites: h.sites.map((s) => ({ id: s.id, address: s.address ?? "2 Admiralty Way", state: "Lagos", lga: "Eti-Osa", contactName: "Mrs Bello", contactRole: "Estate manager", contactPhone: "0803 123 4567", contactEmail: "bello@lekki.test", equipment: [{ item: "Two-way radio", quantity: 4 }, { item: "Torch", quantity: 6 }] })),
    posts: h.sites.flatMap((s) => s.posts).map((p) => ({ id: p.id, categoryId: p.postLabel === "Supervisor" ? w.sup.id : w.guard.id })),
    ...over,
  });
}

/** The handover, complete, submitted, with the Operations manager designated. */
async function submitted(w: W) {
  const { q, h } = await acceptedQuote(w);
  await fill(w, h.id);
  await designateAcceptor(w.admin, w.ops1.userId);
  await submitHandover(w.repA, h.id);
  return { q, h };
}

const keysOf = (x: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(x)) x.forEach((i) => keysOf(i, out));
  else if (x && typeof x === "object" && !(x instanceof Date) && !("toFixed" in (x as object))) for (const [k, v] of Object.entries(x)) {
      out.add(k);
      keysOf(v, out);
    }
  return out;
};

describe("starting a handover", () => {
  it("is started by the client's acceptance of the quote: one draft, with the sites and posts copied from the quote, and nothing made in Operations", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, validUntil: "2026-12-31", lines: quoteLines(w) });
    await sendQuote(w.repA, q.id);
    expect(await getHandoverForDeal(w.repA, w.deal.id)).toBeNull(); // sending is not accepting
    await decideQuote(w.repA, q.id, "ACCEPTED");
    const h = (await getHandoverForDeal(w.repA, w.deal.id))!;
    expect(h).toMatchObject({ status: "DRAFT", revisionNo: 1, quoteNumber: q.number, quoteVersion: 1, preparedByUserId: w.repA.userId });
    expect(h.number).toMatch(/^HO-?\d{5}$/);
    expect(Number(h.monthlyBill)).toBe(1740000);
    expect(h.sites.map((s) => s.name)).toEqual(["Lekki Gardens Phase 1", "Lekki Gardens Phase 2"]);
    expect(h.sites[0].address).toBe("1 Admiralty Way");
    const gate = h.sites[0].posts[0];
    expect(gate).toMatchObject({ postLabel: "Main gate", shiftPattern: "24/7", headcount: 12, requiredPersonnel: 14, categoryId: null });
    expect(Number(gate.billPerHead)).toBe(120000);
    expect(h.events.map((e) => e.kind)).toEqual(["CREATED"]);
    expect(h.missing.length).toBeGreaterThan(5); // it says what is still needed
    for (const m of [db.client, db.contract, db.contractRate, db.beat]) expect(await (m as unknown as { count: (a: object) => Promise<number> }).count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });

  it("is not started by a rejected quote, and a quote that is not accepted cannot start one", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: quoteLines(w) });
    await expect(createHandoverForQuote(w.repA, q.id)).rejects.toThrow(/accepted/i); // still a draft
    await sendQuote(w.repA, q.id);
    await expect(createHandoverForQuote(w.repA, q.id)).rejects.toThrow(/accepted/i);
    await decideQuote(w.repA, q.id, "REJECTED", "Too dear");
    expect(await getHandoverForDeal(w.repA, w.deal.id)).toBeNull();
    expect(await db.crmHandover.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });

  it("is refused for an accepted quote that was below the minimum margin and never given the approval it needed", async () => {
    const w = await world();
    const q = await createQuote(w.repA, { opportunityId: w.deal.id, lines: quoteLines(w) });
    await sendQuote(w.repA, q.id);
    // forced into a state the app cannot reach: accepted, below the minimum, with no approval
    await db.crmQuote.update({ where: { id: q.id }, data: { status: "ACCEPTED", belowMinimum: true, belowMarginApproved: false } });
    await expect(createHandoverForQuote(w.repA, q.id)).rejects.toThrow(/approval/i);
    expect(await db.crmHandover.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });

  it("is made once per deal: asking again returns the same handover, and a quote with a handover cannot be revised", async () => {
    const w = await world();
    const { q, h } = await acceptedQuote(w);
    expect((await createHandoverForQuote(w.repA, q.id)).id).toBe(h.id);
    expect(await db.crmHandover.count({ where: { organizationId: w.t.org.id } })).toBe(1);
    await expect(reviseQuote(w.repA, q.id)).rejects.toThrow(/handover/i);
  });
});

describe("preparing and sending the handover", () => {
  it("saves what Sales enters (phone to E.164), and says what is still missing until it is complete", async () => {
    const w = await world();
    const { h } = await acceptedQuote(w);
    await expect(submitHandover(w.repA, h.id)).rejects.toThrow(/Scope of service/);
    const s = await fill(w, h.id);
    expect(s.missing).toEqual([]);
    const full = await getHandover(w.repA, h.id);
    expect(full).toMatchObject({ scope: "24/7 manned guarding of two estate phases", termMonths: 12, revisionNo: 2 });
    expect(full.sites[0]).toMatchObject({ contactName: "Mrs Bello", contactPhoneE164: "+2348031234567", state: "Lagos", lga: "Eti-Osa" });
    expect(full.sites[0].equipment).toEqual([{ item: "Two-way radio", quantity: 4 }, { item: "Torch", quantity: 6 }]);
    expect(full.sites[1].posts[0].categoryId).toBe(w.sup.id);
  });

  it("refuses a bad phone, an equipment quantity of nothing, a category from another organization, and a site or post that is not this handover's", async () => {
    const w = await world();
    const other = await world();
    const { h } = await acceptedQuote(w);
    const full = await getHandover(w.repA, h.id);
    await expect(saveHandover(w.repA, h.id, { sites: [{ id: full.sites[0].id, contactPhone: "12345" }] })).rejects.toThrow(/phone/i);
    await expect(saveHandover(w.repA, h.id, { sites: [{ id: full.sites[0].id, equipment: [{ item: "Radio", quantity: 0 }] }] })).rejects.toThrow(/at least 1/);
    await expect(saveHandover(w.repA, h.id, { posts: [{ id: full.sites[0].posts[0].id, categoryId: other.guard.id }] })).rejects.toThrow(/category/i);
    const o = await acceptedQuote(other);
    const theirs = await getHandover(other.repA, o.h.id);
    await expect(saveHandover(w.repA, h.id, { sites: [{ id: theirs.sites[0].id, address: "x" }] })).rejects.toThrow(/site/i);
  });

  it("lets an Operations question come back and be answered: sent, returned with the question, changed, sent again; each step is on record", async () => {
    const w = await world();
    const { h } = await submitted(w);
    expect((await getHandover(w.repA, h.id)).status).toBe("SUBMITTED");
    await expect(saveHandover(w.repA, h.id, { scope: "changed after sending" })).rejects.toThrow(/sent|returned/i);
    await expect(returnHandover(w.ops1, h.id, "")).rejects.toThrow(/question|reason|note/i);
    await returnHandover(w.ops1, h.id, "Which gate is the 24/7 post?");
    const back = await getHandover(w.repA, h.id);
    expect(back).toMatchObject({ status: "RETURNED", returnNote: "Which gate is the 24/7 post?" });
    await expect(acceptHandover(w.ops1, h.id, {})).rejects.toThrow(/sent|submitted/i); // a returned handover cannot be accepted
    await saveHandover(w.repA, h.id, { clientRequirements: "Uniformed, licensed guards; the main gate is the 24/7 post" });
    await submitHandover(w.repA, h.id);
    const again = await getHandover(w.repA, h.id);
    expect(again.status).toBe("SUBMITTED");
    expect(again.submittedRevision).toBe(again.revisionNo);
    expect(again.events.map((e) => e.kind)).toEqual(["CREATED", "SUBMITTED", "RETURNED", "SUBMITTED"]);
  });
});

describe("the handshake: only a designated person in Operations, who did not prepare it, can accept", () => {
  it("says so when nobody has been designated, and refuses someone who has not been designated, however senior", async () => {
    const w = await world();
    const { h } = await acceptedQuote(w);
    await fill(w, h.id);
    await submitHandover(w.repA, h.id);
    await expect(acceptHandover(w.ops1, h.id, {})).rejects.toThrow(/No one has been designated/i);
    await designateAcceptor(w.admin, w.ops2.userId);
    await expect(acceptHandover(w.ops1, h.id, {})).rejects.toThrow(/designated/i); // ops1 is Operations but not designated
    await expect(acceptHandover(w.repA, h.id, {})).rejects.toThrow(/permission/i); // a salesperson has no such permission at all
    expect((await getHandover(w.repA, h.id)).status).toBe("SUBMITTED");
  });

  it("never lets the person who prepared or sent it accept it, even when designated", async () => {
    const w = await world();
    // the company administrator runs this deal themselves, and is also a designated acceptor
    const account = await createAccount(w.admin, { name: "Ikoyi Towers Ltd" });
    const deal = await createOpportunity(w.admin, { accountId: account.id, name: "Ikoyi guarding" });
    const q = await createQuote(w.admin, { opportunityId: deal.id, lines: quoteLines(w) });
    await sendQuote(w.admin, q.id);
    await decideQuote(w.admin, q.id, "ACCEPTED");
    const h = (await getHandoverForDeal(w.admin, deal.id))!;
    expect(h.preparedByUserId).toBe(w.admin.userId);
    const full = await getHandover(w.admin, h.id);
    await saveHandover(w.admin, h.id, { scope: "Scope", clientRequirements: "Req", startDate: "2027-01-01", termMonths: 12, noSpecialSla: true, sites: full.sites.map((s) => ({ id: s.id, address: "A", state: "Lagos", lga: "Eti-Osa", contactName: "N", contactPhone: "08031234567", noEquipment: true })), posts: full.sites.flatMap((s) => s.posts).map((p) => ({ id: p.id, categoryId: p.postLabel === "Supervisor" ? w.sup.id : w.guard.id })) });
    await designateAcceptor(w.admin, w.admin.userId);
    await submitHandover(w.admin, h.id);
    await expect(acceptHandover(w.admin, h.id, {})).rejects.toThrow(/prepared or sent/i);
    await expect(returnHandover(w.admin, h.id, "A question")).rejects.toThrow(/prepared or sent/i);
    expect(await db.client.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });

  it("accepts only the revision that was sent: a change made after sending voids the acceptance", async () => {
    const w = await world();
    const { h } = await submitted(w);
    await db.crmHandover.update({ where: { id: h.id }, data: { revisionNo: { increment: 1 } } }); // a change slipped in after sending (the app cannot do this)
    await expect(acceptHandover(w.ops1, h.id, {})).rejects.toThrow(/changed since/i);
  });

  it("designates only people who may accept, only by the company administrator, and a removed person can no longer accept", async () => {
    const w = await world();
    await expect(designateAcceptor(w.repA, w.ops1.userId)).rejects.toThrow(/permission/i);
    await expect(designateAcceptor(w.admin, w.repB.userId)).rejects.toThrow(/cannot accept|not allowed|may not/i);
    const other = await world();
    await expect(designateAcceptor(w.admin, other.ops1.userId)).rejects.toThrow(/not an active user/i);
    const a = await designateAcceptor(w.admin, w.ops1.userId);
    expect((await listAcceptors(w.repA)).map((x) => x.userId)).toEqual([w.ops1.userId]);
    expect((await listAcceptors(other.repA))).toEqual([]);
    const { h } = await acceptedQuote(w);
    await fill(w, h.id);
    await submitHandover(w.repA, h.id);
    await removeAcceptor(w.admin, a.id);
    await expect(acceptHandover(w.ops1, h.id, {})).rejects.toThrow(/No one has been designated/i);
    expect(await db.auditLog.count({ where: { organizationId: w.t.org.id, action: { startsWith: "SALES_HANDOVER_ACCEPTOR" } } })).toBe(2);
  });
});

describe("what acceptance makes", () => {
  it("makes the client, a DRAFT contract, one rate for each category and one site for each quote site, and changes nothing in payroll", async () => {
    const w = await world();
    const { h } = await submitted(w);
    expect(await db.client.count({ where: { organizationId: w.t.org.id } })).toBe(0); // nothing exists before acceptance
    const acc = await acceptHandover(w.ops1, h.id, { note: "Capacity confirmed" });
    expect(acc).toMatchObject({ status: "ACCEPTED", acceptedByUserId: w.ops1.userId, acceptedRevision: acc.submittedRevision });
    const client = await db.client.findFirstOrThrow({ where: { organizationId: w.t.org.id } });
    expect(client).toMatchObject({ name: "Lekki Gardens Estate", status: "ACTIVE" });
    const contract = await db.contract.findFirstOrThrow({ where: { organizationId: w.t.org.id }, include: { rates: true } });
    expect(contract).toMatchObject({ clientId: client.id, status: "DRAFT", businessLine: "GUARDING", billingMethod: "PER_HEAD_MONTHLY" });
    expect(contract.startDate.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(contract.endDate!.toISOString().slice(0, 10)).toBe("2027-12-31");
    expect(contract.rates.map((r) => [r.categoryId, Number(r.agreedRate), r.operativeSharePct === null ? null : Number(r.operativeSharePct), r.salaryStructureId]).sort()).toEqual([
      [w.guard.id, 120000, 70, w.structure.id],
      [w.sup.id, 150000, 60, w.structure.id],
    ].sort());
    expect(contract.defaultStructureId).toBe(w.structure.id);
    const beats = await db.beat.findMany({ where: { organizationId: w.t.org.id }, orderBy: { name: "asc" } });
    expect(beats.map((b) => [b.name, b.approvedStrength, b.state, b.lga, b.address, b.contractId, b.clientId])).toEqual([
      ["Lekki Gardens Phase 1", 14, "Lagos", "Eti-Osa", "1 Admiralty Way", contract.id, client.id], // the 14 people the shifts need, not the 12 billed
      ["Lekki Gardens Phase 2", 2, "Lagos", "Eti-Osa", "2 Admiralty Way", contract.id, client.id],
    ]);
    expect(beats[0].siteContact).toContain("Mrs Bello");
    expect(beats[0].siteContact).toContain("+2348031234567");
    const done = await getHandover(w.ops1, h.id);
    expect(done).toMatchObject({ clientId: client.id, contractId: contract.id });
    expect(done.sites.every((s) => s.beatId && beats.some((b) => b.id === s.beatId))).toBe(true);
    const account = await db.crmAccount.findUniqueOrThrow({ where: { id: w.account.id } });
    expect(account).toMatchObject({ clientId: client.id, accountType: "CLIENT" });
    for (const m of ["employee", "deployment", "payrollRun", "payrollRecord", "paymentBatch", "clientInvoice"] as const)
      expect(await (db[m] as unknown as { count: (a: object) => Promise<number> }).count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });

  it("links the account's own client, or a chosen existing one, and refuses to make a second client of the same name by accident", async () => {
    const w = await world();
    const { h } = await submitted(w);
    const existing = await db.client.create({ data: { organizationId: w.t.org.id, code: "CLT-EXISTING", name: "lekki gardens estate" } });
    await expect(acceptHandover(w.ops1, h.id, {})).rejects.toThrow(/already exists/i);
    expect(await db.contract.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    await expect(acceptHandover(w.ops1, h.id, { existingClientId: "nope" })).rejects.toThrow(/client/i);
    await acceptHandover(w.ops1, h.id, { existingClientId: existing.id });
    expect(await db.client.count({ where: { organizationId: w.t.org.id } })).toBe(1);
    expect((await db.contract.findFirstOrThrow({ where: { organizationId: w.t.org.id } })).clientId).toBe(existing.id);
  });

  it("makes nothing at all if any step fails: no client, contract, rate or site, and the handover stays sent", async () => {
    const w = await world();
    const { h } = await submitted(w);
    await db.employeeCategory.delete({ where: { id: w.sup.id } }); // the category is gone by the time Operations accepts
    await expect(acceptHandover(w.ops1, h.id, {})).rejects.toThrow(/category/i);
    for (const m of ["client", "contract", "contractRate", "beat"] as const) expect(await (db[m] as unknown as { count: (a: object) => Promise<number> }).count({ where: { organizationId: w.t.org.id } })).toBe(0);
    expect(await db.crmAccount.findUniqueOrThrow({ where: { id: w.account.id } })).toMatchObject({ clientId: null, accountType: "PROSPECT" });
    const still = await getHandover(w.ops1, h.id);
    expect(still).toMatchObject({ status: "SUBMITTED", clientId: null, contractId: null });
    expect(still.events.map((e) => e.kind)).toEqual(["CREATED", "SUBMITTED"]);
  });

  it("makes nothing twice: accepting again returns the same result and adds no client, contract, rate or site", async () => {
    const w = await world();
    const { h } = await submitted(w);
    const a = await acceptHandover(w.ops1, h.id, {});
    const b = await acceptHandover(w.ops1, h.id, {});
    expect(b.id).toBe(a.id);
    expect(await db.client.count({ where: { organizationId: w.t.org.id } })).toBe(1);
    expect(await db.contract.count({ where: { organizationId: w.t.org.id } })).toBe(1);
    expect(await db.contractRate.count({ where: { organizationId: w.t.org.id } })).toBe(2);
    expect(await db.beat.count({ where: { organizationId: w.t.org.id } })).toBe(2);
    expect((await getHandover(w.ops1, h.id)).events.filter((e) => e.kind === "ACCEPTED")).toHaveLength(1);
  });

  it("is audited with ids and statuses only: no site contact, phone or client contact appears in any audit entry", async () => {
    const w = await world();
    const { h } = await submitted(w);
    await acceptHandover(w.ops1, h.id, { note: "Capacity confirmed" });
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, OR: [{ action: { startsWith: "SALES_HANDOVER" } }, { action: { in: ["CLIENT_CREATE", "CONTRACT_CREATE", "CONTRACT_RATE_SET", "BEAT_CREATE"] } }] } });
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["SALES_HANDOVER_CREATE", "SALES_HANDOVER_SAVE", "SALES_HANDOVER_SUBMIT", "SALES_HANDOVER_ACCEPT", "CLIENT_CREATE", "CONTRACT_CREATE", "CONTRACT_RATE_SET", "BEAT_CREATE"]));
    const text = JSON.stringify(rows.map((r) => [r.oldValue, r.newValue]));
    for (const secret of ["Mrs Bello", "2348031234567", "08031234567", "bello@lekki.test", "Uniformed", "Two-way radio"]) expect(text).not.toContain(secret);
    expect(rows.every((r) => !!r.userId)).toBe(true);
  });
});

describe("what is frozen", () => {
  it("is the quote's facts always, a sent handover's sites and posts, and everything once it is accepted: the database itself refuses", async () => {
    const w = await world();
    const { h } = await acceptedQuote(w);
    const full = await getHandover(w.repA, h.id);
    const post = full.sites[0].posts[0];
    await expect(db.crmHandover.update({ where: { id: h.id }, data: { monthlyBill: 1 } })).rejects.toThrow(/quote facts/i);
    await expect(db.crmHandoverPost.update({ where: { id: post.id }, data: { headcount: 1 } })).rejects.toThrow(/come from the quote/i);
    await expect(db.crmHandoverPost.update({ where: { id: post.id }, data: { billPerHead: 1 } })).rejects.toThrow(/come from the quote/i);
    await expect(db.crmHandoverSite.update({ where: { id: full.sites[0].id }, data: { name: "Other" } })).rejects.toThrow(/from the quote/i);
    await expect(db.crmHandoverSite.delete({ where: { id: full.sites[0].id } })).rejects.toThrow(/cannot be deleted/i);
    await expect(db.crmHandover.delete({ where: { id: h.id } })).rejects.toThrow(/cannot be deleted/i);
    await db.crmHandoverPost.update({ where: { id: post.id }, data: { categoryId: w.guard.id } }); // what Sales enters can change while a draft

    await fill(w, h.id);
    await designateAcceptor(w.admin, w.ops1.userId);
    await submitHandover(w.repA, h.id);
    await expect(db.crmHandoverSite.update({ where: { id: full.sites[0].id }, data: { address: "elsewhere" } })).rejects.toThrow(/has been sent/i);
    await expect(db.crmHandoverPost.update({ where: { id: post.id }, data: { categoryId: w.sup.id } })).rejects.toThrow(/has been sent/i);

    await acceptHandover(w.ops1, h.id, {});
    await expect(db.crmHandover.update({ where: { id: h.id }, data: { scope: "rewritten" } })).rejects.toThrow(/accepted handover cannot be changed/i);
    await expect(db.crmHandoverSite.update({ where: { id: full.sites[0].id }, data: { address: "elsewhere" } })).rejects.toThrow(/has been sent/i);
    const ev = (await getHandover(w.repA, h.id)).events[0];
    await expect(db.crmHandoverEvent.update({ where: { id: ev.id }, data: { note: "x" } })).rejects.toThrow(/cannot be changed or deleted/i);
    await expect(db.crmHandoverEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/cannot be changed or deleted/i);
  });

  it("never carries the company's cost or margin: the handover shows only what was billed and what is needed", async () => {
    const w = await world();
    const { h } = await submitted(w);
    const keys = [...keysOf(await getHandover(w.repA, h.id))];
    expect(keys.filter((k) => /cost|margin|gross|employer|ruleVersion|breakdown/i.test(k))).toEqual([]);
    expect(keys).toEqual(expect.arrayContaining(["headcount", "requiredPersonnel", "billPerHead", "shiftPattern"]));
    const cols = (await db.$queryRaw<Array<{ column_name: string }>>`select column_name::text from information_schema.columns where table_name in ('CrmHandover','CrmHandoverSite','CrmHandoverPost')`).map((c) => c.column_name);
    expect(cols.filter((c) => /cost|margin|gross/i.test(c))).toEqual([]);
  });
});

describe("who may see and do what", () => {
  it("keeps a salesperson to their own deals' handovers, lets Operations and managers see all, and keeps every organization apart", async () => {
    const w = await world();
    const other = await world();
    const { h } = await acceptedQuote(w);
    await expect(getHandover(w.repB, h.id)).rejects.toThrow(/not found/i); // another salesperson's deal
    await expect(saveHandover(w.repB, h.id, { scope: "x" })).rejects.toThrow(/not found/i);
    expect((await listHandovers(w.repB, {})).length).toBe(0);
    expect((await listHandovers(w.repA, {})).map((x) => x.id)).toEqual([h.id]);
    expect((await listHandovers(w.ops1, {})).map((x) => x.id)).toEqual([h.id]);
    expect((await getHandover(w.admin, h.id)).id).toBe(h.id);
    await expect(getHandover(other.admin, h.id)).rejects.toThrow(/not found/i);
    await expect(getHandover(other.ops1, h.id)).rejects.toThrow(/not found/i);
    await designateAcceptor(other.admin, other.ops1.userId); // a designated acceptor of another organization
    await expect(acceptHandover(other.ops1, h.id, {})).rejects.toThrow(/not found/i);
    await expect(returnHandover(other.ops1, h.id, "A question")).rejects.toThrow(/not found/i);
    expect((await listHandovers(other.admin, {})).length).toBe(0);
    await expect(getHandover(w.t.ctx("AUDITOR", null, 1), h.id)).rejects.toThrow(/permission/i);
  });

  it("is switched off with the sales module", async () => {
    const w = await world();
    const { h } = await acceptedQuote(w);
    await updateSalesSetting(w.admin, { enabled: false });
    await expect(getHandover(w.repA, h.id)).rejects.toThrow(/switched off/i);
    await expect(listHandovers(w.ops1, {})).rejects.toThrow(/switched off/i);
  });

  it("lets Operations return it only while it is sent, and only with a question", async () => {
    const w = await world();
    const { h } = await acceptedQuote(w);
    await designateAcceptor(w.admin, w.ops1.userId);
    await expect(returnHandover(w.ops1, h.id, "Why?")).rejects.toThrow(/sent|submitted/i); // still a draft
    await expect(submitHandover(w.repB, h.id)).rejects.toThrow(/not found/i);
  });
});
