"use server";
import { act } from "./_run";
import * as tax from "@/server/services/tax-engine";

type V = Record<string, unknown>;
const PATHS = ["/accounting", "/finance/invoices"];

export async function saveTaxCodeAction(v: V) {
  return act("tax.manage", async (ctx) => {
    const c = await tax.saveTaxCode(ctx, null, v as never);
    return { message: `Tax code ${c.code} created. Propose its first rate next.` };
  }, PATHS);
}

export async function installStandardTaxAction() {
  return act("tax.manage", async (ctx) => {
    await tax.installStandardTax(ctx);
    return { message: "VAT and withholding codes created, each with a proposed rate that someone else has to approve." };
  }, PATHS);
}

export async function setDefaultTaxCodeAction(id: string) {
  return act("tax.manage", async (ctx) => {
    await tax.setDefaultTaxCode(ctx, id);
    return { message: "Now the default for its type." };
  }, PATHS);
}

export async function setTaxCodeActiveAction(id: string, active: boolean) {
  return act("tax.manage", async (ctx) => {
    await tax.setTaxCodeActive(ctx, id, active);
    return { message: active ? "Code reactivated." : "Code deactivated." };
  }, PATHS);
}

export async function proposeRateAction(taxCodeId: string, v: V) {
  return act("tax.manage", async (ctx) => {
    await tax.proposeRate(ctx, taxCodeId, v as never);
    return { message: "Rate proposed. Someone else has to approve it before invoices can use it." };
  }, PATHS);
}

export async function decideRateAction(id: string, approve: boolean, note?: string) {
  return act("tax.approve", async (ctx) => {
    await tax.decideRate(ctx, id, approve, note);
    return { message: approve ? "Rate approved. Invoices dated on or after its start date will use it." : "Rate turned down." };
  }, PATHS);
}
