"use server";
import { act } from "./_run";
import * as cc from "@/server/services/cost-centers";

type V = Record<string, unknown>;
const PATHS = ["/settings/cost-centers"];

export async function createCostCenterAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      await cc.createCostCenter(ctx, v as never);
      return { message: "Cost center created." };
    },
    PATHS,
  );
}

export async function setCostCenterActiveAction(id: string, active: boolean) {
  return act(
    "settings.manage",
    async (ctx) => {
      await cc.setCostCenterActive(ctx, id, active);
      return { message: active ? "Cost center reactivated." : "Cost center deactivated." };
    },
    PATHS,
  );
}

export async function assignCostCenterAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      await cc.assignCostCenter(
        ctx,
        v.ownerType as "DEPARTMENT" | "CONTRACT" | "BEAT",
        String(v.ownerId),
        v.costCenterId ? String(v.costCenterId) : null,
      );
      return { message: "Cost center assignment saved." };
    },
    PATHS,
  );
}

export async function setCostCenterBudgetAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      await cc.setCostCenterBudget(ctx, v as never);
      return { message: "Budget saved." };
    },
    ["/settings/cost-centers", "/analytics/cost-centers"],
  );
}
