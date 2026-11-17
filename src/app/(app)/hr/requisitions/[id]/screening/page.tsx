import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { screeningOverview } from "@/server/services/recruitment-screening";
import { Empty, PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

/**
 * Every candidate of a requisition with their screening answers, in the order of their candidate numbers. Advice only: nothing here orders, filters, hides or rejects anyone. HR alone;
 * the read is logged.
 */
export default async function ScreeningPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("recruitment.assess");
  const { id } = await params;
  const o = await screeningOverview(ctx, id);
  return (
    <>
      <PageHeader
        title="Screening overview"
        crumbs={[{ href: "/hr/requisitions", label: "Requisitions" }, { href: `/hr/requisitions/${id}`, label: "Requisition" }]}
        description="Each candidate's answers against the screening criteria. Advice for the people deciding, never a ranking."
      />
      <p className="rounded bg-slate-100 p-3 text-xs text-slate-700">{o.note}</p>
      <Section title={`Candidates (${o.candidates.length})`} flush>
        {o.criteria.length === 0 ? (
          <Empty>No screening criteria have been set for this requisition yet.</Empty>
        ) : o.candidates.length === 0 ? (
          <Empty>No candidates yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Candidate</TH>
                {o.criteria.map((c) => (
                  <TH key={c.id}>
                    {c.name}
                    <span className="block text-[10px] font-normal text-muted-foreground">{c.kind === "MUST_HAVE" ? "must have" : "preferred"}</span>
                  </TH>
                ))}
                <TH>Summary</TH>
                <TH>Shortlist</TH>
              </TR>
            </THead>
            <TBody>
              {o.candidates.map((c) => (
                <TR key={c.candidateId}>
                  <TD>
                    <Link className="text-primary underline" href={`/hr/candidates/${c.candidateId}`}>
                      {c.candidateNumber}
                    </Link>{" "}
                    {c.name}
                    <span className="block text-xs text-muted-foreground">{c.stage.toLowerCase()}</span>
                  </TD>
                  {o.criteria.map((cr) => {
                    const a = c.answers.find((x) => x.criterionId === cr.id);
                    return (
                      <TD key={cr.id} className="max-w-[12rem] whitespace-normal text-xs">
                        {a ? <StatusBadge status={a.outcome} /> : <span className="text-muted-foreground">not yet screened</span>}
                        {a?.evidence && <span className="mt-1 block">{a.evidence}</span>}
                      </TD>
                    );
                  })}
                  <TD className="text-xs">
                    {c.summary.met} met, {c.summary.notMet} not met, {c.summary.unclear} unclear of {c.summary.total}
                    {c.summary.mustHaveNotMet > 0 && <span className="block text-amber-700">{c.summary.mustHaveNotMet} must-have(s) not met</span>}
                  </TD>
                  <TD className="max-w-[14rem] whitespace-normal text-xs">
                    {c.shortlist ? (
                      <>
                        <StatusBadge status={c.shortlist.decision} />
                        <span className="mt-1 block">{c.shortlist.reason}</span>
                        <span className="block text-muted-foreground">{c.shortlist.decidedBy}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
