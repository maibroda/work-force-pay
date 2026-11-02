/**
 * The activity layer of the sales module: logging calls, meetings, site surveys, WhatsApp, emails and notes; one timeline of everything about a record; tasks and the
 * daily digest. Outbound WhatsApp and email carry a purpose, service or marketing, and marketing is refused unless the person's latest marketing consent is "granted"
 * (checked here, on the server, before an email is sent or a link is opened); a "service" label is accepted only for someone at an account that is a client, so the label
 * cannot be used to get round consent. Activities are never deleted and never edited (the database refuses): a mistaken one is voided with a reason. Audit entries carry
 * ids, the kind and the purpose, never what was said, so a person can be erased without touching the audit log.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { sendEmail } from "@/lib/email";
import { filterTimeline, groupTasks, mergeTimeline, surveySchema, watDayStart, type TimelineItem, type TimelineType } from "@/lib/sales/activity";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { ownerFilter, requireSales, resolveOwner, seesAll } from "./access";
import { canSendMarketing } from "./consent";
import { DEFAULT_ROTTING_DAYS } from "./deals";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OUTCOME_LABEL = { REACHED: "reached", NO_ANSWER: "no answer", CALLBACK: "call back", WRONG_NUMBER: "wrong number" } as const;

export const MARKETING_REFUSED = "Marketing messages can only go to someone who has agreed to them: their latest marketing consent must be granted. Record their consent first, or, if this is about an active contract with a client, send it as a service message.";
export const SERVICE_REFUSED = "A service message is for someone at a client with an active contract. This person is not at a client, so it can only be sent as marketing, which needs their consent.";

type Target = { leadId?: string; accountId?: string; contactId?: string; opportunityId?: string };

// ─────────────────────────────── who a thing is about ───────────────────────────────

/** Finds each record named (only if the caller may see it) and fills in the account from the contact or deal. */
export async function resolveTarget(ctx: Ctx, tx: Tx | typeof db, t: Target, opts: { readOnly?: boolean } = {}) {
  if (!t.leadId && !t.accountId && !t.contactId && !t.opportunityId) throw new BusinessError("Say who or what this is about: a lead, a contact, an account or a deal.");
  const f = ownerFilter(ctx);
  const lead = t.leadId ? await tx.crmLead.findFirst({ where: { id: t.leadId, organizationId: ctx.orgId, ...f } }) : null;
  if (t.leadId && !lead) throw new BusinessError("Lead not found.");
  if (!opts.readOnly && lead?.status === "VOID") throw new BusinessError("A voided lead cannot be changed.");
  if (!opts.readOnly && lead?.status === "CONVERTED") throw new BusinessError("This lead was converted: log it on the account, contact or deal it became.");
  const contact = t.contactId ? await tx.crmContact.findFirst({ where: { id: t.contactId, organizationId: ctx.orgId, ...f } }) : null;
  if (t.contactId && !contact) throw new BusinessError("Contact not found.");
  if (!opts.readOnly && contact?.status === "VOID") throw new BusinessError("A voided contact cannot be changed.");
  const account = t.accountId ? await tx.crmAccount.findFirst({ where: { id: t.accountId, organizationId: ctx.orgId, ...f } }) : null;
  if (t.accountId && !account) throw new BusinessError("Account not found.");
  const opp = t.opportunityId ? await tx.crmOpportunity.findFirst({ where: { id: t.opportunityId, organizationId: ctx.orgId, ...f } }) : null;
  if (t.opportunityId && !opp) throw new BusinessError("Deal not found.");
  return { leadId: lead?.id ?? null, contactId: contact?.id ?? null, opportunityId: opp?.id ?? null, accountId: account?.id ?? contact?.accountId ?? opp?.accountId ?? null, lead, contact, opp };
}

/** Refuses a marketing message to someone who has not agreed, and a "service" label for someone who is not at a client. */
export async function assertMayMessage(ctx: Ctx, tx: Tx | typeof db, r: Awaited<ReturnType<typeof resolveTarget>>, purpose: "SERVICE" | "MARKETING") {
  const person = r.contactId ? { contactId: r.contactId } : r.leadId ? { leadId: r.leadId } : null;
  if (!person) throw new BusinessError("Choose the contact or lead this message is for.");
  if (purpose === "MARKETING") {
    if (!(await canSendMarketing(ctx, person))) throw new BusinessError(MARKETING_REFUSED);
    return;
  }
  const acct = r.accountId ? await tx.crmAccount.findFirst({ where: { id: r.accountId, organizationId: ctx.orgId }, select: { accountType: true } }) : null;
  if (acct?.accountType !== "CLIENT") throw new BusinessError(SERVICE_REFUSED);
}

