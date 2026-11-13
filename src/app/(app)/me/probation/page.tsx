import { requirePage } from "@/lib/auth/session";
import { getHrPolicy } from "@/server/services/hr-policy";
import { decisionQueue, myProbationReviews } from "@/server/services/probation-workflow";
import { FEEDBACK_MAX, RECOMMENDATION_LABELS, RESPONSE_MAX, type Recommendation } from "@/lib/probation-workflow";
import { fmtDate } from "@/lib/dates";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { decideReviewAction, markResponseReadAction, respondToReviewAction } from "@/app/actions/probation-workflow";

const DECISION_LABEL: Record<string, string> = { CONFIRMED: "Probation confirmed", EXTENDED: "Probation extended", FAILED: "Probation not confirmed" };
const check = (v: boolean | null) => (v === null ? "not asked by the policy" : v ? "yes" : "no");

/**
 * My Workspace > Probation. Three things, each shown only to the person it is for: reviews waiting for MY decision (only if I am a designated decider, and never one I recommended,
 * reviewed or am the subject of); responses I have not marked as read; and MY OWN probation (the decision HR has told me about, the feedback written for me and my one response).
 */
export default async function MyProbationPage() {
  const ctx = await requirePage("self.view");
  const [policy, queue, mine] = await Promise.all([getHrPolicy(ctx.orgId), decisionQueue(ctx), myProbationReviews(ctx)]);
  return (
    <>
      <PageHeader title="Probation" description="Decisions waiting for you, responses to read, and your own probation. Nothing here is shown to anyone but the person it is for." />

      {queue.toDecide.length > 0 && (
        <Section title="Waiting for your decision" description="You were designated to decide. You may decide differently from the recommendation, but a different decision needs a fuller reason. HR does not decide.">
          {queue.toDecide.map((r) => (
            <div key={r.id} className="mb-6 rounded-md border p-3 text-sm">
              <p>
                <b>
                  {r.employeeNumber} — {r.name}
                </b>
                {r.probationEndDate ? <span className="text-muted-foreground"> · probation ends {fmtDate(r.probationEndDate)}</span> : null}
              </p>
              <p className="mt-1">
                <Badge tone="blue">Recommended: {RECOMMENDATION_LABELS[r.recommendation as Recommendation]}{r.recommendedMonths ? ` (${r.recommendedMonths} month(s))` : ""}</Badge> by {r.recommendedBy}
              </p>
              <p className="mt-1 whitespace-pre-line">{r.recommendationNote}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                HR review by {r.reviewedBy}: signed-off appraisal: {check(r.appraisalSignedOff)}; minimum score: {check(r.minScoreMet)}; within the longest probation: {check(r.withinMaxMonths)}.
              </p>
              <p className="whitespace-pre-line">{r.reviewNote}</p>
              <FormPanel title="Make the decision">
                <SmartForm
                  columns={3}
                  submitLabel="Record the decision"
                  action={decideReviewAction.bind(null, r.id)}
                  fields={[
                    { name: "decision", label: "Decision", type: "select", required: true, defaultValue: r.recommendation === "CONFIRM" ? "CONFIRMED" : r.recommendation === "EXTEND" ? "EXTENDED" : "FAILED", options: [{ value: "CONFIRMED", label: "Confirm" }, { value: "EXTENDED", label: "Extend" }, { value: "FAILED", label: "Do not confirm" }] },
                    { name: "extensionMonths", label: "If extending: months", type: "number", min: 1, max: 12, defaultValue: r.recommendedMonths ?? undefined },
                    { name: "effectiveDate", label: "If confirming: permanent from (optional)", type: "date" },
                    { name: "note", label: "Your reason (internal; at least 20 characters if you differ from the recommendation)", type: "textarea", span: 3 },
                    { name: "feedback", label: `Feedback for the employee (required to extend or not confirm; up to ${FEEDBACK_MAX} characters)`, type: "textarea", span: 3 },
                  ]}
                />
              </FormPanel>
            </div>
          ))}
        </Section>
      )}

      {queue.unreadResponses.length > 0 && (
        <Section title="Responses to read" description="An employee responded to a decision. A response changes nothing by itself: read it, and a different decision would be a new, reasoned decision.">
          <ul className="space-y-2 text-sm">
            {queue.unreadResponses.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {r.employeeNumber} — {r.name}, responded {fmtDate(r.respondedAt)}
                </span>
                <ActionButton action={markResponseReadAction.bind(null, r.id)} confirm="Record that you have read this response? Read it on the contract page first." variant="outline">
                  Mark as read
                </ActionButton>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="My probation" description={policy.probationResponseDays > 0 ? `HR tells you in person first; then you can read the decision and the feedback written for you here. You may respond once, within ${policy.probationResponseDays} days of the day you were told.` : "HR tells you in person first; then you can read the decision and the feedback written for you here. You may respond once."}>
        {mine.length === 0 ? (
          <Empty>Nothing to show. A decision about your probation appears here once HR has told you about it.</Empty>
        ) : (
          mine.map((r) => (
            <div key={r.id} className="mb-5 space-y-2 text-sm">
              <p>
                <b>{DECISION_LABEL[r.decision] ?? r.decision}</b>
                {r.effectiveDate ? <span className="text-muted-foreground"> · {fmtDate(r.effectiveDate)}</span> : null}
              </p>
              {r.feedback ? (
                <p className="whitespace-pre-line">
                  <span className="text-xs text-muted-foreground">Feedback for you: </span>
                  {r.feedback}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">No written feedback was added.</p>
              )}
              {r.response ? (
                <p className="whitespace-pre-line">
                  <span className="text-xs text-muted-foreground">
                    Your response ({r.response.agreed ? "you agreed" : "you disagreed"}, {fmtDate(r.response.at)}):{" "}
                  </span>
                  {r.response.text}
                </p>
              ) : r.canRespond ? (
                <FormPanel title="Respond">
                  <SmartForm
                    columns={3}
                    submitLabel="Send my response"
                    action={respondToReviewAction.bind(null, r.id)}
                    fields={[
                      { name: "agree", label: "Do you agree?", type: "select", required: true, options: [{ value: "yes", label: "I agree" }, { value: "no", label: "I disagree" }] },
                      { name: "comment", label: `Your comment (required if you disagree; up to ${RESPONSE_MAX} characters). You can respond once.`, type: "textarea", span: 3 },
                    ]}
                  />
                </FormPanel>
              ) : (
                <p className="text-xs text-muted-foreground">The time to respond has passed.</p>
              )}
            </div>
          ))
        )}
      </Section>
    </>
  );
}
