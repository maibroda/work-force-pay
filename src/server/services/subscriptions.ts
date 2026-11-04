/**
 * Subscriptions: which plan and modules each company has, from when to when (step E2 of docs/plans/module-entitlements.md). The catalogue
 * (src/lib/entitlements) says what a module is and what it needs; this says who has which. NOTHING reads this to switch a page or a job off yet.
 *
 * Who may change one: platform staff (subscription.manage), and a bureau's administrator (bureau.manage) for the bureau's own clients, never for
 * itself or for anyone else's. A company's own administrator can only look (subscription.view): they hold every permission automatically, so
 * subscription.manage is withheld from them in permissions.ts, and a test pins it.
 *
 * A module taken away is given an end date, never deleted, and every change is an event the database itself will not let anyone alter.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";
import { can, ForbiddenError } from "@/lib/auth/permissions";
import { CATALOGUE_VERSION, MODULE_KEYS, MODULES, PLANS, type ModuleKey, type PlanKey } from "@/lib/entitlements/catalogue";
import { checkPlan, whatRemovalBreaks } from "@/lib/entitlements/resolve";
import { BusinessError, db, toJson, type Tx } from "./_base";
import { logAudit } from "./audit";
import { changeBlockers } from "./subscription-blockers";

const DAY = 86_400_000;
const ORDER = new Map<string, number>(MODULE_KEYS.map((k, i) => [k, i]));
const byCatalogue = (a: string, b: string) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99);
const isModule = (k: string): k is ModuleKey => ORDER.has(k);
const isPlan = (k: string): k is PlanKey => Object.prototype.hasOwnProperty.call(PLANS, k);

type EventKind = "CREATED" | "PLAN_CHANGED" | "MODULE_ADDED" | "MODULE_REMOVED" | "LIMITS_CHANGED" | "GRANDFATHERED";

export interface Selection {
  planKey: string;
  addOns?: readonly string[];
  employeeLimit?: number | null;
  crmUserLimit?: number | null;
  reason?: string;
  /** Go ahead although work is in progress that the change leaves readable but unworkable (hard blockers still refuse). */
  acknowledgeSoft?: boolean;
  /** The accepted blueprint this change applies (E5c): recorded in the history. */
  blueprintId?: string;
  /** Runs inside the same transaction, after the change is made, so a caller can record that it happened and have both succeed or neither (E5c). */
  inTx?: (tx: Tx) => Promise<void>;
}

// ─────────────────────────────── Who may do what ───────────────────────────────

/** Platform staff, or the bureau administrator of the bureau this company is a client of. The caller's bureau is the organization they work for, not the client they are working in. */
async function mayManage(ctx: Ctx, orgId: string): Promise<boolean> {
  if (can(ctx.role, "subscription.manage")) return true;
  if (!can(ctx.role, "bureau.manage")) return false;
  const target = await db.organization.findUnique({ where: { id: orgId }, select: { bureauOrganizationId: true } });
  return !!target?.bureauOrganizationId && target.bureauOrganizationId === (ctx.homeOrgId ?? ctx.orgId);
}

async function assertManage(ctx: Ctx, orgId: string) {
  if (!(await mayManage(ctx, orgId))) throw new ForbiddenError("subscription.manage");
}

/** A company's administrator sees its own; the people who can change one see it too. */
async function assertView(ctx: Ctx, orgId: string) {
  if (!can(ctx.role, "subscription.view")) throw new ForbiddenError("subscription.view");
  if (orgId !== ctx.orgId && !(await mayManage(ctx, orgId))) throw new ForbiddenError("subscription.view");
}

// ─────────────────────────────── Checks ───────────────────────────────

const limit = z
  .number()
  .int("A limit is a whole number")
  .min(0, "A limit is a whole number of 0 or more")
  .nullable();
const limitsSchema = z.object({ employeeLimit: limit.optional(), crmUserLimit: limit.optional() });

function parseLimits(raw: { employeeLimit?: number | null; crmUserLimit?: number | null }) {
  const r = limitsSchema.safeParse(raw);
  if (!r.success) throw new BusinessError(`A limit must be a whole number of 0 or more (or empty for no limit).`);
  return r.data;
}

