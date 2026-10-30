import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { cancelTask, completeTask, createTask, digestFor, logActivity, myTasks, reopenTask, sendEmailTo, sendSalesDigests, tasksFor, timeline, voidActivity } from "@/server/services/sales/activities";
import { recordConsent } from "@/server/services/sales/consent";
import { moveOpportunity } from "@/server/services/sales/deals";
import { createOpportunity, listPipelines } from "@/server/services/sales/pipelines";
import { createAccount, createContact, createLead } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { isolatedOrg } from "../helpers";

const mail = vi.mocked(sendEmail);
beforeEach(() => mail.mockClear());

const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const iso = (d: Date) => d.toISOString();

/** An organization with the sales module on, two sales reps, a manager, an Operations user (who can only read), and a contact, a lead and a deal of the first rep. */
async function world() {
  const t = await isolatedOrg();
  const admin = t.ctx("COMPANY_ADMIN", null, 1);
  const repA = t.ctx("BUSINESS_DEV", null, 1);
  const repB = t.ctx("BUSINESS_DEV", null, 2);
  const ops = t.ctx("OPERATIONS", null, 1);
  for (const c of [admin, repA, repB, ops]) await db.user.create({ data: { id: c.userId, organizationId: t.org.id, email: c.email, name: c.name, passwordHash: "not-a-real-hash", role: c.role } });
  await updateSalesSetting(admin, { enabled: true });
  const account = await createAccount(repA, { name: "Lekki Gardens Estate" });
  const contact = await createContact(repA, { accountId: account.id, firstName: "Funmi", lastName: "Bello", phone: "0803 123 4567", email: "funmi@lekki.test" });
  const lead = await createLead(repA, { companyName: "Ikeja Mall", contactName: "Tunde Ola", phone: "08051234567", email: "tunde@ikeja.test" });
  const deal = await createOpportunity(repA, { accountId: account.id, name: "24/7 guarding, 2 sites" });
  const stages = (await listPipelines(admin))[0].stages;
  return { t, admin, repA, repB, ops, account, contact, lead, deal, stage: (n: string) => stages.find((s) => s.name === n)!.id };
}
type W = Awaited<ReturnType<typeof world>>;
const consent = (w: W, status: "GRANTED" | "WITHDRAWN", purpose: "MARKETING" | "SERVICE" = "MARKETING") =>
  recordConsent(w.repA, { contactId: w.contact.id, purpose, status, channel: "WHATSAPP", source: "Signed form at the site visit" });

