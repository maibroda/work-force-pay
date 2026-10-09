"use server";
import { act } from "./_run";
import type { PeriodAction } from "@/lib/fiscal";
import * as periods from "@/server/services/periods";

type V = Record<string, unknown>;
const PATHS = ["/accounting", "/payroll"];

/** Soft close, close, lock or reopen one period; the service checks the specific permission for the action. */
export async function transitionPeriodAction(periodId: string, action: PeriodAction, reason?: string) {
  return act(
    "gl.view",
    async (ctx) => {
      const p = await periods.transitionPeriod(ctx, periodId, action, reason);
      const done = { SOFT_CLOSE: "soft closed", CLOSE: "closed", LOCK: "locked", REOPEN: "reopened" }[action];
      return { message: `${p.name} is ${done}.` };
    },
    PATHS,
  );
}

export async function createFiscalYearAction(v: V) {
  return act(
    "period.approve",
    async (ctx) => {
      const y = await periods.createFiscalYear(ctx, String(v.containing ?? ""));
      return { message: `${y.name} created with its twelve periods.` };
    },
    PATHS,
  );
}
