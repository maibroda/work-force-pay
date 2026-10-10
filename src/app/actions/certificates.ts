"use server";
import { act } from "./_run";
import * as cert from "@/server/services/certificates";

type V = Record<string, unknown>;
const PATHS = ["/accounting/wht-certificates"];

export async function registerCertificateAction(v: V) {
  return act("tax.manage", async (ctx) => {
    const c = await cert.registerCertificate(ctx, v as never);
    return { message: `Certificate ${c.certificateNumber} registered.` };
  }, PATHS);
}

export async function voidCertificateAction(id: string, reason?: string) {
  return act("tax.manage", async (ctx) => {
    await cert.voidCertificate(ctx, id, reason ?? "");
    return { message: "Voided. It stays on record; enter it again if it was wrong." };
  }, PATHS);
}
