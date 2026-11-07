"use client";

import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/action-button";
import { approveDocumentAction, issueDocumentLinkAction, rejectDocumentAction, startReviewAction } from "@/app/actions/documents";
import { toast } from "./toaster";

/** Asks the server for a short-lived signed link, then opens it (a preview in a new tab) or downloads it. */
export async function openDocumentFile(versionId: string, mode: "view" | "download") {
  // a window opened before the wait, so the browser does not treat it as a pop-up
  const tab = mode === "view" ? window.open("", "_blank") : null;
  const r = await issueDocumentLinkAction(versionId, mode);
  const url = (r.data as { url?: string } | undefined)?.url;
  if (!r.ok || !url) {
    tab?.close();
    return toast(false, r.error ?? "The link could not be made.");
  }
  if (tab) tab.location.href = url;
  else window.location.assign(url);
}

/** View and download for the current file of a document. The server decides whether the caller may open it. */
export function DocumentFileButtons({ current }: { current: { id: string; canPreview: boolean } | null }) {
  if (!current) return <span className="text-xs text-muted-foreground">No file</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {current.canPreview && (
        <Button size="sm" variant="outline" type="button" onClick={() => openDocumentFile(current.id, "view")}>
          View
        </Button>
      )}
      <Button size="sm" variant="outline" type="button" onClick={() => openDocumentFile(current.id, "download")}>
        Download
      </Button>
    </span>
  );
}

/** The actions on a row of the central register: open the file, take it for review, approve or reject. The server checks each one again. */
export function RegisterRowActions({
  documentId,
  current,
  actions,
}: {
  documentId: string;
  current: { id: string; canPreview: boolean } | null;
  actions: { startReview: boolean; decide: boolean };
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <DocumentFileButtons current={current} />
      {actions.startReview && (
        <ActionButton action={startReviewAction.bind(null, documentId)} variant="outline">
          Take for review
        </ActionButton>
      )}
      {actions.decide && (
        <>
          <ActionButton action={approveDocumentAction.bind(null, documentId)} confirm="Approve this document?" variant="success">
            Approve
          </ActionButton>
          <ActionButton action={rejectDocumentAction.bind(null, documentId)} reason reasonPlaceholder="Why is it rejected? (required)" variant="outline">
            Reject
          </ActionButton>
        </>
      )}
    </div>
  );
}
