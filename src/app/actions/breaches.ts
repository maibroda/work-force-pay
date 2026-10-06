"use server";
import { act, s } from "./_run";
import { DATA_CATEGORIES, type Assessment } from "@/lib/breaches";
import { BusinessError } from "@/server/services/_base";
import * as br from "@/server/services/breaches";

type V = Record<string, unknown>;
const PAGES = ["/hr"];

/** A date field and an optional "14:30" field become one timestamp ("2026-10-06T14:30"). */
function stamp(date: unknown, time: unknown): string {
  const t = String(time ?? "").trim();
  const dd = String(date ?? "");
  if (!t) return dd;
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) throw new BusinessError("Write the time as hours:minutes, e.g. 14:30.");
  return `${dd}T${t.padStart(5, "0")}`;
}

/** One tick box per kind of data (cat_0, cat_1 …) become the list of ticked names. */
const categories = (v: V) => DATA_CATEGORIES.filter((_, i) => v[`cat_${i}`] === true);

export async function reportBreachAction(v: V) {
  return act("hr.manage", async (ctx) => {
    const b = await br.reportBreach(ctx, {
      title: String(v.title ?? ""),
      description: String(v.description ?? ""),
      discoveredAt: stamp(v.discoveredDate, v.discoveredTime),
      occurredOn: s(v.occurredOn),
      dataCategories: categories(v),
      individualsAffected: v.individualsAffected === "" || v.individualsAffected === undefined ? undefined : Number(v.individualsAffected),
    });
    return { message: `${b.incidentNumber} logged. The regulator's clock started when you became aware — assess the risk now.` };
  }, PAGES);
}

export async function updateBreachDetailsAction(id: string, v: V) {
  return act("hr.manage", async (ctx) => {
    const cats = categories(v);
    await br.updateDetails(ctx, id, {
      dataCategories: Object.keys(v).some((k) => k.startsWith("cat_")) ? cats : undefined,
      individualsAffected: v.individualsAffected === "" || v.individualsAffected === undefined ? undefined : Number(v.individualsAffected),
      containmentNote: s(v.containmentNote),
      containedAt: v.containedDate ? stamp(v.containedDate, v.containedTime) : undefined,
      rootCause: s(v.rootCause),
      remediation: s(v.remediation),
    });
    return { message: "Details saved." };
  }, PAGES);
}

export async function addBreachNoteAction(id: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await br.addNote(ctx, id, String(v.note ?? ""));
    return { message: "Note added to the timeline." };
  }, PAGES);
}

export async function assessBreachAction(id: string, v: V) {
  return act("hr.approve", async (ctx) => {
    await br.assessBreach(ctx, id, String(v.assessment) as Assessment, String(v.note ?? ""));
    return { message: "Assessment recorded." };
  }, PAGES);
}

export async function notifyRegulatorAction(id: string, v: V) {
  return act("hr.approve", async (ctx) => {
    await br.recordRegulatorNotified(ctx, id, { notifiedAt: stamp(v.notifiedDate, v.notifiedTime), reference: s(v.reference), lateReason: s(v.lateReason) });
    return { message: "Recorded that the regulator was told." };
  }, PAGES);
}

export async function notifyIndividualsAction(id: string, v: V) {
  return act("hr.approve", async (ctx) => {
    await br.recordIndividualsNotified(ctx, id, { notifiedAt: stamp(v.notifiedDate, v.notifiedTime), note: String(v.note ?? "") });
    return { message: "Recorded that the people affected were told." };
  }, PAGES);
}

export async function closeBreachAction(id: string, note?: string) {
  return act("hr.approve", async (ctx) => {
    await br.closeBreach(ctx, id, note);
    return { message: "Breach closed." };
  }, PAGES);
}
