import Link from "next/link";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { RECOMMENDATION_LABELS, type Recommendation } from "@/lib/probation-workflow";
import { reviewsForContract } from "@/server/services/probation-workflow";
import { fmtDate } from "@/lib/dates";
import { Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { reviewRecommendationAction } from "@/app/actions/probation-workflow";

const STATUS_LABEL: Record<string, string> = { RECOMMENDED: "Awaiting HR review", RETURNED: "Returned to the manager", FORWARDED: "Waiting for the independent decision", DECIDED: "Decided" };
const check = (v: boolean | null) => (v === null ? "Not asked by the policy" : v ? "Yes" : "No");

/**
 * The probation workflow on a contract (docs/plans/probation-workflow-plan.md): every round, newest first, with HR's review form where a recommendation is waiting. The
 * server decides who may do what; the flags here only decide which form to show. The decision itself is made by a designated decider under My workspace > Probation.
 */
export async function ProbationReviews({ ctx, contractId }: { ctx: Ctx; contractId: string }) {
  const reviews = await reviewsForContract(ctx, contractId);
  const manage = can(ctx.role, "hr.manage");
  return (
    <Section
      title="Probation review"
      description="The manager recommends, a different HR person reviews, and an independent decider decides. The employee then receives written feedback and may respond once. A returned round stays as it was and a new recommendation starts the next."
    >
      {reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recommendation yet. The employee&apos;s reporting manager makes it under <b>My Workspace › My team&apos;s probation</b> (HR records it there only where the employee has no reporting manager).
        </p>
      ) : (
        <ol className="space-y-4">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b>Round {r.round}</b>
                <Badge tone={r.status === "DECIDED" ? "green" : r.status === "RETURNED" ? "amber" : "blue"}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                <span>
                  Recommended: <b>{RECOMMENDATION_LABELS[r.recommendation as Recommendation]}</b>
                  {r.recommendedMonths ? ` (${r.recommendedMonths} month(s))` : ""}
                </span>
                {r.recordedByHr && <Badge tone="amber">recorded by HR: no reporting manager</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {r.recommendedBy}, {fmtDate(r.recommendedAt)}
              </p>
              <p className="mt-1 whitespace-pre-line">{r.recommendationNote}</p>

              {r.reviewedAt && (
                <div className="mt-3 border-t pt-2">
                  <p className="text-xs text-muted-foreground">
                    HR review by {r.reviewedBy}, {fmtDate(r.reviewedAt)} — policy checks: signed-off appraisal: {check(r.appraisalSignedOff)}; minimum score: {check(r.minScoreMet)}; within the longest probation: {check(r.withinMaxMonths)}
                  </p>
                  <p className="mt-1 whitespace-pre-line">{r.reviewNote}</p>
                </div>
              )}

              {r.status === "RECOMMENDED" && manage && (
                <div className="mt-3 border-t pt-3">
                  {r.recommendedByUserId === ctx.userId ? (
                    <p className="text-xs text-muted-foreground">You recorded this recommendation, so a different HR person reviews it.</p>
                  ) : (
                    <SmartForm
                      columns={3}
                      submitLabel="Record the review"
                      action={reviewRecommendationAction.bind(null, r.id)}
                      fields={[
                        { name: "outcome", label: "Outcome", type: "select", required: true, options: [{ value: "FORWARD", label: "Forward to the decider" }, { value: "RETURN", label: "Return to the manager" }] },
                        { name: "note", label: "Note (what you checked against the policy)", type: "textarea", required: true, span: 2 },
                      ]}
                    />
                  )}
                </div>
              )}

              {r.status === "FORWARDED" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  A designated decider decides this under <Link className="text-primary underline" href="/me/probation">My Workspace › Probation</Link>. HR cannot decide it.
                </p>
              )}

              {r.status === "DECIDED" && (
                <div className="mt-3 space-y-1 border-t pt-2">
                  {r.decidedAgainstRecommendation && <Badge tone="amber">decided against the manager&apos;s recommendation</Badge>}
                  <p className="text-xs text-muted-foreground">Decided {fmtDate(r.decidedAt)}. The decision is in the history above.</p>
                  {r.feedbackText && (
                    <p className="whitespace-pre-line">
                      <span className="text-xs text-muted-foreground">Feedback written for the employee: </span>
                      {r.feedbackText}
                    </p>
                  )}
                  {r.respondedAt ? (
                    <p className="whitespace-pre-line">
                      <span className="text-xs text-muted-foreground">
                        The employee {r.responseAgreed ? "agreed" : "disagreed"} on {fmtDate(r.respondedAt)}
                        {r.responseReadAt ? `; read by ${r.responseReadBy} on ${fmtDate(r.responseReadAt)}` : "; not yet read by the decider"}:{" "}
                      </span>
                      {r.responseText}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No response from the employee yet.</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
