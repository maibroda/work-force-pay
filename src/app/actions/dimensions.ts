"use server";
import { act } from "./_run";
import * as dims from "@/server/services/dimensions";

type V = Record<string, unknown>;
const PATHS = ["/accounting"];

export async function createRegionAction(v: V) {
  return act("gl.manage", async (ctx) => ({ message: `Region ${(await dims.createRegion(ctx, v as never)).name} created.` }), PATHS);
}

export async function createBranchAction(v: V) {
  return act("gl.manage", async (ctx) => ({ message: `Branch ${(await dims.createBranch(ctx, v as never)).name} created.` }), PATHS);
}

export async function createProfitCentreAction(v: V) {
  return act("gl.manage", async (ctx) => ({ message: `Profit centre ${(await dims.createProfitCentre(ctx, v as never)).name} created.` }), PATHS);
}

export async function createProjectAction(v: V) {
  return act("gl.manage", async (ctx) => ({ message: `Project ${(await dims.createProject(ctx, v as never)).name} created.` }), PATHS);
}

export async function setDimensionActiveAction(kind: dims.MasterKind, id: string, active: boolean) {
  return act(
    "gl.manage",
    async (ctx) => {
      await dims.setDimensionActive(ctx, kind, id, active);
      return { message: active ? "Activated." : "Retired: no new postings can use it; what was posted keeps it." };
    },
    PATHS,
  );
}
