"use server";
import { act } from "./_run";
import * as pf from "@/server/services/payment-file";
import * as pb from "@/server/services/paying-banks";

type V = Record<string, unknown>;

export async function saveBankCodeAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      await pf.saveBankCode(ctx, v as never);
      return { message: "Bank saved." };
    },
    ["/payments/bank-codes", "/payments/bank-file"],
  );
}

export async function createPayingBankAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      await pb.createPayingBank(ctx, v as never);
      return { message: "Paying bank added." };
    },
    ["/payments/paying-banks", "/payments/bank-file"],
  );
}

export async function savePayingBankAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const { id, active, isDefault, ...rest } = v;
      // an empty box means "no limit" / "no change" depending on the field, so only what was filled in is passed on
      const keep = Object.fromEntries(Object.entries(rest).filter(([k, x]) => x !== undefined && (x !== "" || ["narrationMax", "maxRows", "debitAccountNumber"].includes(k))));
      await pb.savePayingBank(ctx, { id: String(id), ...keep, active: active === undefined ? undefined : active === true || active === "true" || active === "on", isDefault: isDefault === undefined ? undefined : isDefault === true || isDefault === "true" || isDefault === "on" } as never);
      return { message: "Paying bank saved." };
    },
    ["/payments/paying-banks", "/payments/bank-file"],
  );
}

export async function importCodeSetAction(v: V) {
  return act(
    "payment.manage",
    async (ctx) => {
      const set = await pb.importCodeSet(ctx, String(v.payingBankId), String(v.list ?? ""), String(v.sourceName ?? ""));
      return { message: `Saved as version ${set.version}: ${set.entryCount} banks, ${set.blockedCount} blocked.` };
    },
    ["/payments/paying-banks", "/payments/bank-file"],
  );
}
