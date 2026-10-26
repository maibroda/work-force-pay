/**
 * The bureau's sales pipeline: leads and their stages, the outreach log, referral partners and the commission owed to them. It lives in the
 * bureau's own organization (never inside a client), is visible only to people with the CRM permissions, and holds no payroll data. Stage
 * moves, outreach and payouts are kept as a record that cannot be rewritten; the rules that matter (a lost lead says why, a won lead has a fee
 * and is final, commission is paid only on a won lead to the partner who referred it) are held by the database as well.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { iso } from "@/lib/dates";
import { num } from "@/lib/money";
import {
  CHANNELS,
  commissionEarned,
  DAILY_CONTACT_TARGET,
  isContact,
  OPEN_STAGES,
  OUTCOMES,
  PARTNER_KINDS,
  salesSummary,
  SEGMENTS,
  SOURCES,
  STAGES,
  STAGE_LABELS,
  validateMove,
  type Stage,
} from "@/lib/crm";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";

/** Whether the signed-in person is in the bureau's own organization, where the pipeline lives (pages say so plainly when they are not). */
export async function crmAvailable(ctx: Ctx): Promise<boolean> {
  if (ctx.homeOrgId) return false;
  const org = await db.organization.findUnique({ where: { id: ctx.orgId }, select: { isBureau: true } });
  return !!org?.isBureau;
}

async function requireCrm(ctx: Ctx, permission: "crm.view" | "crm.manage") {
  assertCan(ctx, permission);
  if (ctx.homeOrgId) throw new BusinessError("The sales pipeline belongs to the bureau's own organization. Go back to the bureau first.");
  if (!(await crmAvailable(ctx))) throw new BusinessError("The sales pipeline belongs to a payroll bureau.");
}

const opt = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));
const optEmail = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.toLowerCase() : undefined))
  .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "That email address isn't valid.");
const money = z.coerce.number().min(0, "Can't be negative").max(1_000_000_000).default(0);
const normalName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const today = () => iso(new Date());

// ─────────────────────────────── Referral partners ───────────────────────────────

export const partnerSchema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  kind: z.enum(PARTNER_KINDS),
  contactName: opt,
  email: optEmail,
  phone: opt,
  commissionPct: z.coerce.number().min(0).max(100),
  commissionMonths: z.coerce.number().int().min(1).max(60).default(12),
  notes: opt,
});

export async function createPartner(ctx: Ctx, raw: z.input<typeof partnerSchema>) {
  await requireCrm(ctx, "crm.manage");
  const v = partnerSchema.parse(raw);
  if (await db.referralPartner.findFirst({ where: { organizationId: ctx.orgId, name: { equals: v.name, mode: "insensitive" } } })) throw new BusinessError("A referral partner with that name already exists.");
  const p = await db.referralPartner.create({ data: { organizationId: ctx.orgId, ...v } });
  await logAudit(ctx, { action: "CRM_PARTNER_CREATE", entity: "ReferralPartner", entityId: p.id, newValue: { name: p.name, commissionPct: v.commissionPct, commissionMonths: v.commissionMonths } });
  return p;
}

export async function updatePartner(ctx: Ctx, id: string, raw: z.input<typeof partnerSchema> & { active?: boolean }) {
  await requireCrm(ctx, "crm.manage");
  const v = partnerSchema.parse(raw);
  const old = await db.referralPartner.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Referral partner not found.");
  const p = await db.referralPartner.update({ where: { id }, data: { ...v, ...(raw.active === undefined ? {} : { active: raw.active }) } });
  await logAudit(ctx, { action: "CRM_PARTNER_UPDATE", entity: "ReferralPartner", entityId: id, oldValue: { commissionPct: num(old.commissionPct), commissionMonths: old.commissionMonths, active: old.active }, newValue: { commissionPct: num(p.commissionPct), commissionMonths: p.commissionMonths, active: p.active } });
  return p;
}

