import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { OBJECTIVE_RESULT_LABELS, OUTCOME_LABELS, PIP_STATUS_LABELS, type ObjectiveResult, type PipOutcome, type PipStatus } from "@/lib/pip";
import { eligibleOwners, getPlan } from "@/server/services/pip";
import { BusinessError } from "@/server/services/_base";
import { fmtDate, iso } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm, type Field } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  addObjectiveAction,
  approveOutcomeAction,
  approveStartAction,
  proposeOutcomeAction,
  recordReviewAction,
  removeObjectiveAction,
  returnOutcomeAction,
  returnPlanAction,
  submitPlanAction,
  updatePlanAction,
  withdrawPlanAction,
} from "@/app/actions/pip";

const RESULT_TONE: Record<ObjectiveResult, "gray" | "green" | "amber" | "red"> = { OPEN: "gray", MET: "green", PARTLY_MET: "amber", NOT_MET: "red" };
const resultOptions = (["MET", "PARTLY_MET", "NOT_MET"] as const).map((r) => ({ value: r, label: OBJECTIVE_RESULT_LABELS[r] }));

export default async function ImprovementPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("pip.view");
  const { id } = await params;
  const p = await getPlan(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!p) notFound();
  const status = p.status as PipStatus;
  const a = p.actions;
  const owners = a.edit ? await eligibleOwners(ctx) : [];
  const today = iso(new Date());
  const lengthDays = Math.round((p.endDate.getTime() - p.startDate.getTime()) / 86_400_000);

  const reviewFields: Field[] = [
    { name: "reviewedOn", label: "Date of the review", type: "date", required: true, defaultValue: today },
    { name: "summary", label: "Summary of the review", type: "textarea", required: true, span: 2 },
    ...p.objectives.flatMap((o): Field[] => [
      { name: `result_${o.id}`, label: `Objective: ${o.gap} — result`, type: "select", options: resultOptions },
      { name: `note_${o.id}`, label: "Note on this objective (optional)" },
    ]),
  ];

  return (
    <>
      <PageHeader
        title={`Improvement plan — ${fullName(p.employee)}`}
        crumbs={[{ href: "/hr/improvement-plans", label: "Improvement plans" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status === "ACTIVE" ? "blue" : status === "CLOSED" ? "green" : status === "WITHDRAWN" ? "gray" : "amber"}>{PIP_STATUS_LABELS[status]}</Badge>
            <Link className="text-primary hover:underline" href={`/employees/${p.employeeId}`}>
              {p.employee.employeeNumber}
            </Link>
            {p.appraisalId && (
              <Link className="text-primary hover:underline" href={`/hr/appraisals/${p.appraisalId}`}>
                started from an appraisal
              </Link>
            )}
          </span>
        }
      />
      <div className="mb-5">
        <KV
          cols={4}
          items={[
            ["Dates", `${fmtDate(p.startDate)} – ${fmtDate(p.endDate)} (${lengthDays} days)`],
            ["Owner", p.ownerName],
            ["Drafted by", p.draftedBy],
            ["Started by", p.activatedBy ? `${p.activatedBy}, ${fmtDate(p.activatedAt)}` : "—"],
            ["Extensions used", String(p.extensionsUsed)],
            ["Next review", status === "ACTIVE" ? (p.reviewState === "OVERDUE" ? <Badge tone="red">overdue since {fmtDate(p.nextReviewDue)}</Badge> : fmtDate(p.nextReviewDue)) : "—"],
            ["Employee's response", p.acknowledgedAt ? (p.employeeAgreed ? "Agreed" : "Disagreed") : status === "DRAFT" || status === "AWAITING_APPROVAL" ? "Not shown to the employee yet" : "Not yet"],
            ["Outcome", p.outcome ? OUTCOME_LABELS[p.outcome as PipOutcome] : status === "OUTCOME_PROPOSED" && p.proposedOutcome ? `${OUTCOME_LABELS[p.proposedOutcome as PipOutcome]} (proposed by ${p.proposedBy})` : "—"],
          ]}
        />
      </div>

      {status === "DRAFT" && p.returnNote && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>Returned to draft:</b> {p.returnNote}
        </p>
      )}
      {p.acknowledgedAt && !p.employeeAgreed && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>The employee disagrees:</b> {p.employeeResponse}
        </p>
      )}
      {status === "OUTCOME_PROPOSED" && p.proposedNote && (
        <p className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <b>Proposed outcome — {p.proposedOutcome ? OUTCOME_LABELS[p.proposedOutcome as PipOutcome] : ""}:</b> {p.proposedNote}
          {p.proposedEndDate ? ` New end date ${fmtDate(p.proposedEndDate)}.` : ""}
        </p>
      )}
      {status === "CLOSED" && p.outcomeNote && (
        <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <b>Outcome note:</b> {p.outcomeNote}
          {p.outcomeApprovedBy ? ` (approved by ${p.outcomeApprovedBy}, ${fmtDate(p.closedAt)})` : ""}
        </p>
      )}
      {status === "WITHDRAWN" && (
        <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <b>Withdrawn</b> by {p.withdrawnBy} on {fmtDate(p.withdrawnAt)}: {p.withdrawReason}
        </p>
      )}

      <Section title="The concerns">
        <p className="whitespace-pre-line text-sm">{p.concerns}</p>
      </Section>

      <Section title="Objectives" description="Each objective names the gap, the measurable target, the support the company gives, and when. The result is the latest review's." flush>
        {p.objectives.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No objectives yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Gap</TH>
                <TH>Target</TH>
                <TH>Support</TH>
                <TH>Due</TH>
                <TH>Result</TH>
                {a.edit && <TH />}
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
                    <Badge tone={RESULT_TONE[o.result as ObjectiveResult]}>{OBJECTIVE_RESULT_LABELS[o.result as ObjectiveResult]}</Badge>
                    {o.resultNote && <div className="mt-1 text-[11px] text-muted-foreground">{o.resultNote}</div>}
                  </TD>
                  {a.edit && (
                    <TD>
                      <ActionButton action={removeObjectiveAction.bind(null, o.id)} confirm="Remove this objective?" variant="outline">
                        Remove
                      </ActionButton>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {a.edit && (
        <>
          <Section title="Add an objective">
            <SmartForm
              columns={2}
              submitLabel="Add objective"
              action={addObjectiveAction.bind(null, p.id)}
              fields={[
                { name: "gap", label: "The gap: what has to be put right", required: true, span: 2 },
                { name: "target", label: "The measurable target", required: true, span: 2 },
                { name: "support", label: "The support the company will give (training, coaching, equipment)", span: 2 },
                { name: "dueDate", label: "Due date (within the plan's dates)", type: "date", required: true },
              ]}
            />
          </Section>
          <Section title="Edit the draft">
            <SmartForm
              columns={3}
              submitLabel="Save changes"
              action={updatePlanAction.bind(null, p.id)}
              fields={[
                { name: "startDate", label: "Start date", type: "date", defaultValue: iso(p.startDate) },
                { name: "days", label: "Length in days", type: "number", defaultValue: lengthDays },
                { name: "ownerUserId", label: "Plan owner", type: "select", defaultValue: p.ownerUserId, options: owners.map((u) => ({ value: u.id, label: u.name })) },
                { name: "concerns", label: "The concerns", type: "textarea", span: 3, defaultValue: p.concerns },
              ]}
            />
          </Section>
        </>
      )}

      <Section title={`Reviews (${p.reviews.length})`} description="Recorded at each milestone and never edited afterwards. The employee sees them and may add one comment to each.">
        {p.reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">No review has been recorded yet.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {p.reviews.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <div className="font-medium">
                  {fmtDate(r.reviewedOn)} <span className="text-xs font-normal text-muted-foreground">by {r.recordedBy}</span>
                </div>
                <p className="mt-1 whitespace-pre-line">{r.summary}</p>
                {r.assessments.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1 text-xs">
                    {r.assessments.map((x) => (
                      <li key={x.id}>
                        <Badge tone={RESULT_TONE[x.result as ObjectiveResult]}>
                          {p.objectives.find((o) => o.id === x.objectiveId)?.gap.slice(0, 40) ?? "Objective"}: {OBJECTIVE_RESULT_LABELS[x.result as ObjectiveResult]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                {r.employeeComment && (
                  <p className="mt-2 rounded bg-muted/50 px-2 py-1 text-xs">
                    <b>Employee&apos;s comment:</b> {r.employeeComment}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {a.review && (
        <Section title="Record a review" description="Give each objective a result if you assessed it. The next review falls due after the interval set in the HR policy.">
          <SmartForm columns={2} submitLabel="Record review" action={recordReviewAction.bind(null, p.id)} fields={reviewFields} />
        </Section>
      )}

      {a.proposeOutcome && (
        <Section title="Propose an outcome" description="A second person has to approve it. An Unsuccessful outcome only records the result: it changes nothing else about the employee.">
          <SmartForm
            columns={2}
            submitLabel="Propose outcome"
            action={proposeOutcomeAction.bind(null, p.id)}
            fields={[
              { name: "outcome", label: "Outcome", type: "select", required: true, options: (["SUCCESSFUL", "EXTENDED", "UNSUCCESSFUL"] as const).map((o) => ({ value: o, label: OUTCOME_LABELS[o] })) },
              { name: "newEndDate", label: "New end date (only for an extension)", type: "date" },
              { name: "note", label: "Why", type: "textarea", required: true, span: 2 },
            ]}
          />
        </Section>
      )}

      {(a.submit || a.approveStart || a.returnStart || a.approveOutcome || a.returnOutcome || a.withdraw) && (
        <Section title="Actions">
          <div className="flex flex-wrap gap-2">
            {a.submit && (
              <ActionButton action={submitPlanAction.bind(null, p.id)} confirm="Submit this plan? Someone else has to approve it before it starts, and then the employee will see it." variant="success">
                Submit for approval
              </ActionButton>
            )}
            {a.approveStart && (
              <ActionButton action={approveStartAction.bind(null, p.id)} confirm="Start this plan? The employee will see it from now on." variant="success">
                Approve and start
              </ActionButton>
            )}
            {a.returnStart && (
              <ActionButton action={returnPlanAction.bind(null, p.id)} reason reasonPlaceholder="What needs changing? (required)" variant="outline">
                Return to draft
              </ActionButton>
            )}
            {a.approveOutcome && (
              <ActionButton action={approveOutcomeAction.bind(null, p.id)} confirm="Approve this outcome? A Successful or Unsuccessful outcome closes the plan for good." variant="success">
                Approve outcome
              </ActionButton>
            )}
            {a.returnOutcome && (
              <ActionButton action={returnOutcomeAction.bind(null, p.id)} reason reasonPlaceholder="Why is it returned? (required)" variant="outline">
                Return outcome
              </ActionButton>
            )}
            {a.withdraw && (
              <ActionButton action={withdrawPlanAction.bind(null, p.id)} reason reasonPlaceholder="Why is it withdrawn? (required)" variant="outline">
                Withdraw plan
              </ActionButton>
            )}
          </div>
          {(status === "AWAITING_APPROVAL" || status === "OUTCOME_PROPOSED") && !a.approveStart && !a.approveOutcome && (
            <p className="mt-2 text-xs text-muted-foreground">
              Someone with the approve right, who is not the drafter, the owner or (for an outcome) the person who proposed it, has to decide this step.
            </p>
          )}
        </Section>
      )}
    </>
  );
}
