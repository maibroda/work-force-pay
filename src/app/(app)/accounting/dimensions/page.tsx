import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listDimensionMasters, type MasterKind } from "@/server/services/dimensions";
import { fmtDate } from "@/lib/dates";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createBranchAction, createProfitCentreAction, createProjectAction, createRegionAction, setDimensionActiveAction } from "@/app/actions/dimensions";

export default async function DimensionsPage() {
  const ctx = await requirePage("gl.view");
  const manage = can(ctx.role, "gl.manage");
  const { regions, branches, profitCentres, projects, clients, contracts } = await listDimensionMasters(ctx);
  const regionOptions = regions.filter((r) => r.active).map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }));
  const toggle = (kind: MasterKind, id: string, active: boolean) =>
    manage ? (
      <ActionButton action={setDimensionActiveAction.bind(null, kind, id, !active)} variant="outline">
        {active ? "Retire" : "Activate"}
      </ActionButton>
    ) : null;
  const status = (active: boolean) => (active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Retired</Badge>);

  return (
    <>
      <PageHeader
        title="Accounting dimensions"
        description="Every ledger line can say who and what it is for, beyond its account. Client, contract, beat, cost centre, department, employee and asset come from the records you already keep. Region, branch, profit centre and project are set up here. A dimension is fixed when the line is posted. Retiring one stops new postings using it and leaves what was posted alone. An account can insist on dimensions under Chart of Accounts → Edit."
      />

      <Section title={`Regions (${regions.length})`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Inside</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {regions.map((r) => (
              <TR key={r.id}>
                <TD className="font-mono">{r.code}</TD>
                <TD>{r.name}</TD>
                <TD className="text-xs">{r.parent ? `${r.parent.code} — ${r.parent.name}` : "—"}</TD>
                <TD>{status(r.active)}</TD>
                <TD className="text-right">{toggle("REGION", r.id, r.active)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!regions.length && <Empty>No regions yet.</Empty>}
      </Section>
      {manage && (
        <FormPanel title="Add a region">
          <SmartForm
            columns={3}
            submitLabel="Add region"
            action={createRegionAction}
            fields={[
              { name: "code", label: "Code", required: true, placeholder: "e.g. SW" },
              { name: "name", label: "Name", required: true, placeholder: "e.g. South West" },
              { name: "parentId", label: "Inside (optional)", type: "select", options: regionOptions, help: "Put a region inside a zone, which is just a larger region." },
            ]}
          />
        </FormPanel>
      )}

      <Section title={`Branches (${branches.length})`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Region</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {branches.map((b) => (
              <TR key={b.id}>
                <TD className="font-mono">{b.code}</TD>
                <TD>{b.name}</TD>
                <TD className="text-xs">{b.region ? `${b.region.code} — ${b.region.name}` : "—"}</TD>
                <TD>{status(b.active)}</TD>
                <TD className="text-right">{toggle("BRANCH", b.id, b.active)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!branches.length && <Empty>No branches yet.</Empty>}
      </Section>
      {manage && (
        <FormPanel title="Add a branch">
          <SmartForm
            columns={3}
            submitLabel="Add branch"
            action={createBranchAction}
            fields={[
              { name: "code", label: "Code", required: true },
              { name: "name", label: "Name", required: true },
              { name: "regionId", label: "Region (optional)", type: "select", options: regionOptions },
            ]}
          />
        </FormPanel>
      )}

      <Section title={`Profit centres (${profitCentres.length})`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {profitCentres.map((p) => (
              <TR key={p.id}>
                <TD className="font-mono">{p.code}</TD>
                <TD>{p.name}</TD>
                <TD>{status(p.active)}</TD>
                <TD className="text-right">{toggle("PROFIT_CENTRE", p.id, p.active)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!profitCentres.length && <Empty>No profit centres yet.</Empty>}
      </Section>
      {manage && (
        <FormPanel title="Add a profit centre">
          <SmartForm
            columns={3}
            submitLabel="Add profit centre"
            action={createProfitCentreAction}
            fields={[
              { name: "code", label: "Code", required: true },
              { name: "name", label: "Name", required: true, placeholder: "e.g. Guarding, Technology" },
            ]}
          />
        </FormPanel>
      )}

      <Section title={`Projects (${projects.length})`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Client / contract</TH>
              <TH>Dates</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {projects.map((p) => {
              const client = clients.find((c) => c.id === p.clientId);
              const contract = contracts.find((c) => c.id === p.contractId);
              return (
                <TR key={p.id}>
                  <TD className="font-mono">{p.code}</TD>
                  <TD>{p.name}</TD>
                  <TD className="text-xs">{[client && `${client.code} — ${client.name}`, contract && `${contract.contractNumber}`].filter(Boolean).join(" · ") || "—"}</TD>
                  <TD className="text-xs">{p.startDate ? fmtDate(p.startDate) : "—"} {p.endDate ? `to ${fmtDate(p.endDate)}` : ""}</TD>
                  <TD>{status(p.active)}</TD>
                  <TD className="text-right">{toggle("PROJECT", p.id, p.active)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {!projects.length && <Empty>No projects yet.</Empty>}
      </Section>
      {manage && (
        <FormPanel title="Add a project">
          <SmartForm
            columns={3}
            submitLabel="Add project"
            action={createProjectAction}
            fields={[
              { name: "code", label: "Code", required: true },
              { name: "name", label: "Name", required: true },
              { name: "clientId", label: "Client (optional)", type: "select", options: clients.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })) },
              { name: "contractId", label: "Contract (optional)", type: "select", options: contracts.map((c) => ({ value: c.id, label: `${c.contractNumber} — ${c.name}` })), help: "Must belong to the client if you choose both." },
              { name: "startDate", label: "Starts (optional)", type: "date" },
              { name: "endDate", label: "Ends (optional)", type: "date" },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
