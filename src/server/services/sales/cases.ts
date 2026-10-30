/**
 * Cases, service levels and renewals: the "keep the client" side of the sales module. A case is a problem or request from a client account; when it opens, its first-response and
 * resolution deadlines are worked out from the account's SLA policy (else the organization's default for that priority) and the business-hours calendar, and KEPT on the case, so
 * changing a policy later never moves a deadline. A scheduled job warns at 75% of each window, flags a breach and escalates it to the sales managers. A reopened case restarts its
 * resolution clock and is counted separately. A second job opens one renewal deal for each contract ending within the window. Audit entries carry ids, numbers, priorities and
 * statuses, never what was written.
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { clockState, DEFAULT_CALENDAR, dueAt, warnAt, type Calendar } from "@/lib/sales/sla";
import { BusinessError, db, type Tx } from "../_base";
import { logAudit } from "../audit";
import { nextNumber } from "../numbering";
import { ownerFilter, requireSales, resolveOwner } from "./access";
import { refreshAccountHealthSafe } from "./health";
import { insertOpportunity, ensureRenewalPipeline } from "./pipelines";

const DAY = 86_400_000;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
const CATEGORIES = ["SERVICE_QUALITY", "STAFFING", "BILLING", "COMPLAINT", "REQUEST", "OTHER"] as const;
type Priority = (typeof PRIORITIES)[number];

// ─────────────────────────────── business hours, holidays, policies ───────────────────────────────

export async function calendarOf(orgId: string, tx: Tx | typeof db = db): Promise<Calendar> {
  const [h, days] = await Promise.all([tx.crmBusinessHours.findUnique({ where: { organizationId: orgId } }), tx.crmHoliday.findMany({ where: { organizationId: orgId }, select: { date: true } })]);
  return { ...(h ? { openMinute: h.openMinute, closeMinute: h.closeMinute, workDays: h.workDays } : DEFAULT_CALENDAR), holidays: days.map((d) => d.date.toISOString().slice(0, 10)) };
}

export async function getCalendarSettings(ctx: Ctx) {
  await requireSales(ctx, "sales.view");
  return { ...(await calendarOf(ctx.orgId)), isDefault: !(await db.crmBusinessHours.findUnique({ where: { organizationId: ctx.orgId }, select: { id: true } })), holidayRows: await db.crmHoliday.findMany({ where: { organizationId: ctx.orgId }, orderBy: { date: "asc" } }) };
}

const hoursSchema = z
  .object({ openMinute: z.number().int().min(0).max(1439), closeMinute: z.number().int().min(1).max(1440), workDays: z.array(z.number().int().min(1).max(7)).min(1, "Choose at least one working day") })
  .refine((v) => v.closeMinute > v.openMinute, { message: "The closing time must be after the opening time" });

export async function saveBusinessHours(ctx: Ctx, raw: z.input<typeof hoursSchema>) {
  await requireSales(ctx, "sales.configure");
  const p = hoursSchema.safeParse(raw);
  if (!p.success) throw new BusinessError(p.error.issues[0].message);
  const v = { ...p.data, workDays: [...new Set(p.data.workDays)].sort() };
  await db.crmBusinessHours.upsert({ where: { organizationId: ctx.orgId }, create: { organizationId: ctx.orgId, ...v, updatedBy: ctx.name }, update: { ...v, updatedBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_BUSINESS_HOURS_SAVE", entity: "CrmBusinessHours", entityId: ctx.orgId, newValue: v });
}

export async function addHoliday(ctx: Ctx, raw: { date: string; name: string }) {
  await requireSales(ctx, "sales.configure");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date ?? "")) throw new BusinessError("Use a date like 2026-12-25.");
  if (!raw.name?.trim()) throw new BusinessError("Name the holiday.");
  const exists = await db.crmHoliday.findUnique({ where: { organizationId_date: { organizationId: ctx.orgId, date: new Date(`${raw.date}T00:00:00Z`) } } });
  if (exists) throw new BusinessError("That date is already a holiday.");
  const h = await db.crmHoliday.create({ data: { organizationId: ctx.orgId, date: new Date(`${raw.date}T00:00:00Z`), name: raw.name.trim(), createdBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_HOLIDAY_ADD", entity: "CrmHoliday", entityId: h.id, newValue: { date: raw.date } });
  return h;
}

export async function removeHoliday(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.configure");
  const h = await db.crmHoliday.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!h) throw new BusinessError("Holiday not found.");
  await db.crmHoliday.delete({ where: { id } });
  await logAudit(ctx, { action: "SALES_HOLIDAY_REMOVE", entity: "CrmHoliday", entityId: id, oldValue: { date: h.date.toISOString().slice(0, 10) } });
}

const policySchema = z.object({
  accountId: z.string().optional(),
  priority: z.enum(PRIORITIES),
  firstResponseMinutes: z.number().int().min(1, "The first-response time must be at least 1 minute").max(525_600),
  resolutionMinutes: z.number().int().min(1, "The resolution time must be at least 1 minute").max(525_600),
  businessHoursOnly: z.boolean(),
});

export async function listSlaPolicies(ctx: Ctx) {
  await requireSales(ctx, "sales.view");
  return db.crmSlaPolicy.findMany({ where: { organizationId: ctx.orgId }, include: { account: { select: { name: true } } }, orderBy: [{ accountKey: "asc" }, { priority: "asc" }] });
}

/** Sets the policy for a priority, for one account or (with no account) as the organization's default. */
export async function saveSlaPolicy(ctx: Ctx, raw: z.input<typeof policySchema>) {
  await requireSales(ctx, "sales.configure");
  const p = policySchema.safeParse(raw);
  if (!p.success) throw new BusinessError(p.error.issues[0].message);
  const v = p.data;
  if (v.resolutionMinutes < v.firstResponseMinutes) throw new BusinessError("Resolution cannot be due before the first response.");
  if (v.accountId && !(await db.crmAccount.findFirst({ where: { id: v.accountId, organizationId: ctx.orgId }, select: { id: true } }))) throw new BusinessError("Account not found.");
  const key = v.accountId ?? "";
  const rec = await db.crmSlaPolicy.upsert({
    where: { organizationId_accountKey_priority: { organizationId: ctx.orgId, accountKey: key, priority: v.priority } },
    create: { organizationId: ctx.orgId, accountId: v.accountId ?? null, accountKey: key, priority: v.priority, firstResponseMinutes: v.firstResponseMinutes, resolutionMinutes: v.resolutionMinutes, businessHoursOnly: v.businessHoursOnly, createdBy: ctx.name },
    update: { firstResponseMinutes: v.firstResponseMinutes, resolutionMinutes: v.resolutionMinutes, businessHoursOnly: v.businessHoursOnly, active: true, updatedBy: ctx.name },
  });
  await logAudit(ctx, { action: "SALES_SLA_POLICY_SAVE", entity: "CrmSlaPolicy", entityId: rec.id, newValue: { priority: v.priority, accountId: v.accountId ?? null, firstResponseMinutes: v.firstResponseMinutes, resolutionMinutes: v.resolutionMinutes, businessHoursOnly: v.businessHoursOnly } });
  return rec;
}

