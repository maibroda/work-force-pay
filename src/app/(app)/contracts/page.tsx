import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listContracts } from "@/server/services/clients";
import { options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createContractAction, setContractBusinessLineAction } from "@/app/actions/clients";
import { InlineSelect } from "@/components/inline-select";
import { contractFields } from "./fields";

const BUSINESS_LINE_OPTIONS = [
  { value: "GUARDING", label: "Guarding" },
  { value: "OUTSOURCING", label: "Outsourcing / Resourcing" },
];

export default async function ContractsPage() {
  const ctx = await requirePage("client.view");
  const [rows, o] = await Promise.all([listContracts(ctx), options(ctx)]);
  return (
    <>
      <PageHeader
        title="Contracts"
        description="A client can have one or more contracts; each contract holds the agreed rates and its beats."
        actions={
          <Link className="text-sm text-primary underline" href="/contracts/rates">
            Agreed rates & structures →
          </Link>
        }
      />
      {can(ctx.role, "client.manage") && (
        <FormPanel title="Create contract">
          <SmartForm
            columns={3}
            fields={contractFields(o)}
            action={createContractAction}
            submitLabel="Create contract"
          />
        </FormPanel>
      )}
      <Section title={`${rows.length} contract(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Number</TH>
              <TH>Client</TH>
              <TH>Contract</TH>
              <TH>Period</TH>
              <TH className="text-right">Value</TH>
              <TH>Billing</TH>
              <TH>Business line</TH>
              <TH>Sharing</TH>
              <TH>Structure</TH>
              <TH className="text-right">Beats</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">{c.contractNumber}</TD>
                <TD>
                  <Link className="text-primary hover:underline" href={`/clients/${c.clientId}`}>
                    {c.client.name}
                  </Link>
                </TD>
                <TD>{c.name}</TD>
                <TD>
                  {fmtDate(c.startDate)} → {fmtDate(c.endDate)}
                </TD>
                <TD className="text-right">{c.contractValue ? naira(c.contractValue) : "—"}</TD>
                <TD className="text-xs">{c.billingMethod.replace(/_/g, " ")}</TD>
                <TD>
                  <InlineSelect
                    value={c.businessLine}
                    options={BUSINESS_LINE_OPTIONS}
                    action={setContractBusinessLineAction.bind(null, c.id)}
                    disabled={!can(ctx.role, "client.manage")}
                  />
                </TD>
                <TD>
                  {num(c.operativeSharePct)}:{100 - num(c.operativeSharePct)}
                </TD>
                <TD className="text-xs">{c.defaultStructure?.name ?? "—"}</TD>
                <TD className="text-right">{c._count.beats}</TD>
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
