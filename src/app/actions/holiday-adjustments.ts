"use server";
import { actFor } from "./_run";
import * as adj from "@/server/services/holiday-adjustments";
const act = actFor("holiday-adjustments.ts");

const PATHS = ["/payroll/holidays"];

/** A payroll reviewer approves a holiday adjustment (never the person who approved the shift). It changes no pay yet. */
export async function approveHolidayAdjustmentAction(id: string) {
  return act(
    "payroll.inputs.approve",
    async (ctx) => {
      await adj.reviewHolidayAdjustment(ctx, id, "APPROVED");
      return { message: "Holiday adjustment approved. It changes no pay yet." };
    },
    PATHS,
  );
}

export async function rejectHolidayAdjustmentAction(id: string, reason?: string) {
  return act(
    "payroll.inputs.approve",
    async (ctx) => {
      await adj.reviewHolidayAdjustment(ctx, id, "REJECTED", reason);
      return { message: "Holiday adjustment rejected." };
    },
    PATHS,
  );
}
