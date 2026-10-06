import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { getAppraisal, eligibleReviewers } from "@/server/services/appraisals";
import { BusinessError } from "@/server/services/_base";
import { KIND_LABELS, RATING_LABELS, RATINGS, RECOMMENDATIONS, RECOMMENDATION_LABELS } from "@/lib/appraisal";
import { can } from "@/lib/auth/permissions";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { KV, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm, type Field } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  acknowledgeAppraisalAction,
  approveAppraisalAction,
  assignReviewerAction,
  returnReviewAction,
  saveReviewAction,
  saveSelfAssessmentAction,
  submitReviewAction,
} from "@/app/actions/appraisals";

const ratingOptions = RATINGS.map((r) => ({ value: String(r), label: `${r} — ${RATING_LABELS[r]}` }));
const label = (s: string) => s.replace(/_/g, " ").toLowerCase();

export default async function AppraisalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage();
  const { id } = await params;
  const a = await getAppraisal(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!a) notFound();
  const reviewers = a.can.assign ? await eligibleReviewers(ctx) : [];
  const score = a.overallScore != null ? num(a.overallScore) : null;
  const showReviewer = !a.redacted;
  const high = a.policy.above;
  const low = a.policy.below;

  const selfFields: Field[] = [
    ...a.ratings.flatMap((r): Field[] => [
      { name: `self_rating_${r.criterionId}`, label: `${r.criterionName} (weight ${r.weight})`, type: "select", options: ratingOptions, defaultValue: r.selfRating ?? undefined },
      { name: `self_comment_${r.criterionId}`, label: "Why? (optional)", defaultValue: r.selfComment ?? undefined },
    ]),
    { name: "comment", label: "Anything else you want your manager to know", type: "textarea", span: 2, defaultValue: a.employeeSelfComment ?? undefined },
  ];
  const reviewFields: Field[] = [
    ...a.ratings.flatMap((r): Field[] => [
      {
        name: `rating_${r.criterionId}`,
        label: `${r.criterionName} (weight ${r.weight})${r.selfRating ? ` — they rated themselves ${r.selfRating}` : ""}`,
        type: "select",
        options: ratingOptions,
        defaultValue: r.rating ?? undefined,
      },
      { name: `comment_${r.criterionId}`, label: low || high ? `Comment (required for ${[low ? `${low} or below` : "", high ? `${high} or above` : ""].filter(Boolean).join(" and ")})` : "Comment", defaultValue: r.comment ?? undefined },
    ]),
    { name: "strengths", label: "Strengths", type: "textarea", span: 2, defaultValue: a.strengths ?? undefined },
    { name: "improvements", label: "Areas to improve", type: "textarea", span: 2, defaultValue: a.improvements ?? undefined },
    { name: "goals", label: "Goals for the next period", type: "textarea", span: 2, defaultValue: a.goals ?? undefined },
    { name: "reviewerComment", label: "Overall comment", type: "textarea", span: 2, defaultValue: a.reviewerComment ?? undefined },
    { name: "recommendation", label: "Recommendation", type: "select", defaultValue: a.recommendation, options: RECOMMENDATIONS.map((r) => ({ value: r, label: RECOMMENDATION_LABELS[r] })) },
  ];

  return (
    <>
      <PageHeader
        title={`${fullName(a.employee)} — ${a.cycle.name}`}
        crumbs={can(ctx.role, "appraisal.view") ? [{ href: "/hr/appraisals", label: "Appraisals" }, { href: `/hr/appraisals/cycle/${a.cycleId}`, label: a.cycle.name }] : [{ href: "/me/appraisals", label: "My appraisals" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} /> {KIND_LABELS[a.cycle.kind]} · {a.employee.employeeNumber} · {a.employee.category.name}
            {a.cycle.status === "CLOSED" && <Badge tone="gray">cycle closed</Badge>}
          </span>
        }
      />
      <KV
        cols={4}
        items={[
          ["Period", `${fmtDate(a.cycle.periodStart)} – ${fmtDate(a.cycle.periodEnd)}`],
          ["Due", fmtDate(a.cycle.dueDate)],
          ["Reviewer", a.reviewerName ?? <Badge tone="amber">not assigned</Badge>],
          ["Self-assessment", a.selfSubmittedAt ? `done ${fmtDate(a.selfSubmittedAt)}` : a.policy.selfAssessment ? "not yet" : "switched off"],
        ]}
      />

      {a.redacted && (
        <p className="my-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {a.status === "DRAFT" ? "Your manager is still working on this review." : "Your manager has submitted the review and it's awaiting sign-off."} You&apos;ll see their ratings and comments once it&apos;s signed off.
        </p>
      )}
      {a.can.review && a.returnNote && (
        <p className="my-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>Returned for another look:</b> {a.returnNote}
        </p>
      )}

      {score != null && (
        <StatGrid cols={3}>
          <Stat label="Overall score" value={score.toFixed(2)} sub={a.overallBand ?? undefined} tone={score >= 3.5 ? "green" : score < 2.5 ? "red" : undefined} />
          <Stat label="Recommendation" value={RECOMMENDATION_LABELS[a.recommendation]} />
          <Stat label="Self vs reviewer" value={a.selfGap == null ? "—" : `${a.selfGap > 0 ? "+" : ""}${a.selfGap.toFixed(2)}`} sub="Employee's own average minus the reviewer's" />
        </StatGrid>
      )}

      <Section title="Ratings" flush>
        <Table>
          <THead>
            <TR>
              <TH>Criterion</TH>
              <TH>Weight</TH>
              <TH>Employee</TH>
              {showReviewer && <TH>Reviewer</TH>}
            </TR>
          </THead>
          <TBody>
            {a.ratings.map((r) => (
              <TR key={r.id}>
                <TD>{r.criterionName}</TD>
                <TD>{r.weight}</TD>
                <TD className="max-w-xs whitespace-normal text-xs">
                  {r.selfRating ? `${r.selfRating} — ${RATING_LABELS[r.selfRating]}` : "—"}
                  {r.selfComment && <div className="text-muted-foreground">{r.selfComment}</div>}
                </TD>
                {showReviewer && (
                  <TD className="max-w-xs whitespace-normal text-xs">
                    {r.rating ? `${r.rating} — ${RATING_LABELS[r.rating]}` : "—"}
                    {r.comment && <div className="text-muted-foreground">{r.comment}</div>}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      {a.employeeSelfComment && (
        <Section title="Employee's comment">
          <p className="whitespace-pre-line text-sm">{a.employeeSelfComment}</p>
        </Section>
      )}
      {showReviewer && (a.strengths || a.improvements || a.goals || a.reviewerComment) && (
        <Section title="Reviewer's assessment">
          <KV
            cols={2}
            items={[
              ["Strengths", <span key="s" className="whitespace-pre-line">{a.strengths ?? "—"}</span>],
              ["Areas to improve", <span key="i" className="whitespace-pre-line">{a.improvements ?? "—"}</span>],
              ["Goals for the next period", <span key="g" className="whitespace-pre-line">{a.goals ?? "—"}</span>],
              ["Overall comment", <span key="c" className="whitespace-pre-line">{a.reviewerComment ?? "—"}</span>],
            ]}
          />
        </Section>
      )}
      {a.approvedAt && (
        <Section title="Sign-off & response">
          <p className="text-sm">
            Signed off by <b>{a.approvedBy}</b> on {fmtDate(a.approvedAt)}
            {a.approvalNote ? ` — ${a.approvalNote}` : ""}.
          </p>
          {a.acknowledgedAt && (
            <p className="mt-2 text-sm">
              {a.employeeAgreed ? <Badge tone="green">Employee agreed</Badge> : <Badge tone="red">Employee disagreed</Badge>} {fmtDate(a.acknowledgedAt)}
              {a.employeeResponse ? ` — ${a.employeeResponse}` : ""}
            </p>
          )}
        </Section>
      )}

      {a.can.selfAssess && (
        <Section title="Your self-assessment" description="Rate yourself honestly — your manager sees this when they do their review. You can change it until they submit.">
          <SmartForm columns={2} submitLabel="Save my self-assessment" resetOnSuccess={false} action={saveSelfAssessmentAction.bind(null, a.id)} fields={selfFields} />
        </Section>
      )}

      {a.can.review && (
        <Section title="Your review" description={`Rate every criterion (1 = ${RATING_LABELS[1].toLowerCase()}, 5 = ${RATING_LABELS[5].toLowerCase()}). Save as often as you like; submit when it's complete.`}>
          <SmartForm columns={2} submitLabel="Save draft" resetOnSuccess={false} action={saveReviewAction.bind(null, a.id)} fields={reviewFields} />
          <div className="mt-3">
            <ActionButton action={submitReviewAction.bind(null, a.id)} confirm="Submit this review for sign-off? Save your draft first — unsaved changes aren't submitted.">
              Submit for sign-off
            </ActionButton>
          </div>
        </Section>
      )}

      {a.can.approve && (
        <Section title="Sign-off" description="Approving releases the result to the employee. Return it if the ratings or comments need another look.">
          <div className="flex flex-wrap gap-2">
            <ActionButton action={approveAppraisalAction.bind(null, a.id)} confirm="Sign off this appraisal and release it to the employee?" variant="success">
              Approve
            </ActionButton>
            <ActionButton action={returnReviewAction.bind(null, a.id)} reason reasonPlaceholder="What needs another look?" variant="outline">
              Return to reviewer
            </ActionButton>
          </div>
        </Section>
      )}

      {a.can.acknowledge && (
        <Section title="Your response" description="Read the result above, then record that you've seen it. If you disagree, say why — it's kept with the appraisal.">
          <div className="flex flex-wrap gap-2">
            <ActionButton action={acknowledgeAppraisalAction.bind(null, a.id, true)} confirm="Acknowledge this appraisal?">
              I&apos;ve read it and agree
            </ActionButton>
            <ActionButton action={acknowledgeAppraisalAction.bind(null, a.id, false)} reason reasonPlaceholder="Why do you disagree?" variant="outline">
              I disagree
            </ActionButton>
          </div>
        </Section>
      )}

      {a.can.assign && (
        <Section title="Reviewer" description={`Currently ${a.reviewerName ?? "nobody"}. Only someone with the review permission can be chosen, and never the employee.`}>
          <SmartForm
            columns={2}
            submitLabel="Assign"
            action={assignReviewerAction.bind(null, a.id)}
            fields={[{ name: "userId", label: "Reviewer", type: "select", required: true, defaultValue: a.reviewerUserId ?? undefined, options: reviewers.filter((u) => u.employeeId !== a.employeeId).map((u) => ({ value: u.id, label: `${u.name} (${label(u.role)})` })) }]}
          />
        </Section>
      )}
      <p className="mb-8 text-xs text-muted-foreground">
        <Link className="underline" href={can(ctx.role, "appraisal.view") ? "/hr/appraisals" : "/me/appraisals"}>
          Back to appraisals
        </Link>
      </p>
    </>
  );
}
