"use server";
import { actFor } from "./_run";
import * as book from "@/server/services/price-book";
const act = actFor("price-book.ts");

type V = Record<string, unknown>;
const PATHS = ["/settings/price-book"];

/** Platform staff only (the service checks it again). Each `price_<module>` field that is not empty becomes a price; the rest are left unpriced. */
export async function createPriceBookAction(v: V) {
  return act("pricebook.manage", async (ctx) => {
    const lines: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) if (k.startsWith("price_") && String(val ?? "").trim() !== "") lines[k.slice("price_".length)] = String(val).trim();
    await book.createPriceBook(ctx, { effectiveFrom: String(v.effectiveFrom ?? ""), currency: v.currency ? String(v.currency) : undefined, minimumMonthly: String(v.minimumMonthly ?? "").trim() || "0.00", note: v.note ? String(v.note) : undefined, lines });
    return { message: `Saved as a draft starting ${String(v.effectiveFrom)} with ${Object.keys(lines).length} price${Object.keys(lines).length === 1 ? "" : "s"}. A second person must verify it before any quote can use it.` };
  }, PATHS);
}

export async function verifyPriceBookAction(id: string) {
  return act("pricebook.manage", async (ctx) => {
    await book.verifyPriceBook(ctx, id);
    return { message: "Verified. From its start date, quotes use these prices, and they can no longer be changed." };
  }, PATHS);
}

export async function deletePriceBookDraftAction(id: string) {
  return act("pricebook.manage", async (ctx) => {
    await book.deletePriceBookDraft(ctx, id);
    return { message: "Draft deleted." };
  }, PATHS);
}
