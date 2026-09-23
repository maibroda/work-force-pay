import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listClients } from "@/server/services/clients";
import { enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createClientAction } from "@/app/actions/clients";

export default async function ClientsPage() {
  const ctx = await requirePage("client.view");
  const rows = await listClients(ctx);
  return (
    <>
      <PageHeader
        title="Clients"
        description="A client can have multiple contracts and multiple beats (locations). Payroll reports roll up by client and beat."
      />
      {can(ctx.role, "client.manage") && (
        <FormPanel title="Create client">
          <SmartForm
            columns={3}
            fields={[
              { name: "name", label: "Client name", required: true },
              { name: "code", label: "Client code", help: "Leave blank to auto-generate" },
              { name: "contactPerson", label: "Contact person" },
              { name: "phone", label: "Phone" },
              { name: "email", label: "Email", type: "email" },
              {
                name: "status",
                label: "Status",
                type: "select",
                options: enumOptions(["ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"]),
                defaultValue: "ACTIVE",
              },
              { name: "address", label: "Address", span: 3 },
              { name: "startDate", label: "Contract start", type: "date" },
              { name: "endDate", label: "Contract end", type: "date" },
            ]}
            action={createClientAction}
            submitLabel="Create client"
          />
        </FormPanel>
      )}
      <Section title={`${rows.length} client(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Client</TH>
              <TH>Contact</TH>
              <TH className="text-right">Contracts</TH>
              <TH className="text-right">Beats</TH>
              <TH className="text-right">Staff (current)</TH>
              <TH>Start</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">{c.code}</TD>
                <TD>
                  <Link className="font-medium text-primary hover:underline" href={`/clients/${c.id}`}>
                    {c.name}
                  </Link>
                </TD>
                <TD>{c.contactPerson ?? "—"}</TD>
                <TD className="text-right">{c._count.contracts}</TD>
                <TD className="text-right">{c._count.beats}</TD>
                <TD className="text-right">{c._count.employees}</TD>
                <TD>{fmtDate(c.startDate)}</TD>
                <TD>
                  <StatusBadge status={c.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
