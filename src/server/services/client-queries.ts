/**
 * Client queries: a client asks the bureau something in the portal; the bureau answers; either side can close it. Each query is a thread of
 * messages that are never edited, and how long the bureau took to first reply is kept. The bureau's team is emailed when a query is raised or
 * the client replies, and the person who raised it when the bureau replies (best effort: a failed email never loses a message).
 */
import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { assertCan, BusinessError, db } from "./_base";
import { logAudit } from "./audit";
import { nextNumber } from "./numbering";
import { listClients } from "./bureau";
import { teamEmails } from "./payroll-reminders";

export const QUERY_CATEGORIES = ["PAYROLL", "EMPLOYEE_DETAILS", "STATUTORY", "INPUTS", "OTHER"] as const;
export const QUERY_CATEGORY_LABELS: Record<(typeof QUERY_CATEGORIES)[number], string> = {
  PAYROLL: "This month's payroll",
  EMPLOYEE_DETAILS: "An employee's details",
  STATUTORY: "Tax, pension or other statutory matters",
  INPUTS: "Inputs we sent you",
  OTHER: "Something else",
};
/** A reply is expected within this many hours; a query waiting longer is flagged. */
export const RESPONSE_TARGET_HOURS = 24;

const isClientRole = (ctx: Ctx) => ctx.role === "CLIENT_APPROVER" || ctx.role === "CLIENT_HR";
const hours = (a: Date, b: Date) => Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 10) / 10;

export async function notify(to: string[], subject: string, text: string) {
  for (const t of to) {
    try {
      await sendEmail({ to: t, subject, text, html: `<div style="font-family:system-ui,sans-serif;max-width:600px">${text.split("\n").map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("")}</div>` });
    } catch (e) {
      logger.error("client_query_email_failed", { to: t, error: e });
    }
  }
}

async function loadQuery(ctx: Ctx, id: string) {
  const q = await db.clientQuery.findFirst({ where: { id, organizationId: ctx.orgId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!q) throw new BusinessError("Query not found.");
  return q;
}

export const raiseSchema = z.object({
  subject: z.string().trim().min(5, "Give the query a short title (at least 5 characters)").max(150),
  category: z.enum(QUERY_CATEGORIES),
  body: z.string().trim().min(10, "Say what you need (at least 10 characters)").max(5000),
});

export async function raiseQuery(ctx: Ctx, raw: z.input<typeof raiseSchema>) {
  assertCan(ctx, "portal.query");
  const v = raiseSchema.parse(raw);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, bureauOrganizationId: true } });
  const q = await db.$transaction(async (tx) => {
    const number = await nextNumber(tx, ctx.orgId, "CLIENT_QUERY");
    const created = await tx.clientQuery.create({ data: { organizationId: ctx.orgId, number, subject: v.subject, category: v.category, raisedBy: ctx.name, raisedByUserId: ctx.userId } });
    await tx.clientQueryMessage.create({ data: { organizationId: ctx.orgId, queryId: created.id, side: "CLIENT", authorName: ctx.name, authorUserId: ctx.userId, body: v.body } });
    await logAudit(ctx, { action: "CLIENT_QUERY_RAISE", entity: "ClientQuery", entityId: created.id, newValue: { number, subject: v.subject, category: v.category } }, tx);
    return created;
  });
  await notify(await teamEmails(ctx.orgId, org.bureauOrganizationId, []), `New query from ${org.name}: ${q.subject}`, `${ctx.name} (${org.name}) raised ${q.number}: ${q.subject}\n\n${v.body}\n\nWork in ${org.name} and open Service Desk to answer it.`);
  return q;
}

