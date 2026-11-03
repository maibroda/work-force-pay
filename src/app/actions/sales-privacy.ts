"use server";
import { actFor } from "./_run";
import { completeAccess, eraseForRetention, eraseSubject, keepLead, openRequest, refuseRequest, setRetention, verifyIdentity } from "@/server/services/sales/privacy";
const act = actFor("sales-privacy.ts");

type V = Record<string, unknown>;
const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const PATHS = ["/sales/privacy"];

/** Opens a request from a person about their data (a copy, or erasure). The deadline is counted from the day it was received. */
export async function openRequestAction(v: V) {
  return act("sales.privacy.manage", async (ctx) => {
    const r = await openRequest(ctx, {
      kind: v.kind === "ERASURE" ? "ERASURE" : "ACCESS",
      subjectType: String(v.subject ?? "").startsWith("LEAD:") ? "LEAD" : "CONTACT",
      subjectId: String(v.subject ?? "").split(":")[1] ?? "",
      requesterName: String(v.requesterName ?? ""),
      channel: text(v.channel),
      receivedOn: text(v.receivedOn),
    });
    return { message: `Request ${r.number} opened. Check the person's identity next.` };
  }, PATHS);
}

export async function verifyIdentityAction(v: V, reason?: string) {
  return act("sales.privacy.manage", async (ctx) => {
    await verifyIdentity(ctx, String(v.id ?? ""), reason ?? String(v.method ?? ""));
    return { message: "Identity recorded as checked." };
  }, PATHS);
}

export async function refuseRequestAction(v: V, reason?: string) {
  return act("sales.privacy.manage", async (ctx) => {
    await refuseRequest(ctx, String(v.id ?? ""), reason ?? String(v.reason ?? ""));
    return { message: "Request closed without action." };
  }, PATHS);
}

/** Erases the person: their record is anonymised and their addresses stay suppressed. This cannot be undone. */
export async function eraseSubjectAction(v: V, reason?: string) {
  return act("sales.privacy.manage", async (ctx) => {
    const r = await eraseSubject(ctx, String(v.id ?? ""), reason ?? text(v.outcomeNote));
    const n = Object.values(r.review).reduce((a, b) => a + b.length, 0);
    return { message: `Erased. ${n} record(s) elsewhere may still mention the person in free text and are listed for review.` };
  }, PATHS);
}

export async function completeAccessAction(v: V) {
  return act("sales.privacy.manage", async (ctx) => {
    await completeAccess(ctx, String(v.id ?? ""));
    return { message: "Request completed." };
  }, PATHS);
}

export async function setRetentionAction(v: V) {
  return act("sales.privacy.manage", async (ctx) => {
    const raw = text(v.months);
    await setRetention(ctx, raw === undefined ? null : Number(raw));
    return { message: raw === undefined ? "Retention review switched off." : "Retention period saved." };
  }, PATHS);
}

export async function keepLeadAction(v: V, reason?: string) {
  return act("sales.privacy.manage", async (ctx) => {
    await keepLead(ctx, String(v.id ?? ""), Number(v.months ?? 12), reason ?? String(v.reason ?? ""));
    return { message: "Kept. It will come up for review again after that." };
  }, PATHS);
}

export async function eraseForRetentionAction(v: V) {
  return act("sales.privacy.manage", async (ctx) => {
    const r = await eraseForRetention(ctx, String(v.id ?? ""));
    return { message: `Erased and recorded as ${r.number}.` };
  }, PATHS);
}