export async function removeSlaPolicy(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.configure");
  const r = await db.crmSlaPolicy.findFirst({ where: { id, organizationId: ctx.orgId } });
  if (!r) throw new BusinessError("Policy not found.");
  await db.crmSlaPolicy.delete({ where: { id } }); // cases keep the figures they were given, so nothing else changes
  await logAudit(ctx, { action: "SALES_SLA_POLICY_REMOVE", entity: "CrmSlaPolicy", entityId: id, oldValue: { priority: r.priority } });
}

/** The starting default policies. THESE FIGURES ARE PLACEHOLDERS for the organization to correct (docs/crm/07a-phase-7a-plan.md). Only made if there is no default policy yet. */
const STARTER_POLICIES: Array<[Priority, number, number, boolean]> = [["CRITICAL", 60, 240, false], ["HIGH", 240, 540, true], ["NORMAL", 540, 1620, true], ["LOW", 1620, 5400, true]];
export async function createStarterPolicies(ctx: Ctx) {
  await requireSales(ctx, "sales.configure");
  if (await db.crmSlaPolicy.findFirst({ where: { organizationId: ctx.orgId, accountKey: "" }, select: { id: true } })) throw new BusinessError("There are already default policies.");
  await db.crmSlaPolicy.createMany({ data: STARTER_POLICIES.map(([priority, fr, res, bh]) => ({ organizationId: ctx.orgId, accountKey: "", priority, firstResponseMinutes: fr, resolutionMinutes: res, businessHoursOnly: bh, createdBy: ctx.name })) });
  await logAudit(ctx, { action: "SALES_SLA_POLICY_STARTER", entity: "CrmSlaPolicy", entityId: ctx.orgId });
}

