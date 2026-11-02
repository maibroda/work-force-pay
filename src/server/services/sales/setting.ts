import { z } from "zod";
import type { Ctx } from "@/lib/auth/context";
import { assertCan, db } from "../_base";
import { logAudit } from "../audit";
import { ensureDefaultPipelines } from "./pipelines";

export const settingSchema = z.object({ enabled: z.boolean().optional(), mode: z.enum(["CLASSIC", "SIMPLE"]).optional() });

/** Whether the sales module is on for this organization, and how enquiries are handled. Readable by anyone who may use sales, even while it is off. */
export async function getSalesSetting(ctx: Ctx) {
  assertCan(ctx, "sales.view");
  const s = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId } });
  return { enabled: s?.enabled ?? false, mode: s?.mode ?? ("CLASSIC" as const) };
}

/** Switches the module on or off and chooses classic (leads first) or simple (enquiries go straight to deals). Off keeps everything already entered. */
export async function updateSalesSetting(ctx: Ctx, raw: z.input<typeof settingSchema>) {
  assertCan(ctx, "sales.configure");
  const v = settingSchema.parse(raw);
  const before = await getSalesSetting(ctx);
  const next = { enabled: v.enabled ?? before.enabled, mode: v.mode ?? before.mode };
  await db.crmSetting.upsert({
    where: { organizationId: ctx.orgId },
    create: { organizationId: ctx.orgId, ...next, updatedBy: ctx.name },
    update: { ...next, updatedBy: ctx.name },
  });
  if (next.enabled) await ensureDefaultPipelines(ctx.orgId); // the starting New business pipeline, created once
  await logAudit(ctx, { action: "SALES_SETTING_UPDATE", entity: "CrmSetting", entityId: ctx.orgId, oldValue: before, newValue: next });
  return next;
}
