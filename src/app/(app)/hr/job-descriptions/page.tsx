import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getKpiBands, listJobDescriptions } from "@/server/services/performance";
import { options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { formatBandLines } from "@/lib/performance";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createJobDescriptionAction, updateKpiBandsAction } from "@/app/actions/performance";

export default async function JobDescriptionsPage() {
  const ctx = await requirePage("appraisal.view");
  const [rows, o, bands] = await Promise.all([listJobDescriptions(ctx), options(ctx), getKpiBands(ctx.orgId)]);
  return (
    <>
      <PageHeader
        title="Job descriptions & KPIs"
        description="What each role is for, and the measurable targets (KPIs) its holders are appraised against. HR drafts a job description; a second person makes it active. An active version is never edited: a change is a new draft that starts as a copy. A review cycle can give KPIs a share of the overall score."
      />

      {can(ctx.role, "appraisal.manage") && (
        <FormPanel title="Draft a job description" open={!rows.length}>
          <SmartForm
            columns={2}
            submitLabel="Create draft"
            action={createJobDescriptionAction}
            fields={[
              { name: "categoryId", label: "Employee category", type: "select", required: true, options: o.categories },
              { name: "title", label: "Job title", required: true },
              { name: "purpose", label: "What the role is for", type: "textarea", span: 2 },
              { name: "responsibilities", label: "Main responsibilities", type: "textarea", span: 2 },
            ]}
          />
        </FormPanel>
      )}

      <Section title={`${rows.length} job description(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Category</TH>
              <TH>Version</TH>
              <TH>Title</TH>
              <TH>KPIs</TH>
              <TH>Status</TH>
              <TH>Drafted by</TH>
              <TH>Made active</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((j) => (
              <TR key={j.id}>
                <TD>{j.category.name}</TD>
                <TD>{j.version}</TD>
                <TD>
                  <Link className="text-primary underline" href={`/hr/job-descriptions/${j.id}`}>
                    {j.title}
                  </Link>
                </TD>
                <TD>{j._count.kpis}</TD>
                <TD>
                  <StatusBadge status={j.status} />
                </TD>
                <TD className="text-xs">{j.draftedBy}</TD>
                <TD className="text-xs">{j.activatedAt ? `${fmtDate(j.activatedAt)} by ${j.activatedBy}` : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No job descriptions yet.</Empty>}
      </Section>

      <Section
        title="How a KPI result becomes a score"
        description="The result is compared with the target as a percentage (for a lower-is-better KPI, the target divided by the result). Each line below says: from this percentage upwards, the score is this. Scores run from 1 to 5, and a higher result never scores lower."
      >
        {can(ctx.role, "hr.configure") ? (
          <SmartForm
            columns={1}
            submitLabel="Save bands"
            resetOnSuccess={false}
            action={updateKpiBandsAction}
            fields={[{ name: "bands", label: "Bands (one per line: the percentage it starts at, then the score)", type: "textarea", required: true, defaultValue: formatBandLines(bands) }]}
          />
        ) : (
          <pre className="text-sm">{formatBandLines(bands)}</pre>
        )}
      </Section>
    </>
  );
}