async function resolvePolicy(tx: Tx | typeof db, orgId: string, accountId: string, priority: Priority) {
  const own = await tx.crmSlaPolicy.findUnique({ where: { organizationId_accountKey_priority: { organizationId: orgId, accountKey: accountId, priority } } });
  if (own?.active) return own;
  const dflt = await tx.crmSlaPolicy.findUnique({ where: { organizationId_accountKey_priority: { organizationId: orgId, accountKey: "", priority } } });
  return dflt?.active ? dflt : null;
}

export async function setRenewalWindow(ctx: Ctx, days: number) {
  await requireSales(ctx, "sales.configure");
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new BusinessError("The renewal window is between 1 and 365 days.");
  await db.crmSetting.update({ where: { organizationId: ctx.orgId }, data: { renewalWindowDays: days, updatedBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_RENEWAL_WINDOW", entity: "CrmSetting", entityId: ctx.orgId, newValue: { days } });
}

// ─────────────────────────────── cases ───────────────────────────────

const caseSchema = z.object({
  accountId: z.string().min(1, "Choose the account"),
  contactId: z.string().optional(),
  opportunityId: z.string().optional(),
  beatId: z.string().optional(),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  subject: z.string().trim().min(3, "Say briefly what the case is about").max(200),
  description: z.string().trim().max(4000).optional(),
  ownerUserId: z.string().optional(),
});

async function loadCase(ctx: Ctx, tx: Tx | typeof db, id: string) {
  const c = await tx.crmCase.findFirst({ where: { id, organizationId: ctx.orgId, account: { ...ownerFilter(ctx) } } });
  if (!c) throw new BusinessError("Case not found.");
  return c;
}
const ev = (tx: Tx | typeof db, orgId: string, caseId: string, kind: "OPENED" | "RESPONDED" | "NOTE" | "REASSIGNED" | "RESOLVED" | "REOPENED" | "WARNING" | "BREACH" | "ESCALATED", byName: string, byUserId: string | null, note?: string | null) =>
  tx.crmCaseEvent.create({ data: { organizationId: orgId, caseId, kind, byName, byUserId, note: note ?? null } });
const notify = (orgId: string, userId: string, title: string, body: string, caseId: string) => db.crmNotification.create({ data: { organizationId: orgId, userId, title, body, href: `/sales/cases/${caseId}` } });

/** Opens a case. Its SLA deadlines are worked out now from the policy in force and the business-hours calendar, and kept. */
export async function createCase(ctx: Ctx, raw: z.input<typeof caseSchema>) {
  await requireSales(ctx, "sales.case.manage");
  const p = caseSchema.safeParse(raw);
  if (!p.success) throw new BusinessError(p.error.issues[0].message);
  const v = p.data;
  const account = await db.crmAccount.findFirst({ where: { id: v.accountId, organizationId: ctx.orgId, ...ownerFilter(ctx) } });
  if (!account) throw new BusinessError("Account not found.");
  if (account.status === "VOID") throw new BusinessError("A voided account cannot have a case.");
  if (v.contactId && !(await db.crmContact.findFirst({ where: { id: v.contactId, organizationId: ctx.orgId, accountId: account.id }, select: { id: true } }))) throw new BusinessError("That contact is not at this account.");
  if (v.opportunityId && !(await db.crmOpportunity.findFirst({ where: { id: v.opportunityId, organizationId: ctx.orgId, accountId: account.id }, select: { id: true } }))) throw new BusinessError("That deal is not this account's.");
  if (v.beatId && !(await db.beat.findFirst({ where: { id: v.beatId, organizationId: ctx.orgId, ...(account.clientId ? { clientId: account.clientId } : {}) }, select: { id: true } }))) throw new BusinessError("That site is not one of this client's.");
  const owner = v.ownerUserId ? await resolveOwner(ctx, v.ownerUserId) : { ownerUserId: account.ownerUserId, ownerName: account.ownerName };
  const now = new Date();
  const [policy, cal] = await Promise.all([resolvePolicy(db, ctx.orgId, account.id, v.priority), calendarOf(ctx.orgId)]);
  const sla = policy
    ? {
        slaPolicyId: policy.id, slaFirstResponseMinutes: policy.firstResponseMinutes, slaResolutionMinutes: policy.resolutionMinutes, slaBusinessHoursOnly: policy.businessHoursOnly,
        firstResponseDueAt: dueAt(now, policy.firstResponseMinutes, policy.businessHoursOnly, cal), firstResponseWarnAt: warnAt(now, policy.firstResponseMinutes, policy.businessHoursOnly, cal),
        resolutionDueAt: dueAt(now, policy.resolutionMinutes, policy.businessHoursOnly, cal), resolutionWarnAt: warnAt(now, policy.resolutionMinutes, policy.businessHoursOnly, cal),
      }
    : {};
  const c = await db.$transaction(async (tx: Tx) => {
    const number = await nextNumber(tx, ctx.orgId, "SALES_CASE");
    const made = await tx.crmCase.create({
      data: {
        organizationId: ctx.orgId, number, accountId: account.id, contactId: v.contactId ?? null, opportunityId: v.opportunityId ?? null, beatId: v.beatId ?? null, category: v.category, priority: v.priority,
        subject: v.subject, description: v.description || null, ...owner, openedAt: now, resolutionStartedAt: now, createdBy: ctx.name, createdByUserId: ctx.userId, ...sla,
      },
    });
    await ev(tx, ctx.orgId, made.id, "OPENED", ctx.name, ctx.userId);
    await logAudit(ctx, { action: "SALES_CASE_OPEN", entity: "CrmCase", entityId: made.id, newValue: { number, priority: v.priority, category: v.category, hasSla: !!policy } }, tx);
    return made;
  });
  await refreshAccountHealthSafe(ctx.orgId, account.id); // an open case changes the account's health
  if (owner.ownerUserId !== ctx.userId) await notify(ctx.orgId, owner.ownerUserId, `Case ${c.number} was opened for you`, `${v.priority} priority: ${v.subject}`, c.id).catch((e) => logger.error("sales_case_notify_failed", { error: e }));
  return c;
}

/** The first answer to the client stops the first-response clock. Later answers are logged. */
export async function respondToCase(ctx: Ctx, id: string, note: string) {
  await requireSales(ctx, "sales.case.manage");
  if (!note?.trim()) throw new BusinessError("Write what you told the client.");
  return db.$transaction(async (tx: Tx) => {
    const c = await loadCase(ctx, tx, id);
    if (c.status !== "OPEN") throw new BusinessError("A resolved case must be reopened before it can be answered.");
    const first = !c.firstRespondedAt;
    const u = first ? await tx.crmCase.update({ where: { id }, data: { firstRespondedAt: new Date() } }) : c;
    await ev(tx, ctx.orgId, id, "RESPONDED", ctx.name, ctx.userId, note.trim());
    await logAudit(ctx, { action: "SALES_CASE_RESPOND", entity: "CrmCase", entityId: id, newValue: { first } }, tx);
    return u;
  });
}

export async function addCaseNote(ctx: Ctx, id: string, note: string) {
  await requireSales(ctx, "sales.case.manage");
  if (!note?.trim()) throw new BusinessError("Write the note.");
  await loadCase(ctx, db, id);
  await ev(db, ctx.orgId, id, "NOTE", ctx.name, ctx.userId, note.trim());
  await logAudit(ctx, { action: "SALES_CASE_NOTE", entity: "CrmCase", entityId: id });
}

export async function resolveCase(ctx: Ctx, id: string, note: string) {
  await requireSales(ctx, "sales.case.manage");
  if (!note?.trim()) throw new BusinessError("Say how the case was resolved.");
  const done = await db.$transaction(async (tx: Tx) => {
    const c = await loadCase(ctx, tx, id);
    if (c.status !== "OPEN") throw new BusinessError("This case is already resolved.");
    const now = new Date();
    const u = await tx.crmCase.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: now, ...(c.firstRespondedAt ? {} : { firstRespondedAt: now }) } }); // resolving it answers it
    await ev(tx, ctx.orgId, id, "RESOLVED", ctx.name, ctx.userId, note.trim());
    await logAudit(ctx, { action: "SALES_CASE_RESOLVE", entity: "CrmCase", entityId: id }, tx);
    return u;
  });
  await refreshAccountHealthSafe(ctx.orgId, done.accountId);
  return done;
}

