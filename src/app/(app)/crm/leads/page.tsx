import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listLeads, listPartners, pipelineOwners } from "@/server/services/crm";
import { SOURCES, SOURCE_LABELS, STAGES, STAGE_LABELS } from "@/lib/crm";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, FilterBar, FilterField, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createLeadAction } from "@/app/actions/crm";
import { crmGate } from "../_gate";
import { leadFields, STAGE_TONE } from "../_fields";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("crm.view");
  const gate = await crmGate(ctx, "Leads");
  if (gate) return gate;
  const sp = await searchParams;
  const manage = can(ctx.role, "crm.manage");
  const [leads, owners, partners] = await Promise.all([
    listLeads(ctx, { stage: sp.stage, ownerUserId: sp.owner, source: sp.source, q: sp.q }),
    pipelineOwners(ctx),
    listPartners(ctx, { activeOnly: true }),
  ]);
  return (
    <>
      <PageHeader title="Leads" description="Every prospect, in every stage. A company can be in the pipeline only once." crumbs={[{ href: "/crm", label: "Sales pipeline" }]} />
      {manage && (
        <FormPanel title="Add a lead">
          <SmartForm
            columns={3}
            submitLabel="Add to the pipeline"
            resetOnSuccess
            action={createLeadAction}
            fields={leadFields({ owners: owners.map((o) => ({ value: o.id, label: o.name })), partners: partners.map((p) => ({ value: p.id, label: p.name })), me: ctx.userId })}
          />
        </FormPanel>
      )}
      <FilterBar>
        <FilterField label="Search">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Company, contact or number" />
        </FilterField>
        <FilterField label="Stage">
          <Select name="stage" defaultValue={sp.stage ?? ""}>
            <option value="">All</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Owner">
          <Select name="owner" defaultValue={sp.owner ?? ""}>
            <option value="">Anyone</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Source">
          <Select name="source" defaultValue={sp.source ?? ""}>
            <option value="">Any</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${leads.length} lead(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Lead</TH>
              <TH>Company</TH>
              <TH>Stage</TH>
              <TH className="text-right">Staff</TH>
              <TH className="text-right">Expected MRR</TH>
              <TH>Source</TH>
              <TH>Owner</TH>
              <TH>Since</TH>
            </TR>
          </THead>
          <TBody>
            {leads.map((l) => (
              <TR key={l.id}>
                <TD className="font-mono text-xs">{l.number}</TD>
                <TD>
                  <Link className="text-primary underline" href={`/crm/leads/${l.id}`}>
                    {l.company}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{l.contactName}</span>
                </TD>
                <TD>
                  <Badge tone={STAGE_TONE[l.stage]}>{STAGE_LABELS[l.stage]}</Badge>
                </TD>
                <TD className="text-right">{l.headcount ?? "—"}</TD>
                <TD className="text-right text-xs">{Number(l.expectedMrr) ? naira(l.expectedMrr) : "—"}</TD>
                <TD className="text-xs">{l.partner?.name ?? SOURCE_LABELS[l.source]}</TD>
                <TD className="text-xs">{l.ownerName}</TD>
                <TD className="text-xs">{fmtDate(l.stageChangedAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!leads.length && <Empty>No leads match.</Empty>}
      </Section>
    </>
  );
}
