import { requirePage } from "@/lib/auth/session";
import { listBankCodes } from "@/server/services/payment-file";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { saveBankCodeAction } from "@/app/actions/payment-file";

export default async function BankCodesPage() {
  const ctx = await requirePage("payment.manage");
  const banks = await listBankCodes(ctx);
  return (
    <>
      <PageHeader
        title="Bank list and codes"
        description="The code the bank payment file puts against each bank. The list starts from the standard 3-digit bank codes and is yours to correct and extend (microfinance and mobile-money banks use longer codes). Confirm the codes against the upload guide of the bank the client pays from before the first file goes out."
      />
      <Section title={`${banks.length} bank(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Bank</TH>
              <TH>Code</TH>
              <TH>Also known as</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {banks.map((b) => (
              <TR key={b.id}>
                <TD>{b.name}</TD>
                <TD className="font-mono text-xs">{b.code}</TD>
                <TD className="max-w-md whitespace-normal text-xs">{b.aliases.join(", ") || "—"}</TD>
                <TD>{b.active ? <Badge tone="green">In use</Badge> : <Badge>Not in use</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      <Section title="Add or correct a bank" description="To correct a bank, enter its name exactly as listed above and the right code. Names the employee records use for it go under 'Also known as'.">
        <SmartForm
          columns={3}
          submitLabel="Save bank"
          resetOnSuccess
          action={saveBankCodeAction}
          fields={[
            { name: "name", label: "Bank name", required: true },
            { name: "code", label: "Bank code", required: true, pattern: "^[0-9]{3,6}$", patternMessage: "3 to 6 digits" },
            { name: "active", label: "In use", type: "checkbox", defaultValue: true },
            { name: "aliases", label: "Also known as (comma separated)", span: 3 },
          ]}
        />
      </Section>
    </>
  );
}
