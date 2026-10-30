"use server";
import { act } from "./_run";
import { saveHealthWeights } from "@/server/services/sales/health";

type V = Record<string, unknown>;

export async function saveHealthWeightsAction(v: V) {
  return act("sales.configure", async (ctx) => {
    const n = (x: unknown) => (x === "" || x === undefined || x === null ? NaN : Number(x));
    await saveHealthWeights(ctx, { SLA_BREACHES: n(v.SLA_BREACHES), OPEN_SEVERE_CASES: n(v.OPEN_SEVERE_CASES), GUARD_ABSENCE: n(v.GUARD_ABSENCE), INVOICES_OVERDUE: n(v.INVOICES_OVERDUE), CONTRACT_END: n(v.CONTRACT_END), CLIENT_CONTACT: n(v.CLIENT_CONTACT) });
    return { message: "Weights saved. Scores use them from the next recalculation (every night, and when a case changes)." };
  }, ["/sales/cases/settings", "/sales/health"]);
}
