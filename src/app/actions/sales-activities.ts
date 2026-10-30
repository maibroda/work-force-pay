"use server";
import { act } from "./_run";
import { cancelTask, completeTask, createTask, logActivity, reopenTask, sendEmailTo, voidActivity } from "@/server/services/sales/activities";

type V = Record<string, unknown>;
const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const num = (x: unknown) => (x === undefined || x === null || x === "" ? undefined : Number(x));
const target = (v: V) => ({ leadId: text(v.leadId), accountId: text(v.accountId), contactId: text(v.contactId), opportunityId: text(v.opportunityId) });

const REVALIDATE = ["/sales/leads", "/sales/accounts", "/sales/contacts", "/sales/opportunities", "/sales/tasks"];

/** Logs a call, meeting, site survey, WhatsApp, email or note. A marketing message to someone who has not agreed is refused. */
export async function logActivityAction(v: V) {
  return act("sales.manage", async (ctx) => {
    const kind = String(v.kind ?? "") as "CALL" | "MEETING" | "SITE_SURVEY" | "WHATSAPP" | "EMAIL" | "NOTE";
    const photoLinks = (text(v.photoLinks) ?? "").split(/[\s,]+/).filter(Boolean);
    await logActivity(ctx, {
      kind,
      ...target(v),
      occurredAt: text(v.occurredAt),
      subject: text(v.subject),
      body: text(v.body),
      callOutcome: text(v.callOutcome) as never,
      purpose: text(v.purpose) as never,
      survey: kind === "SITE_SURVEY" ? { siteType: String(v.siteType ?? ""), entryPoints: num(v.entryPoints), existingGuards: num(v.existingGuards), riskNotes: text(v.riskNotes), photoLinks: photoLinks.length ? photoLinks : undefined } : undefined,
    });
    return { message: "Logged." };
  }, REVALIDATE);
}

/** Using a call or WhatsApp link logs it first. Nothing is opened if this fails (for example a marketing WhatsApp to someone who has not agreed). */
export async function logLinkUseAction(v: V) {
  return act("sales.manage", async (ctx) => {
    const kind = v.kind === "WHATSAPP" ? "WHATSAPP" : "CALL";
    await logActivity(ctx, { kind, ...target(v), purpose: kind === "WHATSAPP" ? (text(v.purpose) as never) : undefined, body: kind === "WHATSAPP" ? text(v.body) : undefined, viaLink: true });
    return { message: kind === "WHATSAPP" ? "Logged. Opening WhatsApp." : "Logged. Starting the call." };
  }, REVALIDATE);
}

export async function sendEmailAction(v: V) {
  return act("sales.manage", async (ctx) => {
    await sendEmailTo(ctx, { contactId: text(v.contactId), leadId: text(v.leadId), opportunityId: text(v.opportunityId), subject: String(v.subject ?? ""), body: String(v.body ?? ""), purpose: v.purpose === "MARKETING" ? "MARKETING" : "SERVICE" });
    return { message: "Email sent and logged." };
  }, REVALIDATE);
}

export async function voidActivityAction(v: V) {
  return act("sales.manage", async (ctx) => {
    await voidActivity(ctx, String(v.id ?? ""), String(v.reason ?? ""));
    return { message: "Voided. It stays on the timeline with your reason." };
  }, REVALIDATE);
}

export async function createTaskAction(v: V) {
  return act("sales.manage", async (ctx) => {
    // the date and time are typed in Lagos time (UTC+1)
    const at = (s: unknown) => (text(s) ? `${String(s).trim()}:00+01:00` : undefined); // a date-time field gives 2026-10-30T14:30
    await createTask(ctx, { title: String(v.title ?? ""), notes: text(v.notes), dueAt: at(v.dueAt) ?? "", reminderAt: at(v.reminderAt), ownerUserId: text(v.ownerUserId), ...target(v) });
    return { message: "Task added." };
  }, REVALIDATE);
}

export async function completeTaskAction(v: V) {
  return act("sales.manage", async (ctx) => {
    await completeTask(ctx, String(v.id ?? ""));
    return { message: "Done." };
  }, [...REVALIDATE, "/sales/board"]);
}

export async function reopenTaskAction(v: V) {
  return act("sales.manage", async (ctx) => {
    await reopenTask(ctx, String(v.id ?? ""));
    return { message: "Reopened." };
  }, REVALIDATE);
}

export async function cancelTaskAction(v: V) {
  return act("sales.manage", async (ctx) => {
    await cancelTask(ctx, String(v.id ?? ""));
    return { message: "Cancelled." };
  }, REVALIDATE);
}
