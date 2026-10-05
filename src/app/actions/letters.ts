"use server";
import { act } from "./_run";
import * as letters from "@/server/services/letters";
import type { LetterTypeKey } from "@/lib/letters";

type V = Record<string, unknown>;
const PATHS = ["/hr", "/employees", "/settings"];

export async function generateLetterAction(v: V) {
  return act("hr.manage", async (ctx) => {
    const l = await letters.generateLetter(ctx, v as never);
    return { message: `${l.referenceNumber} generated.`, redirectTo: `/hr/letters/${l.id}` };
  }, PATHS);
}

export async function saveLetterTemplateAction(v: V) {
  return act("hr.configure", async (ctx) => {
    await letters.saveTemplate(ctx, v as never);
    return { message: "Letter wording saved — new letters will use it." };
  }, PATHS);
}

export async function resetLetterTemplateAction(type: string) {
  return act("hr.configure", async (ctx) => {
    await letters.resetTemplate(ctx, type as LetterTypeKey);
    return { message: "Wording reset to the default." };
  }, PATHS);
}
