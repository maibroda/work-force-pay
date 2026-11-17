import Link from "next/link";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { RECONSIDERATION_STATUS_LABELS, STATEMENT_WORDING_REVIEWED, isOpenStatus, type ReconsiderationStatus } from "@/lib/probation-reconsideration";
import { getHrPolicy } from "@/server/services/hr-policy";
import { reconsiderationsForContract } from "@/server/services/probation-reconsideration";
import { fmtDate } from "@/lib/dates";
import { Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm, type Field } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { communicateReconsiderationAction, requestReconsiderationAction, reviewReconsiderationAction, withdrawReconsiderationAction } from "@/app/actions/probation-reconsideration";

/** The fields of a request: the justification, the months, and up to three measurable conditions. Shared with the supervisor's page. */
export const requestFields = (minJustification: number): Field[] => [
  { name: "justification", label: `Why this reconsideration is justified (in your own words, at least ${minJustification} characters)`, type: "textarea" as const, required: true, span: 3 },
  { name: "months", label: "Extension (months)", type: "number" as const, required: true, min: 1, max: 36 },
  ...[1, 2, 3].flatMap((i) => [
    { name: `measure${i}`, label: `Condition ${i}: what is measured${i === 1 ? " (required)" : ""}` },
    { name: `target${i}`, label: "The target" },
    { name: `reviewOn${i}`, label: "Reviewed on", type: "date" as const },
  ]),
];

/**
 * Reconsideration of a failed probation on a contract (docs/plans/failed-probation-renewal-proposal.md): every request, with HR's review form where one is waiting and the button that records the
 * employee has been formally told. The server decides who may do what; the flags here only decide which form to show. The decision itself is made by a designated decider under My workspace >
 * Probation. Shown only where there is something to show.
 */
export async function ProbationReconsiderations({ ctx, contractId, failed, noManager }: { ctx: Ctx; contractId: string; failed: boolean; noManager: boolean }) {
  const [policy, rows] = await Promise.all([getHrPolicy(ctx.orgId), reconsiderationsForContract(ctx, contractId)]);
  if (rows.length === 0 && !(policy.reconsiderationEnabled && failed && noManager && can(ctx.role, "hr.manage"))) return null;
  const manage = can(ctx.role, "hr.manage");
  const open = rows.some((r) => isOpenStatus(r.status as ReconsiderationStatus));
  return (
    <Section
      title="Reconsideration of the failed probation"
      description="A failed probation stays recorded as failed. A reconsideration is a separate step, never automatic: the supervisor asks with a justification and measurable conditions, a different HR person reviews it, a designated decider decides, and the extension takes effect only once the employee has been formally told. It sets no pay and changes no employee status."
    >
      {rows.map((r) => (
        <div key={r.id} className="mb-4 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={r.status === "EFFECTIVE" ? "green" : r.status === "DECLINED" || r.status === "WITHDRAWN" ? "gray" : r.status === "RETURNED" ? "amber" : "blue"}>{RECONSIDERATION_STATUS_LABELS[r.status as ReconsiderationStatus]}</Badge>
            <span>
              {r.proposedMonths} month(s) proposed{r.approvedMonths ? `, ${r.approvedMonths} approved` : ""}
            </span>
            {r.recordedByHr && <Badge tone="amber">recorded by HR: no reporting manager</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {r.requestedBy}, {fmtDate(r.requestedAt)}
          </p>
          <p className="mt-1 whitespace-pre-line">{r.justification}</p>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {r.expectations.map((e) => (
              <li key={e.id}>
                {e.measure}: {e.target} (reviewed {fmtDate(e.reviewOn)})
              </li>
            ))}
          </ul>
          {r.hrAt && (
            <p className="mt-2 text-xs text-muted-foreground">
              HR review by {r.hrBy}, {fmtDate(r.hrAt)}: <span className="whitespace-pre-line text-foreground">{r.hrNote}</span>
            </p>
          )}
          {r.decidedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Decision by {r.decidedBy}, {fmtDate(r.decidedAt)}
              {r.decisionNote ? <>: <span className="whitespace-pre-line text-foreground">{r.decisionNote}</span></> : null}
            </p>
          )}

          {r.status === "REQUESTED" && manage && (
            <div className="mt-3 border-t pt-3">
              {r.requestedByUserId === ctx.userId ? (
                <p className="text-xs text-muted-foreground">You recorded this request, so a different HR person reviews it.</p>
              ) : (
                <SmartForm
                  columns={3}
                  submitLabel="Record the review"
                  action={reviewReconsiderationAction.bind(null, r.id)}
                  fields={[
                    { name: "outcome", label: "Outcome", type: "select", required: true, options: [{ value: "FORWARD", label: "Forward to the decider" }, { value: "RETURN", label: "Return to the supervisor" }, { value: "DECLINE", label: "Decline" }] },
                    { name: "note", label: "Note (what you checked: the justification and the conditions)", type: "textarea", required: true, span: 2 },
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
          {r.status === "APPROVED" && manage && (
            <div className="mt-3 border-t pt-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Approved. Tell the employee, in person and in writing, the earlier decision, the extension, the new review date and the conditions above. {STATEMENT_WORDING_REVIEWED ? "" : "The written statement the system records is plain and factual; its wording has not yet been reviewed by a lawyer. "}
                Until you record that they were told, nothing changes.
              </p>
              <ActionButton action={communicateReconsiderationAction.bind(null, r.id)} confirm="Record that the employee has been formally told? The probation is extended from today, and this cannot be undone." variant="outline">
                Record that the employee was told: extend the probation
              </ActionButton>
            </div>
          )}
          {r.status === "EFFECTIVE" && (
            <div className="mt-3 border-t pt-2">
              <p className="text-xs text-muted-foreground">
                Told on {fmtDate(r.communicatedAt)} by {r.communicatedBy}; the probation now ends {fmtDate(r.newEndDate)}. The statement given:
              </p>
              <p className="mt-1 whitespace-pre-line">{r.statement}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {r.respondedAt ? `The employee ${r.responseAgreed ? "agreed" : "disagreed"} on ${fmtDate(r.respondedAt)}${r.responseText ? `: ${r.responseText}` : ""}` : "No response from the employee yet."}
              </p>
            </div>
          )}
          {r.status === "REQUESTED" && r.requestedByUserId === ctx.userId && (
            <div className="mt-3 border-t pt-3">
              <SmartForm columns={3} submitLabel="Withdraw" action={withdrawReconsiderationAction.bind(null, r.id)} fields={[{ name: "reason", label: "Why you are withdrawing it", required: true, span: 2 }]} />
            </div>
          )}
        </div>
      ))}
      {policy.reconsiderationEnabled && failed && noManager && manage && !open && rows.length < policy.reconsiderationMax && (
        <div className="rounded-md border p-3">
          <p className="mb-2 text-sm font-medium">Ask for a reconsideration (this employee has no reporting manager, so HR asks)</p>
          <SmartForm columns={3} submitLabel="Request the reconsideration" action={requestReconsiderationAction.bind(null, contractId)} fields={requestFields(policy.reconsiderationMinJustification)} />
        </div>
      )}
    </Section>
  );
}
