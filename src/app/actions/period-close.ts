"use server";
import { act } from "./_run";
import * as close from "@/server/services/period-close";

const PATHS = ["/accounting"];

export async function signOffAction(periodId: string, code: string, done: boolean, note?: string) {
  return act("period.close", async (ctx) => {
    await close.signOff(ctx, periodId, code, done, note);
    return { message: done ? "Signed off." : "Sign-off taken back." };
  }, PATHS);
}

export async function waiveCheckAction(periodId: string, code: string, reason?: string) {
  return act("period.approve", async (ctx) => {
    await close.waiveCheck(ctx, periodId, code, reason ?? "");
    return { message: "Recorded. The period can now close over this item; the reason is kept with the period." };
  }, PATHS);
}

export async function setCloseChecklistRequiredAction(required: boolean) {
  return act("period.approve", async (ctx) => {
    await close.setCloseChecklistRequired(ctx, required);
    return { message: required ? "Every sign-off is now needed before a period can close." : "Sign-offs are now advisory." };
  }, PATHS);
}
