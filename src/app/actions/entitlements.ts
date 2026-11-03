"use server";
import { actFor } from "./_run";
import * as sw from "@/server/services/entitlement-switch";
const act = actFor("entitlements.ts");

type V = Record<string, unknown>;
const PATHS = ["/settings/entitlements"];

/** Platform staff only (the service checks it again). Turning a module on is refused while a company has no subscription. */
export async function setModuleModeAction(v: V) {
  return act("subscription.manage", async (ctx) => {
    await sw.setMode(ctx, String(v.moduleKey ?? ""), String(v.mode ?? "") as never, String(v.reason ?? ""));
    return { message: `Saved: ${String(v.moduleKey)} is now ${String(v.mode)}.` };
  }, PATHS);
}