describe("logging what happened", () => {
  it("takes a call with its outcome, a meeting, a site survey with its checklist, a WhatsApp and a note, and fills in the account from the contact or deal", async () => {
    const w = await world();
    const call = await logActivity(w.repA, { kind: "CALL", contactId: w.contact.id, callOutcome: "REACHED", body: "Wants a site visit" });
    expect(call).toMatchObject({ kind: "CALL", callOutcome: "REACHED", accountId: w.account.id, contactId: w.contact.id, viaLink: false });
    await logActivity(w.repA, { kind: "MEETING", opportunityId: w.deal.id, subject: "Walk the estate with the manager" });
    const survey = await logActivity(w.repA, { kind: "SITE_SURVEY", opportunityId: w.deal.id, survey: { siteType: "Residential estate", entryPoints: 3, existingGuards: 0, riskNotes: "North fence broken", photoLinks: ["https://example.test/fence.jpg"] } });
    expect(survey.survey).toMatchObject({ siteType: "Residential estate", entryPoints: 3, existingGuards: 0 });
    expect(survey.accountId).toBe(w.account.id);
    await logActivity(w.repA, { kind: "NOTE", leadId: w.lead.id, body: "Met at the trade fair" });
    await consent(w, "GRANTED");
    await logActivity(w.repA, { kind: "WHATSAPP", contactId: w.contact.id, purpose: "MARKETING", body: "Our new patrol service" });
  });

  it("says what is missing: a call's outcome, the checklist, the note, what the meeting was, the purpose of a message, who it is about, and no future dates", async () => {
    const w = await world();
    await expect(logActivity(w.repA, { kind: "CALL", contactId: w.contact.id })).rejects.toThrow(/how the call went/i);
    await expect(logActivity(w.repA, { kind: "SITE_SURVEY", opportunityId: w.deal.id })).rejects.toThrow(/checklist/i);
    await expect(logActivity(w.repA, { kind: "SITE_SURVEY", opportunityId: w.deal.id, survey: { siteType: "Estate", entryPoints: -2 } })).rejects.toThrow(/entry points/i);
    await expect(logActivity(w.repA, { kind: "NOTE", contactId: w.contact.id })).rejects.toThrow(/write the note/i);
    await expect(logActivity(w.repA, { kind: "MEETING", contactId: w.contact.id })).rejects.toThrow(/meeting was about/i);
    await expect(logActivity(w.repA, { kind: "WHATSAPP", contactId: w.contact.id, body: "Hi" })).rejects.toThrow(/service message or marketing/i);
    await expect(logActivity(w.repA, { kind: "NOTE", body: "Orphan" })).rejects.toThrow(/who or what/i);
    await expect(logActivity(w.repA, { kind: "NOTE", contactId: w.contact.id, body: "Later", occurredAt: iso(new Date(Date.now() + 86_400_000)) })).rejects.toThrow(/future/i);
    expect(await db.crmActivity.count({ where: { organizationId: w.t.org.id } })).toBe(0);
  });

  it("counts as activity on the deal (a backdated entry never makes a deal look less recently worked), and a call started from a link needs no outcome yet", async () => {
    const w = await world();
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { lastActivityAt: ago(30) } });
    await logActivity(w.repA, { kind: "NOTE", opportunityId: w.deal.id, body: "Spoke to the manager" });
    const fresh = (await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id } })).lastActivityAt;
    expect(Date.now() - fresh.getTime()).toBeLessThan(60_000);
    await logActivity(w.repA, { kind: "NOTE", opportunityId: w.deal.id, body: "An old conversation", occurredAt: iso(ago(40)) });
    expect((await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id } })).lastActivityAt.getTime()).toBe(fresh.getTime());
    const started = await logActivity(w.repA, { kind: "CALL", contactId: w.contact.id, viaLink: true });
    expect(started).toMatchObject({ callOutcome: null, viaLink: true });
  });
});

