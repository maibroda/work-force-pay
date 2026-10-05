import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listCandidates, recruitmentSummary } from "@/server/services/recruitment";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const STAGES = ["APPLIED", "SCREENING", "INTERVIEW", "ASSESSMENT", "OFFER", "HIRED", "REJECTED", "WITHDRAWN"];

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const [rows, sum] = await Promise.all([listCandidates(ctx, { stage: sp.stage, q: sp.q }), recruitmentSummary(ctx)]);
  return (
    <>
      <PageHeader
        title="Candidates & pipeline"
        description="Add candidates from an approved requisition. Each moves through screening, interview, assessment and offer — and is vetted before they can be hired."
      />
      <StatGrid cols={5}>
        {STAGES.slice(0, 5).map((s) => (
          <Stat key={s} label={s.charAt(0) + s.slice(1).toLowerCase()} value={sum.stages[s] ?? 0} />
        ))}
      </StatGrid>
      <FilterBar>
        <FilterField label="Search">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Name, number, phone, email" className="w-64" />
        </FilterField>
        <FilterField label="Stage">
          <Select name="stage" defaultValue={sp.stage ?? ""}>
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} candidate(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Candidate</TH>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Source</TH>
              <TH>Expects</TH>
              <TH>Stage</TH>
              <TH>Since</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/hr/candidates/${c.id}`}>
                    {c.candidateNumber}
                  </Link>
                </TD>
                <TD>
                  {c.firstName} {c.lastName}
                </TD>
                <TD className="text-xs">
                  <Link className="hover:underline" href={`/hr/requisitions/${c.requisitionId}`}>
                    {c.requisition.requisitionNumber} — {c.requisition.title}
                  </Link>
                </TD>
                <TD className="text-xs">{c.source.replace(/_/g, " ")}</TD>
                <TD>{c.expectedMonthlyGross ? naira(c.expectedMonthlyGross) : "—"}</TD>
                <TD>
                  <StatusBadge status={c.stage} />
                </TD>
                <TD className="text-xs">{fmtDate(c.stageChangedAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No candidates match — add them from a requisition.</Empty>}
      </Section>
    </>
  );
}