/** Reopening restarts the resolution clock from now (the first response is not asked for again) and is counted, so a case closed early shows up. */
export async function reopenCase(ctx: Ctx, id: string, reason: string) {
  await requireSales(ctx, "sales.case.manage");
  if (!reason?.trim()) throw new BusinessError("Say why the case is being reopened.");
  const cal = await calendarOf(ctx.orgId);
  const reopened = await db.$transaction(async (tx: Tx) => {
    const c = await loadCase(ctx, tx, id);
    if (c.status !== "RESOLVED") throw new BusinessError("Only a resolved case can be reopened.");
    const now = new Date();
    const clock =
      c.slaResolutionMinutes != null
        ? { resolutionDueAt: dueAt(now, c.slaResolutionMinutes, c.slaBusinessHoursOnly, cal), resolutionWarnAt: warnAt(now, c.slaResolutionMinutes, c.slaBusinessHoursOnly, cal) }
        : {};
    const u = await tx.crmCase.update({ where: { id }, data: { status: "OPEN", resolvedAt: null, reopenedCount: { increment: 1 }, resolutionStartedAt: now, resolutionWarnedAt: null, resolutionBreachedAt: null, ...clock } });
    await ev(tx, ctx.orgId, id, "REOPENED", ctx.name, ctx.userId, reason.trim());
    await logAudit(ctx, { action: "SALES_CASE_REOPEN", entity: "CrmCase", entityId: id, newValue: { reopenedCount: u.reopenedCount } }, tx);
    return u;
  });
  await refreshAccountHealthSafe(ctx.orgId, reopened.accountId);
  return reopened;
}

