import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { listAccounts } from "@/server/services/sales/records";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createAccountAction } from "@/app/actions/sales";

const SOURCES = ["REFERRAL", "WALK_IN", "PHONE", "WEBSITE", "WHATSAPP", "TENDER", "EVENT", "EXISTING_CLIENT", "OTHER"];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export default async function SalesAccountsPage() {
  const ctx = await requirePage("sales.view");
  let accounts: Awaited<ReturnType<typeof listAccounts>> = [];
  let why = "";
  try {
    accounts = await listAccounts(ctx);
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    why = e.message;
  }
  return (
    <>
      <PageHeader title="Accounts" description="The companies this organization sells to or serves. A won deal is later handed over into a real client, contract and sites." />
      {why && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {why}{" "}
          {can(ctx.role, "sales.configure") && (
            <Link className="underline" href="/sales/settings">
              Open Sales settings
            </Link>
          )}
        </p>
      )}
      {!why && (
        <Section title={`${accounts.length} account(s)`} flush>
          <Table>
            <THead>
              <TR>
                <TH>Company</TH>
                <TH>Type</TH>
                <TH>Industry</TH>
                <TH>State</TH>
                <TH>Source</TH>
                <TH>Owner</TH>
              </TR>
            </THead>
            <TBody>
              {accounts.map((a) => (
                <TR key={a.id}>
                  <TD>{a.name}</TD>
                  <TD>
                    <Badge tone={a.accountType === "CLIENT" ? "green" : undefined}>{label(a.accountType)}</Badge>
                  </TD>
                  <TD className="text-xs">{a.industry ?? "—"}</TD>
                  <TD className="text-xs">{a.state ?? "—"}</TD>
                  <TD className="text-xs">{a.source ? label(a.source) : "—"}</TD>
                  <TD className="text-xs">{a.ownerName}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!accounts.length && <p className="px-4 py-4 text-sm text-muted-foreground">No accounts yet.</p>}
        </Section>
      )}
      {!why && can(ctx.role, "sales.manage") && (
        <Section title="Add an account">
          <SmartForm
            columns={3}
            submitLabel="Add account"
            resetOnSuccess
            action={createAccountAction}
            fields={[
              { name: "name", label: "Company", required: true },
              { name: "industry", label: "Industry" },
              {
                name: "accountType",
                label: "Type",
                type: "select",
                defaultValue: "PROSPECT",
                options: [
                  { value: "PROSPECT", label: "Prospect" },
                  { value: "CLIENT", label: "Client" },
                  { value: "FORMER_CLIENT", label: "Former client" },
                ],
              },
              { name: "state", label: "State" },
              { name: "address", label: "Address", span: 2 },
              { name: "source", label: "Source", type: "select", options: [{ value: "", label: "—" }, ...SOURCES.map((s) => ({ value: s, label: label(s) }))] },
              { name: "rcNumber", label: "RC number" },
              { name: "emailDomain", label: "Company email domain (for example acme.com)" },
            ]}
          />
        </Section>
      )}
    </>
  );
}
