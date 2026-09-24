import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listBankAccounts } from "@/server/services/bank-reconciliation";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createBankAccountAction, setBankAccountActiveAction } from "@/app/actions/bank-reconciliation";

export default async function BankAccountsPage() {
  const ctx = await requirePage("gl.view");
  const [accounts, glAccounts] = await Promise.all([
    listBankAccounts(ctx),
    db.glAccount.findMany({ where: { organizationId: ctx.orgId, active: true }, orderBy: { code: "asc" } }),
  ]);
  const manage = can(ctx.role, "payment.manage");
  return (
    <>
      <PageHeader
        title="Bank accounts"
        description="The organization's own operating account(s). Import bank statements and reconcile them at Finance → Bank Reconciliation."
      />
      <Section title="Bank accounts" flush>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Bank</TH>
              <TH>Account number</TH>
              <TH>GL account</TH>
              <TH className="text-right">Opening balance</TH>
              <TH>Opening date</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {accounts.map((a) => (
              <TR key={a.id}>
                <TD>
                  <Link href={`/finance/bank-reconciliation?account=${a.id}`} className="text-primary hover:underline">
                    {a.name}
                  </Link>
                </TD>
                <TD>{a.bankName}</TD>
                <TD className="font-mono text-xs">{a.accountNumber}</TD>
                <TD className="text-xs">{a.glAccount ? `${a.glAccount.code} — ${a.glAccount.name}` : "—"}</TD>
                <TD className="text-right">{naira(a.openingBalance)}</TD>
                <TD className="text-xs">{fmtDate(a.openingDate)}</TD>
                <TD>
                  <StatusBadge status={a.active ? "ACTIVE" : "INACTIVE"} />
                </TD>
                <TD>
                  {manage && (
                    <ActionButton
                      action={setBankAccountActiveAction.bind(null, a.id, !a.active)}
                      confirm={a.active ? "Deactivate this account?" : "Reactivate this account?"}
                      variant="outline"
                    >
                      {a.active ? "Deactivate" : "Reactivate"}
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!accounts.length && <Empty>No bank accounts yet.</Empty>}
      </Section>
      {manage && (
        <FormPanel title="Add bank account">
          <SmartForm
            columns={3}
            submitLabel="Create bank account"
            action={createBankAccountAction}
            fields={[
              { name: "name", label: "Account name", required: true, placeholder: "Operating Account" },
              { name: "bankName", label: "Bank name", required: true },
              { name: "accountNumber", label: "Account number", required: true },
              {
                name: "glAccountId",
                label: "GL account (optional)",
                type: "select",
                options: glAccounts.map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` })),
              },
              { name: "openingBalance", label: "Opening balance (₦)", type: "number", defaultValue: 0 },
              { name: "openingDate", label: "Opening date", type: "date", required: true },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
