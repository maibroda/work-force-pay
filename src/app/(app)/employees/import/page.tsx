import { requirePage } from "@/lib/auth/session";
import { listImportBatches } from "@/server/services/employee-import";
import { IMPORT_COLUMNS } from "@/lib/employee-import";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Section } from "@/components/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ImportForm } from "./import-form";

export default async function ImportEmployeesPage() {
  const ctx = await requirePage("employee.manage");
  const batches = await listImportBatches(ctx);
  return (
    <>
      <PageHeader
        title="Import employees"
        crumbs={[{ href: "/employees", label: "Employees" }]}
        description="Load a client's staff from a CSV file. Every row is checked first: required details, categories and departments, dates, account numbers, and duplicates within the file and against existing staff."
        actions={
          <a className="text-sm text-primary underline" href="/api/employees/import-template">
            Download the template
          </a>
        }
      />

      <Section title="Upload and check">
        <ImportForm />
      </Section>

      <Section title="Columns" description="Column names are matched ignoring case and spacing. Dates are DD/MM/YYYY or YYYY-MM-DD. Employee numbers are always generated, never imported." flush>
        <Table>
          <THead>
            <TR>
              <TH>Column</TH>
              <TH>Notes</TH>
              <TH>Example</TH>
            </TR>
          </THead>
          <TBody>
            {IMPORT_COLUMNS.map((c) => (
              <TR key={c.key}>
                <TD className="text-xs font-medium">{c.header}</TD>
                <TD className="text-xs">{c.help}</TD>
                <TD className="text-xs">{c.example}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section title="Previous imports" flush>
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>File</TH>
              <TH>By</TH>
              <TH className="text-right">Rows</TH>
              <TH className="text-right">Imported</TH>
              <TH className="text-right">Left out</TH>
              <TH className="text-right">With warnings</TH>
            </TR>
          </THead>
          <TBody>
            {batches.map((b) => (
              <TR key={b.id}>
                <TD>{fmtDate(b.createdAt)}</TD>
                <TD className="text-xs">{b.fileName}</TD>
                <TD className="text-xs">{b.createdBy}</TD>
                <TD className="text-right">{b.rowCount}</TD>
                <TD className="text-right">{b.importedCount}</TD>
                <TD className="text-right">{b.skippedCount}</TD>
                <TD className="text-right">{b.warningCount}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!batches.length && <p className="px-4 py-4 text-sm text-muted-foreground">No imports yet.</p>}
      </Section>
    </>
  );
}
