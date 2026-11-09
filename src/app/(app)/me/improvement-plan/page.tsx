import { requirePage } from "@/lib/auth/session";
import { OBJECTIVE_RESULT_LABELS, OUTCOME_LABELS, PIP_STATUS_LABELS, type ObjectiveResult, type PipOutcome } from "@/lib/pip";
import { myPlans } from "@/server/services/pip";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { acknowledgePlanAction, addEmployeeCommentAction } from "@/app/actions/pip";

const TONE: Record<ObjectiveResult, "gray" | "green" | "amber" | "red"> = { OPEN: "gray", MET: "green", PARTLY_MET: "amber", NOT_MET: "red" };

export default async function MyImprovementPlanPage() {
  const ctx = await requirePage();
  const plans = await myPlans(ctx);
  return (
    <>
      <PageHeader
        title="My improvement plan"
        description="If your manager and HR have agreed a plan to help you reach the standard expected, it appears here once it has started: what has to improve, how you will be supported, and how it is going. You can say whether you agree, and add a comment to each review."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : plans.length === 0 ? (
        <Section title="Nothing to show">
          <p className="text-sm text-muted-foreground">You have no improvement plan.</p>
        </Section>
      ) : (
        plans.map((p) => (
          <div key={p.id}>
            <Section
              title={`Plan ${fmtDate(p.startDate)} – ${fmtDate(p.endDate)}`}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={p.status === "ACTIVE" ? "blue" : p.status === "CLOSED" ? "green" : "gray"}>{p.status === "OUTCOME_PROPOSED" ? "Being reviewed" : PIP_STATUS_LABELS[p.status]}</Badge>
                  {p.outcome && <Badge tone={p.outcome === "SUCCESSFUL" ? "green" : "gray"}>{OUTCOME_LABELS[p.outcome as PipOutcome]}</Badge>}
                  <span className="text-xs text-muted-foreground">Reviewed with: {p.ownerName}</span>
                </span>
              }
            >
              <p className="whitespace-pre-line text-sm">{p.concerns}</p>
            </Section>

            <Section title="What has to improve, and how you will be supported" flush>
              <Table>
                <THead>
                  <TR>
                    <TH>What has to improve</TH>
                    <TH>Target</TH>
                    <TH>Support</TH>
                    <TH>By</TH>
                    <TH>So far</TH>
                  </TR>
                </THead>
                <TBody>
                  {p.objectives.map((o) => (
                    <TR key={o.id}>
                      <TD className="max-w-xs whitespace-normal">{o.gap}</TD>
                      <TD className="max-w-xs whitespace-normal">{o.target}</TD>
                      <TD className="max-w-xs whitespace-normal text-xs">{o.support ?? "—"}</TD>
                      <TD className="text-xs">{fmtDate(o.dueDate)}</TD>
                      <TD>
                        <Badge tone={TONE[o.result as ObjectiveResult]}>{OBJECTIVE_RESULT_LABELS[o.result as ObjectiveResult]}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Section>

            {p.reviews.length > 0 && (
              <Section title="Reviews">
                <ul className="space-y-3 text-sm">
                  {p.reviews.map((r) => (
                    <li key={r.id} className="rounded-md border p-3">
                      <div className="font-medium">{fmtDate(r.reviewedOn)}</div>
                      <p className="mt-1 whitespace-pre-line">{r.summary}</p>
                      {r.employeeComment ? (
                        <p className="mt-2 rounded bg-muted/50 px-2 py-1 text-xs">
                          <b>Your comment:</b> {r.employeeComment}
                        </p>
                      ) : p.status !== "WITHDRAWN" ? (
                        <div className="mt-2">
                          <SmartForm columns={1} submitLabel="Add my comment" action={addEmployeeCommentAction.bind(null, r.id)} fields={[{ name: "comment", label: "Your comment on this review (you can add one)", type: "textarea" }]} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {p.status !== "WITHDRAWN" &&
              (p.acknowledgedAt ? (
                <Section title="Your response">
                  <p className="text-sm">
                    {p.employeeAgreed ? "You said you agree with this plan." : `You said you disagree: ${p.employeeResponse}`} <span className="text-xs text-muted-foreground">({fmtDate(p.acknowledgedAt)})</span>
                  </p>
                </Section>
              ) : (
                <Section title="Your response" description="Read the plan above, then record that you have seen it. If you disagree, say why: it is kept with the plan. Disagreeing does not stop the plan.">
                  <div className="flex flex-wrap gap-2">
                    <ActionButton action={acknowledgePlanAction.bind(null, p.id, true)} confirm="Record that you have read this plan and agree with it?">
                      I have read it and agree
                    </ActionButton>
                    <ActionButton action={acknowledgePlanAction.bind(null, p.id, false)} reason reasonPlaceholder="Why do you disagree?" variant="outline">
                      I disagree
                    </ActionButton>
                  </div>
                </Section>
              ))}
          </div>
        ))
      )}
    </>
  );
}