describe("marketing needs consent, on the server, before anything is sent", () => {
  it("refuses a marketing WhatsApp until the person has agreed, and again as soon as they withdraw; nothing is logged when refused", async () => {
    const w = await world();
    const send = () => logActivity(w.repA, { kind: "WHATSAPP", contactId: w.contact.id, purpose: "MARKETING", body: "Our new patrol service" });
    await expect(send()).rejects.toThrow(/marketing consent|agreed/i); // no consent recorded: unknown
    await consent(w, "GRANTED", "SERVICE"); // consent to service messages never opens marketing
    await expect(send()).rejects.toThrow(/agreed/i);
    await consent(w, "GRANTED");
    expect((await send()).purpose).toBe("MARKETING");
    await consent(w, "WITHDRAWN"); // opting out is immediate
    await expect(send()).rejects.toThrow(/agreed/i);
    expect(await db.crmActivity.count({ where: { organizationId: w.t.org.id, kind: "WHATSAPP" } })).toBe(1);
  });

  it("applies to a lead the same way, and to a deal's primary contact", async () => {
    const w = await world();
    await expect(logActivity(w.repA, { kind: "WHATSAPP", leadId: w.lead.id, purpose: "MARKETING", body: "Hello" })).rejects.toThrow(/agreed/i);
    await recordConsent(w.repA, { leadId: w.lead.id, purpose: "MARKETING", status: "GRANTED", channel: "WEB_FORM", source: "Enquiry form on the website" });
    await logActivity(w.repA, { kind: "WHATSAPP", leadId: w.lead.id, purpose: "MARKETING", body: "Hello" });
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { primaryContactId: w.contact.id } });
    await expect(logActivity(w.repA, { kind: "WHATSAPP", opportunityId: w.deal.id, purpose: "MARKETING", body: "Hello" })).rejects.toThrow(/agreed/i); // the contact has not agreed
  });

  it("accepts the service label only for someone at a client, so the label cannot be used to get round consent", async () => {
    const w = await world();
    const service = () => logActivity(w.repA, { kind: "WHATSAPP", contactId: w.contact.id, purpose: "SERVICE", body: "Your guards are on site from Monday" });
    await expect(service()).rejects.toThrow(/not at a client/i);
    await expect(logActivity(w.repA, { kind: "WHATSAPP", leadId: w.lead.id, purpose: "SERVICE", body: "x" })).rejects.toThrow(/not at a client/i);
    await db.crmAccount.update({ where: { id: w.account.id }, data: { accountType: "CLIENT" } });
    expect((await service()).purpose).toBe("SERVICE");
  });

  it("sends an email only when allowed, to the address on the person, and logs it; a refused marketing email sends nothing and logs nothing", async () => {
    const w = await world();
    const send = (purpose: "SERVICE" | "MARKETING") => sendEmailTo(w.repA, { contactId: w.contact.id, subject: "Our patrol service", body: "Hello Funmi,\n\nWe now offer patrols.", purpose });
    await expect(send("MARKETING")).rejects.toThrow(/agreed/i);
    expect(mail).not.toHaveBeenCalled();
    expect(await db.crmActivity.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    await consent(w, "GRANTED");
    const a = await send("MARKETING");
    expect(mail).toHaveBeenCalledTimes(1);
    expect(mail.mock.calls[0][0]).toMatchObject({ to: "funmi@lekki.test", subject: "Our patrol service" });
    expect(mail.mock.calls[0][0].html).toContain("<p>Hello Funmi,</p>");
    expect(a).toMatchObject({ kind: "EMAIL", purpose: "MARKETING", subject: "Our patrol service", contactId: w.contact.id });
    await consent(w, "WITHDRAWN");
    await expect(send("MARKETING")).rejects.toThrow(/agreed/i);
    expect(mail).toHaveBeenCalledTimes(1);
    await db.crmContact.update({ where: { id: w.contact.id }, data: { email: null } });
    await expect(sendEmailTo(w.repA, { contactId: w.contact.id, subject: "Hi there", body: "x", purpose: "SERVICE" })).rejects.toThrow(/not at a client|no email/i);
  });

  it("escapes what the user typed so it cannot inject markup into the email", async () => {
    const w = await world();
    await consent(w, "GRANTED");
    await sendEmailTo(w.repA, { contactId: w.contact.id, subject: "Hello again", body: "<script>alert(1)</script> & more", purpose: "MARKETING" });
    expect(mail.mock.calls[0][0].html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; more</p>");
  });
});

describe("who can do and see what", () => {
  it("keeps a salesperson to their own records, lets a manager and Operations read everything, lets only people who manage sales log, and keeps organizations apart", async () => {
    const w = await world();
    const other = await world();
    await logActivity(w.repA, { kind: "NOTE", contactId: w.contact.id, body: "Private to Funmi's owner" });
    await expect(logActivity(w.repB, { kind: "NOTE", contactId: w.contact.id, body: "Not mine" })).rejects.toThrow(/not found/i);
    await expect(timeline(w.repB, { contactId: w.contact.id })).rejects.toThrow(/not found/i);
    await expect(timeline(w.repB, { opportunityId: w.deal.id })).rejects.toThrow(/not found/i);
    expect((await timeline(w.repA, { contactId: w.contact.id })).length).toBe(1);
    expect((await timeline(w.admin, { contactId: w.contact.id })).length).toBe(1);
    expect((await timeline(w.ops, { contactId: w.contact.id })).length).toBe(1); // Operations reads
    await expect(logActivity(w.ops, { kind: "NOTE", contactId: w.contact.id, body: "x" })).rejects.toThrow(/permission/i); // but does not write
    await expect(timeline(other.admin, { contactId: w.contact.id })).rejects.toThrow(/not found/i);
    await expect(logActivity(other.admin, { kind: "NOTE", contactId: w.contact.id, body: "x" })).rejects.toThrow(/not found/i);
    await expect(timeline(w.t.ctx("AUDITOR", null, 1), { contactId: w.contact.id })).rejects.toThrow(/permission/i);
    await updateSalesSetting(w.admin, { enabled: false });
    await expect(timeline(w.repA, { contactId: w.contact.id })).rejects.toThrow(/switched off/i);
  });
});