/** The plan and add-ons as a set of modules, or an error that says what is wrong with the selection. */
function resolveSelection(sel: Selection): { plan: PlanKey; modules: ModuleKey[]; addOns: ModuleKey[] } {
  if (!isPlan(sel.planKey)) throw new BusinessError(`There is no plan called "${sel.planKey}".`);
  const addOns = [...new Set(sel.addOns ?? [])];
  const check = checkPlan(sel.planKey, addOns);
  if (!check.ok) throw new BusinessError(check.problems.map((p) => p.message).join(" "));
  return { plan: sel.planKey, modules: check.modules, addOns: addOns as ModuleKey[] };
}

async function lockSubscription(tx: Tx, subscriptionId: string) {
  await (tx as Prisma.TransactionClient).$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${subscriptionId} FOR UPDATE`;
}

async function record(tx: Tx, ctx: Ctx, orgId: string, subscriptionId: string, kind: EventKind, detail: unknown, reason?: string | null) {
  await tx.subscriptionEvent.create({ data: { organizationId: orgId, subscriptionId, kind, reason: reason || null, byUserId: ctx.userId, byName: ctx.name, detail: toJson(detail) } });
  await logAudit({ ...ctx, orgId }, { action: `SUBSCRIPTION_${kind}`, entity: "Subscription", entityId: subscriptionId, newValue: detail, reason: reason || null }, tx);
}

/**
 * Refuses the change while there is work in progress in a module it ends that would be stranded (E5a): a hard blocker always refuses, saying what to finish; a soft one refuses
 * until it has been acknowledged. Reads only, inside the change's own transaction, for this company only.
 */
async function assertNoBlockers(tx: Tx, orgId: string, removing: readonly ModuleKey[], acknowledgeSoft: boolean | undefined) {
  if (removing.length === 0) return;
  const { hard, soft } = await changeBlockers(orgId, removing, tx);
  if (hard.length) throw new BusinessError(`${removing.map((k) => MODULES[k].name).join(", ")} cannot be removed yet. ${hard.map((b) => b.message).join(" ")}`);
  if (soft.length && !acknowledgeSoft) throw new BusinessError(`${soft.map((b) => b.message).join(" ")} To go ahead anyway, acknowledge this and repeat the change.`);
}

const isActive = (m: { startsOn: Date; endsOn: Date | null }, at: Date) => m.startsOn <= at && (!m.endsOn || m.endsOn > at);

// ─────────────────────────────── Making one ───────────────────────────────

async function createIn(tx: Tx, ctx: Ctx, orgId: string, sel: Selection) {
  const { plan, modules, addOns } = resolveSelection(sel);
  const limits = parseLimits({ employeeLimit: sel.employeeLimit ?? null, crmUserLimit: sel.crmUserLimit ?? null });
  if (!(await tx.organization.findUnique({ where: { id: orgId }, select: { id: true } }))) throw new BusinessError("Organization not found.");
  if (await tx.subscription.findUnique({ where: { organizationId: orgId }, select: { id: true } })) throw new BusinessError("This company already has a subscription.");
  const now = new Date();
  const sub = await tx.subscription.create({
    data: { organizationId: orgId, planKey: plan, catalogueVersion: CATALOGUE_VERSION, employeeLimit: limits.employeeLimit ?? null, crmUserLimit: limits.crmUserLimit ?? null, createdBy: ctx.name },
  });
  await tx.subscriptionModule.createMany({
    data: modules.map((k) => ({ organizationId: orgId, subscriptionId: sub.id, moduleKey: k, source: addOns.includes(k) ? ("ADD_ON" as const) : ("PLAN" as const), startsOn: now })),
  });
  await record(tx, ctx, orgId, sub.id, "CREATED", { plan, modules, employeeLimit: sub.employeeLimit, crmUserLimit: sub.crmUserLimit, ...(sel.blueprintId ? { blueprintId: sel.blueprintId } : {}) }, sel.reason);
  await sel.inTx?.(tx);
  return sub;
}

/** Gives a company its subscription. Platform staff, or a bureau for its own client. */
export async function createSubscription(ctx: Ctx, orgId: string, sel: Selection) {
  await assertManage(ctx, orgId);
  return db.$transaction((tx) => createIn(tx, ctx, orgId, sel));
}

/**
 * For the places that make companies (bureau onboarding, the seed): the company's subscription if it has one, otherwise a new one from `sel`. The caller has already
 * been authorised to create the company, so this does not ask again; do not call it from anywhere that has not.
 */
export async function ensureSubscription(tx: Tx, ctx: Ctx, orgId: string, sel: Selection) {
  const existing = await tx.subscription.findUnique({ where: { organizationId: orgId } });
  return existing ?? createIn(tx, ctx, orgId, sel);
}

// ─────────────────────────────── Reading ───────────────────────────────

export async function getSubscription(ctx: Ctx, orgId: string = ctx.orgId) {
  await assertView(ctx, orgId);
  const sub = await db.subscription.findUnique({
    where: { organizationId: orgId },
    include: { modules: { orderBy: { createdAt: "asc" } }, events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!sub) return null;
  const now = new Date();
  return {
    ...sub,
    modules: sub.modules.map((m) => ({ ...m, active: isActive(m, now) })).sort((a, b) => byCatalogue(a.moduleKey, b.moduleKey) || a.startsOn.getTime() - b.startsOn.getTime()),
  };
}

export async function historyOf(ctx: Ctx, orgId: string = ctx.orgId) {
  await assertView(ctx, orgId);
  return db.subscriptionEvent.findMany({ where: { organizationId: orgId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

/**
 * The modules a company had on a day, in catalogue order; null when it has no subscription (so the caller decides what that means: the plan is that it means everything while
 * enforcement is off, and the core only once it is on). For the caller's own organization: takes the id, not a context, because the later enforcement reads it on every request.
 */
export async function modulesOn(orgId: string, at: Date = new Date()): Promise<ModuleKey[] | null> {
  const sub = await db.subscription.findUnique({ where: { organizationId: orgId }, select: { id: true } });
  if (!sub) return null;
  const rows = await db.subscriptionModule.findMany({ where: { subscriptionId: sub.id, startsOn: { lte: at }, OR: [{ endsOn: null }, { endsOn: { gt: at } }] }, select: { moduleKey: true } });
  return [...new Set(rows.map((r) => r.moduleKey))].filter(isModule).sort(byCatalogue);
}

// ─────────────────────────────── Changing one ───────────────────────────────

/** Runs a change against the company's subscription with its row locked, so two changes cannot interleave. */
async function change<T>(ctx: Ctx, orgId: string, fn: (tx: Prisma.TransactionClient, sub: { id: string; planKey: string }, active: ModuleKey[], now: Date) => Promise<T>) {
  await assertManage(ctx, orgId);
  return db.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { organizationId: orgId }, select: { id: true, planKey: true } });
    if (!sub) throw new BusinessError("This company has no subscription yet.");
    await lockSubscription(tx, sub.id);
    const now = new Date();
    const rows = await tx.subscriptionModule.findMany({ where: { subscriptionId: sub.id } });
    const active = rows.filter((r) => isActive(r, now)).map((r) => r.moduleKey).filter(isModule);
    return fn(tx, sub, active, now);
  });
}

export async function addModule(ctx: Ctx, orgId: string, moduleKey: string, reason: string) {
  await assertManage(ctx, orgId);
  if (!isModule(moduleKey)) throw new BusinessError(`There is no module called "${moduleKey}".`);
  await change(ctx, orgId, async (tx, sub, active, now) => {
    if (active.includes(moduleKey)) throw new BusinessError(`${MODULES[moduleKey].name} is already part of this subscription.`);
    // everything it needs must be there already (the custom plan is the core alone, so every other module in the set counts as an add-on)
    const problems = checkPlan("custom", [...active.filter((k) => k !== "core"), moduleKey]).problems.filter((p) => p.module === moduleKey);
    if (problems.length) throw new BusinessError(problems.map((p) => p.message).join(" "));
    await tx.subscriptionModule.create({ data: { organizationId: orgId, subscriptionId: sub.id, moduleKey, source: "ADD_ON", startsOn: now } });
    await record(tx, ctx, orgId, sub.id, "MODULE_ADDED", { added: [moduleKey] }, reason);
  });
}

/** Ends a module (the row stays, with an end date). Refused if another module the company has needs it. `readOnlyDays` is how long its data stays readable afterwards (used by a later step). */
export async function removeModule(ctx: Ctx, orgId: string, moduleKey: string, reason: string, opts: { readOnlyDays?: number; acknowledgeSoft?: boolean } = {}) {
  await assertManage(ctx, orgId);
  if (!isModule(moduleKey)) throw new BusinessError(`There is no module called "${moduleKey}".`);
  if (opts.readOnlyDays !== undefined && (!Number.isInteger(opts.readOnlyDays) || opts.readOnlyDays < 0)) throw new BusinessError("The read-only period is a whole number of days.");
  await change(ctx, orgId, async (tx, sub, active, now) => {
    const { broken, refused } = whatRemovalBreaks(active, [moduleKey]);
    if (refused.length) throw new BusinessError(refused[0].message);
    if (!active.includes(moduleKey)) throw new BusinessError(`${MODULES[moduleKey].name} is not part of this subscription.`);
    if (broken.length) throw new BusinessError(broken.map((b) => b.because).join(" "));
    await assertNoBlockers(tx, orgId, [moduleKey], opts.acknowledgeSoft);
    await tx.subscriptionModule.updateMany({
      where: { subscriptionId: sub.id, moduleKey, startsOn: { lte: now }, OR: [{ endsOn: null }, { endsOn: { gt: now } }] },
      data: { endsOn: now, readOnlyUntil: opts.readOnlyDays ? new Date(now.getTime() + opts.readOnlyDays * DAY) : null },
    });
    await record(tx, ctx, orgId, sub.id, "MODULE_REMOVED", { removed: [moduleKey], readOnlyDays: opts.readOnlyDays ?? 0 }, reason);
  });
}

/** Moves to another plan: modules it no longer has are ended, new ones start, and the rest carry on. The whole selection has to hold together, or nothing changes. */
export async function changePlan(ctx: Ctx, orgId: string, sel: Selection) {
  await assertManage(ctx, orgId);
  const { plan, modules, addOns } = resolveSelection(sel);
  await change(ctx, orgId, async (tx, sub, active, now) => {
    const ending = active.filter((k) => !modules.includes(k));
    const starting = modules.filter((k) => !active.includes(k));
    await assertNoBlockers(tx, orgId, ending, sel.acknowledgeSoft);
    if (ending.length) await tx.subscriptionModule.updateMany({ where: { subscriptionId: sub.id, moduleKey: { in: ending }, startsOn: { lte: now }, OR: [{ endsOn: null }, { endsOn: { gt: now } }] }, data: { endsOn: now } });
    if (starting.length) await tx.subscriptionModule.createMany({ data: starting.map((k) => ({ organizationId: orgId, subscriptionId: sub.id, moduleKey: k, source: addOns.includes(k) ? ("ADD_ON" as const) : ("PLAN" as const), startsOn: now })) });
    const kept = modules.filter((k) => active.includes(k));
    for (const k of kept) await tx.subscriptionModule.updateMany({ where: { subscriptionId: sub.id, moduleKey: k, endsOn: null }, data: { source: addOns.includes(k) ? "ADD_ON" : "PLAN" } });
    // limits are changed only when the selection gives them (a plain change of plan leaves them as they are); null means no limit
    const limits = parseLimits({ employeeLimit: sel.employeeLimit, crmUserLimit: sel.crmUserLimit });
    const limitData = { ...(limits.employeeLimit !== undefined ? { employeeLimit: limits.employeeLimit } : {}), ...(limits.crmUserLimit !== undefined ? { crmUserLimit: limits.crmUserLimit } : {}) };
    await tx.subscription.update({ where: { id: sub.id }, data: { planKey: plan, catalogueVersion: CATALOGUE_VERSION, ...limitData } });
    await record(tx, ctx, orgId, sub.id, "PLAN_CHANGED", { from: sub.planKey, to: plan, added: starting, removed: ending, ...(Object.keys(limitData).length ? { limits: limitData } : {}), ...(sel.blueprintId ? { blueprintId: sel.blueprintId } : {}) }, sel.reason);
    await sel.inTx?.(tx);
  });
}

/** Stores the limits. They are not checked anywhere yet (a later step does that). `undefined` leaves one as it is; `null` means no limit. */
export async function setLimits(ctx: Ctx, orgId: string, raw: { employeeLimit?: number | null; crmUserLimit?: number | null }, reason: string) {
  await assertManage(ctx, orgId);
  const v = parseLimits(raw);
  await change(ctx, orgId, async (tx, sub) => {
    const before = await tx.subscription.findUniqueOrThrow({ where: { id: sub.id }, select: { employeeLimit: true, crmUserLimit: true } });
    const data = { ...(v.employeeLimit !== undefined ? { employeeLimit: v.employeeLimit } : {}), ...(v.crmUserLimit !== undefined ? { crmUserLimit: v.crmUserLimit } : {}) };
    await tx.subscription.update({ where: { id: sub.id }, data });
    await record(tx, ctx, orgId, sub.id, "LIMITS_CHANGED", { from: before, to: { ...before, ...data } }, reason);
  });
}