// ─────────────────────────────── logging an activity ───────────────────────────────

const text = (max: number) => z.string().trim().max(max).optional();
export const activitySchema = z.object({
  kind: z.enum(["CALL", "MEETING", "SITE_SURVEY", "WHATSAPP", "EMAIL", "NOTE"]),
  leadId: z.string().optional(),
  accountId: z.string().optional(),
  contactId: z.string().optional(),
  opportunityId: z.string().optional(),
  occurredAt: z.string().datetime({ offset: true, message: "Use a date and time like 2026-10-30T14:30:00+01:00" }).optional(),
  subject: text(200),
  body: text(4000),
  callOutcome: z.enum(["REACHED", "NO_ANSWER", "CALLBACK", "WRONG_NUMBER"]).optional(),
  survey: surveySchema.optional(),
  purpose: z.enum(["SERVICE", "MARKETING"]).optional(),
  /** Set when the activity was logged by using a call or WhatsApp link. */
  viaLink: z.boolean().optional(),
});
export type ActivityInput = z.input<typeof activitySchema>;

async function insertActivity(ctx: Ctx, tx: Tx, v: z.output<typeof activitySchema>, r: Awaited<ReturnType<typeof resolveTarget>>) {
  const occurredAt = v.occurredAt ? new Date(v.occurredAt) : new Date();
  const message = v.kind === "WHATSAPP" || v.kind === "EMAIL";
  const a = await tx.crmActivity.create({
    data: {
      organizationId: ctx.orgId, kind: v.kind, leadId: r.leadId, accountId: r.accountId, contactId: r.contactId, opportunityId: r.opportunityId, occurredAt,
      subject: v.subject || null, body: v.body || null, callOutcome: v.kind === "CALL" ? (v.callOutcome ?? null) : null,
      survey: v.kind === "SITE_SURVEY" ? (v.survey as Prisma.InputJsonValue) : Prisma.DbNull, purpose: message ? v.purpose : null, viaLink: v.viaLink ?? false,
      createdBy: ctx.name, createdByUserId: ctx.userId,
    },
  });
  if (r.opportunityId) {
    // anything done on a deal counts as activity on it (a backdated entry never makes a deal look less recently worked)
    await tx.crmOpportunity.updateMany({ where: { id: r.opportunityId, lastActivityAt: { lt: occurredAt } }, data: { lastActivityAt: occurredAt } });
  }
  await logAudit(ctx, { action: "SALES_ACTIVITY_LOG", entity: "CrmActivity", entityId: a.id, newValue: { kind: v.kind, purpose: a.purpose, viaLink: a.viaLink, leadId: r.leadId, contactId: r.contactId, accountId: r.accountId, opportunityId: r.opportunityId } }, tx);
  return a;
}

function validate(raw: ActivityInput) {
  const p = activitySchema.safeParse(raw);
  if (!p.success) throw new BusinessError(p.error.issues[0].message);
  const v = p.data;
  const at = v.occurredAt ? new Date(v.occurredAt).getTime() : Date.now();
  if (at > Date.now() + 5 * 60_000) throw new BusinessError("An activity cannot be dated in the future. Use a task for something still to do.");
  if (v.kind === "CALL" && !v.callOutcome && !v.viaLink) throw new BusinessError("Say how the call went: reached, no answer, call back or wrong number.");
  if (v.kind === "SITE_SURVEY" && !v.survey) throw new BusinessError("Fill in the site survey checklist.");
  if (v.kind === "NOTE" && !v.body?.trim()) throw new BusinessError("Write the note.");
  if (v.kind === "MEETING" && !v.subject?.trim() && !v.body?.trim()) throw new BusinessError("Say what the meeting was about.");
  if ((v.kind === "WHATSAPP" || v.kind === "EMAIL") && !v.purpose) throw new BusinessError("Say whether this message is a service message or marketing.");
  return v;
}

