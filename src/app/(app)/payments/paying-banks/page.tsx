import { db } from "@/lib/db";
import { requirePage } from "@/lib/auth/session";
import { BUILT_IN_CODE_LISTS } from "@/lib/bank-code-lists";
import { LAYOUT_SOURCES, layoutToText } from "@/lib/paying-bank";
import { listCodeSetEntries, listPayingBanks } from "@/server/services/paying-banks";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { assignPayingBankAction, confirmBlockedEntryAction, createPayingBankAction, importCodeSetAction, savePayingBankAction } from "@/app/actions/payment-file";

export default async function PayingBanksPage() {
  const ctx = await requirePage("payment.manage");
  const banks = await listPayingBanks(ctx);
  const blockedByBank = new Map(await Promise.all(banks.map(async (b) => [b.id, (await listCodeSetEntries(ctx, b.id)).entries.filter((e) => e.blocked)] as const)));
  const categories = await db.employeeCategory.findMany({ where: { organizationId: ctx.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
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
              <TH className="text-right">People assigned</TH>
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
                <TD className="text-right">{b.people}</TD>
                <TD>
                  {b.active ? <Badge tone="green">In use</Badge> : <Badge>Not in use</Badge>} {b.isDefault && <Badge tone="blue">Default</Badge>}
                </TD>
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

      {banks.length > 0 && (
        <Section title="Who is paid from which bank" description="One payroll can be paid from several banks: say which bank each person is paid from, and one file is made per bank. Anyone with no bank of their own is paid from the default bank. This applies from the NEXT payment batches; batches already made keep theirs.">
          <SmartForm
            columns={2}
            submitLabel="Assign"
            resetOnSuccess
            action={assignPayingBankAction}
            fields={[
              { name: "payingBankId", label: "Paid from", type: "select", options: [{ value: "", label: "The default bank (clears their own)" }, ...banks.filter((b) => b.active).map((b) => ({ value: b.id, label: b.name }))] },
              { name: "categoryId", label: "Everyone in this category (optional)", type: "select", options: [{ value: "", label: "—" }, ...categories.map((c) => ({ value: c.id, label: c.name }))] },
              { name: "employeeNumbers", label: "Employee numbers (separated by commas, spaces or new lines)", type: "textarea", span: 2 },
            ]}
          />
        </Section>
      )}

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
          {(blockedByBank.get(b.id) ?? []).length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-medium">{blockedByBank.get(b.id)!.length} blocked entries: never put in a file</h3>
              <p className="mb-2 text-xs text-muted-foreground">Ask the bank for the true code of an entry, then apply it here with who confirmed it and how. It is saved as the next version of the list and audited; the list the bank sent stays as it was.</p>
              <Table>
                <THead>
                  <TR>
                    <TH>Bank</TH>
                    <TH>Code listed</TH>
                    <TH>Why it is blocked</TH>
                  </TR>
                </THead>
                <TBody>
                  {blockedByBank.get(b.id)!.map((e) => (
                    <TR key={e.id}>
                      <TD className="text-xs">{e.name}</TD>
                      <TD className="font-mono text-xs">{e.code}</TD>
                      <TD className="whitespace-normal text-xs">{e.blockedReason}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <SmartForm
                columns={3}
                submitLabel="Apply the confirmed code"
                resetOnSuccess
                action={confirmBlockedEntryAction}
                fields={[
                  { name: "payingBankId", label: "", type: "hidden", defaultValue: b.id },
                  { name: "entryId", label: "Blocked entry", type: "select", required: true, options: blockedByBank.get(b.id)!.map((e) => ({ value: e.id, label: `${e.name} (listed ${e.code})` })) },
                  { name: "code", label: "Code the bank confirmed", required: true, pattern: "^[A-Za-z0-9]{3,6}$", patternMessage: "3 to 6 letters or digits" },
                  { name: "note", label: "Who confirmed it, and how", required: true },
                ]}
              />
            </>
          )}
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