/** A message on a query: from the client in the portal, or from the bureau's staff. */
export async function replyToQuery(ctx: Ctx, queryId: string, body: string) {
  const client = isClientRole(ctx);
  assertCan(ctx, client ? "portal.query" : "query.respond");
  if (!body || body.trim().length < 2) throw new BusinessError("Write your message.");
  const q = await loadQuery(ctx, queryId);
  if (q.status === "CLOSED") throw new BusinessError("This query is closed; raise a new one.");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, bureauOrganizationId: true } });
  await db.$transaction(async (tx) => {
    await tx.clientQueryMessage.create({ data: { organizationId: ctx.orgId, queryId, side: client ? "CLIENT" : "BUREAU", authorName: ctx.name, authorUserId: ctx.userId, body: body.trim() } });
    await tx.clientQuery.update({ where: { id: queryId }, data: client ? { status: "OPEN" } : { status: "ANSWERED", ...(q.firstResponseAt ? {} : { firstResponseAt: new Date() }) } });
    await logAudit(ctx, { action: client ? "CLIENT_QUERY_CLIENT_REPLY" : "CLIENT_QUERY_BUREAU_REPLY", entity: "ClientQuery", entityId: queryId, newValue: { number: q.number } }, tx);
  });
  if (client) await notify(await teamEmails(ctx.orgId, org.bureauOrganizationId, []), `${org.name} replied on ${q.number}: ${q.subject}`, `${ctx.name} replied:\n\n${body.trim()}`);
  else {
    const raiser = await db.user.findUnique({ where: { id: q.raisedByUserId }, select: { email: true, active: true } });
    if (raiser?.active) await notify([raiser.email], `Your query ${q.number} has a reply: ${q.subject}`, `${ctx.name}${org.bureauOrganizationId ? ` (${(await db.organization.findUnique({ where: { id: ctx.homeOrgId ?? org.bureauOrganizationId }, select: { name: true } }))?.name ?? "your payroll provider"})` : ""} replied:\n\n${body.trim()}\n\nSign in to the portal to read the thread and reply.`);
  }
}

/** Closes a query: the client when they are satisfied, or the bureau when it is dealt with. */
export async function closeQuery(ctx: Ctx, queryId: string) {
  assertCan(ctx, isClientRole(ctx) ? "portal.query" : "query.respond");
  const q = await loadQuery(ctx, queryId);
  if (q.status === "CLOSED") throw new BusinessError("This query is already closed.");
  await db.clientQuery.update({ where: { id: queryId }, data: { status: "CLOSED", closedAt: new Date(), closedBy: ctx.name } });
  await logAudit(ctx, { action: "CLIENT_QUERY_CLOSE", entity: "ClientQuery", entityId: queryId, newValue: { number: q.number } });
}

const view = (q: { createdAt: Date; firstResponseAt: Date | null; status: string; closedAt: Date | null }, now = new Date()) => ({
  responseHours: q.firstResponseAt ? hours(q.createdAt, q.firstResponseAt) : null,
  waitingHours: q.status === "OPEN" && !q.firstResponseAt ? hours(q.createdAt, now) : null,
  overdue: q.status !== "CLOSED" && !q.firstResponseAt && hours(q.createdAt, now) > RESPONSE_TARGET_HOURS,
});

export async function listQueries(ctx: Ctx) {
  if (!can(ctx.role, "portal.query") && !can(ctx.role, "query.respond")) assertCan(ctx, "portal.query");
  const rows = await db.clientQuery.findMany({ where: { organizationId: ctx.orgId }, include: { _count: { select: { messages: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });
  return rows.map((q) => ({ ...q, ...view(q) }));
}

export async function getQuery(ctx: Ctx, id: string) {
  if (!can(ctx.role, "portal.query") && !can(ctx.role, "query.respond")) assertCan(ctx, "portal.query");
  const q = await loadQuery(ctx, id);
  return { ...q, ...view(q) };
}

/** Open queries across the clients this person works on, oldest waiting first, with how long the bureau has taken on average. */
export async function bureauOpenQueries(ctx: Ctx) {
  assertCan(ctx, "bureau.view");
  const { clients } = await listClients(ctx);
  if (!clients.length) return { rows: [], averageResponseHours: null as number | null };
  const names = new Map(clients.map((c) => [c.org.id, c.org.name]));
  const ids = [...names.keys()];
  const [open, answered] = await Promise.all([
    db.clientQuery.findMany({ where: { organizationId: { in: ids }, status: { not: "CLOSED" } }, orderBy: { createdAt: "asc" } }),
    db.clientQuery.findMany({ where: { organizationId: { in: ids }, firstResponseAt: { not: null } }, select: { createdAt: true, firstResponseAt: true }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const avg = answered.length ? Math.round((answered.reduce((a, q) => a + hours(q.createdAt, q.firstResponseAt!), 0) / answered.length) * 10) / 10 : null;
  return { rows: open.map((q) => ({ ...q, clientName: names.get(q.organizationId) ?? "", ...view(q) })), averageResponseHours: avg };
}
