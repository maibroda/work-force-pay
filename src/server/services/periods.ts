/**
 * Financial years and accounting periods.
 *
 * Every journal belongs to a monthly accounting period and can only be posted while that period's status allows it.
 * Years are created on demand (the first posting into a year creates its twelve periods) or ahead of time by hand.
 *
 *   OPEN ──soft close──▶ SOFT_CLOSED ──close──▶ CLOSED ──lock──▶ LOCKED
 *     ▲                       │                    │
 *     └───────── reopen (reason) ─────────────────┘            (a locked period is final)
 *
 * Closing needs a second person: whoever soft closed a period cannot also close it. Reopening needs the reopen
 * permission and a written reason. Every step is kept in the period's own append-only trail and in the audit log.
 * A period can only be closed once every earlier period that has journals has been closed, and locked once every earlier
 * period that has journals has been locked. Earlier periods with nothing in them don't hold anything up, so a company
 * that starts using the system mid-year isn't made to close months that were never used.
 */
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { d, iso } from "@/lib/dates";
import { fiscalYearFor, monthlyPeriods, nextStatus, whyNot, type PeriodAction, type PeriodStatus } from "@/lib/fiscal";
import { assertCan, BusinessError, db, type Tx } from "./_base";
import { logAudit } from "./audit";

/** The year containing `date`, created with its twelve periods if it doesn't exist yet. Safe to call concurrently. */
export async function ensureFiscalYear(tx: Tx, orgId: string, date: Date) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { fiscalYearStartMonth: true } });
  const spec = fiscalYearFor(date, org.fiscalYearStartMonth);
  const existing = await tx.fiscalYear.findUnique({ where: { organizationId_startDate: { organizationId: orgId, startDate: spec.startDate } } });
  if (existing) return existing;
  const year = await tx.fiscalYear.upsert({
    where: { organizationId_startDate: { organizationId: orgId, startDate: spec.startDate } },
    update: {},
    create: { organizationId: orgId, name: spec.name, startDate: spec.startDate, endDate: spec.endDate },
  });
  await tx.accountingPeriod.createMany({
    data: monthlyPeriods(spec.startDate).map((p) => ({ organizationId: orgId, fiscalYearId: year.id, number: p.number, name: p.name, startDate: p.startDate, endDate: p.endDate })),
    skipDuplicates: true,
  });
  return year;
}

/** The accounting period containing `date`, creating its year first if needed. */
export async function periodFor(tx: Tx, orgId: string, date: Date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const find = () => tx.accountingPeriod.findFirst({ where: { organizationId: orgId, startDate: { lte: day }, endDate: { gte: day } } });
  const found = await find();
  if (found) return found;
  await ensureFiscalYear(tx, orgId, day);
  const created = await find();
  if (!created) throw new BusinessError(`No accounting period covers ${iso(day)}.`);
  return created;
}

export async function listFiscalYears(ctx: Ctx) {
  assertCan(ctx, "gl.view");
  const years = await db.fiscalYear.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { startDate: "desc" },
    include: { periods: { orderBy: { number: "asc" }, include: { _count: { select: { journals: true } }, events: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  });
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { fiscalYearStartMonth: true } });
  return { startMonth: org.fiscalYearStartMonth, years };
}

export async function periodTrail(ctx: Ctx, periodId: string) {
  assertCan(ctx, "gl.view");
  const p = await db.accountingPeriod.findFirst({ where: { id: periodId, organizationId: ctx.orgId } });
  if (!p) throw new BusinessError("Period not found.");
  return db.accountingPeriodEvent.findMany({ where: { periodId }, orderBy: { createdAt: "asc" } });
}

/** Creates a financial year ahead of time (the one that contains the given date). */
export async function createFiscalYear(ctx: Ctx, containing: string) {
  assertCan(ctx, "period.approve");
  const date = d(containing);
  if (Number.isNaN(date.getTime())) throw new BusinessError("That date isn't valid.");
  return db.$transaction(async (tx) => {
    const year = await ensureFiscalYear(tx, ctx.orgId, date);
    await logAudit(ctx, { action: "FISCAL_YEAR_CREATE", entity: "FiscalYear", entityId: year.id, newValue: { name: year.name } }, tx);
    return year;
  });
}

const PERMISSION: Record<PeriodAction, "period.close" | "period.approve" | "period.reopen"> = {
  SOFT_CLOSE: "period.close",
  CLOSE: "period.approve",
  LOCK: "period.approve",
  REOPEN: "period.reopen",
};

export async function transitionPeriod(ctx: Ctx, periodId: string, action: PeriodAction, reason?: string) {
  assertCan(ctx, PERMISSION[action]);
  return db.$transaction(async (tx) => {
    const p = await tx.accountingPeriod.findFirst({ where: { id: periodId, organizationId: ctx.orgId } });
    if (!p) throw new BusinessError("Period not found.");
    const to = nextStatus(action, p.status as PeriodStatus);
    if (!to) throw new BusinessError(whyNot(action, p.status as PeriodStatus));
    if (action === "REOPEN" && (!reason || reason.trim().length < 15)) throw new BusinessError("Say why this period is being reopened, in a sentence or two. It is recorded.");

    if (action === "CLOSE" || action === "LOCK") {
      const earlier = await tx.accountingPeriod.findFirst({
        where: {
          organizationId: ctx.orgId,
          startDate: { lt: p.startDate },
          journals: { some: {} },
          status: { in: action === "CLOSE" ? ["OPEN", "SOFT_CLOSED"] : ["OPEN", "SOFT_CLOSED", "CLOSED"] },
        },
        orderBy: { startDate: "asc" },
      });
      if (earlier)
        throw new BusinessError(
          `${earlier.name} has postings and is still ${earlier.status === "OPEN" ? "open" : earlier.status === "SOFT_CLOSED" ? "soft closed" : "only closed"}. ${action === "CLOSE" ? "Close" : "Lock"} the earlier periods first.`,
        );
    }
    if (action === "CLOSE") {
      const soft = await tx.accountingPeriodEvent.findFirst({ where: { periodId, action: "SOFT_CLOSE" }, orderBy: { createdAt: "desc" } });
      if (soft && soft.actorUserId === ctx.userId) throw new BusinessError("You soft closed this period, so someone else has to close it.");
    }

    const updated = await tx.accountingPeriod.update({ where: { id: periodId }, data: { status: to } });
    await tx.accountingPeriodEvent.create({
      data: { organizationId: ctx.orgId, periodId, action, fromStatus: p.status, toStatus: to, actor: ctx.name, actorUserId: ctx.userId, reason: reason?.trim() || null },
    });
    await logAudit(ctx, { action: `PERIOD_${action}`, entity: "AccountingPeriod", entityId: periodId, oldValue: { status: p.status }, newValue: { status: to, period: p.name }, reason }, tx);
    return updated;
  });
}

/** Whether the person may still post into a soft-closed period. */
export const canPostWhenSoftClosed = (ctx: Ctx) => can(ctx.role, "period.close");

/**
 * Stamps the accounting period on journals posted before periods existed. Each journal's period is set once and never
 * changed; the database permits this one update on an unstamped journal and nothing else. Returns how many were stamped.
 */
export async function backfillJournalPeriods(orgId: string): Promise<number> {
  const unstamped = await db.journalEntry.findMany({ where: { organizationId: orgId, periodId: null }, select: { id: true, postingDate: true } });
  let n = 0;
  for (const j of unstamped) {
    const period = await periodFor(db, orgId, j.postingDate);
    await db.journalEntry.update({ where: { id: j.id }, data: { periodId: period.id } });
    n++;
  }
  return n;
}
