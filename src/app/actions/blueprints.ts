"use server";
import { actFor } from "./_run";
import { QUESTIONS } from "@/lib/entitlements/configure";
import * as bp from "@/server/services/blueprints";
const act = actFor("blueprints.ts");

type V = Record<string, unknown>;
const PATHS = ["/crm/blueprints"];

const count = (v: unknown): number => (String(v ?? "").trim() === "" ? Number.NaN : Number(v));

/** For platform staff and bureau sales people (the service checks it again). Configures and prices the prospect, saves it as a draft, and opens it. */
export async function saveBlueprintAction(v: V) {
  return act("blueprint.manage", async (ctx) => {
    const wants: Record<string, boolean> = {};
    for (const q of QUESTIONS) if (v[`want_${q.key}`] === true || v[`want_${q.key}`] === "true") wants[q.key] = true;
    const saved = await bp.saveBlueprint(ctx, {
      prospectName: String(v.prospectName ?? ""),
      answers: { employees: count(v.employees), crmUsers: String(v.crmUsers ?? "").trim() === "" ? null : count(v.crmUsers), wants },
      leadId: v.leadId ? String(v.leadId) : null,
    });
    return { message: "Saved as a draft.", redirectTo: `/crm/blueprints/${saved.id}` };
  }, PATHS);
}

/** Records that the blueprint was sent, accepted or dropped. The app sends nothing and makes no subscription. */
export async function setBlueprintStatusAction(id: string, status: bp.BlueprintStatus) {
  return act("blueprint.manage", async (ctx) => {
    await bp.setBlueprintStatus(ctx, id, status);
    return { message: `Marked ${status.toLowerCase()}.` };
  }, [...PATHS, `/crm/blueprints/${id}`]);
}
