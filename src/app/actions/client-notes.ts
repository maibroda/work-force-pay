"use server";
import { act } from "./_run";
import * as cn from "@/server/services/client-notes";

type V = Record<string, unknown>;
const PATHS = ["/finance/notes", "/finance/invoices", "/finance/statements", "/finance/receipts"];

export async function raiseNoteAction(v: V) {
  return act("note.manage", async (ctx) => {
    const n = await cn.raiseNote(ctx, v as never);
    return { message: `${n.noteNumber} raised. Someone else has to approve it before it takes effect.`, redirectTo: `/finance/notes/${n.id}` };
  }, PATHS);
}

export async function withdrawNoteAction(id: string, reason?: string) {
  return act("note.manage", async (ctx) => {
    await cn.withdrawNote(ctx, id, reason ?? "");
    return { message: "Withdrawn." };
  }, PATHS);
}

export async function decideNoteAction(id: string, approve: boolean, note?: string) {
  return act("note.approve", async (ctx) => {
    await cn.decideNote(ctx, id, approve, note);
    return { message: approve ? "Approved and posted. The invoice's balance has moved." : "Note turned down." };
  }, PATHS);
}
