import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { SESSION_STATUS_LABELS, type SessionStatus } from "@/lib/training-plan";
import { getSession } from "@/server/services/training-plan";
import { sessionCosts } from "@/server/services/training-cost";
import { BusinessError } from "@/server/services/_base";
import { fmtDate, iso } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveCostAction, declineCostAction, recordCostAction, reverseCostAction } from "@/app/actions/training-cost";
import { naira } from "@/lib/money";
import { attendedAction, cancelSessionAction, completeSessionAction, enrolByNumberAction, notAttendedAction, unenrolAction } from "@/app/actions/training-plan";

const RESULT_TONE = { ENROLLED: "gray", ATTENDED: "green", ABSENT: "amber" } as const;
const RESULT_LABEL = { ENROLLED: "Enrolled", ATTENDED: "Attended", ABSENT: "Did not attend" } as const;

export default async function TrainingSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("hr.view");
  const { id } = await params;
  const s = await getSession(ctx, id).catch((e) => {
    if (e instanceof BusinessError) return null;
    throw e;
  });
  if (!s) notFound();
  const manage = can(ctx.role, "hr.manage");
  const approve = can(ctx.role, "hr.approve");
  const costs = manage ? await sessionCosts(ctx, id) : null;
  const status = s.status as SessionStatus;
  const open = status === "SCHEDULED";
  const started = iso(s.sessionDate) <= iso(new Date()); // attendance can be recorded from the day of the session
  return (
    <>
      <PageHeader
        title={`${s.programme.name} — ${fmtDate(s.sessionDate)}`}
        crumbs={[{ href: "/hr/training-calendar", label: "Training calendar" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status === "SCHEDULED" ? "blue" : status === "COMPLETED" ? "green" : "gray"}>{SESSION_STATUS_LABELS[status]}</Badge>
            {s.taken} of {s.seats} seats taken
          </span>
        }
      />
      <div className="mb-5">
        <KV
          cols={4}
          items={[
            ["Date", `${fmtDate(s.sessionDate)}${s.startTime ? ` at ${s.startTime}` : ""}`],
            ["Venue", s.venue ?? "—"],
            ["Trainer", s.trainer ?? "—"],
            ["Certificate", s.programme.validityMonths ? `valid ${s.programme.validityMonths} months` : "does not expire"],
          ]}
        />
      </div>
      {status === "CANCELLED" && (
        <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <b>Cancelled</b> {s.cancelledAt ? fmtDate(s.cancelledAt) : ""}: {s.cancelledReason}
        </p>
      )}

      <Section title="Enrolled" description="Marking someone Attended creates their certificate record (the session date, valid for the programme's months), so the compliance view updates. A mistake can be corrected: it revokes only the record the attendance created." flush>
        {s.enrolments.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nobody is enrolled yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Result</TH>
                {manage && <TH>Actions</TH>}
              </TR>
            </THead>
            <TBody>
              {s.enrolments.map((e) => (
                <TR key={e.id}>
                  <TD>
                    {fullName(e.employee)}
                    <div className="text-xs text-muted-foreground">{e.employee.employeeNumber}</div>
                  </TD>
                  <TD>
                    <Badge tone={RESULT_TONE[e.status]}>{RESULT_LABEL[e.status]}</Badge>
                    {e.absenceReason && <div className="mt-1 text-xs text-muted-foreground">{e.absenceReason}</div>}
                  </TD>
                  {manage && (
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {status !== "CANCELLED" && started && e.status !== "ATTENDED" && (
                          <ActionButton action={attendedAction.bind(null, e.id)} variant="success">
                            Attended
                          </ActionButton>
                        )}
                        {status !== "CANCELLED" && started && e.status !== "ABSENT" && (
                          <ActionButton action={notAttendedAction.bind(null, e.id)} reason reasonPlaceholder="Why did they not attend? (required)" variant="outline">
                            Did not attend
                          </ActionButton>
                        )}
                        {e.status === "ENROLLED" && (
                          <ActionButton action={unenrolAction.bind(null, e.id)} confirm="Take this person off the session?" variant="outline">
                            Take off
                          </ActionButton>
                        )}
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {costs && (
        <Section
          title="What this session cost"
          description="A record kept by HR: nothing is posted to the accounts and no payment is made. Only approved lines count in the spend. A mistake is corrected by a reversing line, never by editing. Wages are not a training cost."
        >
          {costs.lines.length === 0 ? (
            <p className="mb-3 text-sm text-muted-foreground">No cost recorded yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Kind</TH>
                  <TH>Amount</TH>
                  <TH>What</TH>
                  <TH>Recorded by</TH>
                  <TH>Status</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {costs.lines.map((l) => (
                  <TR key={l.id}>
                    <TD>{l.kind.toLowerCase()}</TD>
                    <TD className={Number(l.amount) < 0 ? "text-red-700" : ""}>{naira(Number(l.amount))}</TD>
                    <TD className="max-w-xs whitespace-normal text-xs">
                      {l.description}
                      {l.invoiceReference ? <span className="block text-muted-foreground">Invoice {l.invoiceReference}</span> : null}
                    </TD>
                    <TD className="text-xs">{l.recordedBy}</TD>
                    <TD>
                      <Badge tone={l.status === "APPROVED" ? "green" : l.status === "PENDING" ? "amber" : "gray"}>{l.status.toLowerCase()}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {l.status === "PENDING" && approve && (
                        <span className="flex gap-1">
                          <ActionButton action={approveCostAction.bind(null, l.id)} variant="success">
                            Approve
                          </ActionButton>
                          <ActionButton action={declineCostAction.bind(null, l.id)} reason reasonPlaceholder="Why decline? (required)" variant="outline">
                            Decline
                          </ActionButton>
                        </span>
                      )}
                      {l.status === "APPROVED" && !l.reversesId && (
                        <ActionButton action={reverseCostAction.bind(null, l.id)} reason reasonPlaceholder="Why reverse it? (required)" variant="outline">
                          Reverse
                        </ActionButton>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <p className="my-3 text-sm">
            Counted: <b>{naira(Number(costs.approvedTotal))}</b>
            {Number(costs.pendingTotal) !== 0 && <span className="text-amber-700"> · waiting for a second person: {naira(Number(costs.pendingTotal))}</span>}
          </p>
          <SmartForm
            columns={2}
            submitLabel="Record the cost"
            action={recordCostAction.bind(null, s.id)}
            fields={[
              { name: "kind", label: "Kind", type: "select", required: true, options: [{ value: "FEE", label: "Fee" }, { value: "TRAVEL", label: "Travel" }, { value: "MATERIALS", label: "Materials" }, { value: "VENUE", label: "Venue" }, { value: "OTHER", label: "Other" }] },
              { name: "amount", label: "Amount in naira", type: "text", required: true, placeholder: "e.g. 125000.50", help: "Up to two decimals. Above the company's threshold a second person must approve it." },
              { name: "description", label: "What it was for", required: true, span: 2 },
              { name: "invoiceReference", label: "Invoice reference (optional)" },
            ]}
          />
        </Section>
      )}

      {manage && open && s.seatsLeft > 0 && (
        <Section title="Enrol someone">
          <SmartForm columns={2} submitLabel="Enrol" action={enrolByNumberAction.bind(null, s.id)} fields={[{ name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" }]} />
        </Section>
      )}
      {manage && open && s.seatsLeft === 0 && <p className="mb-4 text-sm text-muted-foreground">This session is full. Take someone off to free a seat.</p>}

      {manage && open && (
        <Section title="Actions">
          <div className="flex flex-wrap gap-2">
            {started && (
              <ActionButton action={completeSessionAction.bind(null, s.id)} confirm="Complete this session? Everyone enrolled must have been marked first." variant="success">
                Complete the session
              </ActionButton>
            )}
            <ActionButton action={cancelSessionAction.bind(null, s.id)} reason reasonPlaceholder="Why is it cancelled? (required)" variant="outline">
              Cancel the session
            </ActionButton>
          </div>
        </Section>
      )}
    </>
  );
}
