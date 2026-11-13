import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getContract, probationHistory } from "@/server/services/contracts";
import { db } from "@/lib/db";
import { AGAINST_REASON_MIN } from "@/lib/probation";
import { probationAppraisalFor } from "@/server/services/appraisals";
import { getHrPolicy } from "@/server/services/hr-policy";
import { RECOMMENDATION_LABELS } from "@/lib/appraisal";
import { num } from "@/lib/money";
import { ActionButton } from "@/components/action-button";
import { enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FormPanel, KV, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ProbationReviews } from "@/components/probation-reviews";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { decideProbationAction, markProbationInformedAction, renewContractAction } from "@/app/actions/hr-lifecycle";
import { generateLetterAction } from "@/app/actions/letters";
import { startProbationAppraisalAction } from "@/app/actions/appraisals";

const TYPES = ["PERMANENT", "FIXED_TERM", "PROBATION", "CASUAL", "CONSULTANT", "INTERNSHIP"];

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("hr.view");
  const { id } = await params;
  const c = await getContract(ctx, id);
  if (!c) notFound();
  const manage = can(ctx.role, "hr.manage");
  const approve = can(ctx.role, "hr.approve");
  const active = c.status === "ACTIVE";
  const reviewing = active && (c.probationOutcome === "PENDING" || c.probationOutcome === "EXTENDED");
  const [pa, policy] = reviewing ? await Promise.all([probationAppraisalFor(ctx.orgId, c), getHrPolicy(ctx.orgId)]) : [null, null];
  const paOpen = pa && (pa.status === "DRAFT" || pa.status === "SUBMITTED");
  // the decisions made about this probation, what the signed-off appraisal recommends, and whether a failed probation has had an exit started
  const history = await probationHistory(ctx, c.id);
  // with the probation workflow on, the decision goes through recommendation, HR review and an independent decider (the review panel below), never the direct forms
  const workflowOn = (await getHrPolicy(ctx.orgId)).probationWorkflow;
  const recommendation = pa && (pa.status === "APPROVED" || pa.status === "ACKNOWLEDGED") && pa.recommendation !== "NONE" ? pa.recommendation : null;
  const exitStarted = c.probationOutcome === "FAILED" ? (await db.exitRecord.count({ where: { organizationId: ctx.orgId, employeeId: c.employeeId, status: { in: ["PENDING", "APPROVED", "PROCESSED"] } } })) > 0 : true;
  return (
    <>
      <PageHeader
        title={`${c.contractNumber} — ${c.jobTitle}`}
        crumbs={[{ href: "/hr/contracts", label: "Contracts" }]}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={c.status} /> {c.type.replace(/_/g, " ").toLowerCase()} ·{" "}
            <Link className="text-primary underline" href={`/employees/${c.employeeId}`}>
              {c.employee.employeeNumber} — {fullName(c.employee)}
            </Link>
          </span>
        }
      />
      <Section title="Terms">
        <KV
          cols={4}
          items={[
            ["Start date", fmtDate(c.startDate)],
            ["End date", c.endDate ? fmtDate(c.endDate) : "Open-ended"],
            ["Notice period", `${c.noticePeriodDays} days`],
            ["Signed", c.signedDate ? fmtDate(c.signedDate) : "Not recorded"],
            ["Probation", c.probationMonths ? `${c.probationMonths} month(s), ends ${fmtDate(c.probationEndDate)}` : "None"],
            ["Probation outcome", c.probationOutcome ? <StatusBadge key="p" status={c.probationOutcome} /> : "—"],
            ["Extensions", c.probationExtensions],
            ["Document", c.documentReference],
            ["Previous contract", c.previousContract ? <Link key="pc" className="text-primary underline" href={`/hr/contracts/${c.previousContract.id}`}>{c.previousContract.contractNumber}</Link> : "—"],
            ["Renewed as", c.renewals.length ? c.renewals.map((r) => <Link key={r.id} className="mr-2 text-primary underline" href={`/hr/contracts/${r.id}`}>{r.contractNumber}</Link>) : "—"],
            ["Terminated", c.terminatedAt ? `${fmtDate(c.terminatedAt)} — ${c.terminationReason ?? ""}` : "—"],
            ["Created by", `${c.createdBy} · ${fmtDate(c.createdAt)}`],
            ["Notes", <span key="n" className="whitespace-pre-line">{c.notes ?? "—"}</span>],
          ]}
        />
      </Section>

      {c.probationOutcome === "FAILED" && active && !exitStarted && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>Probation not confirmed, and no exit has been started.</b> The employee stays on the payroll until one is. What follows (notice, pay, any rule in the contract) is for HR and your adviser to decide; nothing happens automatically.{" "}
          <Link className="font-medium underline" href={`/employees/${c.employeeId}?tab=lifecycle`}>
            Start the exit process
          </Link>
        </p>
      )}
      {c.probationOutcome === "CONFIRMED" && manage && (
        <div className="mb-4">
          <ActionButton action={generateLetterAction.bind(null, { type: "PROBATION_CONFIRMATION", employeeId: c.employeeId })} confirm="Generate the probation confirmation letter?" variant="outline">
            Generate the confirmation letter
          </ActionButton>
        </div>
      )}
      {history.length > 0 && (
        <Section title="Probation decisions" description="Each decision, who made it and why, with the probation appraisal that supported it. A decision is never edited; a later one is added." flush>
          <ul className="divide-y text-sm">
            {history.map((x) => (
              <li key={x.id} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={x.decision} />
                  <span>
                    {x.decidedBy}, {fmtDate(x.decidedAt)}
                  </span>
                  {x.extensionMonths ? <span className="text-xs text-muted-foreground">extended by {x.extensionMonths} month(s) to {fmtDate(x.effectiveDate)}</span> : null}
                  {x.decision === "CONFIRMED" && x.effectiveDate ? <span className="text-xs text-muted-foreground">permanent from {fmtDate(x.effectiveDate)}</span> : null}
                  {x.againstRecommendation && <Badge tone="amber">against the appraisal&apos;s recommendation</Badge>}
                </div>
                {x.note && <p className="whitespace-pre-line text-sm">{x.note}</p>}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {x.appraisalId ? (
                    <Link className="text-primary underline" href={`/hr/appraisals/${x.appraisalId}`}>
                      Probation appraisal{x.appraisalScore != null ? ` ${(x.appraisalScore / 100).toFixed(2)}` : ""}
                      {x.appraisalRecommendation && x.appraisalRecommendation !== "NONE" ? ` · recommended: ${RECOMMENDATION_LABELS[x.appraisalRecommendation]}` : ""}
                    </Link>
                  ) : (
                    <span>No probation appraisal behind this decision</span>
                  )}
                  {x.informedAt ? (
                    <span>Employee told {fmtDate(x.informedAt)} by {x.informedBy}</span>
                  ) : manage ? (
                    <ActionButton action={markProbationInformedAction.bind(null, x.id)} confirm="Record that the employee has been told? They will then see one line about this decision." variant="outline">
                      Mark the employee as told
                    </ActionButton>
                  ) : (
                    <span>Employee not yet told</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {reviewing && can(ctx.role, "appraisal.view") && (
        <Section
          title="Probation appraisal"
          description={
            policy?.probationRequiresAppraisal
              ? `Policy: probation can be confirmed only after a signed-off probation appraisal${num(policy.probationMinScore) > 0 ? ` scoring at least ${num(policy.probationMinScore).toFixed(2)}` : ""}. Extending or failing isn't blocked.`
              : "A structured review of how the employee performed in probation — optional, but it gives the decision some evidence."
          }
        >
          {pa ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link className="text-primary underline" href={`/hr/appraisals/${pa.id}`}>
                {pa.cycle.name}
              </Link>
              <StatusBadge status={pa.status} />
              {pa.overallScore != null && (
                <span>
                  {num(pa.overallScore).toFixed(2)} — {pa.overallBand}
                  {pa.recommendation !== "NONE" && <> · recommends: {RECOMMENDATION_LABELS[pa.recommendation]}</>}
                </span>
              )}
              {!paOpen && can(ctx.role, "appraisal.manage") && (
                <ActionButton action={startProbationAppraisalAction.bind(null, c.id)} confirm="Start another probation appraisal?" variant="outline">
                  Start another
                </ActionButton>
              )}
            </div>
          ) : can(ctx.role, "appraisal.manage") ? (
            <ActionButton action={startProbationAppraisalAction.bind(null, c.id)} confirm="Start a probation appraisal for this employee?">
              Start a probation appraisal
            </ActionButton>
          ) : (
            <p className="text-sm text-muted-foreground">No probation appraisal has been started.</p>
          )}
        </Section>
      )}

      {workflowOn && c.probationOutcome && <ProbationReviews ctx={ctx} contractId={c.id} />}

      {approve && reviewing && !workflowOn && recommendation && (
        <p className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          The signed-off probation appraisal recommends: <b>{RECOMMENDATION_LABELS[recommendation]}</b>. You may decide otherwise, but a decision against it needs a fuller reason (at least {AGAINST_REASON_MIN} characters) and is marked on the record. Whoever reviewed or signed off that appraisal cannot make the decision.
        </p>
      )}
      {approve && reviewing && !workflowOn && (
        <div className="grid gap-5 lg:grid-cols-3">
          <FormPanel title="Confirm probation" open>
            <SmartForm
              columns={1}
              submitLabel="Confirm"
              action={decideProbationAction.bind(null, c.id)}
              fields={[
                { name: "decision", label: "", type: "hidden", defaultValue: "CONFIRMED" },
                ...(c.type === "PROBATION"
                  ? [
                      { name: "effectiveDate", label: "Permanent from", type: "date" as const, help: "Blank = the day after probation ends." },
                      { name: "noticePeriodDays", label: "Notice period after confirmation (days)", type: "number" as const, min: 0 },
                    ]
                  : []),
                { name: "note", label: "Note", type: "textarea" },
              ]}
            />
          </FormPanel>
          <FormPanel title="Extend probation">
            <SmartForm
              columns={1}
              submitLabel="Extend"
              action={decideProbationAction.bind(null, c.id)}
              fields={[
                { name: "decision", label: "", type: "hidden", defaultValue: "EXTENDED" },
                { name: "extensionMonths", label: "Extend by (months)", type: "number", required: true, min: 1, max: 12 },
                { name: "note", label: "Reason", type: "textarea", required: true },
              ]}
            />
          </FormPanel>
          <FormPanel title="Fail probation">
            <SmartForm
              columns={1}
              submitLabel="Mark as failed"
              action={decideProbationAction.bind(null, c.id)}
              fields={[
                { name: "decision", label: "", type: "hidden", defaultValue: "FAILED" },
                { name: "note", label: "Reason", type: "textarea", required: true },
              ]}
            />
          </FormPanel>
        </div>
      )}

      {manage && active && (
        <FormPanel title="Renew, extend or convert this contract">
          <p className="mb-3 text-xs text-muted-foreground">
            Creates the next contract in the chain and supersedes this one. Leave the start date blank to start the day after this contract ends.
          </p>
          <SmartForm
            columns={3}
            submitLabel="Renew"
            action={renewContractAction.bind(null, c.id)}
            fields={[
              { name: "type", label: "Type", type: "select", options: enumOptions(TYPES), defaultValue: c.type === "PROBATION" ? "PERMANENT" : c.type },
              { name: "jobTitle", label: "Job title", defaultValue: c.jobTitle },
              { name: "startDate", label: "Start date", type: "date" },
              { name: "endDate", label: "End date", type: "date", help: "Blank for permanent." },
              { name: "noticePeriodDays", label: "Notice period (days)", type: "number", min: 0, defaultValue: c.noticePeriodDays },
              { name: "signedDate", label: "Signed on", type: "date" },
              { name: "documentReference", label: "Document reference", span: 2 },
              { name: "notes", label: "Notes", type: "textarea", span: 3 },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
