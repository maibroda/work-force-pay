import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listHealthChecks } from "@/server/services/health-checks";
import { fmtDate } from "@/lib/dates";
import { Empty, FilterBar, FilterField, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { crmGate } from "../crm/_gate";
import { CHECK_STATUS_LABEL, CHECK_STATUS_TONE } from "./_tone";

export default async function HealthChecksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("healthcheck.view");
  const gate = await crmGate(ctx, "Health checks");
  if (gate) return gate;
  const sp = await searchParams;
  const rows = await listHealthChecks(ctx, { status: sp.status });
  return (
    <>
      <PageHeader
        title="Payroll health checks"
        description="A limited review of a prospect's payroll process against a standard checklist: what was seen operating, and what was not. A second person reviews it before it is issued, and the summary says plainly that it is not an audit or a certification. Start one from the lead's page."
      />
      <FilterBar>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {Object.entries(CHECK_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} health check(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>No.</TH>
              <TH>Prospect</TH>
              <TH>Period</TH>
              <TH className="text-right">Findings</TH>
              <TH>Assessed by</TH>
              <TH>Status</TH>
              <TH>Issued</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/health-checks/${c.id}`}>
                    {c.number}
                  </Link>
                </TD>
                <TD className="text-xs">{c.lead.company}</TD>
                <TD className="text-xs">{c.periodReviewed ?? "—"}</TD>
                <TD className="text-right">{c._count.findings}</TD>
                <TD className="text-xs">{c.assessedBy}</TD>
                <TD>
                  <Badge tone={CHECK_STATUS_TONE[c.status]}>{CHECK_STATUS_LABEL[c.status]}</Badge>
                </TD>
                <TD className="text-xs">{c.issuedAt ? fmtDate(c.issuedAt) : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No health checks yet.</Empty>}
      </Section>
    </>
  );
}
