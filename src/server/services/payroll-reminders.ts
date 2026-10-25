/**
 * Email reminders for a client's payroll calendar: to the client's contact about inputs and approval they owe, and to the bureau team
 * about everything overdue or due soon. Off for a client until someone switches it on. Never at weekends, never the same reminder twice in a
 * day (the log records it, and a send that failed is not logged so it is tried again), and a client is nudged at most a handful of times per month for the same thing.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { can, type Role } from "@/lib/auth/permissions";
import { iso } from "@/lib/dates";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import {
  isWorkingDay,
  MAX_CLIENT_REMINDERS_PER_MONTH,
  planReminders,
  renderClientApproval,
  renderClientInputs,
  renderTeamDigest,
  type PeriodFacts,
  type ReminderKind,
} from "@/lib/payroll-reminders";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { milestonesFor, toDates } from "./payroll-calendar";

// ─────────────────────────────── Setting ───────────────────────────────

export async function getReminderSetting(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  const s = await db.payrollReminderSetting.findUnique({ where: { organizationId: ctx.orgId } });
  return { enabled: s?.enabled ?? false, remindClient: s?.remindClient ?? true, remindTeam: s?.remindTeam ?? true, leadDays: s?.leadDays ?? 2, extraEmails: s?.extraEmails ?? [] };
}

export const reminderSettingSchema = z.object({
  enabled: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
  remindClient: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
  remindTeam: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
  leadDays: z.coerce.number().int().min(0).max(14),
  extraEmails: z
    .string()
    .optional()
    .transform((s) => (s ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))
    .refine((l) => l.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)), "One of the extra addresses is not a valid email."),
});

export async function saveReminderSetting(ctx: Ctx, raw: z.input<typeof reminderSettingSchema>) {
  assertCan(ctx, "settings.manage");
  const v = reminderSettingSchema.parse(raw);
  const before = await getReminderSetting(ctx);
  await db.payrollReminderSetting.upsert({
    where: { organizationId: ctx.orgId },
    create: { organizationId: ctx.orgId, ...v, updatedBy: ctx.name },
    update: { ...v, updatedBy: ctx.name },
  });
  await logAudit(ctx, { action: "PAYROLL_REMINDER_SETTING_SAVE", entity: "PayrollReminderSetting", entityId: ctx.orgId, oldValue: before, newValue: v });
}

// ─────────────────────────────── Working out and sending ───────────────────────────────

export type ReminderOutcome = {
  periodName: string;
  kind: ReminderKind;
  to: string;
  status: "SENT" | "WOULD_SEND" | "ALREADY_SENT_TODAY" | "LIMIT_REACHED" | "FAILED";
};
export type ReminderRun = { organization: string; skipped?: string; outcomes: ReminderOutcome[]; notes: string[] };

export async function teamEmails(orgId: string, bureauId: string | null, extra: string[]): Promise<string[]> {
  let users: { email: string; role: Role }[];
  if (bureauId) {
    const [granted, bureauUsers] = await Promise.all([
      db.user.findMany({ where: { active: true, clientAccess: { some: { clientOrganizationId: orgId } } }, select: { email: true, role: true } }),
      db.user.findMany({ where: { active: true, organizationId: bureauId }, select: { email: true, role: true } }),
    ]);
    users = [...granted, ...bureauUsers.filter((u) => can(u.role as Role, "bureau.manage"))] as { email: string; role: Role }[];
  } else {
    users = (await db.user.findMany({ where: { active: true, organizationId: orgId, role: { in: ["PAYROLL_ADMIN", "COMPANY_ADMIN"] } }, select: { email: true, role: true } })) as { email: string; role: Role }[];
  }
  return [...new Set([...users.map((u) => u.email), ...extra].map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/**
 * Works out, and unless `dryRun` sends, today's reminders for one organization. Only organizations that have switched reminders on are sent to;
 * a preview ignores that so people can see what would go out before switching on.
 */
