"use server";
import { actFor } from "./_run";
import * as ho from "@/server/services/hr-officers";
const act = actFor("hr-officers.ts");

type V = Record<string, unknown>;
const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const PAGES = ["/settings/hr-officers"];

/** Only the Company Administrator (and platform staff) can reach these: `hr.officer.manage` is withheld from the HR administrator, so nobody grants themselves a function. */
export async function appointOfficerAction(v: V) {
  return act("hr.officer.manage", async (ctx) => {
    await ho.appointOfficer(ctx, s(v.userId) ?? "", { external: v.external === true || v.external === "on" || v.external === "true", accessEndsOn: s(v.accessEndsOn) });
    return { message: "Appointed. The officer can do nothing in HR until you grant a function." };
  }, PAGES);
}

export async function grantFunctionAction(v: V) {
  return act("hr.officer.manage", async (ctx) => {
    await ho.grantFunction(ctx, { userId: s(v.userId) ?? "", function: s(v.function) as never, reason: s(v.reason) ?? "", endsOn: s(v.endsOn) });
    return { message: "Function granted." };
  }, PAGES);
}

export async function revokeFunctionAction(grantId: string, reason?: string) {
  return act("hr.officer.manage", async (ctx) => {
    await ho.revokeFunction(ctx, grantId, reason ?? "");
    return { message: "Function revoked. It stops working on the officer's next request." };
  }, PAGES);
}

export async function removeOfficerAction(userId: string) {
  return act("hr.officer.manage", async (ctx) => {
    await ho.removeOfficer(ctx, userId);
    return { message: "Appointment ended: every function is revoked and the account is switched off." };
  }, PAGES);
}
