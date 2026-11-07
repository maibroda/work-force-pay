"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { issueDocumentLinkAction } from "@/app/actions/documents";
import { DocumentUpload } from "@/components/document-upload";
import { TASK_STATE_LABELS, type TaskState } from "@/lib/documents";
import { toast } from "./toaster";

const TONE: Record<TaskState, Tone> = { PENDING: "gray", SUBMITTED: "blue", UNDER_REVIEW: "violet", COMPLETED: "green" };

async function open(versionId: string, mode: "view" | "download") {
  const tab = mode === "view" ? window.open("", "_blank") : null; // opened before the wait so the browser allows it
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
 * A checklist step that follows a document: where it stands (Pending, Submitted, Under review, Completed), the document it needs,
 * and the way to upload or replace it. Submitting and reviewing are done in the employee's document register. The step is completed
 * only by the approved document; the server decides who may do what.
 */
export function TaskDocument({
  kind,
  taskId,
  employeeId,
  typeName,
  state,
  documentId,
  note,
  current,
  canUpload,
}: {
  kind: "ONBOARDING" | "EXIT";
  taskId: string;
  employeeId: string;
  typeName: string;
  state: TaskState;
  documentId: string | null;
  note: string | null;
  current: { id: string; canPreview: boolean } | null;
  canUpload: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[state]}>{TASK_STATE_LABELS[state]}</Badge>
        <span className="text-muted-foreground">Document: {typeName}</span>
      </div>
      {note && <div className="text-red-700">Rejected: {note}</div>}
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
        {canUpload && (
          <Button size="sm" variant="outline" type="button" onClick={() => setUploading((x) => !x)}>
            {documentId ? "Upload a new version" : "Upload document"}
          </Button>
        )}
        {documentId && (
          <Link className="self-center text-primary underline" href={`/employees/${employeeId}?tab=documents`}>
            Submit or review in documents
          </Link>
        )}
      </div>
      {uploading && (
        <div className="rounded-md border bg-card p-3">
          <DocumentUpload employeeId={employeeId} types={[]} task={documentId ? undefined : { kind, id: taskId }} replaceDocumentId={documentId ?? undefined} onDone={() => setUploading(false)} />
        </div>
      )}
    </div>
  );
}
