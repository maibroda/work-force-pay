"use server";
import { actFor } from "./_run";
import * as rel from "@/server/services/relations";
const act = actFor("welfare.ts");

type V = Record<string, unknown>;
const s = (x: unknown) => (typeof x === "string" ? x : undefined);
const PAGES = ["/hr/welfare-cases"];

/**
 * The welfare lane: the same case services as the Employee relations page, reached with the welfare permission alone (the Welfare function of a Delegated HR Officer, or the HR
 * administrator). The service itself limits this lane to WELFARE cases, whatever case id is sent.
 */
export async function addWelfareNoteAction(caseId: string, v: V) {
  return act("welfare.manage", async (ctx) => {
    await rel.addCaseNote(ctx, caseId, v as never);
    return { message: "Added to the case file." };
  }, PAGES);
}
export async function assignWelfareAction(caseId: string, v: V) {
  return act("welfare.manage", async (ctx) => {
    await rel.assignCase(ctx, caseId, s(v.assignedTo) ?? "");
    return { message: "Case assigned." };
  }, PAGES);
}
export async function setWelfareStatusAction(caseId: string, status: string) {
  return act("welfare.manage", async (ctx) => {
    await rel.setCaseStatus(ctx, caseId, status as never);
    return { message: `Case moved to ${status.toLowerCase()}.` };
  }, PAGES);
}
export async function resolveWelfareAction(caseId: string, v: V) {
  return act("welfare.manage", async (ctx) => {
    await rel.resolveCase(ctx, caseId, v as never);
    return { message: "Case resolved. It still needs to be closed." };
  }, PAGES);
}
export async function closeWelfareAction(caseId: string, reason?: string) {
  return act("welfare.manage", async (ctx) => {
    await rel.closeCase(ctx, caseId, { reason });
    return { message: "Case closed." };
  }, PAGES);
}
