"use server";
import { act } from "./_run";
import * as hc from "@/server/services/health-checks";

type V = Record<string, unknown>;
const PATHS = ["/health-checks", "/crm"];

export async function createHealthCheckAction(leadId: string, v: V) {
  return act("healthcheck.manage", async (ctx) => {
    const c = await hc.createHealthCheck(ctx, leadId, v as never);
    return { message: `${c.number} started.`, redirectTo: `/health-checks/${c.id}` };
  }, PATHS);
}

export async function updateHealthCheckAction(id: string, v: V) {
  return act("healthcheck.manage", async (ctx) => {
    await hc.updateHealthCheck(ctx, id, v as never);
    return { message: "Saved." };
  }, PATHS);
}

export async function assessItemAction(itemId: string, v: V) {
  return act("healthcheck.manage", async (ctx) => {
    await hc.assessItem(ctx, itemId, v as never);
    return { message: "Saved." };
  }, PATHS);
}

export async function addFindingAction(checkId: string, v: V) {
  return act("healthcheck.manage", async (ctx) => {
    const f = await hc.addFinding(ctx, checkId, v as never);
    return { message: `Finding ${f.number} recorded.` };
  }, PATHS);
}

export async function deleteFindingAction(id: string) {
  return act("healthcheck.manage", async (ctx) => {
    await hc.deleteFinding(ctx, id);
    return { message: "Finding removed." };
  }, PATHS);
}

export async function submitForReviewAction(id: string) {
  return act("healthcheck.manage", async (ctx) => {
    await hc.submitForReview(ctx, id);
    return { message: "Sent for review." };
  }, PATHS);
}

export async function sendBackAction(id: string, reason?: string) {
  return act("healthcheck.manage", async (ctx) => {
    await hc.sendBack(ctx, id, reason ?? "");
    return { message: "Sent back to the assessor." };
  }, PATHS);
}

export async function issueHealthCheckAction(id: string, v: V) {
  return act("healthcheck.manage", async (ctx) => {
    await hc.issueHealthCheck(ctx, id, v as never);
    return { message: "Issued. It can no longer be changed." };
  }, PATHS);
}

export async function withdrawHealthCheckAction(id: string, reason?: string) {
  return act("healthcheck.manage", async (ctx) => {
    await hc.withdrawHealthCheck(ctx, id, reason ?? "");
    return { message: "Withdrawn." };
  }, PATHS);
}
