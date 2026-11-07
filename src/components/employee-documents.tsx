import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { CATEGORY_LABELS, STATUS_LABELS, type DocumentCategory } from "@/lib/documents";
import { listEmployeeDocuments, listTypes } from "@/server/services/documents";
import { fmtDate } from "@/lib/dates";
import { FormPanel, Section, Empty } from "@/components/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DocumentUpload } from "@/components/document-upload";
import { DocumentRowActions } from "@/components/document-row-actions";

/**
 * An employee's electronic documents, on the Documents tab of the profile: the register (what is on file, its status, dates and versions,
 * and the actions the caller may take) and the upload panel. The server enforces every permission; this only shows what it allows.
 */
export async function EmployeeDocuments({ ctx, employeeId }: { ctx: Ctx; employeeId: string }) {
  if (!can(ctx.role, "document.view")) return null;
  const canManage = can(ctx.role, "document.manage");
  const [rows, types] = await Promise.all([listEmployeeDocuments(ctx, employeeId), listTypes(ctx)]);
  const uploadTypes = types
    .filter((t) => !t.sensitive || can(ctx.role, "document.sensitive"))
    .map((t) => ({ id: t.id, name: t.name, category: t.category, categoryLabel: CATEGORY_LABELS[t.category as DocumentCategory], hasExpiry: t.hasExpiry }));
  const today = new Date();
  return (
    <>
      <Section
        title="Document register"
        description="Each document's file, with every earlier version kept. Files are stored encrypted and opened only through short-lived links; every view and download is recorded. Identification and medical documents are shown only to people with that access."
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Document</TH>
              <TH>Category</TH>
              <TH>Uploaded</TH>
              <TH>Issue date</TH>
              <TH>Expiry date</TH>
              <TH>Status</TH>
              <TH>Last updated</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const expiringSoon = r.expiryDate && r.status === "APPROVED" && r.expiryDate.getTime() - today.getTime() < 30 * 86_400_000;
              return (
                <TR key={r.id} className={r.status === "EXPIRED" ? "bg-red-50/60" : ""}>
                  <TD className="max-w-xs whitespace-normal">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.current ? r.current.fileName : r.legacyReference ? `Reference: ${r.legacyReference}` : "No file yet"}
                      {r.reference ? ` · No. ${r.reference}` : ""}
                    </div>
                    {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                  </TD>
                  <TD className="text-xs">{CATEGORY_LABELS[r.category as DocumentCategory]}</TD>
                  <TD className="text-xs">
                    {fmtDate(r.uploadedAt)}
                    <div className="text-muted-foreground">by {r.uploadedBy}</div>
                  </TD>
                  <TD className="text-xs">{fmtDate(r.issueDate)}</TD>
                  <TD className={r.status === "EXPIRED" ? "text-xs font-medium text-red-700" : "text-xs"}>
                    {fmtDate(r.expiryDate)}
                    {expiringSoon ? <Badge tone="amber" className="ml-1">expires soon</Badge> : null}
                  </TD>
                  <TD>{r.status === "REFERENCE_ONLY" ? <Badge tone="gray">{STATUS_LABELS.REFERENCE_ONLY}</Badge> : <StatusBadge status={r.status} />}</TD>
                  <TD className="text-xs">{fmtDate(r.updatedAt)}</TD>
                  <TD className="min-w-56">
                    <DocumentRowActions
                      documentId={r.id}
                      employeeId={employeeId}
                      current={r.current ? { id: r.current.id, canPreview: r.current.canPreview } : null}
                      versions={r.versions.map((v) => ({ ...v, uploadedAt: v.uploadedAt.toISOString(), replacedAt: v.replacedAt ? v.replacedAt.toISOString() : null }))}
                      canManage={canManage}
                      referenceOnly={r.referenceOnly}
                      archived={r.status === "ARCHIVED"}
                      types={uploadTypes}
                    />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {!rows.length && <Empty>No documents on file for this employee.</Empty>}
      </Section>
      {canManage && (
        <FormPanel title="Upload documents">
          <DocumentUpload employeeId={employeeId} types={uploadTypes} />
        </FormPanel>
      )}
    </>
  );
}