export async function listPartners(ctx: Ctx, opts: { activeOnly?: boolean } = {}) {
  await requireCrm(ctx, "crm.view");
  return db.referralPartner.findMany({ where: { organizationId: ctx.orgId, ...(opts.activeOnly ? { active: true } : {}) }, orderBy: { name: "asc" } });
}

/** What each partner has sent, won, earned, been paid and is still owed. */
export async function partnerSummary(ctx: Ctx) {
  await requireCrm(ctx, "crm.view");
  const [partners, leads, payouts] = await Promise.all([
    db.referralPartner.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" } }),
    db.lead.findMany({ where: { organizationId: ctx.orgId, partnerId: { not: null } }, select: { id: true, number: true, company: true, stage: true, partnerId: true, expectedMrr: true } }),
    db.referralPayout.findMany({ where: { organizationId: ctx.orgId }, orderBy: { paidOn: "desc" } }),
  ]);
  return partners.map((p) => {
    const mine = leads.filter((l) => l.partnerId === p.id);
    const won = mine.filter((l) => l.stage === "WON");
    const lines = won.map((l) => {
      const earned = commissionEarned({ pct: num(p.commissionPct), months: p.commissionMonths, mrr: num(l.expectedMrr) });
      const paid = Math.round(payouts.filter((x) => x.leadId === l.id).reduce((a, x) => a + num(x.amount), 0) * 100) / 100;
      return { leadId: l.id, number: l.number, company: l.company, earned, paid, owed: Math.round((earned - paid) * 100) / 100 };
    });
    const sum = (k: "earned" | "paid" | "owed") => Math.round(lines.reduce((a, x) => a + x[k], 0) * 100) / 100;
    return { partner: p, referred: mine.length, won: won.length, lines, earned: sum("earned"), paid: sum("paid"), owed: sum("owed"), payouts: payouts.filter((x) => x.partnerId === p.id).slice(0, 10) };
  });
}

export const payoutSchema = z.object({
  partnerId: z.string().min(1),
  leadId: z.string().min(1, "Choose the lead this is for"),
  amount: z.coerce.number().refine((n) => n !== 0, "Enter the amount"),
  paidOn: z.string().min(1, "Enter the date it was paid"),
  reference: opt,
});

/** Records commission actually paid. A correction is a negative amount with a reference saying what it corrects. */
export async function recordPayout(ctx: Ctx, raw: z.input<typeof payoutSchema>) {
  await requireCrm(ctx, "crm.manage");
  const v = payoutSchema.parse(raw);
  const lead = await db.lead.findFirst({ where: { id: v.leadId, organizationId: ctx.orgId } });
  const partner = await db.referralPartner.findFirst({ where: { id: v.partnerId, organizationId: ctx.orgId } });
  if (!lead || !partner) throw new BusinessError("Lead or partner not found.");
  if (lead.stage !== "WON") throw new BusinessError("Commission is paid only on a lead that has been won.");
  if (lead.partnerId !== partner.id) throw new BusinessError(`${partner.name} did not refer ${lead.company}.`);
  const paidOn = new Date(`${v.paidOn}T00:00:00Z`);
  if (Number.isNaN(paidOn.getTime()) || v.paidOn > today()) throw new BusinessError("The payment date can't be in the future.");
  if (v.amount < 0 && (v.reference ?? "").length < 5) throw new BusinessError("A correction needs a reference saying what it corrects.");
  const [paidRows] = await Promise.all([db.referralPayout.findMany({ where: { leadId: lead.id }, select: { amount: true } })]);
  const earned = commissionEarned({ pct: num(partner.commissionPct), months: partner.commissionMonths, mrr: num(lead.expectedMrr) });
  const paid = paidRows.reduce((a, x) => a + num(x.amount), 0);
  if (v.amount > 0 && paid + v.amount > earned + 0.005) throw new BusinessError(`That is more than is owed: ${lead.company} has earned ₦${earned.toLocaleString("en-NG")} in commission and ₦${paid.toLocaleString("en-NG")} has been paid.`);
  if (v.amount < 0 && paid + v.amount < -0.005) throw new BusinessError("That would take back more than was paid.");
  const p = await db.referralPayout.create({ data: { organizationId: ctx.orgId, partnerId: partner.id, leadId: lead.id, amount: v.amount, paidOn, reference: v.reference ?? null, byName: ctx.name } });
  await logAudit(ctx, { action: "CRM_PAYOUT", entity: "ReferralPayout", entityId: p.id, newValue: { partner: partner.name, lead: lead.number, amount: v.amount }, reason: v.reference });
  return p;
}

