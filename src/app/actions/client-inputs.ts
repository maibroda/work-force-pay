"use server";
import { act } from "./_run";
import * as inputs from "@/server/services/client-inputs";

type V = Record<string, unknown>;
const PATHS = ["/portal/inputs", "/payroll/client-inputs", "/payroll/calendar", "/portal"];

/** Checks a file without writing anything; the result is in `data`. */
export async function previewClientInputsAction(v: V) {
  return act("portal.inputs", async (ctx) => {
    const check = await inputs.previewClientInputs(ctx, String(v.periodId ?? ""), String(v.csv ?? ""));
    return { message: "Checked.", data: check };
  });
}

export async function submitClientInputsAction(v: V) {
  return act(
    "portal.inputs",
    async (ctx) => {
      const b = await inputs.submitClientInputs(ctx, { periodId: String(v.periodId ?? ""), csv: String(v.csv ?? ""), fileName: String(v.fileName ?? ""), note: v.note ? String(v.note) : undefined });
      return { message: `${b.number} sent. The bureau will review it and you will be emailed.`, redirectTo: `/portal/inputs/${b.id}` };
    },
    PATHS,
  );
}

export async function withdrawClientInputsAction(id: string) {
  return act(
    "portal.inputs",
    async (ctx) => {
      await inputs.withdrawClientInputs(ctx, id);
      return { message: "Withdrawn. Nothing was added to the payroll." };
    },
    PATHS,
  );
}

export async function acceptClientInputsAction(id: string) {
  return act(
    "payroll.inputs.approve",
    async (ctx) => {
      const r = await inputs.acceptClientInputs(ctx, id);
      return { message: `${r.rows} input(s) added to the month.${r.recalculate ? " The payroll has already been calculated: calculate it again to include them." : ""}` };
    },
    PATHS,
  );
}

export async function rejectClientInputsAction(id: string, reason?: string) {
  return act(
    "payroll.inputs.approve",
    async (ctx) => {
      await inputs.rejectClientInputs(ctx, id, reason ?? "");
      return { message: "Sent back to the client." };
    },
    PATHS,
  );
}