export async function reassignCase(ctx: Ctx, id: string, userId: string) {
  await requireSales(ctx, "sales.case.manage");
  const owner = await resolveOwner(ctx, userId); // only a manager may name someone else
  const c = await loadCase(ctx, db, id);
  await db.crmCase.update({ where: { id }, data: owner });
  await ev(db, ctx.orgId, id, "REASSIGNED", ctx.name, ctx.userId);
  await logAudit(ctx, { action: "SALES_CASE_REASSIGN", entity: "CrmCase", entityId: id, oldValue: { ownerUserId: c.ownerUserId }, newValue: { ownerUserId: owner.ownerUserId } });
  if (owner.ownerUserId !== ctx.userId) await notify(ctx.orgId, owner.ownerUserId, `Case ${c.number} was given to you`, c.subject, id);
}

function withClocks<T extends Awaited<ReturnType<typeof loadCase>>>(c: T, now = new Date()) {
  return {
    ...c,
    firstResponse: clockState({ dueAt: c.firstResponseDueAt, warnAt: c.firstResponseWarnAt, doneAt: c.firstRespondedAt }, now),
    resolution: clockState({ dueAt: c.resolutionDueAt, warnAt: c.resolutionWarnAt, doneAt: c.resolvedAt }, now),
  };
}

export async function getCase(ctx: Ctx, id: string) {
  await requireSales(ctx, "sales.view");
  const c = await loadCase(ctx, db, id);
  const events = await db.crmCaseEvent.findMany({ where: { caseId: id }, orderBy: [{ at: "asc" }, { id: "asc" }] });
  return { ...withClocks(c), events };
}