// ─────────────────────────────── Leads ───────────────────────────────

const leadFields = {
  company: z.string().trim().min(2, "Company name is required"),
  segment: z.enum(SEGMENTS).default("SME"),
  headcount: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(1_000_000).optional()),
  source: z.enum(SOURCES).default("OUTBOUND"),
  partnerId: opt,
  contactName: z.string().trim().min(2, "The decision-maker's name is required"),
  contactRole: opt,
  contactEmail: optEmail,
  contactPhone: opt,
  expectedMrr: money,
  nextStep: opt,
  nextStepOn: opt,
  notes: opt,
  ownerUserId: opt,
};
export const leadSchema = z.object(leadFields);

async function resolveOwner(ctx: Ctx, ownerUserId: string | undefined) {
  if (!ownerUserId || ownerUserId === ctx.userId) return { id: ctx.userId, name: ctx.name };
  const u = await db.user.findFirst({ where: { id: ownerUserId, organizationId: ctx.orgId, active: true } });
  if (!u || !can(u.role, "crm.manage")) throw new BusinessError("The owner must be someone who works on the pipeline.");
  return { id: u.id, name: u.name };
}

async function checkPartner(ctx: Ctx, partnerId: string | undefined) {
  if (!partnerId) return;
  const p = await db.referralPartner.findFirst({ where: { id: partnerId, organizationId: ctx.orgId } });
  if (!p) throw new BusinessError("Referral partner not found.");
  if (!p.active) throw new BusinessError(`${p.name} is no longer active as a referral partner.`);
}

async function assertNotDuplicate(ctx: Ctx, company: string, exceptId?: string) {
  const same = (await db.lead.findMany({ where: { organizationId: ctx.orgId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { number: true, company: true, stage: true } })).find((l) => normalName(l.company) === normalName(company));
  if (same) throw new BusinessError(`${same.company} is already in the pipeline as ${same.number} (${STAGE_LABELS[same.stage as Stage].toLowerCase()}).${same.stage === "LOST" ? " Reopen it instead of adding it again." : ""}`);
}

export async function createLead(ctx: Ctx, raw: z.input<typeof leadSchema>) {
  await requireCrm(ctx, "crm.manage");
  const v = leadSchema.parse(raw);
  await assertNotDuplicate(ctx, v.company);
  await checkPartner(ctx, v.partnerId);
  if (v.source === "REFERRAL" && !v.partnerId) throw new BusinessError("Choose the referral partner this came from.");
  const owner = await resolveOwner(ctx, v.ownerUserId);
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "LEAD");
    const { ownerUserId, nextStepOn, ...rest } = v;
    void ownerUserId;
    const lead = await tx.lead.create({
      data: { organizationId: ctx.orgId, number, ...rest, source: v.partnerId ? "REFERRAL" : v.source, nextStepOn: nextStepOn ? new Date(`${nextStepOn}T00:00:00Z`) : null, ownerUserId: owner.id, ownerName: owner.name, createdBy: ctx.name },
    });
    await tx.leadStageChange.create({ data: { organizationId: ctx.orgId, leadId: lead.id, fromStage: null, toStage: "QUALIFIED", byName: ctx.name, byUserId: ctx.userId } });
    await logAudit(ctx, { action: "CRM_LEAD_CREATE", entity: "Lead", entityId: lead.id, newValue: { number, company: lead.company, source: lead.source } }, tx);
    return lead;
  });
}

