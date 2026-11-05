"use server";
import { actFor } from "./_run";
import * as pfas from "@/server/services/pfas";
const act = actFor("pfas.ts");

type V = Record<string, unknown>;
const PATHS = ["/employees/pfas", "/employees", "/employees/pension"];
const text = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function createPfaAction(v: V) {
  return act("hr.configure", async (ctx) => {
    const row = await pfas.createPfa(ctx, { name: text(v.name) ?? "", penComNumber: text(v.penComNumber) });
    return { message: `${row.name} added to the list.` };
  }, PATHS);
}

/** A blank name or PenCom number leaves that detail as it is. */
export async function updatePfaAction(v: V) {
  return act("hr.configure", async (ctx) => {
    const name = text(v.name)?.trim();
    const penComNumber = text(v.penComNumber)?.trim();
    if (!name && !penComNumber) return { message: "Nothing to change: give a new name or a PenCom number." };
    const r = await pfas.updatePfa(ctx, String(v.pfaId ?? ""), { ...(name ? { name } : {}), ...(penComNumber ? { penComNumber } : {}) });
    return { message: r.employeesRenamed ? `Saved. ${r.employeesRenamed} employee${r.employeesRenamed === 1 ? "" : "s"} now show the new name.` : "Saved." };
  }, PATHS);
}

export async function setPfaActiveAction(id: string, active: boolean) {
  return act("hr.configure", async (ctx) => {
    await pfas.setPfaActive(ctx, id, active);
    return { message: active ? "Switched on: it can be chosen again." : "Switched off: it can no longer be chosen. People who already have it keep it." };
  }, PATHS);
}

export async function deletePfaAction(id: string) {
  return act("hr.configure", async (ctx) => {
    await pfas.deletePfa(ctx, id);
    return { message: "Removed from the list." };
  }, PATHS);
}
