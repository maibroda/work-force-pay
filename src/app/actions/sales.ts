"use server";
import { act } from "./_run";
import { BusinessError } from "@/server/services/_base";
import { removeAssignmentRule, setAssignmentMethod, setAssignmentRule, type AssignmentMethod } from "@/server/services/sales/assignment";
import { convertLead } from "@/server/services/sales/conversion";
import { findAccountDuplicates, findPersonDuplicates, type DuplicateReport } from "@/server/services/sales/duplicates";
import { mergeAccounts, mergeContacts } from "@/server/services/sales/merge";
import { kickAutomation } from "@/server/services/sales/automation";
import { createOpportunity } from "@/server/services/sales/pipelines";
import * as records from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";

type V = Record<string, unknown>;

/** A form posts "" for an empty box and "on" or true for a ticked one. */
const blankToUndefined = (v: V) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "" ? undefined : x]));
const ticked = (x: unknown) => x === true || x === "true" || x === "on";
const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

/** Stops an add when it looks like a record already held, unless the person ticked "create anyway". A match owned by someone else is described only by its owner. */
function refuseIfDuplicates(report: DuplicateReport[], createAnyway: boolean) {
  const visible = report.flatMap((r) => r.visible);
  const hidden = report.flatMap((r) => r.hidden);
  if (createAnyway || (!visible.length && !hidden.length)) return;
  const lines = [
    ...visible.map((m) => `${m.label} (${m.reason.toLowerCase()}, owner ${m.ownerName})`),
    ...hidden.map((m) => `a record owned by ${m.ownerName} (${m.reason.toLowerCase()}): ask them or a manager`),
  ];
  throw new BusinessError(`This looks like something already held: ${lines.join("; ")}. Tick "Create anyway" to add it regardless.`);
}

export async function saveSalesSettingAction(v: V) {
  return act(
    "sales.configure",
    async (ctx) => {
      await updateSalesSetting(ctx, { enabled: ticked(v.enabled), mode: v.mode === "SIMPLE" ? "SIMPLE" : "CLASSIC" });
      return { message: "Sales settings saved." };
    },
    ["/sales/settings", "/sales/leads", "/sales/accounts", "/sales/contacts", "/sales/opportunities"],
  );
}

export async function setAssignmentMethodAction(v: V) {
  return act(
    "sales.configure",
    async (ctx) => {
      await setAssignmentMethod(ctx, String(v.method) as AssignmentMethod);
      return { message: "Assignment method saved." };
    },
    ["/sales/settings"],
  );
}

export async function setAssignmentRuleAction(v: V) {
  return act(
    "sales.configure",
    async (ctx) => {
      await setAssignmentRule(ctx, { kind: v.kind === "SERVICE" ? "SERVICE" : "STATE", key: String(v.key ?? ""), userId: String(v.userId ?? "") });
      return { message: "Rule saved." };
    },
    ["/sales/settings"],
  );
}

export async function removeAssignmentRuleAction(id: string) {
  return act(
    "sales.configure",
    async (ctx) => {
      await removeAssignmentRule(ctx, id);
      return { message: "Rule removed." };
    },
    ["/sales/settings"],
  );
}

export async function createLeadAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      refuseIfDuplicates(
        [await findPersonDuplicates(ctx, { phone: text(v.phone), email: text(v.email) }), await findAccountDuplicates(ctx, { name: text(v.companyName) ?? "", email: text(v.email) })],
        ticked(v.createAnyway),
      );
      const { createAnyway: _c, ...rest } = v;
      void _c;
      const l = await records.createLead(ctx, blankToUndefined(rest) as never);
      return { message: `Lead ${l.number} added.` };
    },
    ["/sales/leads"],
  );
}

export async function createAccountAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      refuseIfDuplicates([await findAccountDuplicates(ctx, { name: text(v.name) ?? "", rcNumber: text(v.rcNumber), emailDomain: text(v.emailDomain) })], ticked(v.createAnyway));
      const { createAnyway: _c, ...rest } = v;
      void _c;
      await records.createAccount(ctx, blankToUndefined(rest) as never);
      return { message: "Account added." };
    },
    ["/sales/accounts"],
  );
}

export async function createContactAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      refuseIfDuplicates([await findPersonDuplicates(ctx, { phone: text(v.phone), email: text(v.email) })], ticked(v.createAnyway));
      const { createAnyway: _c, ...rest } = v;
      void _c;
      await records.createContact(ctx, { ...(blankToUndefined(rest) as object), isPrimary: ticked(v.isPrimary) } as never);
      return { message: "Contact added." };
    },
    ["/sales/contacts", "/sales/accounts"],
  );
}

export async function createOpportunityAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      const made = await createOpportunity(ctx, blankToUndefined(v) as never);
      await kickAutomation(ctx.orgId, made.id);
      return { message: "Deal added." };
    },
    ["/sales/opportunities"],
  );
}

export async function convertLeadAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      const r = await convertLead(ctx, String(v.leadId), {
        account: text(v.accountId) ? { id: String(v.accountId) } : { create: true },
        contact: text(v.contactId) ? { id: String(v.contactId) } : { create: true },
        opportunity: ticked(v.createDeal) ? {} : false,
      });
      if (r.opportunityId) await kickAutomation(ctx.orgId, r.opportunityId);
      return { message: r.opportunityId ? "Lead converted into an account, a contact and a deal." : "Lead converted into an account and a contact." };
    },
    ["/sales/leads", "/sales/accounts", "/sales/contacts", "/sales/opportunities"],
  );
}

export async function mergeAccountsAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      await mergeAccounts(ctx, { survivorId: String(v.survivorId), loserId: String(v.loserId) });
      return { message: "Accounts merged. The second one is now voided and points to the first." };
    },
    ["/sales/accounts", "/sales/contacts", "/sales/opportunities", "/sales/merge"],
  );
}

export async function mergeContactsAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      await mergeContacts(ctx, { survivorId: String(v.survivorId), loserId: String(v.loserId) });
      return { message: "Contacts merged. The second one is now voided and points to the first." };
    },
    ["/sales/contacts", "/sales/opportunities", "/sales/merge"],
  );
}