export async function updateLead(ctx: Ctx, id: string, raw: z.input<typeof leadSchema>) {
  await requireCrm(ctx, "crm.manage");
  const v = leadSchema.parse(raw);
  const old = await db.lead.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!old) throw new BusinessError("Lead not found.");
  if (old.stage === "WON" && (v.expectedMrr !== num(old.expectedMrr) || (v.partnerId ?? null) !== old.partnerId))
    throw new BusinessError("A won lead's fee and referral partner can't change: commission depends on them.");
  if (normalName(v.company) !== normalName(old.company)) await assertNotDuplicate(ctx, v.company, id);
  if ((v.partnerId ?? null) !== old.partnerId) await checkPartner(ctx, v.partnerId);
  const owner = await resolveOwner(ctx, v.ownerUserId ?? old.ownerUserId);
  const { ownerUserId, nextStepOn, ...rest } = v;
  void ownerUserId;
  const lead = await db.lead.update({
    where: { id },
    data: { ...rest, partnerId: v.partnerId ?? null, source: v.partnerId ? "REFERRAL" : v.source, nextStepOn: nextStepOn ? new Date(`${nextStepOn}T00:00:00Z`) : null, ownerUserId: owner.id, ownerName: owner.name },
  });
  await logAudit(ctx, { action: "CRM_LEAD_UPDATE", entity: "Lead", entityId: id, oldValue: { company: old.company, expectedMrr: num(old.expectedMrr), owner: old.ownerName }, newValue: { company: lead.company, expectedMrr: num(lead.expectedMrr), owner: lead.ownerName } });
  return lead;
}

export const moveSchema = z.object({
  to: z.enum(STAGES),
  note: opt,
  lostReason: opt,
  expectedMrr: z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.coerce.number().min(0).optional()),
  clientOrganizationId: opt,
});

export async function moveLead(ctx: Ctx, id: string, raw: z.input<typeof moveSchema>) {
  await requireCrm(ctx, "crm.manage");
  const v = moveSchema.parse(raw);
  const lead = await db.lead.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!lead) throw new BusinessError("Lead not found.");
  const mrr = v.expectedMrr ?? num(lead.expectedMrr);
  const problem = validateMove({ from: lead.stage as Stage, to: v.to, expectedMrr: mrr, lostReason: v.lostReason, note: v.note });
  if (problem) throw new BusinessError(problem);
  if (v.clientOrganizationId) {
    if (v.to !== "WON") throw new BusinessError("A client is linked only when the lead is won.");
    const c = await db.organization.findFirst({ where: { id: v.clientOrganizationId, bureauOrganizationId: ctx.orgId }, select: { id: true } });
    if (!c) throw new BusinessError("That client is not one of this bureau's.");
  }
  const now = new Date();
  return db.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id },
      data: {
        stage: v.to,
        stageChangedAt: now,
        expectedMrr: mrr,
        wonAt: v.to === "WON" ? now : null,
        lostAt: v.to === "LOST" ? now : null,
        lostReason: v.to === "LOST" ? v.lostReason!.trim() : null,
        ...(v.clientOrganizationId ? { clientOrganizationId: v.clientOrganizationId } : {}),
      },
    });
    await tx.leadStageChange.create({ data: { organizationId: ctx.orgId, leadId: id, fromStage: lead.stage, toStage: v.to, note: v.to === "LOST" ? v.lostReason!.trim() : (v.note ?? null), byName: ctx.name, byUserId: ctx.userId } });
    await logAudit(ctx, { action: "CRM_LEAD_MOVE", entity: "Lead", entityId: id, oldValue: { stage: lead.stage }, newValue: { stage: v.to, number: lead.number, expectedMrr: mrr }, reason: v.to === "LOST" ? v.lostReason : v.note }, tx);
    return updated;
  });
}

