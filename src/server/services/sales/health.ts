/**
 * The account health score of a client account: it gathers six facts (missed SLA deadlines, open severe cases, guard absence, the oldest overdue invoice, a contract ending
 * without a renewal, time since client-facing contact), scores them with src/lib/sales/health.ts, and stores the latest score with what each measure found. It READS attendance and
 * invoices (through the same open-invoice function the receivables screens use) and changes nothing in payroll, attendance or billing. An account that is at risk gets one task
 * for its owner, not a new one each night. Audit entries carry ids, bands and the score, never names or message text.
 */
import type { CrmHealthBand } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { logger } from "@/lib/logger";
import { DEFAULT_WEIGHTS, scoreAccount, validateWeights, type Band, type Component, type HealthInputs, type Weights } from "@/lib/sales/health";
import { daysPastDue } from "@/lib/statements";
import { BusinessError, db } from "../_base";
import { logAudit } from "../audit";
import { openInvoicesFor } from "../receipts";
import { ownerFilter, requireSales } from "./access";
import { createTask } from "./activities";

const DAY = 86_400_000;
const system = (orgId: string): Ctx => ({ userId: "system:health", orgId, role: "COMPANY_ADMIN", name: "Account health", email: "", employeeId: null });

// ─────────────────────────────── the weights ───────────────────────────────

async function weightsOf(orgId: string): Promise<Weights> {
  const s = await db.crmSetting.findUnique({ where: { organizationId: orgId }, select: { healthWeights: true } });
  const w = s?.healthWeights as Weights | null;
  return w && validateWeights(w) === null ? w : DEFAULT_WEIGHTS;
}

export async function getHealthWeights(ctx: Ctx) {
  await requireSales(ctx, "sales.view");
  const w = await weightsOf(ctx.orgId);
  return { weights: w, isDefault: w === DEFAULT_WEIGHTS };
}

export async function saveHealthWeights(ctx: Ctx, raw: Weights) {
  await requireSales(ctx, "sales.configure");
  const problem = validateWeights(raw);
  if (problem) throw new BusinessError(problem);
  await db.crmSetting.update({ where: { organizationId: ctx.orgId }, data: { healthWeights: raw as never, updatedBy: ctx.name } });
  await logAudit(ctx, { action: "SALES_HEALTH_WEIGHTS", entity: "CrmSetting", entityId: ctx.orgId, newValue: raw });
}

// ─────────────────────────────── the facts ───────────────────────────────

/** The six facts about a client account on a date. Only reads. */
export async function healthInputs(orgId: string, account: { id: string; clientId: string; createdAt: Date }, now: Date): Promise<HealthInputs> {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const since90 = new Date(now.getTime() - 90 * DAY);
  const since30 = new Date(today.getTime() - 30 * DAY);
  const [firstBreaches, resolutionBreaches, severe, attendance, invoices, contract, lastContact] = await Promise.all([
    db.crmCase.count({ where: { organizationId: orgId, accountId: account.id, firstResponseBreachedAt: { gte: since90 } } }),
    db.crmCase.count({ where: { organizationId: orgId, accountId: account.id, resolutionBreachedAt: { gte: since90 } } }),
    db.crmCase.groupBy({ by: ["priority"], where: { organizationId: orgId, accountId: account.id, status: "OPEN", priority: { in: ["CRITICAL", "HIGH"] } }, _count: { _all: true } }),
    db.workRegister.groupBy({ by: ["attendanceStatus"], where: { organizationId: orgId, clientId: account.clientId, date: { gte: since30, lte: today }, attendanceStatus: { in: ["PRESENT", "LATE", "ABSENT"] } }, _count: { _all: true } }),
    openInvoicesFor(system(orgId), account.clientId),
    db.contract.findFirst({ where: { organizationId: orgId, clientId: account.clientId, status: "ACTIVE", endDate: { gte: today, lte: new Date(today.getTime() + 90 * DAY) } }, orderBy: { endDate: "asc" }, select: { id: true, endDate: true } }),
    db.crmActivity.findFirst({ where: { organizationId: orgId, accountId: account.id, voidedAt: null, kind: { not: "NOTE" } }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } }),
  ]);
  const expected = attendance.reduce((n, a) => n + a._count._all, 0);
  const absent = attendance.find((a) => a.attendanceStatus === "ABSENT")?._count._all ?? 0;
  let renewalInProgress = false;
  if (contract) {
    const link = await db.crmRenewalLink.findUnique({ where: { contractId: contract.id }, select: { opportunityId: true } });
    const opp = link ? await db.crmOpportunity.findUnique({ where: { id: link.opportunityId }, select: { status: true, stage: { select: { stageType: true } } } }) : null;
    renewalInProgress = !!opp && opp.status === "ACTIVE" && opp.stage.stageType !== "LOST";
  }
  return {
    slaBreaches90: firstBreaches + resolutionBreaches,
    openCritical: severe.find((s) => s.priority === "CRITICAL")?._count._all ?? 0,
    openHigh: severe.find((s) => s.priority === "HIGH")?._count._all ?? 0,
    absencePct: expected === 0 ? null : Math.round((absent * 1000) / expected) / 10,
    maxDaysOverdue: invoices.reduce((m, i) => Math.max(m, daysPastDue(i.dueDate, now)), 0),
    daysToContractEnd: contract ? Math.round((contract.endDate!.getTime() - today.getTime()) / DAY) : null,
    renewalInProgress,
    daysSinceClientContact: Math.max(0, Math.floor((now.getTime() - (lastContact?.occurredAt ?? account.createdAt).getTime()) / DAY)),
  };
}

