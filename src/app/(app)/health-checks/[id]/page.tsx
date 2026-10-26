import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { getHealthCheck } from "@/server/services/health-checks";
import { AREAS, AREA_LABELS, RESPONSES, RESPONSE_HELP, RESPONSE_LABELS, SEVERITIES, SEVERITY_LABELS, type Response, type Severity } from "@/lib/health-check";
import { fmtDate } from "@/lib/dates";
import { FormPanel, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addFindingAction, assessItemAction, deleteFindingAction, issueHealthCheckAction, sendBackAction, submitForReviewAction, updateHealthCheckAction, withdrawHealthCheckAction } from "@/app/actions/health-checks";
import { crmGate } from "../../crm/_gate";
import { CHECK_STATUS_LABEL, CHECK_STATUS_TONE, RESPONSE_TONE, SEVERITY_TONE } from "../_tone";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

export default async function HealthCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("healthcheck.view");
  const gate = await crmGate(ctx, "Health check");
  if (gate) return gate;
  const { id } = await params;
  const c = await getHealthCheck(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!c) notFound();
  const manage = can(ctx.role, "healthcheck.manage");
  const open = c.status === "IN_PROGRESS" && manage;
  const t = c.summary.totals;
  return (
    <>
      <PageHeader
        title={`${c.number}: ${c.lead.company}`}
        crumbs={[{ href: "/health-checks", label: "Health checks" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={CHECK_STATUS_TONE[c.status]}>{CHECK_STATUS_LABEL[c.status]}</Badge>
            <Link className="text-primary underline" href={c.lead ? `/crm/leads/${c.leadId}` : "#"}>
              {c.lead.number}
            </Link>
            assessed by {c.assessedBy}
            {c.reviewedBy && <span>, reviewed by {c.reviewedBy}</span>}
          </span>
        }
        actions={
          <a className={buttonVariants({ variant: "outline" })} href={`/api/health-checks/${c.id}/summary`}>
            {c.status === "ISSUED" ? "Download the one-page summary" : "Download a draft summary"}
          </a>
        }
      />

      <StatGrid cols={4}>
        <Stat label="Assessed" value={`${t.total - t.notAssessed} of ${t.total}`} tone={t.notAssessed ? "amber" : "green"} />
        <Stat label="Seen in place" value={t.inPlace} tone="green" />
        <Stat label="Seen in part / not seen" value={`${t.partly} / ${t.notSeen}`} tone={t.partly + t.notSeen ? "amber" : "green"} />
        <Stat label="Findings" value={c.findings.length} />
      </StatGrid>

      {c.reviewNote && c.status === "IN_PROGRESS" && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">Sent back by the reviewer: {c.reviewNote}</p>}
      {c.status === "WITHDRAWN" && <p className="rounded bg-muted px-3 py-2 text-sm text-muted-foreground">Withdrawn: {c.withdrawnReason}</p>}
      {c.headline && <p className="rounded border bg-card px-3 py-2 text-sm font-medium">{c.headline}</p>}

      {manage && c.status === "IN_PROGRESS" && (
        <Section title="Ready for review?">
          {c.blockers.length ? (
            <>
              <p className="mb-2 text-sm">Before it can go for review:</p>
              <ul className="list-disc pl-5 text-sm text-amber-800">
                {c.blockers.slice(0, 8).map((b) => (
                  <li key={b}>{b}</li>
                ))}
                {c.blockers.length > 8 && <li>and {c.blockers.length - 8} more.</li>}
              </ul>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>Every control is assessed and every gap has a finding.</span>
              <ActionButton action={submitForReviewAction.bind(null, c.id)} confirm="Send it to a second person to review? You can't change it while they have it.">
                Send for review
              </ActionButton>
            </div>
          )}
        </Section>
      )}

      {manage && c.status === "IN_REVIEW" && (
        <Section title="Review">
          {c.mine ? (
            <p className="text-sm text-muted-foreground">You carried out this check, so someone else has to review and issue it.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">Look through the answers and the findings below. Issuing freezes it for good.</p>
              <SmartForm
                columns={2}
                submitLabel="Issue it"
                resetOnSuccess={false}
                action={issueHealthCheckAction.bind(null, c.id)}
                fields={[
                  { name: "headline", label: "Overall observation (goes on the summary)", type: "textarea", span: 2, help: "What was seen and what was not. Don't promise or certify anything." },
                  { name: "reviewNote", label: "What you checked (internal)", span: 2 },
                ]}
              />
              <ActionButton action={sendBackAction.bind(null, c.id)} variant="outline" reason reasonPlaceholder="What needs another look?">
                Send back
              </ActionButton>
            </div>
          )}
        </Section>
      )}

      {open && (
        <FormPanel title="Scope of the review">
          <SmartForm
            columns={3}
            submitLabel="Save"
            resetOnSuccess={false}
            action={updateHealthCheckAction.bind(null, c.id)}
            fields={[
              { name: "title", label: "Title", required: true, defaultValue: c.title },
              { name: "periodReviewed", label: "Period reviewed", defaultValue: c.periodReviewed ?? undefined, placeholder: "e.g. July to September 2026" },
              { name: "employeesInScope", label: "Employees in scope", type: "number", min: 1, defaultValue: c.employeesInScope ?? undefined },
              { name: "conductedOn", label: "Review carried out on", type: "date", defaultValue: iso(c.conductedOn) },
              { name: "feeQuoted", label: "Fee agreed (₦, for your records)", type: "number", min: 0, defaultValue: c.feeQuoted ? Number(c.feeQuoted) : undefined, help: "Not part of the proposal tool; noted here only." },
              { name: "scopeNote", label: "What was and wasn't looked at", type: "textarea", span: 3, defaultValue: c.scopeNote ?? undefined },
            ]}
          />
        </FormPanel>
      )}

      {AREAS.map((area) => (
        <Section key={area} title={AREA_LABELS[area]} flush>
          <div className="divide-y">
            {c.items
              .filter((i) => i.area === area)
              .map((i) => (
                <div key={i.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="max-w-3xl text-sm">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">{i.code}</span>
                      {i.question}
                    </p>
                    <Badge tone={RESPONSE_TONE[i.response as Response]}>{RESPONSE_LABELS[i.response as Response]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Ask: {i.guidance}</p>
                  {(i.evidence || i.note) && (
                    <p className="mt-1 whitespace-pre-wrap text-xs">
                      {i.evidence && <span>Seen: {i.evidence} </span>}
                      {i.note && <span className="text-muted-foreground">Note: {i.note}</span>}
                    </p>
                  )}
                  {open && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-primary">Answer this control</summary>
                      <div className="mt-2">
                        <p className="mb-2 text-xs text-muted-foreground">{RESPONSES.filter((r) => r !== "NOT_ASSESSED").map((r) => `${RESPONSE_LABELS[r]}: ${RESPONSE_HELP[r]}`).join(" ")}</p>
                        <SmartForm
                          columns={3}
                          submitLabel="Save answer"
                          resetOnSuccess={false}
                          action={assessItemAction.bind(null, i.id)}
                          fields={[
                            { name: "response", label: "What you found", type: "select", required: true, options: RESPONSES.map((r) => ({ value: r, label: RESPONSE_LABELS[r] })), defaultValue: i.response },
                            { name: "evidence", label: "What you saw (the evidence)", type: "textarea", span: 2, defaultValue: i.evidence ?? undefined },
                            { name: "note", label: "Note (why it doesn't apply, or anything else)", span: 3, defaultValue: i.note ?? undefined },
                          ]}
                        />
                      </div>
                    </details>
                  )}
                </div>
              ))}
          </div>
        </Section>
      ))}

      <Section title={`Findings (${c.findings.length})`} flush>
        <Table>
          <THead>
            <TR>
              <TH>No.</TH>
              <TH>Severity</TH>
              <TH>About</TH>
              <TH>What was found</TH>
              <TH>What to do</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {c.summary.ordered.map((f) => {
              const row = c.findings.find((x) => x.number === f.number)!;
              return (
                <TR key={row.id}>
                  <TD className="font-mono text-xs">F{f.number}</TD>
                  <TD>
                    <Badge tone={SEVERITY_TONE[f.severity as Severity]}>{SEVERITY_LABELS[f.severity as Severity]}</Badge>
                  </TD>
                  <TD className="text-xs">
                    {f.itemCode ?? ""} {AREA_LABELS[f.area]}
                  </TD>
                  <TD className="whitespace-normal text-xs">
                    <b>{row.title}</b>
                    <p>{row.description}</p>
                  </TD>
                  <TD className="whitespace-normal text-xs">{row.recommendation}</TD>
                  <TD>
                    {open && (
                      <ActionButton action={deleteFindingAction.bind(null, row.id)} variant="outline" confirm="Remove this finding?">
                        Remove
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {!c.findings.length && <p className="px-4 py-4 text-sm text-muted-foreground">No findings recorded.</p>}
      </Section>

      {open && (
        <FormPanel title="Record a finding">
          <p className="mb-3 text-xs text-muted-foreground">Every control seen only in part or not seen needs at least one finding against it. Say what to do, never promise a result.</p>
          <SmartForm
            columns={3}
            submitLabel="Record finding"
            resetOnSuccess
            action={addFindingAction.bind(null, c.id)}
            fields={[
              { name: "itemCode", label: "Control", type: "select", options: [{ value: "", label: "Not about one control" }, ...c.items.map((i) => ({ value: i.code, label: `${i.code}: ${i.question.slice(0, 60)}${i.question.length > 60 ? "…" : ""}` }))] },
              { name: "area", label: "Area (if not about a control)", type: "select", options: [{ value: "", label: "—" }, ...AREAS.map((a) => ({ value: a, label: AREA_LABELS[a] }))] },
              { name: "severity", label: "Severity", type: "select", required: true, options: SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABELS[s] })), defaultValue: "MEDIUM" },
              { name: "title", label: "Title", required: true, span: 3 },
              { name: "description", label: "What was found", type: "textarea", required: true, span: 3 },
              { name: "recommendation", label: "What to do about it", type: "textarea", required: true, span: 3 },
            ]}
          />
        </FormPanel>
      )}

      {manage && (c.status === "IN_PROGRESS" || c.status === "IN_REVIEW") && (
        <Section title="Withdraw">
          <ActionButton action={withdrawHealthCheckAction.bind(null, c.id)} variant="outline" reason reasonPlaceholder="Why is it being withdrawn?">
            Withdraw this health check
          </ActionButton>
        </Section>
      )}
      {c.issuedAt && <p className="text-xs text-muted-foreground">Issued on {fmtDate(c.issuedAt)}. It can no longer be changed.</p>}
    </>
  );
}