export async function sendDueReminders(orgId: string, opts: { now?: Date; dryRun?: boolean; ignoreWeekend?: boolean } = {}): Promise<ReminderRun> {
  const now = opts.now ?? new Date();
  const today = iso(now);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, include: { engagement: true, bureauOrganization: { select: { id: true, name: true } }, reminderSetting: true } });
  const out: ReminderRun = { organization: org.name, outcomes: [], notes: [] };
  const setting = org.reminderSetting;
  if (!opts.dryRun && !setting?.enabled) return { ...out, skipped: "Reminders are switched off for this client." };
  if (!opts.dryRun && !opts.ignoreWeekend && !isWorkingDay(today)) return { ...out, skipped: "No reminders at weekends." };
  if (opts.dryRun && !isWorkingDay(today)) out.notes.push("Today is a weekend, so nothing would be sent today.");

  const leadDays = setting?.leadDays ?? 2;
  const wantClient = setting?.remindClient ?? true;
  const wantTeam = setting?.remindTeam ?? true;
  const bureauName = org.bureauOrganization?.name ?? org.name;
  const contact = org.engagement?.contactEmail?.trim().toLowerCase() || null;
  const team = wantTeam ? await teamEmails(org.id, org.bureauOrganizationId, setting?.extraEmails ?? []) : [];
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const entries = await db.payrollCalendarEntry.findMany({
    where: { organizationId: orgId, remittanceDue: { gte: new Date(now.getTime() - 30 * 86400000) } },
    include: { period: { select: { name: true } } },
    orderBy: { inputCutoff: "asc" },
  });
  for (const e of entries) {
    const [milestones, items] = await Promise.all([milestonesFor(orgId, e.periodId, toDates(e), today), db.payrollInputItem.findMany({ where: { periodId: e.periodId, status: "EXPECTED" }, select: { kind: true } })]);
    const facts: PeriodFacts = { periodName: e.period.name, clientName: org.name, bureauName, leadDays, milestones, outstandingInputs: items.map((i) => i.kind) };
    for (const plan of planReminders(facts)) {
      let recipients: string[] = [];
      let mail: { subject: string; text: string; html: string };
      if (plan.kind === "CLIENT_INPUTS") {
        mail = renderClientInputs(facts, plan, today, org.engagement?.contactName);
        recipients = wantClient && contact ? [contact] : [];
        if (wantClient && !contact) out.notes.push(`${e.period.name}: inputs are owed but the client has no contact email on the engagement.`);
      } else if (plan.kind === "CLIENT_APPROVAL") {
        mail = renderClientApproval(facts, plan, today, org.engagement?.contactName);
        recipients = wantClient && contact ? [contact] : [];
        if (wantClient && !contact) out.notes.push(`${e.period.name}: approval is owed but the client has no contact email on the engagement.`);
      } else {
        mail = renderTeamDigest(facts, plan, appUrl, e.periodId);
        recipients = team;
      }
      for (const to of recipients) {
        const base = { periodName: e.period.name, kind: plan.kind, to };
        const sentToday = await db.payrollReminderLog.findFirst({ where: { periodId: e.periodId, kind: plan.kind, toEmail: to, day: new Date(`${today}T00:00:00Z`) }, select: { id: true } });
        if (sentToday) {
          out.outcomes.push({ ...base, status: "ALREADY_SENT_TODAY" });
          continue;
        }
        if (plan.kind !== "TEAM_DIGEST" && (await db.payrollReminderLog.count({ where: { periodId: e.periodId, kind: plan.kind, toEmail: to } })) >= MAX_CLIENT_REMINDERS_PER_MONTH) {
          out.outcomes.push({ ...base, status: "LIMIT_REACHED" });
          continue;
        }
        if (opts.dryRun) {
          out.outcomes.push({ ...base, status: "WOULD_SEND" });
          continue;
        }
        try {
          await sendEmail({ to, ...mail });
        } catch (err) {
          // not logged, so the next run today or tomorrow tries again
          logger.error("payroll_reminder_send_failed", { to, organization: org.name, error: err });
          out.outcomes.push({ ...base, status: "FAILED" });
          continue;
        }
        out.outcomes.push({ ...base, status: "SENT" });
        try {
          await db.payrollReminderLog.create({ data: { organizationId: orgId, periodId: e.periodId, kind: plan.kind, toEmail: to, subject: mail.subject, day: new Date(`${today}T00:00:00Z`) } });
        } catch (err) {
          // a run at the same moment logged it first; the unique key keeps the log to one row
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
        }
      }
    }
  }
  const sent = out.outcomes.filter((o) => o.status === "SENT").length;
  if (sent)
    await db.auditLog.create({
      data: { organizationId: orgId, userName: "System (payroll reminders)", action: "PAYROLL_REMINDERS_SENT", entity: "PayrollReminderLog", newValue: { sent, failed: out.outcomes.filter((o) => o.status === "FAILED").length }, metadata: { day: today } },
    });
  return out;
}

/** What would go out today, without sending anything. */
export async function previewReminders(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  return sendDueReminders(ctx.orgId, { dryRun: true });
}

/** Staff sending today's reminders now (the once-a-day rule still applies). */
export async function sendRemindersNow(ctx: Ctx) {
  assertCan(ctx, "payroll.inputs");
  const s = await getReminderSetting(ctx);
  if (!s.enabled) throw new BusinessError("Reminders are switched off for this client. Switch them on first.");
  const r = await sendDueReminders(ctx.orgId, { ignoreWeekend: true });
  await logAudit(ctx, { action: "PAYROLL_REMINDERS_SEND_NOW", entity: "PayrollReminderLog", newValue: { sent: r.outcomes.filter((o) => o.status === "SENT").length } });
  return r;
}

export async function recentReminders(ctx: Ctx) {
  assertCan(ctx, "payroll.view");
  return db.payrollReminderLog.findMany({ where: { organizationId: ctx.orgId }, orderBy: { sentAt: "desc" }, take: 20 });
}

/** The scheduled job: every organization that has switched reminders on. One failing never stops the rest. */
export async function runRemindersForAllOrgs(now = new Date()): Promise<ReminderRun[]> {
  const orgs = await db.payrollReminderSetting.findMany({ where: { enabled: true }, select: { organizationId: true } });
  const out: ReminderRun[] = [];
  for (const o of orgs) {
    try {
      out.push(await sendDueReminders(o.organizationId, { now }));
    } catch (e) {
      logger.error("payroll_reminders_org_failed", { organizationId: o.organizationId, error: e });
      out.push({ organization: o.organizationId, skipped: "Failed — see the server log.", outcomes: [], notes: [] });
    }
  }
  return out;
}
