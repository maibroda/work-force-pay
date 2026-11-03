/**
 * The module switch (step E3b of docs/plans/module-entitlements-e3.md): per module, OFF (nothing is checked), REPORT (let it through and log what would have been refused) or ENFORCE
 * (refuse a company that did not buy it). Platform-wide, and platform staff's alone: a bureau can change its clients' subscriptions but not whether subscriptions are checked.
 * It cannot be turned on while any company has no subscription, because that company would be held to the core only and locked out of everything it uses.
 * Every module starts OFF, and while all are OFF a request is given nothing to check, so nothing changes for anyone until someone decides.
 */
import type { Ctx } from "@/lib/auth/context";
import { ForbiddenError } from "@/lib/auth/permissions";
import { MODULES, MODULE_KEYS, type ModuleKey } from "@/lib/entitlements/catalogue";
import { effectiveModule } from "@/lib/entitlements/entry-modules";
import { decide, type Entitlements, type Mode } from "@/lib/entitlements/guard";
import { logger } from "@/lib/logger";
import { BusinessError, db } from "./_base";
import { modulesOn } from "./subscriptions";

type SwitchMode = "OFF" | Mode;
const MODES: SwitchMode[] = ["OFF", "REPORT", "ENFORCE"];

/** Platform staff only: `subscription.manage` is held by SUPER_ADMIN alone (a bureau's route to it is through its own clients' subscriptions, not this). */
function assertPlatform(ctx: Ctx) {
  if (ctx.role !== "SUPER_ADMIN") throw new ForbiddenError("subscription.manage");
}

/** Companies that have no subscription: the switch cannot be turned on while there are any. */
export async function organizationsWithoutSubscription() {
  return db.organization.findMany({ where: { subscription: null }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
}

export async function listSwitches(ctx: Ctx) {
  assertPlatform(ctx);
  const rows = await db.entitlementSwitch.findMany();
  const by = new Map(rows.map((r) => [r.moduleKey, r.mode]));
  return MODULE_KEYS.filter((k) => k !== "core").map((k) => ({ moduleKey: k, name: MODULES[k].name, mode: (by.get(k) ?? "OFF") as SwitchMode }));
}

export async function switchHistory(ctx: Ctx) {
  assertPlatform(ctx);
  return db.entitlementSwitchEvent.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}

export async function setMode(ctx: Ctx, moduleKey: string, mode: SwitchMode, reason: string) {
  assertPlatform(ctx);
  if (moduleKey === "core") throw new BusinessError("The core platform is always on and cannot be switched.");
  if (!MODULE_KEYS.includes(moduleKey as ModuleKey)) throw new BusinessError(`There is no module called "${moduleKey}".`);
  if (!MODES.includes(mode)) throw new BusinessError("The mode is OFF, REPORT or ENFORCE.");
  if (!reason.trim()) throw new BusinessError("Give a reason for the change.");
  const name = MODULES[moduleKey as ModuleKey].name;
  await db.$transaction(async (tx) => {
    const current = (await tx.entitlementSwitch.findUnique({ where: { moduleKey } }))?.mode ?? "OFF";
    if (current === mode) throw new BusinessError(`${name} is already ${mode}.`);
    if (mode !== "OFF") {
      // checked inside the transaction, so a company made a moment ago is counted
      const missing = await tx.organization.findMany({ where: { subscription: null }, select: { code: true }, orderBy: { code: "asc" }, take: 6 });
      if (missing.length)
        throw new BusinessError(
          `Companies with no subscription would be locked out, so ${name} cannot be set to ${mode} yet. Give a subscription to: ${missing
            .slice(0, 5)
            .map((m) => m.code)
            .join(", ")}${missing.length > 5 ? " and others" : ""}.`,
        );
    }
    if (mode === "OFF") await tx.entitlementSwitch.delete({ where: { moduleKey } });
    else await tx.entitlementSwitch.upsert({ where: { moduleKey }, create: { moduleKey, mode, updatedBy: ctx.name }, update: { mode, updatedBy: ctx.name } });
    await tx.entitlementSwitchEvent.create({ data: { moduleKey, fromMode: current, toMode: mode, reason: reason.trim(), byUserId: ctx.userId, byName: ctx.name } });
  });
}

/**
 * What a request for this company is given to check, or undefined while every module is OFF (the state today: one small lookup, no subscription read). A company with no
 * subscription gets null modules, which the guards treat as the core only; `setMode` makes sure that cannot be the case when a module is first turned on, and this covers a company
 * made afterwards by a route that forgot a subscription.
 */
export async function loadEntitlements(orgId: string): Promise<Entitlements | undefined> {
  const rows = await db.entitlementSwitch.findMany();
  if (rows.length === 0) return undefined;
  const modes: Entitlements["modes"] = {};
  for (const r of rows) if (r.mode !== "OFF") modes[r.moduleKey as ModuleKey] = r.mode;
  return { modules: await modulesOn(orgId), modes };
}

/**
 * For the scheduled jobs (step E3c), which run for every company: the ones among these companies the job may run for. All of them while the job's module is OFF (and the core and
 * a job still held to the core as a guess are never held back); in REPORT mode all of them, with a log line for each that would have been skipped; in ENFORCE mode only the
 * companies that have the module today. `job` is the name in /api/cron/<job>; an unknown name throws, so a typo cannot let a job run for everyone unchecked.
 */
export async function entitledOrgs(orgIds: readonly string[], job: string): Promise<string[]> {
  const mod = effectiveModule("job", `/api/cron/${job}`);
  if (mod === "core" || mod === "bureau") return [...orgIds];
  const row = await db.entitlementSwitch.findUnique({ where: { moduleKey: mod } });
  if (!row || row.mode === "OFF") return [...orgIds];
  const out: string[] = [];
  for (const id of orgIds) {
    const d = decide({ modules: await modulesOn(id), modes: { [mod]: row.mode } }, mod);
    if (d.report) logger.warn("entitlement_would_refuse", { module: mod, kind: "job", entry: job, organizationId: id });
    if (d.allow) out.push(id);
  }
  return out;
}

export async function orgEntitled(orgId: string, job: string): Promise<boolean> {
  return (await entitledOrgs([orgId], job)).length === 1;
}
