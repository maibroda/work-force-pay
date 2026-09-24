"use server";
import { act } from "./_run";
import * as rules from "@/server/services/deduction-rules";

type V = Record<string, unknown>;
const PATHS = ["/settings/recurring-deductions"];

export async function createRecurringDeductionRuleAction(v: V) {
  return act(
    "settings.manage",
    async (ctx) => {
      await rules.createRecurringDeductionRule(ctx, v as never);
      return { message: "Recurring deduction rule created." };
    },
    PATHS,
  );
}

export async function setRecurringDeductionRuleActiveAction(id: string, active: boolean) {
  return act(
    "settings.manage",
    async (ctx) => {
      await rules.setRecurringDeductionRuleActive(ctx, id, active);
      return { message: active ? "Rule reactivated." : "Rule deactivated." };
    },
    PATHS,
  );
}
