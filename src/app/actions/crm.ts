"use server";
import { act } from "./_run";
import * as crm from "@/server/services/crm";

type V = Record<string, unknown>;
const PATHS = ["/crm"];

export async function createLeadAction(v: V) {
  return act(
    "crm.manage",
    async (ctx) => {
      const l = await crm.createLead(ctx, v as never);
      return { message: `${l.number} added to the pipeline.`, redirectTo: `/crm/leads/${l.id}` };
    },
    PATHS,
  );
}

export async function updateLeadAction(id: string, v: V) {
  return act("crm.manage", async (ctx) => {
    await crm.updateLead(ctx, id, v as never);
    return { message: "Lead saved." };
  }, PATHS);
}

export async function moveLeadAction(id: string, v: V) {
  return act("crm.manage", async (ctx) => {
    const l = await crm.moveLead(ctx, id, v as never);
    return { message: l.stage === "WON" ? "Won. Congratulations." : `Moved to ${l.stage.toLowerCase()}.` };
  }, PATHS);
}

export async function logOutreachAction(v: V) {
  return act("crm.manage", async (ctx) => {
    const r = await crm.logOutreach(ctx, v as never);
    return { message: r.lead && !v.leadId ? `Logged, and ${r.lead.number} added to the pipeline.` : "Logged." };
  }, PATHS);
}

export async function createPartnerAction(v: V) {
  return act("crm.manage", async (ctx) => {
    const p = await crm.createPartner(ctx, v as never);
    return { message: `${p.name} added.` };
  }, PATHS);
}

export async function setPartnerActiveAction(id: string, active: boolean) {
  return act("crm.manage", async (ctx) => {
    const p = (await crm.listPartners(ctx)).find((x) => x.id === id);
    if (!p) throw new Error("Referral partner not found.");
    await crm.updatePartner(ctx, id, { name: p.name, kind: p.kind, contactName: p.contactName ?? undefined, email: p.email ?? undefined, phone: p.phone ?? undefined, commissionPct: Number(p.commissionPct), commissionMonths: p.commissionMonths, notes: p.notes ?? undefined, active });
    return { message: active ? "Partner is active again." : "Partner switched off for new leads." };
  }, PATHS);
}

export async function recordPayoutAction(v: V) {
  return act("crm.manage", async (ctx) => {
    await crm.recordPayout(ctx, v as never);
    return { message: "Payout recorded." };
  }, PATHS);
}

/** Outreach logged from a lead's own page: bound to that lead. */
export async function logLeadOutreachAction(leadId: string, v: V) {
  return act("crm.manage", async (ctx) => {
    await crm.logOutreach(ctx, { ...v, leadId } as never);
    return { message: "Logged." };
  }, PATHS);
}