describe("the timeline", () => {
  it("brings activities, stage changes, quote events, handover events and consent changes together, newest first, filterable by type", async () => {
    const w = await world();
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { primaryContactId: w.contact.id } });
    await logActivity(w.repA, { kind: "CALL", opportunityId: w.deal.id, contactId: w.contact.id, callOutcome: "CALLBACK", occurredAt: iso(ago(5)) });
    await logActivity(w.repA, { kind: "NOTE", opportunityId: w.deal.id, body: "Wants a quote for two sites", occurredAt: iso(ago(4)) });
    await moveOpportunity(w.repA, w.deal.id, { stageId: w.stage("Qualified"), nextStep: "Visit the site on Monday" });
    await consent(w, "GRANTED");
    const quote = await db.crmQuote.create({ data: { organizationId: w.t.org.id, opportunityId: w.deal.id, number: "SQ-90001", versionNo: 1, status: "SENT", createdBy: "Rep A", createdByUserId: w.repA.userId, sentAt: ago(1), sentBy: "Rep A", createdAt: ago(2) } });
    const handover = await db.crmHandover.create({ data: { organizationId: w.t.org.id, number: "HO-90001", opportunityId: w.deal.id, quoteId: quote.id, accountId: w.account.id, quoteNumber: "SQ-90001", quoteVersion: 1, monthlyBill: 1, preparedBy: "Rep A", preparedByUserId: w.repA.userId } });
    await db.crmHandoverEvent.create({ data: { organizationId: w.t.org.id, handoverId: handover.id, kind: "CREATED", revisionNo: 1, byUserId: w.repA.userId, byName: "Rep A" } });

    const deal = await timeline(w.repA, { opportunityId: w.deal.id });
    const kinds = deal.map((i) => i.type);
    expect(kinds).toEqual(expect.arrayContaining(["CALL", "NOTE", "STAGE", "QUOTE", "HANDOVER"]));
    expect(deal.map((i) => i.at.getTime())).toEqual([...deal.map((i) => i.at.getTime())].sort((a, b) => b - a)); // newest first
    expect(deal.find((i) => i.type === "STAGE" && i.title.includes("Qualified"))?.title).toMatch(/Moved from .* to Qualified/);
    expect(deal.find((i) => i.type === "QUOTE")?.title).toBe("Quote SQ-90001 version 1 sent");
    expect(deal.find((i) => i.type === "HANDOVER")?.title).toBe("Handover HO-90001: started");
    expect((await timeline(w.repA, { opportunityId: w.deal.id }, { types: ["CALL", "NOTE"] })).map((i) => i.type).sort()).toEqual(["CALL", "NOTE"]);

    const person = await timeline(w.repA, { contactId: w.contact.id });
    expect(person.map((i) => i.type).sort()).toEqual(["CALL", "CONSENT"]);
    expect(person.find((i) => i.type === "CONSENT")?.title).toBe("Marketing consent granted (whatsapp)");
    expect(JSON.stringify(person)).not.toContain("Signed form"); // the consent evidence stays out of the timeline

    const account = await timeline(w.repA, { accountId: w.account.id }); // the account sees its contacts' and deals' history too
    expect(account.map((i) => i.type)).toEqual(expect.arrayContaining(["CALL", "NOTE", "STAGE", "QUOTE", "HANDOVER", "CONSENT"]));
    expect(new Set(account.map((i) => i.id)).size).toBe(account.length);

    await logActivity(w.repA, { kind: "NOTE", leadId: w.lead.id, body: "Lead note" });
    expect((await timeline(w.repA, { leadId: w.lead.id })).map((i) => i.title)).toEqual(["Note"]);
    await expect(timeline(w.repA, { leadId: w.lead.id, contactId: w.contact.id })).rejects.toThrow(/one lead, contact, account or deal/i);
  });

  it("never shows another salesperson's records on an account the viewer can see only in part", async () => {
    const w = await world();
    await logActivity(w.repA, { kind: "NOTE", opportunityId: w.deal.id, body: "Rep A's deal note" });
    const bAccount = await createAccount(w.repB, { name: "Ikoyi Towers" });
    expect((await timeline(w.repB, { accountId: bAccount.id })).length).toBe(0);
    await expect(timeline(w.repB, { accountId: w.account.id })).rejects.toThrow(/not found/i);
  });
});

