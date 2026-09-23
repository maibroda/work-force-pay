import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listBeats } from "@/server/services/clients";
import { options } from "@/server/options";
import { FilterBar, FilterField, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createBeatAction } from "@/app/actions/clients";
import { beatFields } from "../contracts/fields";

export default async function BeatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("client.view");
  const sp = await searchParams;
  const [beats, o] = await Promise.all([
    listBeats(ctx, { clientId: sp.clientId, status: sp.status }),
    options(ctx),
  ]);
  return (
    <>
      <PageHeader
        title="Beats / locations"
        description="New beats start UNMAPPED until Operations maps employees; status then tracks approved vs actual strength."
      />
      {can(ctx.role, "client.manage") && (
        <FormPanel title="Create beat / location">
          <SmartForm
            columns={3}
            fields={beatFields(o.contracts)}
            action={createBeatAction}
            submitLabel="Create beat"
          />
        </FormPanel>
      )}
      <FilterBar>
        <FilterField label="Client">
          <Select name="clientId" defaultValue={sp.clientId ?? ""}>
            <option value="">All</option>
            {o.clients.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {["UNMAPPED", "MAPPED", "UNDERSTAFFED", "OVERSTAFFED", "INACTIVE"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${beats.length} beat(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Beat</TH>
              <TH>Client</TH>
              <TH>Contract</TH>
              <TH>Bid</TH>
              <TH>Region</TH>
              <TH>State / LGA</TH>
              <TH className="text-right">Approved</TH>
              <TH className="text-right">Actual</TH>
              <TH className="text-right">Vacancies</TH>
              <TH className="text-right">Over</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {beats.map((b) => (
              <TR key={b.id}>
                <TD className="font-mono text-xs">{b.code}</TD>
                <TD>
                  <Link
                    className="text-primary hover:underline"
                    href={`/operations/deployments?beatId=${b.id}`}
                  >
                    {b.name}
                  </Link>
                </TD>
                <TD>{b.client.name}</TD>
                <TD className="font-mono text-xs">{b.contract.contractNumber}</TD>
                <TD className="text-xs">{b.bidReference ?? "—"}</TD>
                <TD>{b.region ?? "—"}</TD>
                <TD>
                  {b.state} / {b.lga}
                </TD>
                <TD className="text-right">{b.approvedStrength}</TD>
                <TD className="text-right">{b.actualStrength}</TD>
                <TD className="text-right">{b.vacancies || ""}</TD>
                <TD className="text-right text-red-700">{b.overdeployed || ""}</TD>
                <TD>
                  <StatusBadge status={b.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
