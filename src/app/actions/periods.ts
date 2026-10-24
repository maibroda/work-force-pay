"use server";
import { act } from "./_run";
import type { PeriodAction } from "@/lib/fiscal";
import * as periods from "@/server/services/periods";
import * as yearEnd from "@/server/services/year-end";

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

/** Posts the year-end closing entries: income and expense to nil, profit or loss to retained earnings. */
export async function closeFiscalYearAction(yearId: string, v: V) {
  return act(
    "period.approve",
    async (ctx) => {
      const r = await yearEnd.closeFiscalYear(ctx, yearId, String(v.retainedEarningsAccountId ?? ""));
      return { message: `Year closed: ${r.journal.entryNumber} posted (${r.lines} lines), ${r.profit >= 0 ? "profit" : "loss"} of ${Math.abs(r.profit).toFixed(2)} moved to retained earnings.` };
    },
    PATHS,
  );
}

export async function reopenFiscalYearAction(yearId: string, reason?: string) {
  return act(
    "period.reopen",
    async (ctx) => {
      await yearEnd.reopenFiscalYear(ctx, yearId, reason ?? "");
      return { message: "Year reopened. The closing journal has been reversed." };
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
