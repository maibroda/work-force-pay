import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listAccounts } from "@/server/services/accounting";
import { enumOptions } from "@/server/options";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createAccountAction, setAccountActiveAction } from "@/app/actions/accounting";

const TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];

export default async function AccountsPage() {
  const ctx = await requirePage("gl.view");
  const accounts = await listAccounts(ctx);
  const manage = can(ctx.role, "gl.manage");
  return (
    <>
      <PageHeader
        title="Chart of accounts"
        description="General-ledger accounts that payroll posts to. A standard Nigerian payroll chart is set up for you — rename, add or deactivate accounts to match your own ledger."
      />
      {manage && (
        <FormPanel title="Add an account">
          <SmartForm
            columns={3}
            submitLabel="Add account"
            action={createAccountAction}
            fields={[
              { name: "code", label: "Account code", required: true, placeholder: "e.g. 5210" },
              { name: "name", label: "Account name", required: true },
              { name: "type", label: "Type", type: "select", required: true, options: enumOptions(TYPES) },
            ]}
          />
        </FormPanel>
      )}
      <Section title={`${accounts.length} accounts`} flush>
        {accounts.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {accounts.map((a) => (
                <TR key={a.id}>
                  <TD className="font-mono">{a.code}</TD>
                  <TD>{a.name}</TD>
                  <TD className="text-xs">{a.type}</TD>
                  <TD>
                    {a.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
                  </TD>
                  <TD>
                    {manage && (
                      <ActionButton
                        action={setAccountActiveAction.bind(null, a.id, !a.active)}
                        variant="outline"
                      >
                        {a.active ? "Deactivate" : "Activate"}
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>No accounts.</Empty>
        )}
      </Section>
    </>
  );
}
