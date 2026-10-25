"use server";
import { act } from "./_run";
import * as pf from "@/server/services/payment-file";

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