export async function listLeads(ctx: Ctx, f: { stage?: string; ownerUserId?: string; source?: string; q?: string; open?: boolean } = {}) {
  await requireCrm(ctx, "crm.view");
  return db.lead.findMany({
    where: {
      organizationId: ctx.orgId,
      ...(f.stage && (STAGES as readonly string[]).includes(f.stage) ? { stage: f.stage as Stage } : f.open ? { stage: { in: [...OPEN_STAGES] } } : {}),
      ...(f.ownerUserId ? { ownerUserId: f.ownerUserId } : {}),
      ...(f.source && (SOURCES as readonly string[]).includes(f.source) ? { source: f.source as (typeof SOURCES)[number] } : {}),
      ...(f.q ? { OR: [{ company: { contains: f.q, mode: "insensitive" } }, { contactName: { contains: f.q, mode: "insensitive" } }, { number: { contains: f.q, mode: "insensitive" } }] } : {}),
    },
    include: { partner: { select: { name: true } } },
    orderBy: [{ stageChangedAt: "desc" }],
    take: 500,
  });
}

export async function getLead(ctx: Ctx, id: string) {
  await requireCrm(ctx, "crm.view");
  const lead = await db.lead.findFirst({
    where: { id, organizationId: ctx.orgId },
    include: { partner: true, stageChanges: { orderBy: { at: "desc" } }, activities: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 100 }, payouts: { orderBy: { paidOn: "desc" } } },
  });
  if (!lead) throw new BusinessError("Lead not found.");
  const earned = lead.partner && lead.stage === "WON" ? commissionEarned({ pct: num(lead.partner.commissionPct), months: lead.partner.commissionMonths, mrr: num(lead.expectedMrr) }) : 0;
  const paid = Math.round(lead.payouts.reduce((a, x) => a + num(x.amount), 0) * 100) / 100;
  return { ...lead, commission: { earned, paid, owed: Math.round((earned - paid) * 100) / 100 } };
}

