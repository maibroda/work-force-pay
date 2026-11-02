"use server";
import { act } from "./_run";
import * as records from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";

type V = Record<string, unknown>;

/** A form posts "" for an empty box and "on" or true for a ticked one. */
const blankToUndefined = (v: V) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "" ? undefined : x]));
const ticked = (x: unknown) => x === true || x === "true" || x === "on";

export async function saveSalesSettingAction(v: V) {
  return act(
    "sales.configure",
    async (ctx) => {
      await updateSalesSetting(ctx, { enabled: ticked(v.enabled), mode: v.mode === "SIMPLE" ? "SIMPLE" : "CLASSIC" });
      return { message: "Sales settings saved." };
    },
    ["/sales/settings", "/sales/leads", "/sales/accounts", "/sales/contacts"],
  );
}

export async function createLeadAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      const l = await records.createLead(ctx, blankToUndefined(v) as never);
      return { message: `Lead ${l.number} added.` };
    },
    ["/sales/leads"],
  );
}

export async function createAccountAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      await records.createAccount(ctx, blankToUndefined(v) as never);
      return { message: "Account added." };
    },
    ["/sales/accounts"],
  );
}

export async function createContactAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      await records.createContact(ctx, { ...(blankToUndefined(v) as object), isPrimary: ticked(v.isPrimary) } as never);
      return { message: "Contact added." };
    },
    ["/sales/contacts", "/sales/accounts"],
  );
}
