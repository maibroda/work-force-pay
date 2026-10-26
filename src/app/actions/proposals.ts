"use server";
import { act } from "./_run";
import * as pr from "@/server/services/proposals";

type V = Record<string, unknown>;
const PATHS = ["/crm"];

/** The add-on tick boxes (addon_CODE) become the list of codes the service expects. */
function withAddOns(v: V): V {
  const codes = Object.keys(v).filter((k) => k.startsWith("addon_") && v[k] === true).map((k) => k.slice(6));
  return { ...Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith("addon_"))), addOnCodes: codes };
}

export async function saveSettingAction(v: V) {
  return act("pricing.manage", async (ctx) => {
    await pr.saveSetting(ctx, v as never);
    return { message: "Saved. The rate card needs confirming again before anything is sent." };
  }, PATHS);
}

export async function savePackageAction(key: string, v: V) {
  return act("pricing.manage", async (ctx) => {
    await pr.savePackage(ctx, key, v as never);
    return { message: "Saved. The rate card needs confirming again before anything is sent." };
  }, PATHS);
}

export async function saveAddOnAction(v: V) {
  return act("pricing.manage", async (ctx) => {
    await pr.saveAddOn(ctx, v as never);
    return { message: "Saved. The rate card needs confirming again before anything is sent." };
  }, PATHS);
}

export async function confirmRateCardAction(v: V) {
  return act("pricing.manage", async (ctx) => {
    await pr.confirmRateCard(ctx, String(v.note ?? ""));
    return { message: "Rate card confirmed." };
  }, PATHS);
}

export async function createProposalAction(leadId: string, v: V) {
  return act("crm.manage", async (ctx) => {
    const p = await pr.createProposal(ctx, leadId, withAddOns(v) as never);
    return { message: `${p.number} drafted.`, redirectTo: `/crm/proposals/${p.id}` };
  }, PATHS);
}

export async function updateProposalAction(id: string, v: V) {
  return act("crm.manage", async (ctx) => {
    await pr.updateProposal(ctx, id, withAddOns(v) as never);
    return { message: "Repriced and saved." };
  }, PATHS);
}

export async function approveBelowMarginAction(id: string, reason?: string) {
  return act("pricing.manage", async (ctx) => {
    await pr.approveBelowMargin(ctx, id, reason ?? "");
    return { message: "Approved." };
  }, PATHS);
}

export async function sendProposalAction(id: string) {
  return act("crm.manage", async (ctx) => {
    await pr.sendProposal(ctx, id);
    return { message: "Marked as sent. Download the PDF to send it to the prospect." };
  }, PATHS);
}

export async function decideProposalAction(id: string, decision: "ACCEPTED" | "DECLINED", reason?: string) {
  return act("crm.manage", async (ctx) => {
    await pr.decideProposal(ctx, id, decision, reason);
    return { message: decision === "ACCEPTED" ? "Accepted. The lead now carries this fee." : "Declined." };
  }, PATHS);
}

export async function reviseProposalAction(id: string) {
  return act("crm.manage", async (ctx) => {
    const p = await pr.reviseProposal(ctx, id);
    return { message: `${p.number} drafted from it.`, redirectTo: `/crm/proposals/${p.id}` };
  }, PATHS);
}

export async function withdrawProposalAction(id: string, reason?: string) {
  return act("crm.manage", async (ctx) => {
    await pr.withdrawProposal(ctx, id, reason ?? "");
    return { message: "Withdrawn." };
  }, PATHS);
}
