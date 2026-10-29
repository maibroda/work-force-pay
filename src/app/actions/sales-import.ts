"use server";
import { act } from "./_run";
import { errorsCsv, type ImportKind } from "@/lib/sales/import";
import { recordConsent } from "@/server/services/sales/consent";
import { commitImport, previewImport } from "@/server/services/sales/import";

type V = Record<string, unknown>;

const kindOf = (v: V) => String(v.kind) as ImportKind;

/** Checks the file and returns every row's problems. Saves nothing. */
export async function previewSalesImportAction(v: V) {
  return act("sales.manage", async (ctx) => {
    const p = await previewImport(ctx, kindOf(v), String(v.csv ?? ""));
    return { data: { preview: p, errorsCsv: p.check.fatal ? "" : errorsCsv(kindOf(v), p.check) } };
  });
}

export async function commitSalesImportAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      const r = await commitImport(ctx, kindOf(v), String(v.csv ?? ""), { skipErrors: v.skipErrors === true, importDuplicates: v.importDuplicates === true });
      return { message: `${r.created} imported. ${r.skippedErrors} left out for errors, ${r.skippedDuplicates} left out as already held.` };
    },
    ["/sales/leads", "/sales/accounts", "/sales/contacts"],
  );
}

/** Records that a contact or lead consented to, or withdrew from, marketing. */
export async function recordConsentAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      await recordConsent(ctx, {
        contactId: v.contactId ? String(v.contactId) : undefined,
        leadId: v.leadId ? String(v.leadId) : undefined,
        purpose: v.purpose === "SERVICE" ? "SERVICE" : "MARKETING",
        status: v.status === "WITHDRAWN" ? "WITHDRAWN" : "GRANTED",
        channel: String(v.channel ?? "OTHER") as never,
        source: String(v.source ?? ""),
        evidenceRef: v.evidenceRef ? String(v.evidenceRef) : undefined,
      });
      return { message: "Consent recorded." };
    },
    ["/sales/contacts"],
  );
}
