import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { BusinessError } from "@/server/services/_base";
import { getMyScorecard, myChairing } from "@/server/services/recruitment-panel";
import { enumOptions } from "@/server/options";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { closePanelAction, recommendSelectionAction, submitScorecardAction } from "@/app/actions/recruitment-panel";

const LABELS: Record<number, string> = { 1: "1 — Very weak", 2: "2 — Weak", 3: "3 — Adequate", 4: "4 — Strong", 5: "5 — Very strong" };

export default async function ScorecardPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage();
  const { id } = await params;
  let sc: Awaited<ReturnType<typeof getMyScorecard>>;
  try {
    sc = await getMyScorecard(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const chairing = sc.isChair ? await myChairing(ctx, sc.interview.candidateId) : null;
  const mineByCriterion = new Map((sc.mine?.scores ?? []).map((s) => [s.criterionId, s]));
  return (
    <>
      <PageHeader
        title={`${sc.interview.candidateName} — round ${sc.interview.round}`}
        crumbs={[{ href: "/me/interviews", label: "My interviews" }]}
        description={
          <span className="flex items-center gap-2">
            {sc.interview.jobTitle} <StatusBadge status={sc.closed ? "CLOSED" : sc.submitted ? "SUBMITTED" : "AWAITING_SCORECARD"} />
            {sc.isChair && <span className="text-xs">You are the chair.</span>}
          </span>
        }
      />
      {!sc.closed ? (
        <>
          <FormPanel open title={sc.submitted ? "Your scorecard (you can correct it until the scoring closes)" : "Your scorecard"}>
            <p className="mb-3 text-xs text-muted-foreground">
              Score every criterion from 1 to 5 and give your recommendation. You cannot see anyone else&apos;s scorecard until the scoring is closed, and they cannot see yours. Write about the work, not about the
              person: your comments are read word for word by HR and, once closed, by the panel.
            </p>
            <SmartForm
              columns={2}
              submitLabel={sc.submitted ? "Save my corrections" : "Submit my scorecard"}
              resetOnSuccess={false}
              action={submitScorecardAction.bind(null, id)}
              fields={[
                ...sc.criteria.flatMap((c) => [
                  { name: `score_${c.id}`, label: c.name, type: "select" as const, required: true, defaultValue: String(mineByCriterion.get(c.id)?.score ?? ""), options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: LABELS[n] })) },
                  { name: `comment_${c.id}`, label: `Comment on “${c.name}” (optional)`, type: "text" as const, defaultValue: mineByCriterion.get(c.id)?.comment ?? "" },
                ]),
                { name: "recommendation", label: "Your recommendation", type: "select" as const, required: true, defaultValue: sc.mine?.recommendation ?? "", options: enumOptions(["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"]) },
                { name: "comment", label: "Overall comment (optional)", type: "textarea" as const, span: 2 as const, defaultValue: sc.mine?.comment ?? "" },
              ]}
            />
          </FormPanel>
          {sc.isChair && (
            <Section title="Closing the scoring" description="It closes by itself when every member has submitted. As chair you can close it earlier (at least one scorecard is needed); after that no scorecard can change.">
              <ActionButton action={closePanelAction.bind(null, id)} confirm="Close the scoring now? No scorecard can change afterwards." variant="outline">
                Close scoring now
              </ActionButton>
            </Section>
          )}
        </>
      ) : (
        <>
          <Section title="The scoring is closed" description="Everyone's scorecards can now be read." actions={<Link className="text-sm text-primary underline" href={`/me/interviews/compare/${sc.interview.requisitionId}`}>Compare candidates</Link>}>
            <Table>
              <THead>
                <TR>
                  <TH>Member</TH>
                  {sc.criteria.map((c) => (
                    <TH key={c.id}>{c.name}</TH>
                  ))}
                  <TH>Recommendation</TH>
                  <TH>Comment</TH>
                </TR>
              </THead>
              <TBody>
                {[...(sc.mine ? [{ ...sc.mine, member: `${sc.mine.member} (you)` }] : []), ...(sc.others ?? [])].map((card) => (
                  <TR key={card.member}>
                    <TD>
                      {card.member}
                      {card.isChair ? " (chair)" : ""}
                    </TD>
                    {sc.criteria.map((c) => (
                      <TD key={c.id}>{card.scores.find((s) => s.criterionId === c.id)?.score ?? "—"}</TD>
                    ))}
                    <TD>
                      <StatusBadge status={card.recommendation} />
                    </TD>
                    <TD className="max-w-sm whitespace-normal text-xs">{[card.comment, ...card.scores.map((s) => s.comment)].filter(Boolean).join(" · ") || "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
          {chairing?.chair && chairing.closed && (!chairing.selection || chairing.selection.status === "REJECTED") && (
            <FormPanel open title="Recommend selecting this candidate">
              <p className="mb-3 text-xs text-muted-foreground">As chair you can recommend this candidate. A second person must approve it before an offer can be raised. Say why, in terms of the work.</p>
              <SmartForm
                columns={1}
                submitLabel="Send for approval"
                action={recommendSelectionAction.bind(null, sc.interview.candidateId)}
                fields={[{ name: "note", label: "Your reason (at least 10 characters)", type: "textarea", required: true }]}
              />
            </FormPanel>
          )}
          {chairing?.selection && chairing.selection.status !== "REJECTED" && (
            <Section title="Selection">
              <p className="text-sm">
                Recommendation status: <StatusBadge status={chairing.selection.status} />
              </p>
            </Section>
          )}
        </>
      )}
    </>
  );
}
