"use server";
import { act } from "./_run";
import { acceptHandover, designateAcceptor, removeAcceptor, returnHandover, saveHandover, submitHandover } from "@/server/services/sales/handover";

type V = Record<string, unknown>;
const text = (x: unknown) => (typeof x === "string" ? x : undefined);
const num = (x: unknown) => (x === undefined || x === null || x === "" ? undefined : Number(x));
const list = (x: unknown): V[] => (Array.isArray(x) ? (x as V[]) : []);

const REVALIDATE = ["/sales/handovers", "/sales/opportunities", "/sales/board"];

/** Sales saves what the handover needs. Only what is given is changed. */
export async function saveHandoverAction(v: V) {
  return act("sales.manage", async (ctx) => {
    const h = await saveHandover(ctx, String(v.id ?? ""), {
      scope: text(v.scope),
      clientRequirements: text(v.clientRequirements),
      startDate: text(v.startDate) || undefined,
      termMonths: num(v.termMonths),
      noSpecialSla: typeof v.noSpecialSla === "boolean" ? v.noSpecialSla : undefined,
      serviceLevels: Array.isArray(v.serviceLevels)
        ? list(v.serviceLevels)
            .filter((s) => text(s.obligation)?.trim())
            .map((s) => ({ obligation: String(s.obligation), measure: text(s.measure), consequence: text(s.consequence) }))
        : undefined,
      sites: Array.isArray(v.sites)
        ? list(v.sites).map((s) => ({
            id: String(s.id ?? ""),
            address: text(s.address),
            state: text(s.state),
            lga: text(s.lga),
            contactName: text(s.contactName),
            contactRole: text(s.contactRole),
            contactPhone: text(s.contactPhone),
            contactEmail: text(s.contactEmail),
            noEquipment: typeof s.noEquipment === "boolean" ? s.noEquipment : undefined,
            equipment: Array.isArray(s.equipment)
              ? list(s.equipment)
                  .filter((e) => text(e.item)?.trim())
                  .map((e) => ({ item: String(e.item), quantity: Number(e.quantity) }))
              : undefined,
          }))
        : undefined,
      posts: Array.isArray(v.posts) ? list(v.posts).filter((p) => text(p.categoryId)).map((p) => ({ id: String(p.id ?? ""), categoryId: String(p.categoryId) })) : undefined,
    });
    return { message: h.missing.length ? `Saved. Still needed before it can be sent: ${h.missing.length} item(s).` : "Saved. It is complete and can be sent to Operations.", data: { missing: h.missing } };
  }, REVALIDATE);
}

export async function submitHandoverAction(v: V) {
  return act("sales.manage", async (ctx) => {
    await submitHandover(ctx, String(v.id ?? ""));
    return { message: "Sent to Operations." };
  }, REVALIDATE);
}

export async function returnHandoverAction(v: V) {
  return act("sales.handover.accept", async (ctx) => {
    await returnHandover(ctx, String(v.id ?? ""), String(v.note ?? ""));
    return { message: "Returned to Sales with your question." };
  }, REVALIDATE);
}

export async function acceptHandoverAction(v: V) {
  return act("sales.handover.accept", async (ctx) => {
    await acceptHandover(ctx, String(v.id ?? ""), { note: text(v.note), existingClientId: text(v.existingClientId) || undefined });
    return { message: "Accepted. The client, a draft contract, its rates and the sites have been made." };
  }, [...REVALIDATE, "/clients", "/contracts"]);
}

export async function designateAcceptorAction(v: V) {
  return act("sales.configure", async (ctx) => {
    await designateAcceptor(ctx, String(v.userId ?? ""));
    return { message: "Designated." };
  }, ["/sales/settings"]);
}

export async function removeAcceptorAction(id: string) {
  return act("sales.configure", async (ctx) => {
    await removeAcceptor(ctx, id);
    return { message: "Removed." };
  }, ["/sales/settings"]);
}
