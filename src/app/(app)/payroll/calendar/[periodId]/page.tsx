import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { periodTracker } from "@/server/services/payroll-calendar";
import { INPUT_KIND_LABELS, INPUT_KINDS, type InputKind } from "@/lib/payroll-calendar";
import { fmtDate, iso } from "@/lib/dates";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { adjustCalendarAction, generateCalendarAction, markInputAction, raiseInputIssueAction, resolveInputIssueAction } from "@/app/actions/payroll-calendar";

const TONE = { DONE: "green", OVERDUE: "red", DUE_SOON: "amber", UPCOMING: "gray" } as const;
const WORDS = { DONE: "Done", OVERDUE: "Overdue", DUE_SOON: "Due soon", UPCOMING: "Upcoming" } as const;

export default async function PeriodTrackerPage({ params }: { params: Promise<{ periodId: string }> }) {
  const ctx = await requirePage("payroll.view");
  const { periodId } = await params;
  const t = await periodTracker(ctx, periodId).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!t) notFound();
  const canInputs = can(ctx.role, "payroll.inputs");
  const frozen = ["APPROVED", "LOCKED", "PAID", "CLOSED"].includes(t.period.status);
  const cutoff = t.dates?.inputCutoff;
  const late = (receivedAt: Date | null) => !!cutoff && !!receivedAt && iso(receivedAt) > cutoff;

  return (
    <>
      <PageHeader
        title={`Calendar and inputs — ${t.period.name}`}
        crumbs={[{ href: "/payroll/calendar", label: "Payroll calendar" }]}
        description={t.entry?.adjusted ? `Dates adjusted by ${t.entry.adjustedBy}: ${t.entry.adjustReason}` : undefined}
        actions={
          canInputs &&
          !t.entry && <ActionButton action={generateCalendarAction.bind(null, periodId)}>Generate this month&apos;s dates</ActionButton>
        }
      />

      {t.problems.length > 0 && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">{t.problems.join(" ")}</p>}

      {t.entry && (
        <Section title="Deadlines" flush>
          <Table>
            <THead>
              <TR>
                <TH>Deadline</TH>
                <TH>Date</TH>
                <TH>Where it stands</TH>
              </TR>
            </THead>
            <TBody>
              {t.milestones.map((m) => (
                <TR key={m.key}>
                  <TD>{m.label}</TD>
                  <TD>{fmtDate(m.due)}</TD>
                  <TD>
                    <Badge tone={TONE[m.state]}>{WORDS[m.state]}</Badge>{" "}
                    <span className="text-xs text-muted-foreground">{m.done ? "" : m.days < 0 ? `${-m.days} day(s) late` : m.days === 0 ? "today" : `in ${m.days} day(s)`}</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      {t.entry && (
        <Section title="Inputs from the client" description="Mark each one when it arrives. The count is what is already in the system for the month, to check against." flush>
          <Table>
            <THead>
              <TR>
                <TH>Input</TH>
                <TH>Status</TH>
                <TH>In the system</TH>
                <TH>Note</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {t.items.map((i) => {
                const overdue = i.status === "EXPECTED" && !!cutoff && cutoff < iso(new Date());
                return (
                  <TR key={i.id}>
                    <TD>{INPUT_KIND_LABELS[i.kind as InputKind] ?? i.kind}</TD>
                    <TD>
                      {i.status === "RECEIVED" ? <Badge tone={late(i.receivedAt) ? "amber" : "green"}>{late(i.receivedAt) ? "Received late" : "Received"}</Badge> : i.status === "NOT_APPLICABLE" ? <Badge>Not applicable</Badge> : <Badge tone={overdue ? "red" : "gray"}>{overdue ? "Overdue" : "Expected"}</Badge>}
                      {i.receivedAt && <span className="ml-1 text-xs text-muted-foreground">{fmtDate(i.receivedAt)}</span>}
                    </TD>
                    <TD className="text-xs">{i.evidence === null ? "—" : i.evidence}</TD>
                    <TD className="max-w-xs whitespace-normal text-xs">{i.note ? `${i.note}${i.markedBy ? ` (${i.markedBy})` : ""}` : "—"}</TD>
                    <TD>
                      {canInputs && !frozen && (
                        <span className="flex flex-wrap gap-1">
                          {i.status !== "RECEIVED" && (
                            <ActionButton action={markInputAction.bind(null, periodId, i.kind, "RECEIVED")} reason reasonPlaceholder="How it arrived, from whom" variant="outline">
                              Received
                            </ActionButton>
                          )}
                          {i.status !== "NOT_APPLICABLE" && (
                            <ActionButton action={markInputAction.bind(null, periodId, i.kind, "NOT_APPLICABLE")} reason reasonPlaceholder="Why it does not apply" variant="outline">
                              Not applicable
                            </ActionButton>
                          )}
                          {i.status !== "EXPECTED" && (
                            <ActionButton action={markInputAction.bind(null, periodId, i.kind, "EXPECTED", undefined)} variant="ghost">
                              Undo
                            </ActionButton>
                          )}
                        </span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Section>
      )}

      {t.entry && (
        <Section title="Missing or inconsistent items" description="A running log of what had to be chased or queried with the client, and how it was settled." flush>
          <Table>
            <THead>
              <TR>
                <TH>Raised</TH>
                <TH>Input</TH>
                <TH>What</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {t.issues.map((x) => (
                <TR key={x.id}>
                  <TD className="text-xs">
                    {fmtDate(x.createdAt)}
                    <br />
                    {x.raisedBy}
                  </TD>
                  <TD className="text-xs">{x.kind ? (INPUT_KIND_LABELS[x.kind as InputKind] ?? x.kind) : "General"}</TD>
                  <TD className="max-w-md whitespace-normal text-xs">{x.description}</TD>
                  <TD className="text-xs">{x.status === "RESOLVED" ? `Resolved by ${x.resolvedBy}: ${x.resolution}` : <Badge tone="amber">Open</Badge>}</TD>
                  <TD>
                    {canInputs && x.status === "OPEN" && (
                      <ActionButton action={resolveInputIssueAction.bind(null, x.id)} reason reasonPlaceholder="How it was settled" variant="outline">
                        Resolve
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!t.issues.length && <p className="px-4 py-4 text-sm text-muted-foreground">Nothing logged for this month.</p>}
        </Section>
      )}

      {t.entry && canInputs && !frozen && (
        <Section title="Log a missing or inconsistent item">
          <SmartForm
            columns={3}
            submitLabel="Log item"
            resetOnSuccess
            action={raiseInputIssueAction.bind(null, periodId)}
            fields={[
              { name: "kind", label: "Input", type: "select", options: [{ value: "", label: "General" }, ...INPUT_KINDS.map((k) => ({ value: k, label: INPUT_KIND_LABELS[k] }))] },
              { name: "description", label: "What is missing or inconsistent", type: "textarea", required: true, span: 2 },
            ]}
          />
        </Section>
      )}

      {t.entry && canInputs && (
        <Section title="Adjust this month's dates" description="For a public holiday or an agreed exception. The reason is kept with the dates.">
          <SmartForm
            columns={3}
            submitLabel="Save dates"
            action={adjustCalendarAction.bind(null, periodId)}
            fields={[
              { name: "inputCutoff", label: "Inputs due", type: "date", required: true, defaultValue: t.dates!.inputCutoff },
              { name: "draftDue", label: "Draft due", type: "date", required: true, defaultValue: t.dates!.draftDue },
              { name: "approvalDue", label: "Client approval due", type: "date", required: true, defaultValue: t.dates!.approvalDue },
              { name: "payDate", label: "Pay date", type: "date", required: true, defaultValue: t.dates!.payDate },
              { name: "remittanceDue", label: "Remittances due", type: "date", required: true, defaultValue: t.dates!.remittanceDue },
              { name: "reason", label: "Reason", required: true, placeholder: "e.g. Public holiday on the 20th; client agreed to the 22nd" },
            ]}
          />
        </Section>
      )}
      <p className="text-xs text-muted-foreground">
        <Link className="underline" href="/payroll/calendar">
          ← All months
        </Link>
      </p>
    </>
  );
}
