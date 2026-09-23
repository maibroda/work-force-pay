import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getClient, listBeats } from "@/server/services/clients";
import { enumOptions, options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { FormPanel, KV, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createBeatAction, createContractAction, updateClientAction } from "@/app/actions/clients";
import { contractFields, beatFields } from "../../contracts/fields";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("client.view");
  const { id } = await params;
  const c = await getClient(ctx, id);
  if (!c) notFound();
  const [o, beats] = await Promise.all([options(ctx), listBeats(ctx, { clientId: id })]);
  const manage = can(ctx.role, "client.manage");
  const contractOpts = c.contracts.map((x) => ({ value: x.id, label: `${x.contractNumber} — ${x.name}` }));
  return (
    <>
      <PageHeader
        title={c.name}
        crumbs={[{ href: "/clients", label: "Clients" }]}
        description={
          <>
            <StatusBadge status={c.status} /> <span className="ml-1">Code {c.code}</span>
          </>
        }
        actions={
          <Link className="text-sm text-primary underline" href={`/reports/client-beat?clientId=${c.id}`}>
            Payroll by beat →
          </Link>
        }
      />
      <Section title="Client details">
        <KV
          cols={4}
          items={[
            ["Contact person", c.contactPerson],
            ["Phone", c.phone],
            ["Email", c.email],
            ["Address", c.address],
            ["Contract start", fmtDate(c.startDate)],
            ["Contract end", fmtDate(c.endDate)],
            ["Contracts", c.contracts.length],
            ["Beats", c.beats.length],
          ]}
        />
      </Section>
      {manage && (
        <FormPanel title="Edit client">
          <SmartForm
            columns={3}
            resetOnSuccess={false}
            fields={[
              { name: "name", label: "Client name", required: true, defaultValue: c.name },
              { name: "contactPerson", label: "Contact person", defaultValue: c.contactPerson ?? undefined },
              { name: "phone", label: "Phone", defaultValue: c.phone ?? undefined },
              { name: "email", label: "Email", type: "email", defaultValue: c.email ?? undefined },
              {
                name: "status",
                label: "Status",
                type: "select",
                options: enumOptions(["ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"]),
                defaultValue: c.status,
              },
              { name: "address", label: "Address", defaultValue: c.address ?? undefined },
            ]}
            action={updateClientAction.bind(null, c.id)}
          />
        </FormPanel>
      )}
      <Section
        title="Contracts & agreed rates"
        description="Agreed rate is shared 70:30 — operatives' gross / management cost."
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Contract</TH>
              <TH>Name</TH>
              <TH>Period</TH>
              <TH className="text-right">Value</TH>
              <TH>Share</TH>
              <TH>Category → structure → agreed rate</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {c.contracts.map((x) => (
              <TR key={x.id}>
                <TD className="font-mono text-xs">{x.contractNumber}</TD>
                <TD>{x.name}</TD>
                <TD>
                  {fmtDate(x.startDate)} → {fmtDate(x.endDate)}
                </TD>
                <TD className="text-right">{x.contractValue ? naira(x.contractValue) : "—"}</TD>
                <TD>
                  {num(x.operativeSharePct)}:{100 - num(x.operativeSharePct)}
                </TD>
                <TD className="whitespace-normal text-xs">
                  {x.rates
                    .filter((r) => !r.effectiveTo)
                    .map((r) => (
                      <div key={r.id}>
                        {r.category.name} → {r.salaryStructure.name} → <b>{naira(r.agreedRate)}</b>
                      </div>
                    ))}
                </TD>
                <TD>
                  <StatusBadge status={x.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      {manage && (
        <FormPanel title="Add contract">
          <SmartForm
            columns={3}
            fields={contractFields(o, c.id)}
            action={createContractAction}
            submitLabel="Create contract"
          />
        </FormPanel>
      )}
      <Section title="Beats / locations" flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Beat</TH>
              <TH>Contract</TH>
              <TH>Bid</TH>
              <TH>State / LGA</TH>
              <TH className="text-right">Approved</TH>
              <TH className="text-right">Actual</TH>
              <TH className="text-right">Vacancies</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {beats.map((b) => (
              <TR key={b.id}>
                <TD className="font-mono text-xs">{b.code}</TD>
                <TD>{b.name}</TD>
                <TD className="font-mono text-xs">{b.contract.contractNumber}</TD>
                <TD className="text-xs">{b.bidReference ?? "—"}</TD>
                <TD>
                  {b.state} / {b.lga}
                </TD>
                <TD className="text-right">{b.approvedStrength}</TD>
                <TD className="text-right">{b.actualStrength}</TD>
                <TD className="text-right">{b.vacancies}</TD>
                <TD>
                  <StatusBadge status={b.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      {manage && contractOpts.length > 0 && (
        <FormPanel title="Add beat / location">
          <SmartForm
            columns={3}
            fields={beatFields(contractOpts)}
            action={createBeatAction}
            submitLabel="Create beat"
          />
        </FormPanel>
      )}
    </>
  );
}
