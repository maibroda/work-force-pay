import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { SESSION_STATUS_LABELS, type SessionStatus } from "@/lib/training-plan";
import { listProgrammes, listSessions } from "@/server/services/training-plan";
import { d, fmtDate, iso } from "@/lib/dates";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addProgrammeAction, scheduleSessionAction, setProgrammeActiveAction } from "@/app/actions/training-plan";

const TONE: Record<SessionStatus, "blue" | "green" | "gray"> = { SCHEDULED: "blue", COMPLETED: "green", CANCELLED: "gray" };

/** The month before and after a "YYYY-MM". */
function shift(month: string, by: number) {
  const x = d(`${month}-01`);
  return iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + by, 1))).slice(0, 7);
}

export default async function TrainingCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : iso(new Date()).slice(0, 7);
  const manage = can(ctx.role, "hr.manage");
  const [sessions, programmes] = await Promise.all([listSessions(ctx, { month }), listProgrammes(ctx)]);
  const title = d(`${month}-01`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <PageHeader
        title="Training calendar"
        description="The courses the company runs and when. Schedule a session with seats, enrol people, and record who attended: attending creates the person's certificate record, so the compliance view updates on its own. Seats are a hard limit."
      />
      {manage && (
        <div className="grid gap-5 lg:grid-cols-2">
          <FormPanel title="Add a programme (a course you run)">
            <SmartForm
              columns={2}
              submitLabel="Add programme"
              action={addProgrammeAction}
              fields={[
                { name: "name", label: "Course name (the name a certificate carries; it must match a required course to count for it)", required: true, span: 2 },
                { name: "provider", label: "Provider (optional)" },
                { name: "validityMonths", label: "Certificate valid for (months; blank = does not expire)", type: "number", min: 1, max: 120 },
              ]}
            />
          </FormPanel>
          <FormPanel title="Schedule a session">
            <SmartForm
              columns={2}
              submitLabel="Schedule"
              action={scheduleSessionAction}
              fields={[
                { name: "programmeId", label: "Programme", type: "select", required: true, options: programmes.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name })) },
                { name: "sessionDate", label: "Date", type: "date", required: true },
                { name: "startTime", label: "Start time (e.g. 09:30)" },
                { name: "seats", label: "Seats", type: "number", required: true, min: 1, max: 500 },
                { name: "venue", label: "Venue" },
                { name: "trainer", label: "Trainer" },
              ]}
            />
          </FormPanel>
        </div>
      )}

      <Section
        title={title}
        description="Sessions this month, with seats taken."
        actions={
          <span className="flex items-center gap-2 text-sm">
            <Link className="text-primary hover:underline" href={`/hr/training-calendar?month=${shift(month, -1)}`}>
              ← Previous
            </Link>
            <Link className="text-primary hover:underline" href="/hr/training-calendar">
              This month
            </Link>
            <Link className="text-primary hover:underline" href={`/hr/training-calendar?month=${shift(month, 1)}`}>
              Next →
            </Link>
          </span>
        }
        flush
      >
        {sessions.length === 0 ? (
          <Empty>No sessions this month.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Course</TH>
                <TH>Venue and trainer</TH>
                <TH>Seats</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {sessions.map((s) => (
                <TR key={s.id}>
                  <TD className="text-xs">
                    {fmtDate(s.sessionDate)}
                    {s.startTime && <div className="text-muted-foreground">{s.startTime}</div>}
                  </TD>
                  <TD>
                    <Link className="font-medium text-primary hover:underline" href={`/hr/training-calendar/${s.id}`}>
                      {s.programme.name}
                    </Link>
                  </TD>
                  <TD className="text-xs">{[s.venue, s.trainer].filter(Boolean).join(" · ") || "—"}</TD>
                  <TD className="text-xs">
                    {s.taken} of {s.seats} {s.seatsLeft === 0 && s.status === "SCHEDULED" ? <Badge tone="amber">full</Badge> : null}
                  </TD>
                  <TD>
                    <Badge tone={TONE[s.status as SessionStatus]}>{SESSION_STATUS_LABELS[s.status as SessionStatus]}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section title="Programmes" description="A programme's name is never changed: it is the course name a certificate carries." flush>
        {programmes.length === 0 ? (
          <Empty>No programmes yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Course</TH>
                <TH>Provider</TH>
                <TH>Certificate valid for</TH>
                <TH>In use</TH>
              </TR>
            </THead>
            <TBody>
              {programmes.map((p) => (
                <TR key={p.id} className={p.active ? "" : "opacity-60"}>
                  <TD>{p.name}</TD>
                  <TD className="text-xs">{p.provider ?? "—"}</TD>
                  <TD className="text-xs">{p.validityMonths ? `${p.validityMonths} months` : "Does not expire"}</TD>
                  <TD>
                    {manage ? (
                      <ActionButton action={setProgrammeActiveAction.bind(null, p.id, !p.active)} variant="outline">
                        {p.active ? "Switch off" : "Switch on"}
                      </ActionButton>
                    ) : p.active ? (
                      "Yes"
                    ) : (
                      "No"
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