/** Records something that happened. A WhatsApp or email marked as marketing is refused unless the person has agreed. */
export async function logActivity(ctx: Ctx, raw: ActivityInput) {
  await requireSales(ctx, "sales.manage");
  const v = validate(raw);
  return db.$transaction(async (tx: Tx) => {
    const r = await resolveTarget(ctx, tx, v);
    if ((v.kind === "WHATSAPP" || v.kind === "EMAIL") && !r.contactId && !r.leadId && r.opp?.primaryContactId) r.contactId = r.opp.primaryContactId;
    if (v.kind === "WHATSAPP" || v.kind === "EMAIL") await assertMayMessage(ctx, tx, r, v.purpose!);
    return insertActivity(ctx, tx, v, r);
  }, { timeout: 20_000, maxWait: 10_000 });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Sends an email to a contact or lead through the app's email channel and logs it. Marketing is refused, before anything is sent, unless the person has agreed. */
export async function sendEmailTo(ctx: Ctx, raw: { contactId?: string; leadId?: string; opportunityId?: string; subject: string; body: string; purpose: "SERVICE" | "MARKETING" }) {
  await requireSales(ctx, "sales.manage");
  const subject = (raw.subject ?? "").trim();
  const body = (raw.body ?? "").trim();
  if (subject.length < 2) throw new BusinessError("Give the email a subject.");
  if (!body) throw new BusinessError("Write the email.");
  if (raw.purpose !== "SERVICE" && raw.purpose !== "MARKETING") throw new BusinessError("Say whether this message is a service message or marketing.");
  const r = await resolveTarget(ctx, db, { contactId: raw.contactId, leadId: raw.leadId, opportunityId: raw.opportunityId });
  if (!r.contactId && !r.leadId && r.opp?.primaryContactId) r.contactId = r.opp.primaryContactId;
  await assertMayMessage(ctx, db, r, raw.purpose);
  const person = r.contactId
    ? await db.crmContact.findFirstOrThrow({ where: { id: r.contactId, organizationId: ctx.orgId }, select: { email: true } })
    : await db.crmLead.findFirstOrThrow({ where: { id: r.leadId!, organizationId: ctx.orgId }, select: { email: true } });
  if (!person.email) throw new BusinessError("There is no email address on this contact or lead.");
  await sendEmail({ to: person.email, subject, text: body, html: body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("") });
  return db.$transaction((tx: Tx) => insertActivity(ctx, tx, { kind: "EMAIL", subject, body, purpose: raw.purpose, leadId: r.leadId ?? undefined, contactId: r.contactId ?? undefined, opportunityId: r.opportunityId ?? undefined }, r), { timeout: 20_000 });
}

/** A mistaken activity stays on the timeline, struck through, with the reason. Only its maker or a manager may void it. */
export async function voidActivity(ctx: Ctx, id: string, reason: string) {
  await requireSales(ctx, "sales.manage");
  if (!reason?.trim()) throw new BusinessError("Give the reason for voiding this activity.");
  const f = ownerFilter(ctx);
  const a = await db.crmActivity.findFirst({
    where: { id, organizationId: ctx.orgId, ...(seesAll(ctx) ? {} : { OR: [{ createdByUserId: ctx.userId }, { lead: f }, { contact: f }, { account: f }, { opportunity: f }] }) },
  });
  if (!a) throw new BusinessError("Activity not found.");
  if (a.voidedAt) throw new BusinessError("This activity is already voided.");
  if (a.createdByUserId !== ctx.userId && !seesAll(ctx)) throw new BusinessError("Only the person who logged it, or a sales manager, can void an activity.");
  await db.crmActivity.update({ where: { id }, data: { voidedAt: new Date(), voidedBy: ctx.name, voidReason: reason.trim() } });
  await logAudit(ctx, { action: "SALES_ACTIVITY_VOID", entity: "CrmActivity", entityId: id, newValue: { kind: a.kind } });
}

// ─────────────────────────────── the timeline ───────────────────────────────

const when = (d: Date | null | undefined) => d ?? new Date(0);

/** Everything about a lead, contact, account or deal in one list, newest first. */
export async function timeline(ctx: Ctx, t: Target, opts: { types?: TimelineType[]; take?: number } = {}) {
  await requireSales(ctx, "sales.view");
  const keys = [t.leadId, t.contactId, t.accountId, t.opportunityId].filter(Boolean);
  if (keys.length !== 1) throw new BusinessError("Show the timeline of one lead, contact, account or deal.");
  const f = ownerFilter(ctx);
  const org = ctx.orgId;
  const items: TimelineItem[] = [];
  let dealIds: string[] = [];
  let contactIds: string[] = [];
  let leadId: string | undefined;

  if (t.leadId) {
    if (!(await db.crmLead.findFirst({ where: { id: t.leadId, organizationId: org, ...f }, select: { id: true } }))) throw new BusinessError("Lead not found.");
    leadId = t.leadId;
  } else if (t.contactId) {
    if (!(await db.crmContact.findFirst({ where: { id: t.contactId, organizationId: org, ...f }, select: { id: true } }))) throw new BusinessError("Contact not found.");
    contactIds = [t.contactId];
  } else if (t.accountId) {
    if (!(await db.crmAccount.findFirst({ where: { id: t.accountId, organizationId: org, ...f }, select: { id: true } }))) throw new BusinessError("Account not found.");
    contactIds = (await db.crmContact.findMany({ where: { organizationId: org, accountId: t.accountId, ...f }, select: { id: true } })).map((c) => c.id);
    dealIds = (await db.crmOpportunity.findMany({ where: { organizationId: org, accountId: t.accountId, ...f }, select: { id: true } })).map((o) => o.id);
  } else {
    if (!(await db.crmOpportunity.findFirst({ where: { id: t.opportunityId, organizationId: org, ...f }, select: { id: true } }))) throw new BusinessError("Deal not found.");
    dealIds = [t.opportunityId!];
  }

  const activityWhere: Prisma.CrmActivityWhereInput = t.leadId ? { leadId: t.leadId } : t.contactId ? { contactId: t.contactId } : t.accountId ? { accountId: t.accountId } : { opportunityId: t.opportunityId };
  const [acts, stages, quotes, handoverEvents, consents, caseEvents] = await Promise.all([
    db.crmActivity.findMany({ where: { organizationId: org, ...activityWhere }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 500 }),
    dealIds.length ? db.crmStageHistory.findMany({ where: { organizationId: org, opportunityId: { in: dealIds } }, orderBy: { changedAt: "desc" }, take: 500 }) : [],
    dealIds.length ? db.crmQuote.findMany({ where: { organizationId: org, opportunityId: { in: dealIds } } }) : [],
    dealIds.length ? db.crmHandoverEvent.findMany({ where: { organizationId: org, handover: { opportunityId: { in: dealIds } } }, include: { handover: { select: { number: true } } }, take: 500 }) : [],
    leadId || contactIds.length ? db.crmConsent.findMany({ where: { organizationId: org, ...(leadId ? { leadId } : { contactId: { in: contactIds } }) }, orderBy: { seq: "desc" }, take: 500 }) : [],
    t.accountId || t.contactId ? db.crmCaseEvent.findMany({ where: { organizationId: org, case: t.accountId ? { accountId: t.accountId } : { contactId: t.contactId } }, include: { case: { select: { number: true, priority: true } } }, orderBy: { at: "desc" }, take: 500 }) : [],
  ]);

  for (const a of acts) {
    const s = a.survey as { siteType?: string; entryPoints?: number; existingGuards?: number; riskNotes?: string; photoLinks?: string[] } | null;
    const purpose = a.purpose ? ` (${a.purpose.toLowerCase()})` : "";
    const title =
      a.kind === "CALL" ? (a.callOutcome ? `Call: ${OUTCOME_LABEL[a.callOutcome]}` : "Call started (how it went is not recorded)")
      : a.kind === "MEETING" ? `Meeting${a.subject ? `: ${a.subject}` : ""}`
      : a.kind === "SITE_SURVEY" ? `Site survey: ${s?.siteType ?? ""}`
      : a.kind === "WHATSAPP" ? `WhatsApp${purpose}`
      : a.kind === "EMAIL" ? `Email${a.subject ? `: ${a.subject}` : ""}${purpose}`
      : "Note";
    const detail = a.voidedAt
      ? `Voided by ${a.voidedBy}: ${a.voidReason}`
      : a.kind === "SITE_SURVEY" && s
        ? [s.entryPoints !== undefined && `${s.entryPoints} entry point(s)`, s.existingGuards !== undefined && `${s.existingGuards} existing guard(s)`, s.riskNotes, s.photoLinks?.length && `${s.photoLinks.length} photo link(s)`].filter(Boolean).join("; ")
        : a.body;
    items.push({ id: `act:${a.id}`, type: a.kind, at: a.occurredAt, title: title.trim(), detail, by: a.createdBy, voided: !!a.voidedAt });
  }
  if (stages.length) {
    const names = new Map((await db.crmStage.findMany({ where: { id: { in: [...new Set(stages.flatMap((h) => [h.fromStageId, h.toStageId].filter(Boolean) as string[]))] } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    for (const h of stages) items.push({ id: `stage:${h.id}`, type: "STAGE", at: h.changedAt, title: h.fromStageId ? `Moved from ${names.get(h.fromStageId) ?? "?"} to ${names.get(h.toStageId) ?? "?"}` : `Created in ${names.get(h.toStageId) ?? "?"}`, by: h.changedBy });
  }
  for (const q of quotes) {
    const label = `Quote ${q.number} version ${q.versionNo}`;
    items.push({ id: `quote:${q.id}:made`, type: "QUOTE", at: q.createdAt, title: `${label} made`, by: q.createdBy });
    if (q.approvedAt) items.push({ id: `quote:${q.id}:approved`, type: "QUOTE", at: q.approvedAt, title: `${label} approved below the minimum margin`, by: q.approvedBy });
    if (q.sentAt) items.push({ id: `quote:${q.id}:sent`, type: "QUOTE", at: q.sentAt, title: `${label} sent`, by: q.sentBy });
    if (q.decidedAt && (q.status === "ACCEPTED" || q.status === "REJECTED")) items.push({ id: `quote:${q.id}:decided`, type: "QUOTE", at: q.decidedAt, title: `${label} ${q.status === "ACCEPTED" ? "accepted" : "rejected"} by the client`, by: q.decidedBy });
  }
  for (const e of handoverEvents) items.push({ id: `handover:${e.id}`, type: "HANDOVER", at: e.at, title: `Handover ${e.handover.number}: ${e.kind === "CREATED" ? "started" : e.kind === "SUBMITTED" ? "sent to Operations" : e.kind === "RETURNED" ? "returned with a question" : "accepted by Operations"}`, by: e.byName });
  for (const c of consents) items.push({ id: `consent:${c.id}`, type: "CONSENT", at: c.recordedAt, title: `${c.purpose === "MARKETING" ? "Marketing" : "Service"} consent ${c.status === "GRANTED" ? "granted" : "withdrawn"} (${c.channel.toLowerCase().replace("_", " ")})`, by: c.recordedBy });

  const CASE_WORDS = { OPENED: "opened", RESPONDED: "answered", NOTE: "note added", REASSIGNED: "given to someone else", RESOLVED: "resolved", REOPENED: "reopened", WARNING: "75% of a time limit has gone", BREACH: "a time limit was missed", ESCALATED: "escalated to the sales managers" } as const;
  for (const e of caseEvents) items.push({ id: `case:${e.id}`, type: "CASE", at: e.at, title: `Case ${e.case.number}: ${CASE_WORDS[e.kind]}${e.kind === "OPENED" ? ` (${e.case.priority.toLowerCase()})` : ""}`, detail: e.note, by: e.byName });

  const merged = filterTimeline(mergeTimeline(items), opts.types ?? []);
  return merged.slice(0, opts.take ?? 200).map((i) => ({ ...i, at: when(i.at) }));
}

// ─────────────────────────────── tasks ───────────────────────────────

export const taskSchema = z.object({
  title: z.string().trim().min(2, "Say what the task is").max(200),
  notes: text(2000),
  dueAt: z.string().datetime({ offset: true, message: "Use a date and time like 2026-10-30T14:30:00+01:00" }),
  reminderAt: z.string().datetime({ offset: true, message: "Use a date and time like 2026-10-30T08:00:00+01:00" }).optional(),
  ownerUserId: z.string().optional(),
  leadId: z.string().optional(),
  accountId: z.string().optional(),
  contactId: z.string().optional(),
  opportunityId: z.string().optional(),
});

async function loadTask(ctx: Ctx, tx: Tx | typeof db, id: string) {
  const t = await tx.crmTask.findFirst({ where: { id, organizationId: ctx.orgId, ...(seesAll(ctx) ? {} : { ownerUserId: ctx.userId }) } });
  if (!t) throw new BusinessError("Task not found.");
  return t;
}

export async function createTask(ctx: Ctx, raw: z.input<typeof taskSchema>) {
  await requireSales(ctx, "sales.manage");
  const p = taskSchema.safeParse(raw);
  if (!p.success) throw new BusinessError(p.error.issues[0].message);
  const v = p.data;
  if (v.reminderAt && new Date(v.reminderAt) > new Date(v.dueAt)) throw new BusinessError("The reminder cannot be after the time the task is due.");
  const owner = await resolveOwner(ctx, v.ownerUserId);
  const linked = v.leadId || v.accountId || v.contactId || v.opportunityId;
  const r = linked ? await resolveTarget(ctx, db, v) : null;
  const t = await db.crmTask.create({
    data: {
      organizationId: ctx.orgId, title: v.title, notes: v.notes || null, dueAt: new Date(v.dueAt), reminderAt: v.reminderAt ? new Date(v.reminderAt) : null, ...owner,
      leadId: r?.leadId, contactId: r?.contactId, accountId: r?.accountId, opportunityId: r?.opportunityId, createdBy: ctx.name, createdByUserId: ctx.userId,
    },
  });
  await logAudit(ctx, { action: "SALES_TASK_CREATE", entity: "CrmTask", entityId: t.id, newValue: { ownerUserId: owner.ownerUserId, leadId: t.leadId, contactId: t.contactId, accountId: t.accountId, opportunityId: t.opportunityId } });
  return t;
}

/** Marks a task done. Finishing a task on a deal counts as activity on the deal. */
export async function completeTask(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.manage");
  return db.$transaction(async (tx: Tx) => {
    const t = await loadTask(ctx, tx, id);
    if (t.status !== "OPEN") throw new BusinessError("Only an open task can be completed.");
    const done = await tx.crmTask.update({ where: { id }, data: { status: "DONE", completedAt: new Date(), completedBy: ctx.name } });
    if (t.opportunityId) await tx.crmOpportunity.update({ where: { id: t.opportunityId }, data: { lastActivityAt: new Date() } });
    await logAudit(ctx, { action: "SALES_TASK_COMPLETE", entity: "CrmTask", entityId: id, newValue: { opportunityId: t.opportunityId } }, tx);
    return done;
  });
}

export async function reopenTask(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.manage");
  const t = await loadTask(ctx, db, id);
  if (t.status === "OPEN") throw new BusinessError("This task is already open.");
  const u = await db.crmTask.update({ where: { id }, data: { status: "OPEN", completedAt: null, completedBy: null } });
  await logAudit(ctx, { action: "SALES_TASK_REOPEN", entity: "CrmTask", entityId: id });
  return u;
}

export async function cancelTask(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.manage");
  const t = await loadTask(ctx, db, id);
  if (t.status !== "OPEN") throw new BusinessError("Only an open task can be cancelled.");
  const u = await db.crmTask.update({ where: { id }, data: { status: "CANCELLED" } });
  await logAudit(ctx, { action: "SALES_TASK_CANCEL", entity: "CrmTask", entityId: id });
  return u;
}

const taskInclude = { lead: { select: { id: true, companyName: true } }, account: { select: { id: true, name: true } }, contact: { select: { id: true, firstName: true, lastName: true } }, opportunity: { select: { id: true, name: true } } } as const;

/** The open tasks, grouped overdue, today, this week and later (Lagos time). A manager may ask for everyone's. */
export async function myTasks(ctx: Ctx, opts: { scope?: "mine" | "all"; now?: Date } = {}) {
  await requireSales(ctx, "sales.view");
  if (opts.scope === "all" && !seesAll(ctx)) throw new BusinessError("Only a sales manager can see everyone's tasks.");
  const rows = await db.crmTask.findMany({ where: { organizationId: ctx.orgId, status: "OPEN", ...(opts.scope === "all" ? {} : { ownerUserId: ctx.userId }) }, include: taskInclude, take: 1000 });
  return groupTasks(rows, opts.now ?? new Date());
}

/** The open tasks about one record, if the caller may see it. */
export async function tasksFor(ctx: Ctx, t: Target) {
  await requireSales(ctx, "sales.view");
  const r = await resolveTarget(ctx, db, t, { readOnly: true });
  const key = t.opportunityId ? { opportunityId: r.opportunityId } : t.contactId ? { contactId: r.contactId } : t.leadId ? { leadId: r.leadId } : { accountId: r.accountId };
  return db.crmTask.findMany({ where: { organizationId: ctx.orgId, status: "OPEN", ...(seesAll(ctx) ? {} : { ownerUserId: ctx.userId }), ...key }, include: taskInclude, orderBy: { dueAt: "asc" } });
}

// ─────────────────────────────── the daily digest ───────────────────────────────

/** What one person needs to look at today: tasks overdue and due today, tasks whose reminder is today, and their deals that have gone quiet. */
export async function digestFor(orgId: string, userId: string, now = new Date()) {
  const tasks = await db.crmTask.findMany({ where: { organizationId: orgId, status: "OPEN", ownerUserId: userId }, select: { id: true, title: true, dueAt: true, reminderAt: true, status: true } });
  const g = groupTasks(tasks, now);
  const dayEnd = watDayStart(now).getTime() + DAY;
  const shown = new Set([...g.overdue, ...g.today].map((t) => t.id));
  const reminders = [...g.thisWeek, ...g.later].filter((t) => !shown.has(t.id) && t.reminderAt && t.reminderAt.getTime() < dayEnd);
  const deals = await db.crmOpportunity.findMany({ where: { organizationId: orgId, ownerUserId: userId, status: "ACTIVE", stage: { stageType: "OPEN" } }, select: { id: true, name: true, lastActivityAt: true, stage: { select: { name: true, rottingDays: true } } } });
  const rotting = deals
    .filter((d) => now.getTime() - d.lastActivityAt.getTime() > (d.stage.rottingDays ?? DEFAULT_ROTTING_DAYS) * DAY)
    .map((d) => ({ id: d.id, name: d.name, stage: d.stage.name, daysQuiet: Math.floor((now.getTime() - d.lastActivityAt.getTime()) / DAY) }))
    .sort((a, b) => b.daysQuiet - a.daysQuiet || (a.id < b.id ? -1 : 1));
  return { overdue: g.overdue, today: g.today, reminders, rotting, empty: !g.overdue.length && !g.today.length && !reminders.length && !rotting.length };
}

export async function myDigest(ctx: Ctx, now = new Date()) {
  await requireSales(ctx, "sales.view");
  return digestFor(ctx.orgId, ctx.userId, now);
}

/**
 * The scheduled job: one email a day to each sales person who has something in their digest, in every organization that has the module on. A row for the
 * user and the Lagos day is written first, so running the job twice (or two at once) never sends two; if the send fails the row is removed so the next run tries again.
 */
export async function sendSalesDigests(now = new Date(), opts: { orgId?: string } = {}) {
  const forDate = new Date(watDayStart(now).getTime() + HOUR); // the Lagos date, as a date
  const orgs = await db.crmSetting.findMany({ where: { enabled: true, ...(opts.orgId ? { organizationId: opts.orgId } : {}) }, select: { organizationId: true } });
  let sent = 0;
  let skipped = 0;
  for (const o of orgs) {
    const users = await db.user.findMany({ where: { organizationId: o.organizationId, active: true }, select: { id: true, name: true, email: true, role: true } });
    for (const u of users.filter((x) => can(x.role as never, "sales.manage"))) {
      const d = await digestFor(o.organizationId, u.id, now);
      if (d.empty) { skipped++; continue; }
      try {
        await db.crmDigestRun.create({ data: { organizationId: o.organizationId, userId: u.id, forDate } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") { skipped++; continue; } // already sent today
        throw e;
      }
      const line = (t: { title: string; dueAt: Date }) => `- ${t.title} (due ${new Date(t.dueAt.getTime() + HOUR).toISOString().slice(0, 16).replace("T", " ")})`;
      const lines = [
        `Good morning ${u.name.split(" ")[0]}. Your sales day:`,
        d.overdue.length ? `\nOverdue tasks:\n${d.overdue.map(line).join("\n")}` : "",
        d.today.length ? `\nDue today:\n${d.today.map(line).join("\n")}` : "",
        d.reminders.length ? `\nReminders for today:\n${d.reminders.map(line).join("\n")}` : "",
        d.rotting.length ? `\nDeals gone quiet:\n${d.rotting.map((r) => `- ${r.name} (${r.stage}, nothing for ${r.daysQuiet} days)`).join("\n")}` : "",
      ].filter(Boolean);
      try {
        await sendEmail({ to: u.email, subject: "Your sales day", text: lines.join("\n"), html: `<p>${esc(lines.join("\n")).replace(/\n/g, "<br>")}</p>` });
        sent++;
      } catch (e) {
        await db.crmDigestRun.deleteMany({ where: { organizationId: o.organizationId, userId: u.id, forDate } });
        throw e;
      }
    }
  }
  return { sent, skipped };
}
