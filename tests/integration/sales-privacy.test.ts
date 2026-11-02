import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { can, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { DEFAULT_EARNINGS } from "@/lib/payroll/structure";
import { signUnsubscribe, verifyUnsubscribe } from "@/lib/sales/privacy";
import { createTask, logActivity, sendEmailTo } from "@/server/services/sales/activities";
import { systemCtx } from "@/server/services/sales/automation";
import { createCase, respondToCase } from "@/server/services/sales/cases";
import { canSendMarketing, consentStatus, recordConsent } from "@/server/services/sales/consent";
import { exportCsv } from "@/server/services/sales/export";
import { getHandover, getHandoverForDeal, saveHandover } from "@/server/services/sales/handover";
import { completeAccess, eraseForRetention, eraseSubject, exportSubject, keepLead, listRequests, openRequest, refuseRequest, retentionCandidates, setRetention, unsubscribe, unsubscribeApiUrl, unsubscribeUrl, verifyIdentity } from "@/server/services/sales/privacy";
import { createOpportunity } from "@/server/services/sales/pipelines";
import { createQuote, decideQuote, sendQuote, setMinimumMargin } from "@/server/services/sales/quotes";
import { createAccount, createContact, createLead } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { identifiersFor, isSuppressed } from "@/server/services/sales/suppression";
import { isolatedOrg, uid } from "../helpers";

const mail = vi.mocked(sendEmail);
beforeEach(() => mail.mockClear());

const SECRET = process.env.AUTH_SECRET!;
const DAY = 86_400_000;
const dateOnly = (daysAgo: number) => new Date(Date.now() + 3_600_000 - daysAgo * DAY).toISOString().slice(0, 10);
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

/**
 * An organization with the sales module on, an administrator, a sales rep and an Operations user, and one contact (with a unique name, email and phone, so a search
 * of every table for them cannot be fooled by another test's data) plus a lead.
 */
async function world() {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const ops = t.ctx("OPERATIONS", null, 1);
  for (const c of [admin, repA, ops]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  const tag = uid().toLowerCase() + uid().toLowerCase();
  const digits = String(Math.floor(1_000_000 + Math.random() * 8_999_999)); // 7 digits
  const person = { first: `Fn${tag}`, last: `Ln${tag}`, email: `fn${tag}@lekki.test`, local: `0803${digits}`, e164: `+234803${digits}`, needle: `803${digits}` };
  const account = await createAccount(repA, { name: "Lekki Gardens Estate" });
  const contact = await createContact(repA, { accountId: account.id, firstName: person.first, lastName: person.last, phone: person.local, email: person.email });
  const lead = await createLead(repA, { companyName: "Ikeja Mall", contactName: `Tunde${tag}`, phone: `0805${digits}`, email: `tunde${tag}@ikeja.test` });
  return { t, admin, repA, ops, account, contact, lead, person, tag };
}
type W = Awaited<ReturnType<typeof world>>;

const grant = (w: W, who: { contactId?: string; leadId?: string } = { contactId: w.contact.id }) =>
  recordConsent(w.repA, { ...who, purpose: "MARKETING", status: "GRANTED", channel: "WEB_FORM", source: "Enquiry form on the website", evidenceRef: `Form 114 ${w.person.first} ${w.person.last}` });
const withdraw = (w: W, who: { contactId?: string; leadId?: string } = { contactId: w.contact.id }) =>
  recordConsent(w.repA, { ...who, purpose: "MARKETING", status: "WITHDRAWN", channel: "PHONE", source: "Asked on a call" });
const contactToken = (w: W) => tokenOf(unsubscribeUrl(w.t.org.id, { type: "CONTACT", id: w.contact.id }));

// ─────────────────────────────── the unsubscribe link ───────────────────────────────

describe("unsubscribing by the link", () => {
  it("withdraws marketing consent at once, suppresses the person's addresses, is recorded in the audit log, and can be repeated without effect", async () => {
    const w = await world();
    await grant(w);
    expect(await canSendMarketing(w.repA, { contactId: w.contact.id })).toBe(true);

    expect(await unsubscribe(contactToken(w))).toEqual({ status: "done" });
    expect(await consentStatus(w.repA, { contactId: w.contact.id, purpose: "MARKETING" })).toBe("WITHDRAWN");
    expect(await canSendMarketing(w.repA, { contactId: w.contact.id })).toBe(false);
    expect(await isSuppressed(w.t.org.id, await identifiersFor(w.t.org.id, { contactId: w.contact.id }))).toBe(true);
    expect(await db.crmSuppression.count({ where: { organizationId: w.t.org.id } })).toBe(2); // the email and the phone number

    const rows = await db.crmConsent.findMany({ where: { contactId: w.contact.id }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["GRANTED", "WITHDRAWN"]);
    expect(rows[1]).toMatchObject({ purpose: "MARKETING", channel: "WEB_FORM", recordedBy: "Unsubscribe link" });

    // opening it again (a mail scanner, a double click) changes nothing
    expect(await unsubscribe(contactToken(w))).toEqual({ status: "done" });
    expect(await db.crmConsent.count({ where: { contactId: w.contact.id } })).toBe(2);
    expect(await db.crmSuppression.count({ where: { organizationId: w.t.org.id } })).toBe(2);
    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SALES_UNSUBSCRIBE" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].newValue).toEqual({ subjectType: "CONTACT", subjectId: w.contact.id }); // ids only
  });

  it("works for a lead, and for a person who never gave consent (their addresses are suppressed all the same)", async () => {
    const w = await world();
    expect(await unsubscribe(tokenOf(unsubscribeUrl(w.t.org.id, { type: "LEAD", id: w.lead.id })))).toEqual({ status: "done" });
    expect(await consentStatus(w.repA, { leadId: w.lead.id, purpose: "MARKETING" })).toBe("WITHDRAWN");
    expect(await isSuppressed(w.t.org.id, await identifiersFor(w.t.org.id, { leadId: w.lead.id }))).toBe(true);
  });

  it("does nothing for a link that is altered, made with another secret, or not a token, and says only that it is not valid", async () => {
    const w = await world();
    await grant(w);
    const good = contactToken(w);
    const [payload, mac] = good.split(".");
    const forged = signUnsubscribe(SECRET, { orgId: w.t.org.id, type: "CONTACT", id: "someone-else" }).split(".")[0];
    for (const bad of [`${forged}.${mac}`, `${payload}.${mac.slice(0, -2)}AA`, "garbage", "", "a.b.c"]) expect(await unsubscribe(bad), bad).toEqual({ status: "invalid" });
    expect(await unsubscribe(signUnsubscribe("another-secret-that-is-also-thirty-two-chars-long", { orgId: w.t.org.id, type: "CONTACT", id: w.contact.id }))).toEqual({ status: "invalid" });
    expect(await consentStatus(w.repA, { contactId: w.contact.id, purpose: "MARKETING" })).toBe("GRANTED");
    expect(await db.crmSuppression.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });

  it("answers the same for a valid link to a record that does not exist or was erased, so it reveals nothing about who is on file, and never reaches into another organization", async () => {
    const a = await world();
    const b = await world();
    const unknown = signUnsubscribe(SECRET, { orgId: a.t.org.id, type: "CONTACT", id: "no-such-contact" });
    expect(await unsubscribe(unknown)).toEqual({ status: "done" });
    // a link signed for organization B but naming A's contact finds nothing in B
    await grant(a);
    expect(await unsubscribe(signUnsubscribe(SECRET, { orgId: b.t.org.id, type: "CONTACT", id: a.contact.id }))).toEqual({ status: "done" });
    expect(await consentStatus(a.repA, { contactId: a.contact.id, purpose: "MARKETING" })).toBe("GRANTED");
    expect(await db.crmSuppression.count({ where: { organizationId: { in: [a.t.org.id, b.t.org.id] } } })).toBe(0);
    expect(await db.crmConsent.count({ where: { organizationId: b.t.org.id } })).toBe(0);
  });
});

// ─────────────────────────────── suppression ───────────────────────────────

describe("the suppression list", () => {
  it("holds keyed hashes, never the address or number", async () => {
    const w = await world();
    await grant(w);
    await withdraw(w);
    const rows = await db.crmSuppression.findMany({ where: { organizationId: w.t.org.id } });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.valueHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(r)).not.toContain(w.person.first);
      expect(JSON.stringify(r)).not.toContain(w.person.needle);
    }
  });

  it("blocks the same address on another contact, a lead, or a record created later, even if that record says granted; a fresh consent for the person lifts only their own addresses", async () => {
    const w = await world();
    await grant(w);
    const twin = await createContact(w.repA, { accountId: w.account.id, firstName: "Twin", lastName: "Record", email: w.person.email.toUpperCase() }); // same address, different case, no phone
    await grant(w, { contactId: twin.id });
    expect(await canSendMarketing(w.repA, { contactId: twin.id })).toBe(true);

    await withdraw(w); // the first record's person withdraws
    expect(await canSendMarketing(w.repA, { contactId: twin.id })).toBe(false); // the other record is blocked too
    // a record made later (an import writes its consent straight in) with the same phone number, saying "granted"
    const viaPhone = await createLead(w.repA, { companyName: "Same Phone Ltd", contactName: "Another", phone: w.person.local });
    await db.crmConsent.create({ data: { organizationId: w.t.org.id, leadId: viaPhone.id, purpose: "MARKETING", status: "GRANTED", channel: "OTHER", source: "Import: old list", recordedBy: w.repA.name, recordedByUserId: w.repA.userId } });
    expect(await consentStatus(w.repA, { leadId: viaPhone.id, purpose: "MARKETING" })).toBe("GRANTED");
    expect(await canSendMarketing(w.repA, { leadId: viaPhone.id })).toBe(false); // the same phone number

    await grant(w); // they come back, and say so
    expect(await canSendMarketing(w.repA, { contactId: w.contact.id })).toBe(true);
    expect(await canSendMarketing(w.repA, { contactId: twin.id })).toBe(true);
    expect(await canSendMarketing(w.repA, { leadId: viaPhone.id })).toBe(true);
  });

  it("is per organization: the same address withdrawn in one organization is not blocked in another", async () => {
    const a = await world();
    const b = await world();
    const inB = await createContact(b.repA, { accountId: b.account.id, firstName: "Same", lastName: "Address", email: a.person.email });
    await grant(b, { contactId: inB.id });
    await grant(a);
    await withdraw(a);
    expect(await canSendMarketing(a.repA, { contactId: a.contact.id })).toBe(false);
    expect(await canSendMarketing(b.repA, { contactId: inB.id })).toBe(true);
  });

  it("stops an automation's marketing email as well as a person's", async () => {
    const w = await world();
    await grant(w);
    await unsubscribe(contactToken(w));
    await expect(sendEmailTo(systemCtx(w.t.org.id, "Welcome mail"), { contactId: w.contact.id, subject: "Our patrol service", body: "Hello", purpose: "MARKETING" })).rejects.toThrow(/agreed/i);
    expect(mail).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── the link in every marketing message ───────────────────────────────

describe("every marketing message carries the person's own unsubscribe link", () => {
  it("puts it in the text, in the html, and in the one-click headers of a marketing email, and leaves a service email alone", async () => {
    const w = await world();
    await grant(w);
    await sendEmailTo(w.repA, { contactId: w.contact.id, subject: "Our patrol service", body: "Hello", purpose: "MARKETING" });
    const sent = mail.mock.calls[0][0];
    const url = unsubscribeUrl(w.t.org.id, { type: "CONTACT", id: w.contact.id });
    expect(sent.text).toContain(url);
    expect(sent.html).toContain(`href="${url}"`);
    const api = unsubscribeApiUrl(w.t.org.id, { type: "CONTACT", id: w.contact.id });
    expect(sent.headers).toEqual({ "List-Unsubscribe": `<${api}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    // the link is for this person, in this organization
    expect(verifyUnsubscribe(SECRET, tokenOf(url))).toEqual({ orgId: w.t.org.id, type: "CONTACT", id: w.contact.id });

    await db.crmAccount.update({ where: { id: w.account.id }, data: { accountType: "CLIENT" } });
    await sendEmailTo(w.repA, { contactId: w.contact.id, subject: "Your guards", body: "On site Monday", purpose: "SERVICE" });
    const service = mail.mock.calls[1][0];
    expect(service.text).toBe("On site Monday");
    expect(service.headers).toBeUndefined();
  });

  it("makes a lead's marketing email carry the lead's own link", async () => {
    const w = await world();
    await grant(w, { leadId: w.lead.id });
    await sendEmailTo(w.repA, { leadId: w.lead.id, subject: "Our patrol service", body: "Hello", purpose: "MARKETING" });
    expect(mail.mock.calls[0][0].text).toContain(unsubscribeUrl(w.t.org.id, { type: "LEAD", id: w.lead.id }));
  });

  it("refuses to log a marketing WhatsApp without the person's link, or with someone else's, and logs nothing", async () => {
    const w = await world();
    await grant(w);
    const own = unsubscribeUrl(w.t.org.id, { type: "CONTACT", id: w.contact.id });
    const other = unsubscribeUrl(w.t.org.id, { type: "LEAD", id: w.lead.id });
    const send = (body?: string) => logActivity(w.repA, { kind: "WHATSAPP", contactId: w.contact.id, purpose: "MARKETING", body });
    await expect(send("Our new patrol service")).rejects.toThrow(/unsubscribe link/i);
    await expect(send()).rejects.toThrow(/unsubscribe link/i);
    await expect(send(`Our new patrol service ${other}`)).rejects.toThrow(/unsubscribe link/i);
    expect(await db.crmActivity.count({ where: { organizationId: w.t.org.id, kind: "WHATSAPP" } })).toBe(0);
    expect((await send(`Our new patrol service. To stop: ${own}`)).purpose).toBe("MARKETING");
  });

  it("does not ask a service WhatsApp for a link", async () => {
    const w = await world();
    await db.crmAccount.update({ where: { id: w.account.id }, data: { accountType: "CLIENT" } });
    expect((await logActivity(w.repA, { kind: "WHATSAPP", contactId: w.contact.id, purpose: "SERVICE", body: "Your guards are on site from Monday" })).purpose).toBe("SERVICE");
  });
});

// ─────────────────────────────── data requests ───────────────────────────────

describe("the register of data requests", () => {
  it("numbers each request, counts the response period from the day it was received, and marks an old open one overdue", async () => {
    const w = await world();
    const recent = await openRequest(w.admin, { kind: "ACCESS", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "The person themselves", receivedOn: dateOnly(2), channel: "Email" });
    expect(recent.number).toMatch(/^DSR-?\d{5}$/);
    expect(recent.status).toBe("OPEN");
    expect(recent.identityVerified).toBe(false);
    expect(recent.dueOn.getTime() - recent.receivedOn.getTime()).toBe(30 * DAY);
    const old = await openRequest(w.admin, { kind: "ERASURE", subjectType: "LEAD", subjectId: w.lead.id, requesterName: "Tunde", receivedOn: dateOnly(40) });
    expect(old.number).not.toBe(recent.number);
    const list = await listRequests(w.admin);
    expect(list.find((r) => r.id === old.id)?.overdue).toBe(true);
    expect(list.find((r) => r.id === recent.id)?.overdue).toBe(false);
    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SALES_DSR_OPEN" } });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(w.person.first); // ids and kinds, never the person
  });

  it("is for the company administrator only", async () => {
    const holders = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, "sales.privacy.manage")).sort();
    expect(holders).toEqual(["COMPANY_ADMIN", "SUPER_ADMIN"]);
    const w = await world();
    for (const who of [w.repA, w.ops]) {
      await expect(openRequest(who, { kind: "ACCESS", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Someone" })).rejects.toThrow(/permission/i);
      await expect(listRequests(who)).rejects.toThrow(/permission/i);
      await expect(setRetention(who, 12)).rejects.toThrow(/permission/i);
    }
  });

  it("says what is wrong: who asked, the date, a person that does not exist, one already erased", async () => {
    const w = await world();
    const base = { kind: "ACCESS", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Someone" } as const;
    await expect(openRequest(w.admin, { ...base, requesterName: "" })).rejects.toThrow(/who asked/i);
    await expect(openRequest(w.admin, { ...base, receivedOn: "30/10/2026" })).rejects.toThrow(/date/i);
    await expect(openRequest(w.admin, { ...base, receivedOn: "2099-01-01" })).rejects.toThrow(/future/i);
    await expect(openRequest(w.admin, { ...base, subjectId: "nobody" })).rejects.toThrow(/not found/i);
    await expect(openRequest(w.admin, { ...base, subjectType: "LEAD" })).rejects.toThrow(/not found/i); // a contact's id is not a lead's
  });

  it("keeps organizations apart: another organization's administrator can neither open a request about, nor see, verify, download or erase, this one's", async () => {
    const a = await world();
    const b = await world();
    await expect(openRequest(b.admin, { kind: "ERASURE", subjectType: "CONTACT", subjectId: a.contact.id, requesterName: "Spy" })).rejects.toThrow(/not found/i);
    const req = await openRequest(a.admin, { kind: "ERASURE", subjectType: "CONTACT", subjectId: a.contact.id, requesterName: "Owner" });
    expect((await listRequests(b.admin)).find((r) => r.id === req.id)).toBeUndefined();
    await expect(verifyIdentity(b.admin, req.id, "Rang them back on the number on file")).rejects.toThrow(/not found/i);
    await expect(exportSubject(b.admin, req.id)).rejects.toThrow(/not found/i);
    await expect(eraseSubject(b.admin, req.id)).rejects.toThrow(/not found/i);
    await expect(refuseRequest(b.admin, req.id, "No reason at all")).rejects.toThrow(/not found/i);
    expect((await db.crmContact.findUniqueOrThrow({ where: { id: a.contact.id } })).erasedAt).toBeNull();
  });

  it("can be refused with a reason, which closes it", async () => {
    const w = await world();
    const req = await openRequest(w.admin, { kind: "ERASURE", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Someone" });
    await expect(refuseRequest(w.admin, req.id, "no")).rejects.toThrow(/reason/i);
    await refuseRequest(w.admin, req.id, "Could not confirm who was asking");
    expect(await db.crmDataRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: "REFUSED", outcomeNote: "Could not confirm who was asking" });
    await expect(verifyIdentity(w.admin, req.id, "Rang them back on the number on file")).rejects.toThrow(/closed/i);
  });
});

// ─────────────────────────────── a copy of everything held ───────────────────────────────

/** A draft handover for a deal whose site contact is the person (matched on phone and email). */
async function handoverWithSiteContact(w: W) {
  await setMinimumMargin(w.admin, 0);
  const structure = await db.salaryStructure.create({
    data: {
      organizationId: w.t.org.id, code: "STD", name: "Standard guard", status: "ACTIVE", effectiveFrom: d("2020-01-01"), isDefault: true,
      components: { create: DEFAULT_EARNINGS.map((c, i) => ({ code: c.code, name: c.name, calcType: "PERCENTAGE" as const, percentage: c.percentage, taxable: c.taxable, pensionable: c.pensionable, sortOrder: i })) },
    },
  });
  await db.pensionRule.create({ data: { organizationId: w.t.org.id, version: "P1", employeeRate: 8, employerRate: 10, pensionableCodes: ["BASIC", "HOUSING", "TRANSPORT"], effectiveFrom: d("2020-01-01") } });
  await db.employerCostRule.create({ data: { organizationId: w.t.org.id, version: "E1", effectiveFrom: d("2020-01-01") } });
  const guard = await db.employeeCategory.create({ data: { organizationId: w.t.org.id, code: "GRD", name: "Guard" } });
  const deal = await createOpportunity(w.repA, { accountId: w.account.id, name: "24/7 guarding, 1 site" });
  const q = await createQuote(w.repA, { opportunityId: deal.id, validUntil: "2026-12-31", lines: [{ siteName: "Lekki Gardens Phase 1", siteAddress: "1 Admiralty Way", postLabel: "Main gate", shiftPattern: "24/7", salaryStructureId: structure.id, headcount: 4, requiredPersonnel: 5, billRatePerHead: "120000.00" }] });
  await sendQuote(w.repA, q.id);
  await decideQuote(w.repA, q.id, "ACCEPTED");
  const h = await getHandoverForDeal(w.repA, deal.id);
  if (!h) throw new Error("no handover");
  const full = await getHandover(w.repA, h.id);
  await saveHandover(w.repA, h.id, {
    scope: "Guarding",
    clientRequirements: "Uniformed guards",
    startDate: "2027-01-01",
    termMonths: 12,
    serviceLevels: [{ obligation: "Replace an absent guard", measure: "within 2 hours", consequence: "5% credit" }],
    sites: full.sites.map((s) => ({ id: s.id, address: "2 Admiralty Way", state: "Lagos", lga: "Eti-Osa", contactName: `${w.person.first} ${w.person.last}`, contactRole: "Estate manager", contactPhone: w.person.local, contactEmail: w.person.email, equipment: [{ item: "Two-way radio", quantity: 4 }] })),
    posts: full.sites.flatMap((s) => s.posts).map((p) => ({ id: p.id, categoryId: guard.id })),
  });
  return { deal, handoverId: h.id };
}

/** Everything the CRM can hold about the person: consent history, notes, a task, a case, a duplicate merged in, a converted lead, a deal, and a handover site contact. */
async function richPerson(w: W) {
  await grant(w);
  await logActivity(w.repA, { kind: "NOTE", contactId: w.contact.id, subject: `Call with ${w.person.first}`, body: `${w.person.first} ${w.person.last} wants guards; rang ${w.person.local}; ${w.person.email}` });
  await createTask(w.repA, { title: `Call ${w.person.first} back`, notes: `Number ${w.person.local}`, dueAt: new Date(Date.now() + DAY).toISOString(), contactId: w.contact.id });
  const kase = await createCase(w.repA, { accountId: w.account.id, contactId: w.contact.id, category: "SERVICE_QUALITY", priority: "NORMAL", subject: `Gate broken, reported by ${w.person.first}`, description: `${w.person.first} ${w.person.last} sent photos from ${w.person.email}` });
  await respondToCase(w.repA, kase.id, `Rang ${w.person.first} on ${w.person.local}`);
  const dup = await createContact(w.repA, { accountId: w.account.id, firstName: w.person.first, lastName: w.person.last, email: w.person.email });
  await db.crmContact.update({ where: { id: dup.id }, data: { status: "VOID", mergedIntoId: w.contact.id } });
  const old = await createLead(w.repA, { companyName: "Lekki Gardens Estate", contactName: `${w.person.first} ${w.person.last}`, phone: w.person.local, email: w.person.email, address: `12 ${w.person.first} Close` });
  await db.crmLead.update({ where: { id: old.id }, data: { status: "CONVERTED", convertedContactId: w.contact.id, convertedAt: new Date() } });
  await logActivity(w.repA, { kind: "NOTE", leadId: old.id, body: `Enquiry from ${w.person.first}` }).catch(() => undefined); // a converted lead takes no new notes; the earlier one is added below
  await db.crmActivity.create({ data: { organizationId: w.t.org.id, kind: "NOTE", leadId: old.id, occurredAt: new Date(), body: `Enquiry from ${w.person.first}`, createdBy: w.repA.name, createdByUserId: w.repA.userId } });
  const deal = await createOpportunity(w.repA, { accountId: w.account.id, name: "Estate guarding" });
  await db.crmOpportunity.update({ where: { id: deal.id }, data: { primaryContactId: w.contact.id } });
  const ho = await handoverWithSiteContact(w);
  return { kase, dup, old, deal, ho };
}

describe("a copy of everything held about a person", () => {
  it("needs the identity to be checked first, and is for an open access request", async () => {
    const w = await world();
    const req = await openRequest(w.admin, { kind: "ACCESS", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: w.person.first });
    await expect(exportSubject(w.admin, req.id)).rejects.toThrow(/identity/i);
    await expect(verifyIdentity(w.admin, req.id, "ok")).rejects.toThrow(/how/i);
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    expect(await db.crmDataRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ identityVerified: true, verifiedBy: w.admin.name });
    await expect(exportSubject(w.repA, req.id)).rejects.toThrow(/permission/i);
    const f = await exportSubject(w.admin, req.id);
    expect(f.fileName).toBe(`data-request-${req.number}.json`);
    await expect(completeAccess(w.admin, req.id)).resolves.toBeUndefined();
    await expect(completeAccess(w.admin, req.id)).rejects.toThrow(/closed/i);
  });

  it("holds every record about the person, the duplicate merged into them, the lead they came from, and the site contact on a handover; and nobody else's", async () => {
    const w = await world();
    const x = await richPerson(w);
    const other = await createContact(w.repA, { accountId: w.account.id, firstName: "Stranger", lastName: "Else", email: "stranger@else.test" });
    await logActivity(w.repA, { kind: "NOTE", contactId: other.id, body: "Not the person" });

    const req = await openRequest(w.admin, { kind: "ACCESS", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: w.person.first });
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    const f = await exportSubject(w.admin, req.id);
    const data = JSON.parse(f.json);

    expect(f.sections).toEqual({ contacts: 2, leads: 1, consents: 1, activities: 2, tasks: 1, cases: 1, siteContacts: 1, deals: 1 });
    expect(data.contacts.map((c: { email: string }) => c.email)).toEqual([w.person.email, w.person.email]); // the contact and the duplicate merged into it
    expect(data.leads[0]).toMatchObject({ contactName: `${w.person.first} ${w.person.last}`, address: `12 ${w.person.first} Close` });
    expect(data.consents[0]).toMatchObject({ purpose: "MARKETING", status: "GRANTED", source: "Enquiry form on the website" });
    expect(data.cases[0].history.length).toBeGreaterThan(0);
    expect(data.siteContacts[0]).toMatchObject({ name: `${w.person.first} ${w.person.last}`, email: w.person.email, phone: w.person.e164 });
    expect(data.deals[0].name).toBe("Estate guarding");
    expect(data.onSuppressionList).toBe(false);
    expect(f.json).not.toContain("Stranger");
    expect(f.json).not.toContain("Not the person");

    // the checksum is of exactly the file, and the register keeps it with the section counts
    expect(f.checksum).toBe(createHash("sha256").update(f.json).digest("hex"));
    const after = await db.crmDataRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after).toMatchObject({ exportChecksum: f.checksum, exportSections: f.sections });
    expect(after.exportedAt).not.toBeNull();
    // the audit log records that a copy was made and how many records, not what they say
    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SALES_DSR_EXPORT" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(w.person.first);
    expect(x.kase.id).toBeTruthy();
  });

  it("works for a lead, with the contact the lead became", async () => {
    const w = await world();
    const lead = await createLead(w.repA, { companyName: "Lekki Gardens Estate", contactName: `${w.person.first} ${w.person.last}`, email: w.person.email });
    await db.crmLead.update({ where: { id: lead.id }, data: { status: "CONVERTED", convertedContactId: w.contact.id } });
    const req = await openRequest(w.admin, { kind: "ACCESS", subjectType: "LEAD", subjectId: lead.id, requesterName: w.person.first });
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    const f = await exportSubject(w.admin, req.id);
    expect(f.sections).toMatchObject({ leads: 1, contacts: 1 });
  });
});

// ─────────────────────────────── erasure ───────────────────────────────

/** Rows in the CRM tables (and the audit log of this organization) that still hold any of the needles in a text or JSON column. */
async function mentions(orgId: string, needles: string[]) {
  const cols = await db.$queryRaw<{ t: string; c: string }[]>`SELECT table_name::text AS t, column_name::text AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'Crm%' AND data_type IN ('text', 'character varying', 'jsonb', 'ARRAY')`;
  const hits: string[] = [];
  for (const { t, c } of cols) {
    for (const n of needles) {
      const r = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}" WHERE "${c}"::text ILIKE $1`, `%${n}%`);
      if (r[0].n > 0) hits.push(`${t}.${c} (${r[0].n}) holds ${n}`);
    }
  }
  const audit = await db.auditLog.findMany({ where: { organizationId: orgId }, select: { oldValue: true, newValue: true, reason: true, entityId: true } });
  for (const n of needles) if (JSON.stringify(audit).toLowerCase().includes(n.toLowerCase())) hits.push(`AuditLog holds ${n}`);
  return hits;
}

describe("erasing a person", () => {
  it("anonymises the contact and everything linked to them, so no CRM table holds their name, email or phone any more", async () => {
    const w = await world();
    await richPerson(w);
    const needles = [w.person.first, w.person.last, w.person.email, w.person.needle];
    expect((await mentions(w.t.org.id, needles)).length).toBeGreaterThan(8); // the premise: they really are all over the place

    const req = await openRequest(w.admin, { kind: "ERASURE", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: `${w.person.first} ${w.person.last}` });
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    const r = await eraseSubject(w.admin, req.id);

    expect(await mentions(w.t.org.id, needles)).toEqual([]);
    expect(r.counts).toMatchObject({ contacts: 2, leads: 1, tasks: 1, cases: 1, siteContacts: 1 });
    const c = await db.crmContact.findUniqueOrThrow({ where: { id: w.contact.id } });
    expect(c).toMatchObject({ firstName: "Erased", lastName: "Contact", email: null, phoneE164: null, status: "VOID" });
    expect(c.erasedAt).not.toBeNull();
    // the structure stays: the deal, the case and the account keep their links
    expect(await db.crmCase.count({ where: { organizationId: w.t.org.id, contactId: w.contact.id } })).toBe(1);
    expect(await db.crmOpportunity.count({ where: { organizationId: w.t.org.id, primaryContactId: w.contact.id } })).toBe(1);
    // the request is completed and no longer names who asked
    expect(await db.crmDataRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: "COMPLETED", requesterName: "Erased", identityNote: null, handledBy: w.admin.name });
  });

  it("keeps the audit entries (they hold ids, never the person), and records the erasure with counts", async () => {
    const w = await world();
    await richPerson(w);
    const before = await db.auditLog.count({ where: { organizationId: w.t.org.id } });
    const req = await openRequest(w.admin, { kind: "ERASURE", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Owner" });
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    await eraseSubject(w.admin, req.id);
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id } });
    expect(rows.length).toBeGreaterThanOrEqual(before + 2); // none removed; the request and the erasure added
    const erase = rows.find((x) => x.action === "SALES_DSR_ERASE")!;
    expect(erase.entityId).toBe(req.id);
    expect(erase.newValue).toMatchObject({ subjectType: "CONTACT", subjectId: w.contact.id });
    expect(JSON.stringify(erase.newValue)).not.toContain(w.person.first);
  });

  it("keeps the person suppressed after their addresses are gone, so a record made later with the same address is still blocked, and a fresh consent does not lift it", async () => {
    const w = await world();
    await grant(w);
    const req = await openRequest(w.admin, { kind: "ERASURE", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Owner" });
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    await eraseSubject(w.admin, req.id);
    expect(await db.crmSuppression.count({ where: { organizationId: w.t.org.id, reason: "ERASED" } })).toBe(2);
    const again = await createContact(w.repA, { accountId: w.account.id, firstName: "Back", lastName: "Again", email: w.person.email, phone: w.person.local });
    await grant(w, { contactId: again.id });
    expect(await canSendMarketing(w.repA, { contactId: again.id })).toBe(false);
    expect(await db.crmSuppression.count({ where: { organizationId: w.t.org.id, reason: "ERASED" } })).toBe(2);
  });

  it("makes an address already on the list for another reason an erased one, which no consent can lift", async () => {
    const w = await world();
    await grant(w);
    await withdraw(w); // suppressed because they withdrew
    expect(await db.crmSuppression.count({ where: { organizationId: w.t.org.id, reason: "WITHDRAWN" } })).toBe(2);
    const req = await openRequest(w.admin, { kind: "ERASURE", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Owner" });
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    await eraseSubject(w.admin, req.id);
    expect(await db.crmSuppression.count({ where: { organizationId: w.t.org.id, reason: "ERASED" } })).toBe(2);
    expect(await db.crmSuppression.count({ where: { organizationId: w.t.org.id, reason: "WITHDRAWN" } })).toBe(0);
  });

  it("refuses without a checked identity, for an access request, for someone else's organization, or twice; and then changes nothing", async () => {
    const w = await world();
    await grant(w);
    const access = await openRequest(w.admin, { kind: "ACCESS", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Owner" });
    await verifyIdentity(w.admin, access.id, "Called back on the number on file");
    await expect(eraseSubject(w.admin, access.id)).rejects.toThrow(/copy of the data/i);
    const req = await openRequest(w.admin, { kind: "ERASURE", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Owner" });
    await expect(eraseSubject(w.admin, req.id)).rejects.toThrow(/identity/i);
    await expect(eraseSubject(w.repA, req.id)).rejects.toThrow(/permission/i);
    await expect(eraseSubject(w.ops, req.id)).rejects.toThrow(/permission/i);
    const c = await db.crmContact.findUniqueOrThrow({ where: { id: w.contact.id } });
    expect(c).toMatchObject({ firstName: w.person.first, email: w.person.email });
    expect(c.erasedAt).toBeNull();
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    await eraseSubject(w.admin, req.id);
    await expect(eraseSubject(w.admin, req.id)).rejects.toThrow(/closed/i);
  });

  it("erases a lead and the contact it became, and leaves a converted lead's status as it was", async () => {
    const w = await world();
    const lead = await createLead(w.repA, { companyName: "Lekki Gardens Estate", contactName: `${w.person.first} ${w.person.last}`, email: w.person.email, address: "5 Some Street" });
    await db.crmLead.update({ where: { id: lead.id }, data: { status: "CONVERTED", convertedContactId: w.contact.id } });
    const req = await openRequest(w.admin, { kind: "ERASURE", subjectType: "LEAD", subjectId: lead.id, requesterName: "Owner" });
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    await eraseSubject(w.admin, req.id);
    const l = await db.crmLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l).toMatchObject({ status: "CONVERTED", contactName: null, email: null, address: null });
    expect(l.erasedAt).not.toBeNull();
    expect((await db.crmContact.findUniqueOrThrow({ where: { id: w.contact.id } })).erasedAt).not.toBeNull();
  });

  it("lists the records that may still mention the person in free text, by id and never by what they say", async () => {
    const w = await world();
    await grant(w);
    const deal = await createOpportunity(w.repA, { accountId: w.account.id, name: "Estate guarding" });
    await db.crmOpportunity.update({ where: { id: deal.id }, data: { primaryContactId: w.contact.id } });
    // a note on the ACCOUNT (not on the person) that names them: the tool cannot know it is about them
    const note = await logActivity(w.repA, { kind: "NOTE", accountId: w.account.id, body: `Spoke to ${w.person.first} at the gate` });
    const req = await openRequest(w.admin, { kind: "ERASURE", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Owner" });
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    const r = await eraseSubject(w.admin, req.id);
    expect(r.review.deals).toEqual([deal.id]);
    expect(r.review.accountAndDealActivities).toEqual([note.id]);
    expect(JSON.stringify(r.review)).not.toContain(w.person.first);
    // the note itself is left alone for a person to decide on
    expect((await db.crmActivity.findUniqueOrThrow({ where: { id: note.id } })).body).toContain(w.person.first);
    expect((await db.crmDataRequest.findUniqueOrThrow({ where: { id: req.id } })).reviewList).toEqual(r.review);
  });
});

describe("the protected tables still refuse every other change", () => {
  it("lets only a transaction that has set the erasure flag blank personal columns, and only those", async () => {
    const w = await world();
    await grant(w);
    const act = await logActivity(w.repA, { kind: "NOTE", contactId: w.contact.id, subject: "Subject", body: "Body" });
    const consent = await db.crmConsent.findFirstOrThrow({ where: { contactId: w.contact.id } });
    const flag = (tx: { $queryRaw: typeof db.$queryRaw }) => tx.$queryRaw`SELECT set_config('app.crm_erasure', 'on', true)`;

    // without the flag nothing changes, not even a personal column
    await expect(db.$executeRaw`UPDATE "CrmConsent" SET "source" = 'x' WHERE id = ${consent.id}`).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "CrmActivity" SET "body" = NULL WHERE id = ${act.id}`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM "CrmConsent" WHERE id = ${consent.id}`).rejects.toThrow();

    // with the flag, a personal column may be blanked ...
    await db.$transaction(async (tx) => {
      await flag(tx);
      await tx.$executeRaw`UPDATE "CrmConsent" SET "source" = 'Erased', "evidenceRef" = NULL WHERE id = ${consent.id}`;
      await tx.$executeRaw`UPDATE "CrmActivity" SET "subject" = NULL, "body" = NULL WHERE id = ${act.id}`;
    });
    expect((await db.crmActivity.findUniqueOrThrow({ where: { id: act.id } })).body).toBeNull();

    // ... but nothing else, flag or not
    await expect(db.$transaction(async (tx) => { await flag(tx); await tx.$executeRaw`UPDATE "CrmConsent" SET "status" = 'WITHDRAWN' WHERE id = ${consent.id}`; })).rejects.toThrow();
    await expect(db.$transaction(async (tx) => { await flag(tx); await tx.$executeRaw`UPDATE "CrmConsent" SET "recordedBy" = 'Someone else' WHERE id = ${consent.id}`; })).rejects.toThrow();
    await expect(db.$transaction(async (tx) => { await flag(tx); await tx.$executeRaw`UPDATE "CrmActivity" SET "kind" = 'CALL' WHERE id = ${act.id}`; })).rejects.toThrow();
    await expect(db.$transaction(async (tx) => { await flag(tx); await tx.$executeRaw`DELETE FROM "CrmConsent" WHERE id = ${consent.id}`; })).rejects.toThrow();
    // and the flag does not outlast its transaction
    await expect(db.$executeRaw`UPDATE "CrmConsent" SET "source" = 'again' WHERE id = ${consent.id}`).rejects.toThrow();
    expect((await db.crmConsent.findUniqueOrThrow({ where: { id: consent.id } })).status).toBe("GRANTED");
  });
});

// ─────────────────────────────── retention ───────────────────────────────

describe("reviewing old leads", () => {
  const monthsAgo = (n: number) => {
    const x = new Date();
    x.setUTCMonth(x.getUTCMonth() - n);
    return x;
  };

  it("is off until a period is set, and the period must be sensible", async () => {
    const w = await world();
    expect((await retentionCandidates(w.admin)).months).toBeNull();
    for (const bad of [0, -3, 121, 1.5]) await expect(setRetention(w.admin, bad)).rejects.toThrow(/whole number of months/i);
    await setRetention(w.admin, 12);
    expect((await retentionCandidates(w.admin)).months).toBe(12);
    await setRetention(w.admin, null);
    expect((await retentionCandidates(w.admin)).leads).toEqual([]);
    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SALES_RETENTION_SET" } });
    expect(audit).toHaveLength(2);
  });

  it("lists only unconverted leads with no activity for the whole period; a kept lead drops off", async () => {
    const w = await world();
    await setRetention(w.admin, 6);
    const make = async (name: string, createdMonthsAgo: number) => {
      const l = await createLead(w.repA, { companyName: name, contactName: "X Person" });
      await db.crmLead.update({ where: { id: l.id }, data: { createdAt: monthsAgo(createdMonthsAgo) } });
      return l;
    };
    const stale = await make("Stale Ltd", 12);
    const worked = await make("Worked Ltd", 12);
    await db.crmActivity.create({ data: { organizationId: w.t.org.id, kind: "NOTE", leadId: worked.id, occurredAt: monthsAgo(1), body: "Rang them", createdBy: w.repA.name, createdByUserId: w.repA.userId } });
    const fresh = await make("Fresh Ltd", 1);
    const converted = await make("Converted Ltd", 12);
    await db.crmLead.update({ where: { id: converted.id }, data: { status: "CONVERTED" } });
    const kept = await make("Kept Ltd", 12);

    expect((await retentionCandidates(w.admin)).leads.map((l) => l.id).sort()).toEqual([stale.id, kept.id].sort());
    await expect(keepLead(w.admin, kept.id, 12, "no")).rejects.toThrow(/reason/i);
    await expect(keepLead(w.admin, kept.id, 0, "Active enquiry by phone")).rejects.toThrow(/months/i);
    await keepLead(w.admin, kept.id, 12, "Active enquiry by phone");
    expect((await retentionCandidates(w.admin)).leads.map((l) => l.id)).toEqual([stale.id]);
    void fresh;
  });

  it("erases a lead past the period as a recorded retention request, and refuses one that is not past it or was kept", async () => {
    const w = await world();
    await setRetention(w.admin, 6);
    const stale = await createLead(w.repA, { companyName: "Stale Ltd", contactName: `Old${w.tag}`, email: `old${w.tag}@stale.test` });
    await db.crmLead.update({ where: { id: stale.id }, data: { createdAt: monthsAgo(12) } });
    await expect(eraseForRetention(w.admin, w.lead.id)).rejects.toThrow(/not past the retention period/i); // a new lead
    await expect(eraseForRetention(w.repA, stale.id)).rejects.toThrow(/permission/i);
    const r = await eraseForRetention(w.admin, stale.id);
    expect(r.number).toMatch(/^DSR-?\d{5}$/);
    const l = await db.crmLead.findUniqueOrThrow({ where: { id: stale.id } });
    expect(l).toMatchObject({ contactName: null, email: null });
    expect(l.erasedAt).not.toBeNull();
    expect(await db.crmDataRequest.findFirstOrThrow({ where: { organizationId: w.t.org.id, number: r.number } })).toMatchObject({ kind: "RETENTION", status: "COMPLETED", subjectId: stale.id });
    expect(await isSuppressed(w.t.org.id, [{ kind: "EMAIL", value: `old${w.tag}@stale.test` }])).toBe(true);
    await expect(eraseForRetention(w.admin, stale.id)).rejects.toThrow(/not past the retention period/i); // already erased
  });
});

// ─────────────────────────────── masking ───────────────────────────────

describe("exports show contact details to the people who work the records, and masked to those who only read them", () => {
  it("masks email and phone for Operations, shows them in full to a salesperson, and says so in the audit log", async () => {
    const w = await world();
    expect(can("OPERATIONS", "sales.manage")).toBe(false);
    expect(can("OPERATIONS", "sales.view")).toBe(true);
    const full = await exportCsv(w.repA, "CONTACTS");
    expect(full.csv).toContain(w.person.email);
    expect(full.csv).toContain(w.person.e164);

    const masked = await exportCsv(w.ops, "CONTACTS");
    expect(masked.csv).not.toContain(w.person.email);
    expect(masked.csv).not.toContain(w.person.e164);
    expect(masked.csv).toContain(`f***@lekki.test`);
    expect(masked.csv).toContain(`${w.person.e164.slice(0, 4)}${"*".repeat(w.person.e164.length - 7)}${w.person.e164.slice(-3)}`);

    const leads = await exportCsv(w.ops, "LEADS");
    expect(leads.csv).not.toContain(`tunde${w.tag}@ikeja.test`);
    expect(leads.csv).toContain("t***@ikeja.test");

    const audit = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: "SALES_EXPORT" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => (a.newValue as { masked: boolean }).masked)).toEqual([false, true, true]);
  });

  it("leaves erased people out of the export", async () => {
    const w = await world();
    const req = await openRequest(w.admin, { kind: "ERASURE", subjectType: "CONTACT", subjectId: w.contact.id, requesterName: "Owner" });
    await verifyIdentity(w.admin, req.id, "Called back on the number on file");
    await eraseSubject(w.admin, req.id);
    const csv = (await exportCsv(w.repA, "CONTACTS")).csv;
    expect(csv).not.toContain(w.person.first);
    expect(csv).not.toContain(w.person.email);
  });
});
