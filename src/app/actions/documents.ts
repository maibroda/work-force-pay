"use server";
import { actFor } from "./_run";
import * as docs from "@/server/services/documents";
const act = actFor("documents.ts");

type V = Record<string, unknown>;
const PAGES = ["/employees", "/hr", "/settings"];

/** A short-lived signed link to one version of a file; the browser then opens or downloads it. */
export async function issueDocumentLinkAction(versionId: string, mode: "view" | "download") {
  return act("document.view", async (ctx) => {
    const link = await docs.issueLink(ctx, versionId, mode);
    return { message: "Link ready.", data: { url: link.url } };
  });
}

export async function archiveDocumentAction(id: string, reason?: string) {
  return act("document.manage", async (ctx) => {
    await docs.archiveDocument(ctx, id, reason);
    return { message: "Document archived. It is kept, with every version." };
  }, PAGES);
}

export async function submitDocumentAction(id: string) {
  return act("document.manage", async (ctx) => {
    await docs.submitDocument(ctx, id);
    return { message: "Submitted for review." };
  }, PAGES);
}

export async function startReviewAction(id: string) {
  return act("document.approve", async (ctx) => {
    await docs.startReview(ctx, id);
    return { message: "You are now reviewing this document." };
  }, PAGES);
}

export async function approveDocumentAction(id: string, note?: string) {
  return act("document.approve", async (ctx) => {
    await docs.approveDocument(ctx, id, note);
    return { message: "Document approved." };
  }, PAGES);
}

export async function rejectDocumentAction(id: string, reason?: string) {
  return act("document.approve", async (ctx) => {
    await docs.rejectDocument(ctx, id, reason ?? "");
    return { message: "Document rejected. The reason is recorded." };
  }, PAGES);
}

export async function linkStandardStepsAction() {
  return act("document.configure", async (ctx) => {
    const r = await docs.linkStandardSteps(ctx);
    return { message: `${r.onboarding} onboarding and ${r.exit} exit steps linked to document types. Tasks made from now on follow their document.` };
  }, [...PAGES, "/hr"]);
}

export async function addDocumentTypeAction(v: V) {
  return act("document.configure", async (ctx) => {
    await docs.addType(ctx, { ...v, requiresApproval: v.requiresApproval === true || v.requiresApproval === "on", hasExpiry: v.hasExpiry === true || v.hasExpiry === "on", sensitive: v.sensitive === undefined ? undefined : v.sensitive === true || v.sensitive === "on" } as never);
    return { message: "Document type added." };
  }, PAGES);
}

export async function updateDocumentTypeAction(id: string, v: V) {
  return act("document.configure", async (ctx) => {
    await docs.updateType(ctx, id, v as never);
    return { message: "Saved." };
  }, PAGES);
}
