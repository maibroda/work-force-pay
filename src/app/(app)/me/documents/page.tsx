import { requirePage } from "@/lib/auth/session";
import { CATEGORY_LABELS } from "@/lib/documents";
import { myDocuments } from "@/server/services/document-register";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { DocumentFileButtons } from "@/components/document-file-buttons";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function MyDocumentsPage() {
  const ctx = await requirePage();
  const rows = await myDocuments(ctx);
  return (
    <>
      <PageHeader
        title="My documents"
        description="Your documents that HR has approved, for you to view or download. You cannot change them here: ask HR to replace one. A document whose date has passed is marked Expired."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <Section title={`${rows.length} document${rows.length === 1 ? "" : "s"}`} flush>
          {rows.length === 0 ? (
            <Empty>No approved documents yet. They appear here once HR has approved them.</Empty>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Document</TH>
                  <TH>Category</TH>
                  <TH>Issued</TH>
                  <TH>Expires</TH>
                  <TH>Approved</TH>
                  <TH>File</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} className={r.status === "EXPIRED" ? "bg-red-50/60" : ""}>
                    <TD className="font-medium">
                      {r.name} {r.status === "EXPIRED" && <Badge tone="red">Expired</Badge>}
                    </TD>
                    <TD className="text-xs">{CATEGORY_LABELS[r.category]}</TD>
                    <TD className="text-xs">{fmtDate(r.issueDate)}</TD>
                    <TD className={r.status === "EXPIRED" ? "text-xs font-medium text-red-700" : "text-xs"}>{fmtDate(r.expiryDate)}</TD>
                    <TD className="text-xs">{fmtDate(r.approvedOn)}</TD>
                    <TD>
                      <DocumentFileButtons current={r.current} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
      )}
    </>
  );
}
