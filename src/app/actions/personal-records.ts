"use server";
import { act } from "./_run";
import * as pr from "@/server/services/personal-records";

type V = Record<string, unknown>;

// Contacts are open to the employee themselves (self-service) as well as HR, so these only require a
// login — the service decides whose records the caller may touch. Pages revalidated cover both views.
const PAGES = ["/employees", "/me"];

export async function addContactAction(employeeId: string, v: V) {
  return act(undefined, async (ctx) => {
    await pr.addContact(ctx, employeeId, v as never);
    return { message: "Contact saved." };
  }, PAGES);
}
/** `back` is the list page, so saving an edit leaves edit mode. */
export async function updateContactAction(id: string, back: string, v: V) {
  return act(undefined, async (ctx) => {
    await pr.updateContact(ctx, id, v as never);
    return { message: "Contact updated.", redirectTo: back };
  }, PAGES);
}
export async function setPrimaryContactAction(id: string) {
  return act(undefined, async (ctx) => {
    await pr.setPrimaryContact(ctx, id);
    return { message: "Main contact changed." };
  }, PAGES);
}
export async function removeContactAction(id: string) {
  return act(undefined, async (ctx) => {
    await pr.removeContact(ctx, id);
    return { message: "Contact removed." };
  }, PAGES);
}

export async function addGuarantorAction(employeeId: string, v: V) {
  return act("hr.manage", async (ctx) => {
    await pr.addGuarantor(ctx, employeeId, v as never);
    return { message: "Guarantor recorded — pending verification." };
  }, PAGES);
}
export async function updateGuarantorAction(id: string, back: string, v: V) {
  return act("hr.manage", async (ctx) => {
    const u = await pr.updateGuarantor(ctx, id, v as never);
    return { message: u.status === "PENDING" ? "Guarantor updated — it needs verifying again." : "Guarantor updated.", redirectTo: back };
  }, PAGES);
}
export async function verifyGuarantorAction(id: string, note?: string) {
  return act("hr.manage", async (ctx) => {
    await pr.verifyGuarantor(ctx, id, note ?? "");
    return { message: "Guarantor verified." };
  }, PAGES);
}
export async function rejectGuarantorAction(id: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await pr.rejectGuarantor(ctx, id, reason ?? "");
    return { message: "Guarantor rejected." };
  }, PAGES);
}
export async function releaseGuarantorAction(id: string, reason?: string) {
  return act("hr.manage", async (ctx) => {
    await pr.releaseGuarantor(ctx, id, reason ?? "");
    return { message: "Guarantor released." };
  }, PAGES);
}
export async function deleteGuarantorAction(id: string) {
  return act("hr.manage", async (ctx) => {
    await pr.deleteGuarantor(ctx, id);
    return { message: "Guarantor removed." };
  }, PAGES);
}