describe("mistakes: voided, never deleted or rewritten", () => {
  it("is voided with a reason by its maker or a manager, stays on the timeline struck through, and the database refuses to delete or rewrite it", async () => {
    const w = await world();
    const a = await logActivity(w.repA, { kind: "NOTE", contactId: w.contact.id, body: "Wrong person" });
    await expect(voidActivity(w.repA, a.id, "")).rejects.toThrow(/reason/i);
    await expect(voidActivity(w.repB, a.id, "Not mine")).rejects.toThrow(/not found/i);
    await voidActivity(w.repA, a.id, "Logged on the wrong contact");
    await expect(voidActivity(w.admin, a.id, "again")).rejects.toThrow(/already voided/i);
    const item = (await timeline(w.repA, { contactId: w.contact.id }))[0];
    expect(item).toMatchObject({ voided: true, detail: "Voided by " + w.repA.name + ": Logged on the wrong contact" });
    await expect(db.crmActivity.delete({ where: { id: a.id } })).rejects.toThrow(/cannot be deleted/i);
    const b = await logActivity(w.repA, { kind: "NOTE", contactId: w.contact.id, body: "Original words" });
    await expect(db.crmActivity.update({ where: { id: b.id }, data: { body: "Rewritten" } })).rejects.toThrow(/cannot be changed/i);
    await voidActivity(w.admin, b.id, "Duplicate"); // a manager may void someone else's
    await expect(db.crmActivity.update({ where: { id: b.id }, data: { voidReason: "edited" } })).rejects.toThrow(/voided activity cannot be changed/i);
  });
});

