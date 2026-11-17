import Link from "next/link";
import type { comparison } from "@/server/services/recruitment-panel";
import { Empty, Section } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Data = Awaited<ReturnType<typeof comparison>>;

/**
 * Candidates for one requisition side by side. In the order of their candidate numbers, never by score: the page does not rank, order or hide anyone, and every figure comes with the
 * scorecards it is made from. While a panel is open only how many members have submitted is shown (scoring is blind until it closes).
 */
export function PanelComparison({ data, candidateHref }: { data: Data; candidateHref?: (candidateId: string) => string }) {
  return (
    <>
      <p className="rounded bg-slate-100 p-3 text-xs text-slate-700">{data.note}</p>
      {data.candidates.length === 0 && (
        <Section title="Nothing to compare yet">
          <Empty>No candidate has a closed panel interview on this requisition yet.</Empty>
        </Section>
      )}
      {data.candidates.map((c) => (
        <Section
          key={c.candidateId}
          title={`${c.candidateNumber} — ${c.name}`}
          description={
            <span className="flex items-center gap-2">
              <StatusBadge status={c.stage} />
              {candidateHref && (
                <Link className="text-primary underline" href={candidateHref(c.candidateId)}>
                  Open candidate
                </Link>
              )}
            </span>
          }
        >
          {c.interviews.length === 0 && <Empty>No panel interview.</Empty>}
          {c.interviews.map((iv) => (
            <div key={iv.interviewId} className="mb-5">
              <p className="text-sm font-medium">
                Round {iv.round}: {iv.closed ? `scoring closed (${iv.submitted} of ${iv.panelSize} submitted)` : `scoring open, ${iv.submitted} of ${iv.panelSize} submitted (scorecards are read once it closes)`}
              </p>
              {iv.closed && iv.spread && iv.scorecards && (
                <>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Criterion</TH>
                        <TH>Lowest</TH>
                        <TH>Highest</TH>
                        <TH>Average</TH>
                        <TH>Scored by</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {iv.spread.criteria.map((s) => (
                        <TR key={s.criterionId}>
                          <TD>{s.name}</TD>
                          <TD>{s.min}</TD>
                          <TD>{s.max}</TD>
                          <TD>{s.average.toFixed(1)}</TD>
                          <TD>{s.count}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Recommendations: {Object.entries(iv.spread.recommendations).map(([k, n]) => `${k.replace(/_/g, " ").toLowerCase()} ${n}`).join(", ") || "none"}
                  </p>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Member</TH>
                        {data.criteria.map((cr) => (
                          <TH key={cr.id}>{cr.name}</TH>
                        ))}
                        <TH>Recommendation</TH>
                        <TH>Comment</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {iv.scorecards.map((card) => (
                        <TR key={card.member}>
                          <TD>
                            {card.member}
                            {card.isChair ? " (chair)" : ""}
                          </TD>
                          {data.criteria.map((cr) => (
                            <TD key={cr.id}>{card.scores.find((s) => s.criterionId === cr.id)?.score ?? "—"}</TD>
                          ))}
                          <TD>
                            <StatusBadge status={card.recommendation} />
                          </TD>
                          <TD className="max-w-sm whitespace-normal text-xs">
                            {[card.comment, ...card.scores.map((s) => s.comment)].filter(Boolean).join(" · ") || "—"}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </>
              )}
            </div>
          ))}
        </Section>
      ))}
    </>
  );
}
