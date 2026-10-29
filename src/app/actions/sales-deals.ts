"use server";
import { act } from "./_run";
import { moveOpportunity, updateOpportunity, LOST_REASONS } from "@/server/services/sales/deals";

type V = Record<string, unknown>;
const text = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
const num = (x: unknown) => (x === undefined || x === null || x === "" ? undefined : Number(x));

export async function moveOpportunityAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      const reason = text(v.lostReason);
      await moveOpportunity(ctx, String(v.id), {
        stageId: String(v.stageId ?? ""),
        nextStep: String(v.nextStep ?? ""),
        probability: num(v.probability),
        lostReason: reason && (LOST_REASONS as readonly string[]).includes(reason) ? (reason as (typeof LOST_REASONS)[number]) : undefined,
        lostReasonDetail: text(v.lostReasonDetail),
        competitor: text(v.competitor),
      });
      return { message: "Deal moved." };
    },
    ["/sales/board", "/sales/opportunities"],
  );
}

export async function updateOpportunityAction(v: V) {
  return act(
    "sales.manage",
    async (ctx) => {
      await updateOpportunity(ctx, String(v.id), {
        name: text(v.name),
        monthlyContractValue: text(v.monthlyContractValue),
        probability: num(v.probability),
        expectedCloseDate: text(v.expectedCloseDate),
        expectedStartDate: text(v.expectedStartDate),
        contractTermMonths: num(v.contractTermMonths),
        competitor: text(v.competitor),
        nextStep: text(v.nextStep),
      });
      return { message: "Deal saved." };
    },
    ["/sales/board", "/sales/opportunities"],
  );
}
