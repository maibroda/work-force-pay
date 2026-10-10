"use server";
import { act } from "./_run";
import * as jn from "@/server/services/journals";

type V = Record<string, unknown>;
const PATHS = ["/accounting"];

/** The editor sends the lines as JSON; everything else is plain fields. */
const draftFrom = (v: V) => ({ ...v, lines: JSON.parse(String(v.linesJson ?? "[]")) });

export async function saveDraftAction(id: string | null, v: V) {
  return act(
    "journal.manage",
    async (ctx) => {
      const doc = await jn.saveDraft(ctx, id, draftFrom(v) as never);
      return { message: `${doc.documentNumber} saved as a draft.`, redirectTo: `/accounting/manual-journals/${doc.id}` };
    },
    PATHS,
  );
}

/** Saves the editor's content and submits it in one step. */
export async function saveAndSubmitAction(id: string | null, v: V) {
  return act(
    "journal.manage",
    async (ctx) => {
      const doc = await jn.saveDraft(ctx, id, draftFrom(v) as never);
      const r = await jn.submitDocument(ctx, doc.id);
      return {
        message: r.posted ? `${doc.documentNumber} posted as ${r.journal?.entryNumber} (approval is switched off for this organization).` : `${doc.documentNumber} submitted. Someone else has to approve it before it posts.`,
        redirectTo: `/accounting/manual-journals/${doc.id}`,
      };
    },
    PATHS,
  );
}

export async function submitDocumentAction(id: string) {
  return act("journal.manage", async (ctx) => {
    const r = await jn.submitDocument(ctx, id);
    return { message: r.posted ? `Posted as ${r.journal?.entryNumber}.` : "Submitted. Someone else has to approve it before it posts." };
  }, PATHS);
}

export async function approveDocumentAction(id: string, note?: string) {
  return act("journal.approve", async (ctx) => {
    await jn.approveDocument(ctx, id, note);
    return { message: "Approved. It still has to be posted." };
  }, PATHS);
}

export async function rejectDocumentAction(id: string, note?: string) {
  return act("journal.approve", async (ctx) => {
    await jn.rejectDocument(ctx, id, note ?? "");
    return { message: "Returned to the preparer." };
  }, PATHS);
}

export async function postDocumentAction(id: string) {
  return act("journal.approve", async (ctx) => {
    const j = await jn.postDocument(ctx, id);
    return { message: `Posted as ${j.entryNumber}.`, redirectTo: `/accounting/journals/${j.id}` };
  }, PATHS);
}

export async function cancelDocumentAction(id: string, reason?: string) {
  return act("journal.manage", async (ctx) => {
    await jn.cancelDocument(ctx, id, reason ?? "");
    return { message: "Cancelled. It stays on record." };
  }, PATHS);
}

export async function requestReversalAction(journalId: string, v: V) {
  return act("journal.manage", async (ctx) => {
    await jn.requestReversal(ctx, journalId, String(v.reason ?? ""), String(v.reverseDate ?? ""));
    return { message: "Reversal requested. Someone else has to approve it." };
  }, PATHS);
}

export async function decideReversalAction(id: string, approve: boolean, note?: string) {
  return act("journal.approve", async (ctx) => {
    await jn.decideReversal(ctx, id, approve, note);
    return { message: approve ? "Approved. The reversal has been posted." : "Request turned down." };
  }, PATHS);
}

export async function runDueReversalsAction() {
  return act("journal.approve", async (ctx) => {
    const r = await jn.runDueReversals(ctx, new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z"));
    return { message: `${r.posted} of ${r.due} due accrual reversal(s) posted.${r.failed.length ? ` Not posted: ${r.failed.map((f) => `${f.documentNumber} (${f.reason})`).join("; ")}` : ""}` };
  }, PATHS);
}

export async function setApprovalRequiredAction(required: boolean) {
  return act("period.approve", async (ctx) => {
    await jn.setApprovalRequired(ctx, required);
    return { message: required ? "Manual journals need a second person's approval." : "Manual journals no longer need approval: the person who prepares one can post it." };
  }, PATHS);
}