// ─────────────────────────────── scoring and storing ───────────────────────────────

/** Works out and stores the account's health, records a change of band, and gives an at-risk account's owner one task. Returns null for an account that is not a client account. */
export async function refreshAccountHealth(orgId: string, accountId: string, now = new Date()) {
  const account = await db.crmAccount.findFirst({ where: { id: accountId, organizationId: orgId, status: "ACTIVE" } });
  if (!account?.clientId) return null;
  const result = scoreAccount(await healthInputs(orgId, { id: account.id, clientId: account.clientId, createdAt: account.createdAt }, now), await weightsOf(orgId));
  const before = await db.crmAccountHealth.findUnique({ where: { accountId } });
  const changed = !!before && before.band !== result.band;
  const row = await db.crmAccountHealth.upsert({
    where: { accountId },
    create: { organizationId: orgId, accountId, score: result.score, band: result.band, components: result.components as never, computedAt: now },
    update: { score: result.score, band: result.band, components: result.components as never, computedAt: now, ...(changed ? { previousBand: before!.band, bandChangedAt: now } : {}) },
  });
  const sys = system(orgId);
  if (changed) await logAudit(sys, { action: "SALES_ACCOUNT_HEALTH_BAND", entity: "CrmAccount", entityId: accountId, oldValue: { band: before!.band }, newValue: { band: result.band, score: result.score } });
  if (result.band === "AT_RISK") {
    const title = `Account at risk: ${account.name}`;
    if (!(await db.crmTask.findFirst({ where: { organizationId: orgId, accountId, status: "OPEN", title }, select: { id: true } }))) {
      const worst = [...result.components].filter((c) => c.subScore !== null).sort((a, b) => (a.subScore as number) - (b.subScore as number)).slice(0, 3);
      await createTask(sys, { title, notes: `Health score ${result.score} of 100. Weakest: ${worst.map((c) => c.detail).join("; ")}.`, dueAt: new Date(now.getTime() + 2 * DAY).toISOString(), ownerUserId: account.ownerUserId, accountId });
    }
  }
  return row;
}

/** The same, for use after a case changes: a failure here must never undo the case change. */
export async function refreshAccountHealthSafe(orgId: string, accountId: string) {
  try {
    await refreshAccountHealth(orgId, accountId);
  } catch (e) {
    logger.error("sales_health_refresh_failed", { error: e });
  }
}

/** The nightly job: every client account of every organization that has the module on. */
export async function runHealthJob(now = new Date(), opts: { orgId?: string } = {}) {
  const out = { scored: 0, atRisk: 0 };
  const orgs = await db.crmSetting.findMany({ where: { enabled: true, ...(opts.orgId ? { organizationId: opts.orgId } : {}) }, select: { organizationId: true } });
  for (const o of orgs) {
    const accounts = await db.crmAccount.findMany({ where: { organizationId: o.organizationId, status: "ACTIVE", clientId: { not: null } }, select: { id: true }, take: 2000 });
    for (const a of accounts) {
      try {
        const r = await refreshAccountHealth(o.organizationId, a.id, now);
        if (r) {
          out.scored++;
          if (r.band === "AT_RISK") out.atRisk++;
        }
      } catch (e) {
        logger.error("sales_health_account_failed", { accountId: a.id, error: e });
      }
    }
  }
  return out;
}

// ─────────────────────────────── reading ───────────────────────────────

export interface HealthView {
  score: number;
  band: CrmHealthBand;
  components: Component[];
  previousBand: CrmHealthBand | null;
  bandChangedAt: Date | null;
  computedAt: Date;
}

export async function getAccountHealth(ctx: Ctx, accountId: string): Promise<HealthView | null> {
  await requireSales(ctx, "sales.view");
  const account = await db.crmAccount.findFirst({ where: { id: accountId, organizationId: ctx.orgId, ...ownerFilter(ctx) }, select: { id: true } });
  if (!account) throw new BusinessError("Account not found.");
  const h = await db.crmAccountHealth.findUnique({ where: { accountId } });
  return h ? { score: h.score, band: h.band, components: h.components as unknown as Component[], previousBand: h.previousBand, bandChangedAt: h.bandChangedAt, computedAt: h.computedAt } : null;
}

/** The client accounts the caller may see, weakest first. */
export async function listHealth(ctx: Ctx, f: { band?: Band } = {}) {
  await requireSales(ctx, "sales.view");
  return db.crmAccountHealth.findMany({
    where: { organizationId: ctx.orgId, account: { ...ownerFilter(ctx), status: "ACTIVE" }, ...(f.band ? { band: f.band } : {}) },
    include: { account: { select: { id: true, name: true, ownerName: true } } },
    orderBy: [{ score: "asc" }, { id: "asc" }],
    take: 500,
  });
}