describe("tasks", () => {
  const due = (hours: number) => iso(new Date(Date.now() + hours * 3_600_000));

  it("belongs to one person, is about a record they can see, and a manager may give one to someone else", async () => {
    const w = await world();
    const t = await createTask(w.repA, { title: "Send the proposal", dueAt: due(24), opportunityId: w.deal.id, reminderAt: due(20) });
    expect(t).toMatchObject({ status: "OPEN", ownerUserId: w.repA.userId, opportunityId: w.deal.id, accountId: w.account.id });
    await expect(createTask(w.repA, { title: "For B", dueAt: due(2), ownerUserId: w.repB.userId })).rejects.toThrow(/manager/i);
    await expect(createTask(w.repB, { title: "On A's deal", dueAt: due(2), opportunityId: w.deal.id })).rejects.toThrow(/not found/i);
    await expect(createTask(w.repA, { title: "x", dueAt: due(2) })).rejects.toThrow(/say what the task is/i);
    await expect(createTask(w.repA, { title: "Bad reminder", dueAt: due(2), reminderAt: due(5) })).rejects.toThrow(/reminder cannot be after/i);
    const assigned = await createTask(w.admin, { title: "Follow up with Funmi", dueAt: due(3), ownerUserId: w.repB.userId });
    expect(assigned.ownerUserId).toBe(w.repB.userId);
    await expect(createTask(w.ops, { title: "Ops task", dueAt: due(2) })).rejects.toThrow(/permission/i);
  });

  it("finishing a task on a deal counts as activity on the deal; only the owner or a manager can finish, reopen or cancel it", async () => {
    const w = await world();
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { lastActivityAt: ago(30) } });
    const t = await createTask(w.repA, { title: "Call the estate manager", dueAt: due(1), opportunityId: w.deal.id });
    await expect(completeTask(w.repB, t.id)).rejects.toThrow(/not found/i);
    const done = await completeTask(w.repA, t.id);
    expect(done).toMatchObject({ status: "DONE", completedBy: w.repA.name });
    expect(Date.now() - (await db.crmOpportunity.findUniqueOrThrow({ where: { id: w.deal.id } })).lastActivityAt.getTime()).toBeLessThan(60_000);
    await expect(completeTask(w.repA, t.id)).rejects.toThrow(/only an open task/i);
    expect((await reopenTask(w.repA, t.id)).status).toBe("OPEN");
    expect((await cancelTask(w.admin, t.id)).status).toBe("CANCELLED"); // a manager may
    await expect(cancelTask(w.repA, t.id)).rejects.toThrow(/only an open task/i);
  });

  it("is listed as overdue, today, this week and later in Lagos time; a manager can ask for everyone's; the tasks about a record are listed on it", async () => {
    const w = await world();
    const now = new Date("2026-10-29T10:00:00Z"); // 11:00 on Thursday in Lagos
    const mk = (title: string, at: string, over: Partial<{ ownerUserId: string; opportunityId: string }> = {}) => createTask(over.ownerUserId ? w.admin : w.repA, { title, dueAt: at, ...over });
    await mk("yesterday", "2026-10-28T14:00:00Z", { opportunityId: w.deal.id });
    await mk("later today", "2026-10-29T15:00:00Z");
    await mk("friday", "2026-10-30T10:00:00Z");
    await mk("next monday", "2026-11-02T10:00:00Z");
    await mk("B's task", "2026-10-29T16:00:00Z", { ownerUserId: w.repB.userId });
    const mine = await myTasks(w.repA, { now });
    expect(mine.overdue.map((x) => x.title)).toEqual(["yesterday"]);
    expect(mine.today.map((x) => x.title)).toEqual(["later today"]);
    expect(mine.thisWeek.map((x) => x.title)).toEqual(["friday"]);
    expect(mine.later.map((x) => x.title)).toEqual(["next monday"]);
    expect(mine.overdue[0].opportunity?.name).toBe("24/7 guarding, 2 sites");
    await expect(myTasks(w.repA, { scope: "all", now })).rejects.toThrow(/manager/i);
    expect((await myTasks(w.admin, { scope: "all", now })).today.map((x) => x.title).sort()).toEqual(["B's task", "later today"]);
    expect((await tasksFor(w.repA, { opportunityId: w.deal.id })).map((x) => x.title)).toEqual(["yesterday"]);
    await expect(tasksFor(w.repB, { opportunityId: w.deal.id })).rejects.toThrow(/not found/i);
  });
});

