import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { SESSION_STATUS_LABELS, type SessionStatus } from "@/lib/training-plan";
import { getSession } from "@/server/services/training-plan";
import { BusinessError } from "@/server/services/_base";
import { fmtDate, iso } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
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
