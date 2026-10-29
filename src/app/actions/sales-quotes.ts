"use server";
import { act } from "./_run";
import { approveBelowMargin, createQuote, decideQuote, designateApprover, estimateLine, removeApprover, reviseQuote, sendQuote, setMinimumMargin } from "@/server/services/sales/quotes";

type V = Record<string, unknown>;
const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const num = (x: unknown) => (x === undefined || x === null || x === "" ? undefined : Number(x));

/** What one guard costs the company at this bill rate, from the rules in force today. Saves nothing. */
export async function estimateLineAction(v: V) {
  return act("sales.view", async (ctx) => {
    const e = await estimateLine(ctx, { salaryStructureId: String(v.salaryStructureId ?? ""), billRatePerHead: String(v.billRatePerHead ?? ""), operativeSharePct: num(v.operativeSharePct), businessLine: v.businessLine === "OUTSOURCING" ? "OUTSOURCING" : "GUARDING", headcount: num(v.headcount), requiredPersonnel: num(v.requiredPersonnel) });
    return { data: e };
  });
}

export async function createQuoteAction(v: V) {
  return act("sales.manage", async (ctx) => {
    const lines = (Array.isArray(v.lines) ? (v.lines as V[]) : []).map((l) => ({
      siteName: String(l.siteName ?? ""),
      siteAddress: text(l.siteAddress),
      postLabel: text(l.postLabel),
      shiftPattern: text(l.shiftPattern),
      salaryStructureId: String(l.salaryStructureId ?? ""),
      headcount: Number(l.headcount),
      requiredPersonnel: num(l.requiredPersonnel),
      billRatePerHead: String(l.billRatePerHead ?? ""),
      operativeSharePct: num(l.operativeSharePct),
      businessLine: l.businessLine === "OUTSOURCING" ? ("OUTSOURCING" as const) : ("GUARDING" as const),
    }));
    const q = await createQuote(ctx, { opportunityId: String(v.opportunityId ?? ""), validUntil: text(v.validUntil), notes: text(v.notes), lines });
    return { message: `Quote ${q.number} saved as a draft.`, data: { id: q.id } };
  }, ["/sales/opportunities"]);
}

export async function sendQuoteAction(v: V) {
  return act("sales.manage", async (ctx) => {
    await sendQuote(ctx, String(v.id));
    return { message: "Quote marked as sent." };
  }, ["/sales/opportunities", "/sales/board"]);
}

export async function reviseQuoteAction(v: V) {
  return act("sales.manage", async (ctx) => {
    const q = await reviseQuote(ctx, String(v.id));
    return { message: `Version ${q.versionNo} created as a draft.`, data: { id: q.id } };
  }, ["/sales/opportunities"]);
}

export async function approveBelowMarginAction(v: V) {
  return act("sales.manage", async (ctx) => {
    await approveBelowMargin(ctx, String(v.id), String(v.note ?? ""));
    return { message: "Approved. The quote can now be sent." };
  }, ["/sales/opportunities"]);
}

export async function decideQuoteAction(v: V) {
  return act("sales.manage", async (ctx) => {
    await decideQuote(ctx, String(v.id), v.decision === "REJECTED" ? "REJECTED" : "ACCEPTED", text(v.note));
    return { message: v.decision === "REJECTED" ? "Quote marked as rejected." : "Quote accepted. Its monthly total is now the deal's value." };
  }, ["/sales/opportunities", "/sales/board"]);
}

export async function setMinimumMarginAction(v: V) {
  return act("sales.configure", async (ctx) => {
    await setMinimumMargin(ctx, Number(v.percent));
    return { message: "Minimum margin saved." };
  }, ["/sales/settings"]);
}

export async function designateApproverAction(v: V) {
  return act("sales.configure", async (ctx) => {
    await designateApprover(ctx, String(v.userId ?? ""));
    return { message: "Approver designated." };
  }, ["/sales/settings"]);
}

export async function removeApproverAction(id: string) {
  return act("sales.configure", async (ctx) => {
    await removeApprover(ctx, id);
    return { message: "Approver removed." };
  }, ["/sales/settings"]);
}