/** The people who can be given a lead: everyone in the bureau who works on the pipeline. */
export async function pipelineOwners(ctx: Ctx) {
  await requireCrm(ctx, "crm.view");
  const users = await db.user.findMany({ where: { organizationId: ctx.orgId, active: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  return users.filter((u) => can(u.role, "crm.manage")).map((u) => ({ id: u.id, name: u.name }));
}

// ─────────────────────────────── Outreach ───────────────────────────────

export const outreachSchema = z.object({
  leadId: opt,
  company: opt,
  contactName: opt,
  channel: z.enum(CHANNELS),
  outcome: z.enum(OUTCOMES),
  note: opt,
  date: opt,
  /** For a first contact that turned out qualified: put the company in the pipeline as a new lead. */
  addAsLead: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
  headcount: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).optional()),
});

const MAX_BACKDATE_DAYS = 14;

export async function logOutreach(ctx: Ctx, raw: z.input<typeof outreachSchema>) {
  await requireCrm(ctx, "crm.manage");
  const v = outreachSchema.parse(raw);
  const date = v.date ?? today();
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new BusinessError("That date isn't valid.");
  if (date > today()) throw new BusinessError("An outreach can't be dated in the future.");
  if (Date.parse(`${today()}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`) > MAX_BACKDATE_DAYS * 86_400_000) throw new BusinessError(`Log outreach within ${MAX_BACKDATE_DAYS} days of when it happened, so the daily count stays honest.`);
  let lead = v.leadId ? await db.lead.findFirst({ where: { id: v.leadId, organizationId: ctx.orgId } }) : null;
  if (v.leadId && !lead) throw new BusinessError("Lead not found.");
  const company = lead?.company ?? v.company;
  if (!company || company.length < 2) throw new BusinessError("Say which company this was.");
  if (v.addAsLead) {
    if (lead) throw new BusinessError("This company is already a lead.");
    if (v.outcome !== "QUALIFIED") throw new BusinessError("Only a qualified contact is added to the pipeline.");
    if (!v.contactName) throw new BusinessError("Give the decision-maker's name to add the company as a lead.");
    lead = await createLead(ctx, { company, contactName: v.contactName, headcount: v.headcount, source: "OUTBOUND", segment: "SME" } as never);
  }
  const a = await db.outreachActivity.create({
    data: { organizationId: ctx.orgId, leadId: lead?.id ?? null, company, contactName: v.contactName ?? lead?.contactName ?? null, channel: v.channel, outcome: v.outcome, note: v.note ?? null, date: new Date(`${date}T00:00:00Z`), byName: ctx.name, byUserId: ctx.userId },
  });
  await logAudit(ctx, { action: "CRM_OUTREACH", entity: "OutreachActivity", entityId: a.id, newValue: { company, channel: v.channel, outcome: v.outcome, lead: lead?.number ?? null } });
  return { activity: a, lead };
}

export async function listOutreach(ctx: Ctx, f: { from: string; to: string; userId?: string }) {
  await requireCrm(ctx, "crm.view");
  return db.outreachActivity.findMany({
    where: { organizationId: ctx.orgId, date: { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T00:00:00Z`) }, ...(f.userId ? { byUserId: f.userId } : {}) },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
}

/** Today's qualified contacts against the daily target, for you and for the whole team. */
export async function outreachToday(ctx: Ctx, now = new Date()) {
  await requireCrm(ctx, "crm.view");
  const day = new Date(`${iso(now)}T00:00:00Z`);
  const rows = await db.outreachActivity.findMany({ where: { organizationId: ctx.orgId, date: day }, select: { outcome: true, byUserId: true } });
  const contacts = rows.filter((r) => isContact(r.outcome));
  return { target: DAILY_CONTACT_TARGET, mine: contacts.filter((r) => r.byUserId === ctx.userId).length, team: contacts.length, attempts: rows.length };
}

// ─────────────────────────────── The dashboard ───────────────────────────────

export async function salesDashboard(ctx: Ctx, range: { from: string; to: string }) {
  await requireCrm(ctx, "crm.view");
  const gte = new Date(`${range.from}T00:00:00Z`);
  const lte = new Date(`${range.to}T23:59:59Z`);
  const [leads, changes, acts] = await Promise.all([
    db.lead.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, stage: true, expectedMrr: true, createdAt: true, wonAt: true, lostAt: true } }),
    db.leadStageChange.findMany({ where: { organizationId: ctx.orgId, at: { gte, lte } }, select: { leadId: true, toStage: true, at: true } }),
    db.outreachActivity.findMany({ where: { organizationId: ctx.orgId, date: { gte, lte } }, select: { date: true, outcome: true, byName: true } }),
  ]);
  const summary = salesSummary({
    leads: leads.map((l) => ({ id: l.id, stage: l.stage as Stage, expectedMrr: num(l.expectedMrr), createdAt: l.createdAt, wonAt: l.wonAt, lostAt: l.lostAt })),
    changes: changes.map((c) => ({ leadId: c.leadId, toStage: c.toStage as Stage, at: c.at })),
    activities: acts.map((a) => ({ date: iso(a.date), outcome: a.outcome })),
    from: range.from,
    to: range.to,
  });
  const byPerson = new Map<string, { attempts: number; contacts: number }>();
  for (const a of acts) {
    const cur = byPerson.get(a.byName) ?? { attempts: 0, contacts: 0 };
    cur.attempts++;
    if (isContact(a.outcome)) cur.contacts++;
    byPerson.set(a.byName, cur);
  }
  return { ...summary, target: DAILY_CONTACT_TARGET, byPerson: [...byPerson.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.contacts - a.contacts) };
}

/** The bureau's clients by name only, so a won lead can be linked to the client it became. No payroll data. */
export async function linkableClients(ctx: Ctx) {
  await requireCrm(ctx, "crm.view");
  return db.organization.findMany({ where: { bureauOrganizationId: ctx.orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}
