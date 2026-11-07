"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/action-button";
import { approveDocumentAction, archiveDocumentAction, issueDocumentLinkAction, rejectDocumentAction, startReviewAction, submitDocumentAction } from "@/app/actions/documents";
import { DocumentUpload, type UploadType } from "@/components/document-upload";
import { toast } from "./toaster";

export interface VersionRow {
  id: string;
  version: number;
  fileName: string;
  canPreview: boolean;
  uploadedBy: string;
  uploadedAt: string;
  replacedBy: string | null;
  replacedAt: string | null;
}

/** Asks the server for a short-lived signed link, then opens it (a preview in a new tab) or downloads it. */
async function open(versionId: string, mode: "view" | "download") {
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

/**
 * The actions on one row of the register: view, download, replace, previous versions and archive. The server decides who may do what;
 * what is shown here only follows it.
 */
export function DocumentRowActions({
  documentId,
  employeeId,
  current,
  versions,
  canManage,
  referenceOnly,
  archived,
  types,
  actions,
}: {
  documentId: string;
  employeeId: string;
  current: { id: string; canPreview: boolean } | null;
  versions: VersionRow[];
  canManage: boolean;
  referenceOnly: boolean;
  archived: boolean;
  types: UploadType[];
  /** What the caller may do next with the document (the server checks again). */
  actions: { submit: boolean; startReview: boolean; decide: boolean };
}) {
  const [replacing, setReplacing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {current?.canPreview && (
          <Button size="sm" variant="outline" type="button" onClick={() => open(current.id, "view")}>
            View
          </Button>
        )}
        {current && (
          <Button size="sm" variant="outline" type="button" onClick={() => open(current.id, "download")}>
            Download
          </Button>
        )}
        {actions.submit && (
          <ActionButton action={submitDocumentAction.bind(null, documentId)} confirm="Submit this document for review? A second person will approve or reject it." variant="success">
            Submit for approval
          </ActionButton>
        )}
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
        {canManage && !archived && (
          <Button size="sm" variant="outline" type="button" onClick={() => setReplacing((x) => !x)}>
            {referenceOnly ? "Attach file" : "Replace"}
          </Button>
        )}
        {versions.length > 1 && (
          <Button size="sm" variant="outline" type="button" onClick={() => setShowVersions((x) => !x)}>
            Versions ({versions.length})
          </Button>
        )}
        {canManage && !archived && !referenceOnly && (
          <ActionButton action={archiveDocumentAction.bind(null, documentId)} reason reasonPlaceholder="Why archive it? (optional)" confirm="Archive this document? It stays on file with every version, but leaves the register." variant="outline">
            Archive
          </ActionButton>
        )}
      </div>
      {replacing && (
        <div className="rounded-md border bg-card p-3">
          <DocumentUpload employeeId={employeeId} types={types} replaceDocumentId={documentId} needsType={referenceOnly} onDone={() => setReplacing(false)} />
        </div>
      )}
      {showVersions && (
        <ul className="divide-y rounded-md border text-xs">
          {versions.map((v, i) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                <b>Version {v.version}</b>
                {i === 0 ? " (active)" : ""} · {v.fileName} · uploaded by {v.uploadedBy} on {new Date(v.uploadedAt).toLocaleDateString("en-GB")}
                {v.replacedAt ? ` · replaced by ${v.replacedBy} on ${new Date(v.replacedAt).toLocaleDateString("en-GB")}` : ""}
              </span>
              <span className="flex gap-1">
                {v.canPreview && (
                  <Button size="sm" variant="outline" type="button" onClick={() => open(v.id, "view")}>
                    View
                  </Button>
                )}
                <Button size="sm" variant="outline" type="button" onClick={() => open(v.id, "download")}>
                  Download
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
