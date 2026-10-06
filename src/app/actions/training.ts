"use server";
import { act } from "./_run";
import * as tr from "@/server/services/training";

type V = Record<string, unknown>;
const PAGES = ["/hr", "/settings", "/employees"];

export async function addRequirementAction(v: V) {
  return act("hr.configure", async (ctx) => {
    await tr.addRequirement(ctx, v as never);
    return { message: "Requirement added." };
  }, PAGES);
}

/** The form always sends every field, so a blank category means "everyone" and a blank description clears it. */
export async function updateRequirementAction(id: string, v: V) {
  return act("hr.configure", async (ctx) => {
    await tr.updateRequirement(ctx, id, { ...v, categoryId: v.categoryId ?? "", description: v.description ?? "" } as never);
    return { message: "Requirement updated.", redirectTo: "/settings/training-requirements" };
  }, PAGES);
}

export async function toggleRequirementAction(id: string, active: boolean) {
  return act("hr.configure", async (ctx) => {
    await tr.updateRequirement(ctx, id, { active });
    return { message: active ? "Requirement switched on." : "Requirement switched off — it no longer counts against anyone." };
  }, PAGES);
}
