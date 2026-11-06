import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getJobDescription } from "@/server/services/performance";
import { fmtDate } from "@/lib/dates";
import { KPI_DIRECTION_LABELS, KPI_DIRECTIONS, KPI_UNIT_LABELS, KPI_UNITS, type KpiDirection, type KpiUnit } from "@/lib/performance";
import { FormPanel, KV, PageHeader, Section, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { activateJobDescriptionAction, addKpiAction, discardDraftAction, removeKpiAction, updateJobDescriptionAction } from "@/app/actions/performance";

export default async function JobDescriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("appraisal.view");
  const { id } = await params;
  const jd = await getJobDescription(ctx, id).catch(() => null);
  if (!jd) notFound();
  const draft = jd.status === "DRAFT";
  const manage = draft && can(ctx.role, "appraisal.manage");
  const activate = draft && can(ctx.role, "hr.approve") && jd.draftedByUserId !== ctx.userId;
  return (
    <>
      <PageHeader
        title={`${jd.category.name} — ${jd.title}`}
        crumbs={[{ href: "/hr/job-descriptions", label: "Job descriptions & KPIs" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={jd.status} /> version {jd.version}
          </span>
        }
        actions={
          <>
            {activate && (
              <ActionButton action={activateJobDescriptionAction.bind(null, jd.id)} variant="success" confirm="Make this version active? It replaces the current one for new review cycles. Reviews already under way keep the KPIs they started with.">
                Make active
              </ActionButton>
            )}
            {manage && (
              <ActionButton action={discardDraftAction.bind(null, jd.id)} variant="outline" confirm="Discard this draft?">
                Discard draft
              </ActionButton>
            )}
          </>
        }
      />
      {draft && !activate && can(ctx.role, "hr.approve") && jd.draftedByUserId === ctx.userId && (
        <p className="my-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">You drafted this version, so someone else has to make it active.</p>
      )}

      <Section title="The role">
        <KV
          cols={2}
          items={[
            ["Drafted by", jd.draftedBy],
            ["Made active", jd.activatedAt ? `${fmtDate(jd.activatedAt)} by ${jd.activatedBy}` : "—"],
            ["Retired", jd.retiredAt ? fmtDate(jd.retiredAt) : "—"],
            ["What the role is for", <span key="p" className="whitespace-pre-line">{jd.purpose ?? "—"}</span>],
            ["Main responsibilities", <span key="r" className="whitespace-pre-line">{jd.responsibilities ?? "—"}</span>],
          ]}
        />
      </Section>

      <Section title={`KPIs (${jd.kpis.length})`} description="Each KPI has a target and a weight. Weights are relative, so they need not add up to 100." flush>
        <Table>
          <THead>
            <TR>
              <TH>KPI</TH>
              <TH>Unit</TH>
              <TH>Direction</TH>
              <TH>Target</TH>
              <TH>Weight</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {jd.kpis.map((k) => (
              <TR key={k.id}>
                <TD className="max-w-xs whitespace-normal">
                  {k.name}
                  {k.description && <div className="text-xs text-muted-foreground">{k.description}</div>}
                </TD>
                <TD className="text-xs">{KPI_UNIT_LABELS[k.unit as KpiUnit]}</TD>
                <TD className="text-xs">{KPI_DIRECTION_LABELS[k.direction as KpiDirection]}</TD>
                <TD>{String(k.target)}</TD>
                <TD>{k.weight}</TD>
                <TD>
                  {manage && (
                    <ActionButton action={removeKpiAction.bind(null, k.id)} variant="outline" confirm="Remove this KPI?">
                      Remove
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!jd.kpis.length && <Empty>No KPIs yet.</Empty>}
      </Section>

      {manage && (
        <>
          <FormPanel title="Add a KPI" open>
            <SmartForm
              columns={3}
              submitLabel="Add KPI"
              action={addKpiAction.bind(null, jd.id)}
              fields={[
                { name: "name", label: "KPI", required: true, span: 2, placeholder: "Shifts covered without a late arrival" },
                { name: "unit", label: "Measured in", type: "select", required: true, options: KPI_UNITS.map((u) => ({ value: u, label: KPI_UNIT_LABELS[u] })) },
                { name: "direction", label: "Better when", type: "select", required: true, defaultValue: "HIGHER_IS_BETTER", options: KPI_DIRECTIONS.map((d) => ({ value: d, label: KPI_DIRECTION_LABELS[d] })) },
                { name: "target", label: "Target (exact number, up to 4 decimals)", required: true, placeholder: "95" },
                { name: "weight", label: "Weight", type: "number", defaultValue: 10, required: true },
                { name: "description", label: "What it measures (optional)", span: 3 },
              ]}
            />
          </FormPanel>
          <FormPanel title="Edit the role">
            <SmartForm
              columns={2}
              submitLabel="Save"
              resetOnSuccess={false}
              action={updateJobDescriptionAction.bind(null, jd.id)}
              fields={[
                { name: "title", label: "Job title", required: true, defaultValue: jd.title },
                { name: "purpose", label: "What the role is for", type: "textarea", span: 2, defaultValue: jd.purpose ?? undefined },
                { name: "responsibilities", label: "Main responsibilities", type: "textarea", span: 2, defaultValue: jd.responsibilities ?? undefined },
              ]}
            />
          </FormPanel>
        </>
      )}
    </>
  );
}
