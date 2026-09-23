"use server";
import { act } from "./_run";
import * as gl from "@/server/services/accounting";

type V = Record<string, unknown>;

const PATHS = ["/accounting", "/payroll"];

export async function createAccountAction(v: V) {
  return act(
    "gl.manage",
    async (ctx) => {
      const a = await gl.createAccount(ctx, v as never);
      return { message: `Account ${a.code} — ${a.name} created.` };
    },
    PATHS,
  );
}

export async function setAccountActiveAction(id: string, active: boolean) {
  return act(
    "gl.manage",
    async (ctx) => {
      await gl.updateAccount(ctx, id, { active });
      return { message: active ? "Account activated." : "Account deactivated." };
    },
    PATHS,
  );
}

export async function saveMappingAction(v: V) {
  return act(
    "gl.manage",
    async (ctx) => {
      const m = await gl.saveMapping(ctx, v as never);
      return { message: `${m.headCode} will post to the selected accounts from the next payroll lock.` };
    },
    PATHS,
  );
}

export async function postRunToGlAction(runId: string) {
  return act(
    "gl.manage",
    async (ctx) => {
      const j = await gl.postRunManually(ctx, runId);
      return { message: `Posted as journal ${j.entryNumber}.`, redirectTo: `/accounting/journals/${j.id}` };
    },
    PATHS,
  );
}

export async function closePeriodAction(periodId: string) {
  return act(
    "payroll.lock",
    async (ctx) => {
      const p = await gl.closePeriod(ctx, periodId);
      return { message: `${p.name} closed — payroll heads are posted to the general ledger.` };
    },
    PATHS,
  );
}
