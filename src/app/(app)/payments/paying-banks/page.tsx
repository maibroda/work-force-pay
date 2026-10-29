import { requirePage } from "@/lib/auth/session";
import { BUILT_IN_CODE_LISTS } from "@/lib/bank-code-lists";
import { LAYOUT_SOURCES, layoutToText } from "@/lib/paying-bank";
import { listPayingBanks } from "@/server/services/paying-banks";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createPayingBankAction, importCodeSetAction, savePayingBankAction } from "@/app/actions/payment-file";

export default async function PayingBanksPage() {
  const ctx = await requirePage("payment.manage");
  const banks = await listPayingBanks(ctx);
  return (
    <>
      <PageHeader
        title="Paying banks"
        description="The bank a client pays salaries from. Each has its own list of bank codes (a bank's codes are valid only on its own list: the same code can mean a different bank on another bank's list) and its own upload file layout. The app only makes the file; it never moves money."
      />
      <Section title={`${banks.length} paying bank(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Bank</TH>
              <TH>Upload layout</TH>
              <TH>Bank-code list</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {banks.map((b) => (
              <TR key={b.id}>
                <TD>{b.name}</TD>
                <TD className="whitespace-normal text-xs">{b.hasLayout ? b.layout!.columns.map((c) => c.header).join(" | ") : <Badge tone="amber">Not set up — the bank&apos;s upload template is needed</Badge>}</TD>
                <TD className="whitespace-normal text-xs">
                  {b.latest ? (
                    <>
                      Version {b.latest.version}: {b.latest.entryCount} banks, {b.latest.blockedCount} blocked
                      <br />
                      {b.latest.sourceName}, {fmtDate(b.latest.importedAt)}, fingerprint <span className="font-mono">{b.latest.sourceSha256.slice(0, 12)}…</span>
                    </>
                  ) : (
                    "None yet"
                  )}
                </TD>
                <TD>{b.active ? <Badge tone="green">In use</Badge> : <Badge>Not in use</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!banks.length && <p className="px-4 py-4 text-sm text-muted-foreground">No paying bank yet. Add the bank the client pays from below.</p>}
      </Section>

      <Section title="Add a paying bank" description="Starting from First Bank or Access Bank loads the bank code list that bank supplied. A bank not listed starts empty: import its list and give its upload layout.">
        <SmartForm
          columns={3}
          submitLabel="Add paying bank"
          resetOnSuccess
          action={createPayingBankAction}
          fields={[
            { name: "name", label: "Bank name", required: true },
            { name: "builtIn", label: "Start from", type: "select", options: [{ value: "", label: "Empty (another bank)" }, ...Object.entries(BUILT_IN_CODE_LISTS).map(([k, v]) => ({ value: k, label: `${v.label}'s supplied list` }))] },
            { name: "debitAccountNumber", label: "Company's account at this bank (10 digits)", pattern: "^[0-9]{10}$", patternMessage: "10 digits" },
          ]}
        />
      </Section>

      {banks.map((b) => (
        <Section key={b.id} title={b.name} description={b.hasLayout ? undefined : "No file can be made for this bank until its upload template is set up."}>
          <SmartForm
            columns={3}
            submitLabel={`Save ${b.name}`}
            action={savePayingBankAction}
            fields={[
              { name: "id", label: "", type: "hidden", defaultValue: b.id },
              { name: "debitAccountNumber", label: "Company's account at this bank", defaultValue: b.debitAccountNumber ?? "", pattern: "^[0-9]{10}$", patternMessage: "10 digits" },
              { name: "sheetName", label: "Sheet name", defaultValue: b.layout?.sheetName ?? "Sheet1" },
              { name: "fileType", label: "File type", type: "select", defaultValue: b.layout?.fileType ?? "XLSX", options: [{ value: "XLSX", label: "Excel (.xlsx)" }, { value: "CSV", label: "CSV (.csv)" }] },
              { name: "narrationMax", label: "Longest narration (blank: no limit)", type: "number", defaultValue: b.layout?.narrationMax ?? "" },
              { name: "maxRows", label: "Most rows in a file (blank: no limit)", type: "number", defaultValue: b.layout?.maxRows ?? "" },
              { name: "active", label: "In use", type: "checkbox", defaultValue: b.active },
              { name: "isDefault", label: "Use by default", type: "checkbox", defaultValue: b.isDefault },
              {
                name: "layoutText",
                label: `Columns of the upload file, one per line: Header = SOURCE (sources: ${LAYOUT_SOURCES.join(", ")}; FIXED:value for a constant)`,
                type: "textarea",
                span: 3,
                defaultValue: b.layout ? layoutToText(b.layout) : "",
              },
            ]}
          />
          <h3 className="mt-6 text-sm font-medium">Import a newer bank-code list</h3>
          <p className="mb-2 text-xs text-muted-foreground">Paste the list as CSV with two columns, bank_name and bank_code. It is saved as the next version; earlier versions, and the files made from them, are untouched. Test banks, codes shared by two banks, banks under two codes and codes that may have lost a leading zero are blocked and never put in a file.</p>
          <SmartForm
            columns={2}
            submitLabel="Import list"
            resetOnSuccess
            action={importCodeSetAction}
            fields={[
              { name: "payingBankId", label: "", type: "hidden", defaultValue: b.id },
              { name: "sourceName", label: "Where the list came from (file name or date)", required: true },
              { name: "list", label: "The list (bank_name,bank_code)", type: "textarea", required: true, span: 2 },
            ]}
          />
        </Section>
      ))}
    </>
  );
}