export async function listCases(ctx: Ctx, f: { status?: "OPEN" | "RESOLVED"; priority?: Priority; accountId?: string; breached?: boolean; reopened?: boolean } = {}) {
  await requireSales(ctx, "sales.view");
  const rows = await db.crmCase.findMany({
    where: { organizationId: ctx.orgId, account: { ...ownerFilter(ctx) }, ...(f.status ? { status: f.status } : {}), ...(f.priority ? { priority: f.priority } : {}), ...(f.accountId ? { accountId: f.accountId } : {}), ...(f.reopened ? { reopenedCount: { gt: 0 } } : {}) },
    include: { account: { select: { name: true } } },
    orderBy: [{ openedAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  const now = new Date();
  const out = rows.map((c) => withClocks(c, now));
  return f.breached ? out.filter((c) => c.firstResponse === "BREACHED" || c.firstResponse === "LATE" || c.resolution === "BREACHED" || c.resolution === "LATE") : out;
}

// ─────────────────────────────── the SLA job: warnings, breaches, escalation ───────────────────────────────

async function managers(orgId: string) {
  const users = await db.user.findMany({ where: { organizationId: orgId, active: true }, select: { id: true, name: true, email: true, role: true } });
  return users.filter((u) => can(u.role as never, "sales.manage") && can(u.role as never, "sales.view.all"));
}
async function tell(orgId: string, people: Array<{ id: string; email: string }>, title: string, body: string, caseId: string) {
  for (const u of people) {
    await notify(orgId, u.id, title, body, caseId);
    try {
      await sendEmail({ to: u.email, subject: title, text: body, html: `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` });
    } catch (e) {
      logger.error("sales_case_email_failed", { error: e });
    }
  }
}

/**
 * Looks at every open case: at 75% of a window the owner is warned, once; when a window has passed the case is flagged as breached, once, and the sales managers are told (the
 * escalation). Each step is claimed with a conditional update first, so running the job twice, or two at once, never repeats one.
 */
export async function runCaseSlaJob(now = new Date(), opts: { orgId?: string } = {}) {
  const out = { warned: 0, breached: 0, escalated: 0 };
  const open = await db.crmCase.findMany({ where: { status: "OPEN", ...(opts.orgId ? { organizationId: opts.orgId } : {}), OR: [{ firstResponseDueAt: { not: null } }, { resolutionDueAt: { not: null } }] }, take: 2000 });
  for (const c of open) {
    const clocks = [
      { name: "first response", due: c.firstResponseDueAt, warn: c.firstResponseWarnAt, done: c.firstRespondedAt, warned: "firstResponseWarnedAt", breached: "firstResponseBreachedAt", warnedAt: c.firstResponseWarnedAt, breachedAt: c.firstResponseBreachedAt },
      { name: "resolution", due: c.resolutionDueAt, warn: c.resolutionWarnAt, done: c.resolvedAt, warned: "resolutionWarnedAt", breached: "resolutionBreachedAt", warnedAt: c.resolutionWarnedAt, breachedAt: c.resolutionBreachedAt },
    ] as const;
    for (const k of clocks) {
      if (!k.due || k.done) continue;
      if (now.getTime() > k.due.getTime() && !k.breachedAt) {
        const claimed = await db.crmCase.updateMany({ where: { id: c.id, [k.breached]: null, status: "OPEN" }, data: { [k.breached]: now } });
        if (claimed.count) {
          out.breached++;
          await ev(db, c.organizationId, c.id, "BREACH", "SLA monitor", null, `The ${k.name} time was missed.`);
          const mgrs = await managers(c.organizationId);
          const owner = await db.user.findFirst({ where: { id: c.ownerUserId, organizationId: c.organizationId, active: true }, select: { id: true, email: true } });
          await tell(c.organizationId, [...(owner ? [owner] : []), ...mgrs.filter((m) => m.id !== c.ownerUserId)], `Case ${c.number}: the ${k.name} time was missed`, `${c.priority} priority: ${c.subject}`, c.id);
          await ev(db, c.organizationId, c.id, "ESCALATED", "SLA monitor", null, `${mgrs.length} sales manager(s) told.`);
          out.escalated++;
          await refreshAccountHealthSafe(c.organizationId, c.accountId); // a missed deadline changes the account's health
        }
      } else if (k.warn && now.getTime() >= k.warn.getTime() && !k.warnedAt && !k.breachedAt) {
        const claimed = await db.crmCase.updateMany({ where: { id: c.id, [k.warned]: null, status: "OPEN" }, data: { [k.warned]: now } });
        if (claimed.count) {
          out.warned++;
          await ev(db, c.organizationId, c.id, "WARNING", "SLA monitor", null, `75% of the ${k.name} time has gone.`);
          const owner = await db.user.findFirst({ where: { id: c.ownerUserId, organizationId: c.organizationId, active: true }, select: { id: true, email: true } });
          if (owner) await tell(c.organizationId, [owner], `Case ${c.number}: 75% of the ${k.name} time has gone`, `${c.priority} priority: ${c.subject}`, c.id);
        }
      }
    }
  }
  return out;
}

// ─────────────────────────────── renewals ───────────────────────────────

/**
 * Opens one renewal deal for each active contract that ends within the organization's renewal window and has none yet. The current monthly value is the one of the deal that won the contract
 * (through its handover); a contract that did not come from a handover has no such figure and the renewal deal is opened at zero. A contract whose client has no sales account is counted and left.
 */
export async function runRenewalsJob(now = new Date(), opts: { orgId?: string } = {}) {
  const out = { created: 0, alreadyOpen: 0, noAccount: 0 };
  const settings = await db.crmSetting.findMany({ where: { enabled: true, ...(opts.orgId ? { organizationId: opts.orgId } : {}) }, select: { organizationId: true, renewalWindowDays: true } });
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  for (const s of settings) {
    const contracts = await db.contract.findMany({ where: { organizationId: s.organizationId, status: "ACTIVE", endDate: { gte: today, lte: new Date(today.getTime() + s.renewalWindowDays * DAY) } }, take: 500 });
    for (const k of contracts) {
      if (await db.crmRenewalLink.findUnique({ where: { contractId: k.id } })) { out.alreadyOpen++; continue; }
      const account = await db.crmAccount.findFirst({ where: { organizationId: s.organizationId, clientId: k.clientId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
      if (!account) { out.noAccount++; continue; }
      const won = await db.crmHandover.findFirst({ where: { organizationId: s.organizationId, contractId: k.id }, select: { opportunity: { select: { monthlyContractValue: true, serviceType: true } } } });
      const primary = await db.crmContact.findFirst({ where: { organizationId: s.organizationId, accountId: account.id, status: "ACTIVE" }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { id: true } });
      const sys: Ctx = { userId: "system:renewals", orgId: s.organizationId, role: "COMPANY_ADMIN", name: "Renewals job", email: "", employeeId: null };
      try {
        const opp = await db.$transaction(async (tx: Tx) => {
          const pipelineId = await ensureRenewalPipeline(s.organizationId, tx);
          const o = await insertOpportunity(sys, tx, {
            accountId: account.id, primaryContactId: primary?.id, name: `Renewal: ${k.name}`, serviceType: won?.opportunity.serviceType ?? "OTHER", monthlyContractValue: won ? won.opportunity.monthlyContractValue.toString() : "0",
            pipelineId, expectedCloseDate: k.endDate!.toISOString().slice(0, 10), source: "EXISTING_CLIENT", ownerUserId: account.ownerUserId, ownerName: account.ownerName,
          });
          await tx.crmRenewalLink.create({ data: { organizationId: s.organizationId, contractId: k.id, opportunityId: o.id } }); // one for each contract: the database refuses a second
          return o;
        });
        out.created++;
        await db.crmNotification.create({ data: { organizationId: s.organizationId, userId: account.ownerUserId, title: `Renewal due: ${k.name}`, body: `The contract ends on ${k.endDate!.toISOString().slice(0, 10)}. A renewal deal has been opened${won ? "" : " (its current value is not known: set it)"}.`, href: `/sales/opportunities/${opp.id}` } });
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") { out.alreadyOpen++; continue; } // another run got there first
        throw e;
      }
    }
  }
  return out;
}

/** The scheduled job: SLA warnings and breaches, then renewals. */
export async function runCasesJob(now = new Date()) {
  return { ...(await runCaseSlaJob(now)), ...(await runRenewalsJob(now)) };
}

