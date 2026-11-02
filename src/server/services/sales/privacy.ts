/**
 * Privacy in the sales module (the Nigeria Data Protection Act 2023): the unsubscribe link in every marketing message and the public page behind it, requests from a
 * person about the data held on them (a copy, erasure), and review of old leads. Wording, the response time and the retention period are for a lawyer to confirm.
 *
 * Erasure ANONYMISES: the contact or lead stays (deals, cases and the audit log keep their links) but holds no personal detail, and their addresses go on the
 * suppression list as keyed hashes so they are never marketed to again. It runs in one transaction; the immutable tables (consents, activities, case and handover
 * history) allow a change to their PERSONAL columns only while that transaction has set the database flag `app.crm_erasure`. Audit entries carry ids and counts,
 * never what was removed. Free text elsewhere that might mention the person cannot be found with certainty, so a list of records to review is kept, not a claim they are clean.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { signUnsubscribe, suppressionHash, verifyUnsubscribe, type UnsubscribeSubject } from "@/lib/sales/privacy";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { clearBeatSiteContact } from "../clients";
import { nextNumber } from "../numbering";
import { requireSales } from "./access";
import { addSuppression, identifiersOf, isSuppressed, signingSecret, type Identifier } from "./suppression";

const TX = { timeout: 30_000, maxWait: 10_000 };
export const RESPONSE_DAYS = 30;
const DAY = 86_400_000;
const CAP = 200;

/** Today in Lagos (UTC+1) as a date. */
const today = () => new Date(`${new Date(Date.now() + 3_600_000).toISOString().slice(0, 10)}T00:00:00.000Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

// ─────────────────────────────── the unsubscribe link ───────────────────────────────

/** The public address links point to. In production it must be set: a marketing message is never sent without a working link. */
export function appBase(): string {
  const url = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (url) return url;
  if (process.env.NODE_ENV === "production") throw new BusinessError("The app's public address (APP_URL) is not set, so a marketing message cannot carry its unsubscribe link. Ask your administrator to set it.");
  return "http://localhost:3000";
}

export const unsubscribeUrl = (orgId: string, who: { type: "CONTACT" | "LEAD"; id: string }) => `${appBase()}/unsubscribe/${signUnsubscribe(signingSecret(), { orgId, ...who })}`;

/** The address mail programs POST to for one-click unsubscribe (List-Unsubscribe-Post); a person opening it in a browser is sent on to the page. */
export const unsubscribeApiUrl = (orgId: string, who: { type: "CONTACT" | "LEAD"; id: string }) => `${appBase()}/api/unsubscribe/${signUnsubscribe(signingSecret(), { orgId, ...who })}`;

/** The text and html a marketing email ends with. */
export function marketingFooter(url: string) {
  return { text: `\n\n--\nYou are receiving this because you were in touch with us. To stop receiving marketing messages, open: ${url}`, html: `<hr><p style="font-size:12px;color:#666">You are receiving this because you were in touch with us. <a href="${url}">Unsubscribe</a> from marketing messages.</p>` };
}

/** What a marketing WhatsApp must contain: the person's own unsubscribe link. */
export const WHATSAPP_NEEDS_LINK = "A marketing WhatsApp message must end with the person's unsubscribe link. Add it to the message.";

/**
 * Opening the link withdraws the person's marketing consent and suppresses their addresses, at once and without a login. Opening it again changes nothing. A link that is not
 * valid does nothing; a valid one for a record that no longer exists looks the same as any other, so the page reveals nothing about who is on file.
 */
export async function unsubscribe(token: string): Promise<{ status: "done" | "invalid" }> {
  const who: UnsubscribeSubject | null = verifyUnsubscribe(signingSecret(), token);
  if (!who) return { status: "invalid" };
  const org = who.orgId;
  const sys: Ctx = { userId: "system:unsubscribe", orgId: org, role: "COMPANY_ADMIN", name: "Unsubscribe link", email: "", employeeId: null };
  await db.$transaction(async (tx: Tx) => {
    const rec = who.type === "CONTACT"
      ? await tx.crmContact.findFirst({ where: { id: who.id, organizationId: org }, select: { id: true, erasedAt: true, email: true, phoneE164: true, whatsappE164: true } })
      : await tx.crmLead.findFirst({ where: { id: who.id, organizationId: org }, select: { id: true, erasedAt: true, email: true, phoneE164: true } });
    if (!rec || rec.erasedAt) return;
    const key = who.type === "CONTACT" ? { contactId: rec.id } : { leadId: rec.id };
    const latest = await tx.crmConsent.findFirst({ where: { organizationId: org, ...key, purpose: "MARKETING" }, orderBy: { seq: "desc" }, select: { status: true } });
    await addSuppression(tx, org, identifiersOf(rec), "UNSUBSCRIBED", "unsubscribe link");
    if (latest?.status === "WITHDRAWN") return;
    const row = await tx.crmConsent.create({ data: { organizationId: org, ...key, purpose: "MARKETING", status: "WITHDRAWN", channel: "WEB_FORM", source: "Unsubscribe link in a message", recordedBy: sys.name, recordedByUserId: sys.userId } });
    await logAudit(sys, { action: "SALES_UNSUBSCRIBE", entity: "CrmConsent", entityId: row.id, newValue: { subjectType: who.type, subjectId: rec.id } }, tx);
  }, TX);
  return { status: "done" };
}

// ─────────────────────────────── data requests ───────────────────────────────

const openSchema = z.object({
  kind: z.enum(["ACCESS", "ERASURE"]),
  subjectType: z.enum(["CONTACT", "LEAD"]),
  subjectId: z.string().min(1),
  requesterName: z.string().trim().min(2, "Write who asked.").max(200),
  channel: z.string().trim().max(60).optional(),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-30").optional(),
});

/** Finds the person a request is about, in the caller's organization only. */
async function subject(orgId: string, type: string, id: string, tx: Tx | typeof db = db) {
  if (type === "CONTACT") {
    const c = await tx.crmContact.findFirst({ where: { id, organizationId: orgId } });
    return c ? ({ type: "CONTACT", row: c } as const) : null;
  }
  const l = await tx.crmLead.findFirst({ where: { id, organizationId: orgId } });
  return l ? ({ type: "LEAD", row: l } as const) : null;
}

export async function openRequest(ctx: Ctx, raw: z.input<typeof openSchema>) {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  const p = openSchema.safeParse(raw);
  if (!p.success) throw new BusinessError(p.error.issues[0].message);
  const v = p.data;
  const s = await subject(ctx.orgId, v.subjectType, v.subjectId);
  if (!s) throw new BusinessError(`${v.subjectType === "CONTACT" ? "Contact" : "Lead"} not found.`);
  if (s.row.erasedAt) throw new BusinessError("This person has already been erased.");
  const receivedOn = v.receivedOn ? new Date(`${v.receivedOn}T00:00:00.000Z`) : today();
  if (receivedOn.getTime() > today().getTime()) throw new BusinessError("The date received cannot be in the future.");
  return db.$transaction(async (tx: Tx) => {
    const number = await nextNumber(tx, ctx.orgId, "SALES_DSR");
    const made = await tx.crmDataRequest.create({
      data: { organizationId: ctx.orgId, number, kind: v.kind, subjectType: v.subjectType, subjectId: v.subjectId, requesterName: v.requesterName, channel: v.channel || null, receivedOn, dueOn: addDays(receivedOn, RESPONSE_DAYS), createdBy: ctx.name },
    });
    await logAudit(ctx, { action: "SALES_DSR_OPEN", entity: "CrmDataRequest", entityId: made.id, newValue: { number, kind: v.kind, subjectType: v.subjectType, subjectId: v.subjectId } }, tx);
    return made;
  }, TX);
}

async function loadRequest(ctx: Ctx, id: string, tx: Tx | typeof db = db) {
  const r = await tx.crmDataRequest.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Request not found.");
  return r;
}

export async function listRequests(ctx: Ctx) {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  const rows = await db.crmDataRequest.findMany({ where: { organizationId: ctx.orgId }, orderBy: [{ status: "asc" }, { dueOn: "asc" }], take: CAP });
  return rows.map((r) => ({ ...r, overdue: r.status === "OPEN" && r.dueOn.getTime() < today().getTime() }));
}

/** Records that the person asking was checked to be who they say (a person's judgement; the tool only records it, who and how). */
export async function verifyIdentity(ctx: Ctx, id: string, method: string) {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  if (!method?.trim() || method.trim().length < 5) throw new BusinessError("Say how the person's identity was checked (for example: called back on the number on file).");
  const r = await loadRequest(ctx, id);
  if (r.status !== "OPEN") throw new BusinessError("This request is closed.");
  await db.crmDataRequest.update({ where: { id }, data: { identityVerified: true, identityNote: method.trim().slice(0, 300), verifiedBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_DSR_VERIFY", entity: "CrmDataRequest", entityId: id });
}

/** A request is closed without action (for example, identity could not be confirmed). */
export async function refuseRequest(ctx: Ctx, id: string, reason: string) {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  if (!reason?.trim() || reason.trim().length < 5) throw new BusinessError("Give the reason the request is refused.");
  const r = await loadRequest(ctx, id);
  if (r.status !== "OPEN") throw new BusinessError("This request is closed.");
  await db.crmDataRequest.update({ where: { id }, data: { status: "REFUSED", completedOn: today(), outcomeNote: reason.trim().slice(0, 500), handledBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_DSR_REFUSE", entity: "CrmDataRequest", entityId: id });
}

// ─────────────────────────────── who "the person" is ───────────────────────────────

/** Every record that is the same person: a contact with the duplicates merged into it and the leads it was converted from, or a lead with the contact it became. */
async function closure(orgId: string, s: NonNullable<Awaited<ReturnType<typeof subject>>>, tx: Tx | typeof db) {
  const contactIds = new Set<string>();
  const leadIds = new Set<string>();
  if (s.type === "CONTACT") contactIds.add(s.row.id);
  else {
    leadIds.add(s.row.id);
    if (s.row.convertedContactId) contactIds.add(s.row.convertedContactId);
  }
  // duplicates merged into any of the contacts, and leads converted into any of them
  for (let round = 0; round < 3; round++) {
    const merged = await tx.crmContact.findMany({ where: { organizationId: orgId, mergedIntoId: { in: [...contactIds] } }, select: { id: true } });
    merged.forEach((m) => contactIds.add(m.id));
  }
  const leads = await tx.crmLead.findMany({ where: { organizationId: orgId, convertedContactId: { in: [...contactIds] } }, select: { id: true } });
  leads.forEach((l) => leadIds.add(l.id));
  const contacts = await tx.crmContact.findMany({ where: { organizationId: orgId, id: { in: [...contactIds] } } });
  const leadRows = await tx.crmLead.findMany({ where: { organizationId: orgId, id: { in: [...leadIds] } } });
  return { contactIds: [...contactIds], leadIds: [...leadIds], contacts, leads: leadRows };
}

const idsOfPerson = (c: Awaited<ReturnType<typeof closure>>): Identifier[] => [...c.contacts.flatMap((x) => identifiersOf(x)), ...c.leads.flatMap((x) => identifiersOf(x))];

// ─────────────────────────────── a copy of everything held ───────────────────────────────

export interface Export {
  fileName: string;
  json: string;
  checksum: string;
  sections: Record<string, number>;
}

/** Everything held about the person, as one JSON file, with a checksum and how many records each section holds. Needs the identity to be verified first. */
export async function exportSubject(ctx: Ctx, requestId: string): Promise<Export> {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  const req = await loadRequest(ctx, requestId);
  if (req.status !== "OPEN") throw new BusinessError("This request is closed.");
  if (!req.identityVerified) throw new BusinessError("Check the person's identity first, and record how.");
  const s = await subject(ctx.orgId, req.subjectType, req.subjectId);
  if (!s) throw new BusinessError("Person not found.");
  const org = ctx.orgId;
  const c = await closure(org, s, db);
  const people = { OR: [{ contactId: { in: c.contactIds } }, { leadId: { in: c.leadIds } }] };
  const [consents, activities, tasks, cases, sites, deals, suppressed, siteRows] = await Promise.all([
    db.crmConsent.findMany({ where: { organizationId: org, ...people }, orderBy: { seq: "asc" }, select: { purpose: true, status: true, channel: true, source: true, evidenceRef: true, recordedBy: true, recordedAt: true } }),
    db.crmActivity.findMany({ where: { organizationId: org, ...people }, orderBy: { occurredAt: "asc" }, select: { kind: true, occurredAt: true, subject: true, body: true, callOutcome: true, survey: true, purpose: true, createdBy: true, voidedAt: true, voidReason: true } }),
    db.crmTask.findMany({ where: { organizationId: org, ...people }, orderBy: { dueAt: "asc" }, select: { title: true, notes: true, dueAt: true, status: true, ownerName: true } }),
    db.crmCase.findMany({ where: { organizationId: org, contactId: { in: c.contactIds } }, select: { number: true, subject: true, description: true, status: true, openedAt: true, events: { select: { kind: true, note: true, byName: true, at: true }, orderBy: { at: "asc" } } } }),
    siteContacts(org, idsOfPerson(c), db),
    db.crmOpportunity.findMany({ where: { organizationId: org, primaryContactId: { in: c.contactIds } }, select: { name: true, stage: { select: { name: true } }, createdAt: true } }),
    isSuppressed(org, idsOfPerson(c)),
    siteContacts(org, idsOfPerson(c), db),
  ]);
  // the contact text a handover copied onto the operational site (the client's site record in operations)
  const operationalSites = await db.beat.findMany({ where: { organizationId: org, id: { in: siteRows.map((x) => x.beatId).filter((x): x is string => !!x) }, siteContact: { not: null } }, select: { name: true, siteContact: true } });
  const data = {
    generatedOn: new Date().toISOString(),
    request: req.number,
    contacts: c.contacts.map((x) => ({ firstName: x.firstName, lastName: x.lastName, jobTitle: x.jobTitle, phone: x.phoneE164, whatsapp: x.whatsappE164, email: x.email, status: x.status, createdAt: x.createdAt })),
    leads: c.leads.map((x) => ({ number: x.number, company: x.companyName, contactName: x.contactName, jobTitle: x.jobTitle, phone: x.phoneE164, email: x.email, address: x.address, status: x.status, createdAt: x.createdAt })),
    consents, activities, tasks,
    cases: cases.map(({ events, ...rest }) => ({ ...rest, history: events })),
    siteContacts: sites.map((x) => ({ handover: x.handoverNumber, site: x.site, name: x.contactName, role: x.contactRole, phone: x.contactPhoneE164, email: x.contactEmail })),
    operationalSites: operationalSites.map((b) => ({ site: b.name, siteContact: b.siteContact })),
    deals: deals.map((d) => ({ name: d.name, stage: d.stage?.name ?? null, createdAt: d.createdAt })),
    onSuppressionList: suppressed,
  };
  const json = JSON.stringify(data, null, 2);
  const checksum = createHash("sha256").update(json).digest("hex");
  const sections = { contacts: c.contacts.length, leads: c.leads.length, consents: consents.length, activities: activities.length, tasks: tasks.length, cases: cases.length, siteContacts: sites.length, operationalSites: operationalSites.length, deals: deals.length };
  await db.crmDataRequest.update({ where: { id: requestId }, data: { exportedAt: new Date(), exportChecksum: checksum, exportSections: sections, handledBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_DSR_EXPORT", entity: "CrmDataRequest", entityId: requestId, newValue: { sections } });
  return { fileName: `data-request-${req.number}.json`, json, checksum, sections };
}

/** Handover sites whose client contact is this person (matched on phone or email). */
async function siteContacts(orgId: string, ids: Identifier[], tx: Tx | typeof db) {
  const emails = ids.filter((i) => i.kind === "EMAIL").map((i) => i.value);
  const phones = ids.filter((i) => i.kind === "PHONE").map((i) => i.value);
  if (!emails.length && !phones.length) return [];
  const where: Prisma.CrmHandoverSiteWhereInput = { OR: [...(phones.length ? [{ contactPhoneE164: { in: phones } }] : []), ...emails.map((e) => ({ contactEmail: { equals: e, mode: "insensitive" as const } }))] };
  const rows = await tx.crmHandoverSite.findMany({ where: { handover: { organizationId: orgId }, ...where }, select: { id: true, name: true, beatId: true, contactName: true, contactRole: true, contactPhoneE164: true, contactEmail: true, handover: { select: { number: true } } } });
  return rows.map((r) => ({ id: r.id, beatId: r.beatId, site: r.name, handoverNumber: r.handover.number, contactName: r.contactName, contactRole: r.contactRole, contactPhoneE164: r.contactPhoneE164, contactEmail: r.contactEmail }));
}

// ─────────────────────────────── erasure ───────────────────────────────

export interface ErasureResult {
  counts: Record<string, number>;
  review: Record<string, string[]>;
}

/**
 * The anonymising itself, inside the caller's transaction. The suppression is added BEFORE the addresses are removed. The flag that lets the guards allow a change to personal
 * columns is set for this transaction only.
 */
async function eraseInTx(tx: Tx, ctx: Ctx, s: NonNullable<Awaited<ReturnType<typeof subject>>>, requestNumber: string): Promise<ErasureResult> {
  const org = ctx.orgId;
  const c = await closure(org, s, tx);
  const ids = idsOfPerson(c);
  const now = new Date();
  const reason = `Erased on data request ${requestNumber}`;
  const counts: Record<string, number> = {};

  await addSuppression(tx, org, ids, "ERASED", requestNumber);
  // a record already on the list for another reason keeps that row; the erased reason must win so it is never lifted
  if (ids.length) {
    const secret = signingSecret();
    await tx.crmSuppression.updateMany({ where: { organizationId: org, OR: ids.map((i) => ({ kind: i.kind, valueHash: suppressionHash(secret, org, i.kind, i.value) })) }, data: { reason: "ERASED", source: requestNumber } });
  }

  // the review list is built before anything is blanked: records that may still mention the person in free text
  const accountIds = [...new Set(c.contacts.map((x) => x.accountId).filter((x): x is string => !!x))];
  const dealRows = await tx.crmOpportunity.findMany({ where: { organizationId: org, OR: [{ primaryContactId: { in: c.contactIds } }, { accountId: { in: accountIds } }] }, select: { id: true }, take: CAP });
  const dealIds = dealRows.map((d) => d.id);
  const review: Record<string, string[]> = {
    deals: dealIds,
    // written by automation rules, which put the contact's first name in the text; not linked to the person, so the tool cannot be sure they are about them
    dealTasks: dealIds.length
      ? (await tx.crmTask.findMany({ where: { organizationId: org, opportunityId: { in: dealIds }, OR: [{ contactId: null }, { contactId: { notIn: c.contactIds } }] }, select: { id: true }, take: CAP })).map((x) => x.id)
      : [],
    dealNotifications: dealIds.length
      ? (await tx.crmNotification.findMany({ where: { organizationId: org, href: { in: dealIds.map((id) => `/sales/opportunities/${id}`) } }, select: { id: true }, take: CAP })).map((x) => x.id)
      : [],
    accountAndDealActivities: (await tx.crmActivity.findMany({
      where: {
        organizationId: org,
        AND: [
          { OR: [{ contactId: null }, { contactId: { notIn: c.contactIds } }] },
          { OR: [{ leadId: null }, { leadId: { notIn: c.leadIds } }] },
          { OR: [{ accountId: { in: accountIds } }, { opportunityId: { in: dealIds } }] },
          { OR: [{ body: { not: null } }, { subject: { not: null } }] },
        ],
      },
      select: { id: true },
      take: CAP,
    })).map((x) => x.id),
    cases: (await tx.crmCase.findMany({ where: { organizationId: org, accountId: { in: accountIds }, OR: [{ contactId: null }, { contactId: { notIn: c.contactIds } }] }, select: { id: true }, take: CAP })).map((x) => x.id),
    handoverNotes: dealIds.length ? (await tx.crmHandoverEvent.findMany({ where: { organizationId: org, note: { not: null }, handover: { opportunityId: { in: dealIds } } }, select: { id: true }, take: CAP })).map((x) => x.id) : [],
  };

  const sites = await siteContacts(org, ids, tx);
  // F-01: a handover copied each site's contact as text onto the operational site record. It is cleared only if it still names the person (an address or number of theirs, or the
  // contact's name); text someone has since rewritten is left alone and listed for review.
  const matchers = [...ids.map((i) => i.value.toLowerCase()), ...sites.map((x) => x.contactName?.trim().toLowerCase()).filter((n): n is string => !!n && n.length >= 3)];
  counts.operationalSites = 0;
  review.operationalSites = [];
  for (const beatId of new Set(sites.map((x) => x.beatId).filter((x): x is string => !!x))) {
    const beat = await tx.beat.findFirst({ where: { id: beatId, organizationId: org }, select: { siteContact: true } });
    if (!beat?.siteContact) continue;
    if (matchers.some((m) => beat.siteContact!.toLowerCase().includes(m))) {
      if (await clearBeatSiteContact(tx, ctx, beatId, requestNumber)) counts.operationalSites++;
    } else review.operationalSites.push(beatId);
  }
  await tx.$queryRaw`SELECT set_config('app.crm_erasure', 'on', true)`;
  const people = { OR: [{ contactId: { in: c.contactIds } }, { leadId: { in: c.leadIds } }] };

  counts.consents = (await tx.crmConsent.updateMany({ where: { organizationId: org, ...people }, data: { source: "Erased", evidenceRef: null } })).count;
  counts.activities = (await tx.crmActivity.updateMany({ where: { organizationId: org, ...people }, data: { subject: null, body: null, survey: Prisma.DbNull } })).count;
  counts.tasks = (await tx.crmTask.updateMany({ where: { organizationId: org, ...people }, data: { title: "Erased", notes: null } })).count;
  const cases = await tx.crmCase.findMany({ where: { organizationId: org, contactId: { in: c.contactIds } }, select: { id: true } });
  counts.cases = (await tx.crmCase.updateMany({ where: { id: { in: cases.map((x) => x.id) } }, data: { subject: "Erased", description: null } })).count;
  counts.caseNotes = (await tx.crmCaseEvent.updateMany({ where: { organizationId: org, caseId: { in: cases.map((x) => x.id) } }, data: { note: null } })).count;
  counts.siteContacts = sites.length
    ? (await tx.crmHandoverSite.updateMany({ where: { id: { in: sites.map((x) => x.id) } }, data: { contactName: null, contactRole: null, contactPhoneE164: null, contactEmail: null } })).count
    : 0;
  counts.contacts = (await tx.crmContact.updateMany({
    where: { organizationId: org, id: { in: c.contactIds } },
    data: { firstName: "Erased", lastName: "Contact", jobTitle: null, phoneE164: null, whatsappE164: null, email: null, isPrimary: false, status: "VOID", voidedAt: now, voidedBy: ctx.name, voidReason: reason, erasedAt: now },
  })).count;
  counts.leads = 0;
  for (const l of c.leads) {
    counts.leads += (await tx.crmLead.updateMany({
      where: { id: l.id, organizationId: org },
      data: {
        contactName: null, jobTitle: null, phoneE164: null, email: null, address: null, unqualifiedReason: null, erasedAt: now,
        ...(l.status === "CONVERTED" || l.status === "VOID" ? {} : { status: "VOID" as const, voidedAt: now, voidedBy: ctx.name, voidReason: reason }),
      },
    })).count;
  }
  // every request about this person no longer names who asked
  await tx.crmDataRequest.updateMany({ where: { organizationId: org, OR: [...c.contactIds.map((id) => ({ subjectType: "CONTACT", subjectId: id })), ...c.leadIds.map((id) => ({ subjectType: "LEAD", subjectId: id }))] }, data: { requesterName: "Erased", identityNote: null } });
  return { counts, review };
}

/** Erases the person a request is about. Needs a verified identity and the company administrator's permission. */
export async function eraseSubject(ctx: Ctx, requestId: string, outcomeNote?: string) {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  const req = await loadRequest(ctx, requestId);
  if (req.status !== "OPEN") throw new BusinessError("This request is closed.");
  if (req.kind !== "ERASURE") throw new BusinessError("This request is for a copy of the data, not for erasure.");
  if (!req.identityVerified) throw new BusinessError("Check the person's identity first, and record how.");
  const out = await db.$transaction(async (tx: Tx) => {
    const s = await subject(ctx.orgId, req.subjectType, req.subjectId, tx);
    if (!s) throw new BusinessError("Person not found.");
    if (s.row.erasedAt) throw new BusinessError("This person has already been erased.");
    const r = await eraseInTx(tx, ctx, s, req.number);
    await tx.crmDataRequest.update({ where: { id: requestId }, data: { status: "COMPLETED", completedOn: today(), handledBy: ctx.name, reviewList: r.review, outcomeNote: outcomeNote?.trim().slice(0, 500) || null } });
    await logAudit(ctx, { action: "SALES_DSR_ERASE", entity: "CrmDataRequest", entityId: requestId, newValue: { number: req.number, subjectType: req.subjectType, subjectId: req.subjectId, counts: r.counts } }, tx);
    return r;
  }, TX);
  return out;
}

/** A copy request is closed once the file has been sent to the person. */
export async function completeAccess(ctx: Ctx, requestId: string) {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  const req = await loadRequest(ctx, requestId);
  if (req.status !== "OPEN") throw new BusinessError("This request is closed.");
  if (req.kind !== "ACCESS") throw new BusinessError("This request is for erasure.");
  if (!req.exportedAt) throw new BusinessError("Download the person's data first.");
  await db.crmDataRequest.update({ where: { id: requestId }, data: { status: "COMPLETED", completedOn: today(), handledBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_DSR_COMPLETE", entity: "CrmDataRequest", entityId: requestId });
}

// ─────────────────────────────── retention ───────────────────────────────

const OPEN_LEAD = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED"] as const;

export async function setRetention(ctx: Ctx, months: number | null) {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) throw new BusinessError("Use a whole number of months from 1 to 120, or leave it empty for no review.");
  const before = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { leadRetentionMonths: true } });
  if (!before) throw new BusinessError("Switch the sales module on first.");
  await db.crmSetting.update({ where: { organizationId: ctx.orgId }, data: { leadRetentionMonths: months } });
  await logAudit(ctx, { action: "SALES_RETENTION_SET", entity: "CrmSetting", entityId: ctx.orgId, oldValue: { months: before.leadRetentionMonths }, newValue: { months } });
}

/** Leads not converted whose last activity (or creation) is older than the retention period, and not kept by a review. */
export async function retentionCandidates(ctx: Ctx) {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  const set = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { leadRetentionMonths: true } });
  const months = set?.leadRetentionMonths ?? null;
  if (!months) return { months: null, leads: [] as { id: string; number: string; companyName: string; lastTouched: Date }[] };
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const leads = await db.crmLead.findMany({
    where: { organizationId: ctx.orgId, status: { in: [...OPEN_LEAD] }, erasedAt: null, createdAt: { lt: cutoff }, OR: [{ retentionKeepUntil: null }, { retentionKeepUntil: { lt: today() } }] },
    select: { id: true, number: true, companyName: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: CAP,
  });
  const last = await db.crmActivity.groupBy({ by: ["leadId"], where: { organizationId: ctx.orgId, leadId: { in: leads.map((l) => l.id) } }, _max: { occurredAt: true } });
  const lastBy = new Map(last.map((g) => [g.leadId, g._max.occurredAt]));
  return {
    months,
    leads: leads
      .map((l) => ({ id: l.id, number: l.number, companyName: l.companyName, lastTouched: lastBy.get(l.id) ?? l.createdAt }))
      .filter((l) => l.lastTouched.getTime() < cutoff.getTime()),
  };
}

/** The reviewer decides to keep a lead for a further period. */
export async function keepLead(ctx: Ctx, leadId: string, months: number, reason: string) {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  if (!Number.isInteger(months) || months < 1 || months > 60) throw new BusinessError("Keep it for 1 to 60 months.");
  if (!reason?.trim() || reason.trim().length < 5) throw new BusinessError("Give the reason it is being kept.");
  const lead = await db.crmLead.findFirst({ where: { id: leadId, organizationId: ctx.orgId, erasedAt: null }, select: { id: true } });
  if (!lead) throw new BusinessError("Lead not found.");
  const until = new Date(today());
  until.setUTCMonth(until.getUTCMonth() + months);
  await db.crmLead.update({ where: { id: leadId }, data: { retentionKeepUntil: until } });
  await logAudit(ctx, { action: "SALES_RETENTION_KEEP", entity: "CrmLead", entityId: leadId, newValue: { months, until: until.toISOString().slice(0, 10) }, reason: reason.trim().slice(0, 300) });
}

/** Erases a lead that is past the retention period (recorded as a retention request, so it is in the register). */
export async function eraseForRetention(ctx: Ctx, leadId: string) {
  await requireSales(ctx, "sales.privacy.manage", { allowWhenOff: true });
  const due = await retentionCandidates(ctx);
  if (!due.leads.some((l) => l.id === leadId)) throw new BusinessError("This lead is not past the retention period, or has been kept, so it cannot be erased this way.");
  return db.$transaction(async (tx: Tx) => {
    const s = await subject(ctx.orgId, "LEAD", leadId, tx);
    if (!s) throw new BusinessError("Lead not found.");
    const number = await nextNumber(tx, ctx.orgId, "SALES_DSR");
    const r = await eraseInTx(tx, ctx, s, number);
    const made = await tx.crmDataRequest.create({
      data: { organizationId: ctx.orgId, number, kind: "RETENTION", subjectType: "LEAD", subjectId: leadId, requesterName: "Erased", receivedOn: today(), dueOn: today(), status: "COMPLETED", identityVerified: true, completedOn: today(), handledBy: ctx.name, reviewList: r.review, createdBy: ctx.name, outcomeNote: "Past the retention period" },
    });
    await logAudit(ctx, { action: "SALES_RETENTION_ERASE", entity: "CrmDataRequest", entityId: made.id, newValue: { number, subjectId: leadId, counts: r.counts } }, tx);
    return { number, ...r };
  }, TX);
}