describe("the daily digest", () => {
  it("holds what is overdue, due today, reminded today and gone quiet, for one person", async () => {
    const w = await world();
    const now = new Date("2026-10-29T10:00:00Z");
    await createTask(w.repA, { title: "Overdue one", dueAt: "2026-10-28T10:00:00Z" });
    await createTask(w.repA, { title: "Due today", dueAt: "2026-10-29T15:00:00Z" });
    await createTask(w.repA, { title: "Due next week, remind today", dueAt: "2026-11-05T10:00:00Z", reminderAt: "2026-10-29T07:00:00Z" });
    await createTask(w.repA, { title: "Due next week", dueAt: "2026-11-05T10:00:00Z" });
    await createTask(w.repB, { title: "Someone else's", dueAt: "2026-10-28T10:00:00Z" });
    await db.crmOpportunity.update({ where: { id: w.deal.id }, data: { lastActivityAt: new Date("2026-10-01T10:00:00Z") } });
    const d = await digestFor(w.t.org.id, w.repA.userId, now);
    expect(d.overdue.map((x) => x.title)).toEqual(["Overdue one"]);
    expect(d.today.map((x) => x.title)).toEqual(["Due today"]);
    expect(d.reminders.map((x) => x.title)).toEqual(["Due next week, remind today"]);
    expect(d.rotting).toEqual([expect.objectContaining({ name: "24/7 guarding, 2 sites", daysQuiet: 28 })]);
    expect(d.empty).toBe(false);
    expect((await digestFor(w.t.org.id, w.admin.userId, now)).empty).toBe(true);
  });

  it("is emailed once a day to each sales person who has something in it, and never twice, even if the job runs again", async () => {
    const w = await world();
    const now = new Date("2026-10-29T06:00:00Z");
    await createTask(w.repA, { title: "Overdue one", dueAt: "2026-10-28T10:00:00Z" });
    await sendSalesDigests(now, { orgId: w.t.org.id });
    const mine = () => mail.mock.calls.filter((c) => c[0].to === w.repA.email);
    expect(mine()).toHaveLength(1);
    expect(mine()[0][0].text).toContain("Overdue one");
    expect(mail.mock.calls.filter((c) => c[0].to === w.repB.email || c[0].to === w.ops.email)).toHaveLength(0); // nothing to say, nothing sent
    const again = await sendSalesDigests(now, { orgId: w.t.org.id });
    expect(again.sent).toBe(0);
    expect(mine()).toHaveLength(1);
    await sendSalesDigests(new Date("2026-10-30T06:00:00Z"), { orgId: w.t.org.id }); // the next day it is sent again
    expect(mine()).toHaveLength(2);
    expect(await db.crmDigestRun.count({ where: { organizationId: w.t.org.id } })).toBe(2);
  });

  it("is tried again if the send fails (the day's record is removed)", async () => {
    const w = await world();
    await createTask(w.repA, { title: "Overdue one", dueAt: "2026-10-28T10:00:00Z" });
    mail.mockRejectedValueOnce(new Error("provider down"));
    await expect(sendSalesDigests(new Date("2026-10-29T06:00:00Z"), { orgId: w.t.org.id })).rejects.toThrow(/provider down/);
    expect(await db.crmDigestRun.count({ where: { organizationId: w.t.org.id } })).toBe(0);
    expect((await sendSalesDigests(new Date("2026-10-29T06:00:00Z"), { orgId: w.t.org.id })).sent).toBe(1);
  });

  it("is not sent for an organization that has the module switched off", async () => {
    const w = await world();
    await createTask(w.repA, { title: "Overdue one", dueAt: "2026-10-28T10:00:00Z" });
    await updateSalesSetting(w.admin, { enabled: false });
    expect((await sendSalesDigests(new Date("2026-10-29T06:00:00Z"), { orgId: w.t.org.id })).sent).toBe(0);
  });
});

describe("the audit log", () => {
  it("holds ids, the kind and the purpose, but never what was said, written, asked, or the person's details", async () => {
    const w = await world();
    await consent(w, "GRANTED");
    await logActivity(w.repA, { kind: "NOTE", contactId: w.contact.id, body: "Confidential remark about the estate manager" });
    await sendEmailTo(w.repA, { contactId: w.contact.id, subject: "Secret subject line", body: "Secret body text", purpose: "MARKETING" });
    const t = await createTask(w.repA, { title: "Secret task title", notes: "Secret task notes", dueAt: iso(new Date(Date.now() + 3_600_000)), contactId: w.contact.id });
    await completeTask(w.repA, t.id);
    const a = await logActivity(w.repA, { kind: "NOTE", contactId: w.contact.id, body: "Another" });
    await voidActivity(w.repA, a.id, "Secret void reason");
    const rows = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SALES_ACTIVITY" } } });
    const tasks = await db.auditLog.findMany({ where: { organizationId: w.t.org.id, action: { startsWith: "SALES_TASK" } } });
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(tasks.map((r) => r.action).sort()).toEqual(["SALES_TASK_COMPLETE", "SALES_TASK_CREATE"]);
    const text = JSON.stringify([...rows, ...tasks].map((r) => [r.oldValue, r.newValue, r.reason]));
    for (const secret of ["Confidential", "Secret", "Funmi", "Bello", "funmi@lekki.test", "2348031234567"]) expect(text).not.toContain(secret);
    expect(rows.find((r) => r.action === "SALES_ACTIVITY_LOG" && (r.newValue as { kind?: string })?.kind === "EMAIL")?.newValue).toMatchObject({ kind: "EMAIL", purpose: "MARKETING", contactId: w.contact.id });
  });
});
