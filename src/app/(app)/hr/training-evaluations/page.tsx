import { requirePage } from "@/lib/auth/session";
import { listManagerEvaluations, evaluationsDue, programmeResults } from "@/server/services/training-evaluation";
import { MIN_GROUP } from "@/lib/welfare";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { Empty, PageHeader, Section } from "@/components/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function TrainingEvaluationsPage() {
  const ctx = await requirePage("hr.view");
  const [results, managerRows, due] = await Promise.all([programmeResults(ctx), listManagerEvaluations(ctx), evaluationsDue(ctx)]);
  const shownCount = (c: number | null) => (c === null ? `fewer than ${MIN_GROUP}` : c);
  return (
    <>
      <PageHeader
        title="Training evaluation"
        description={`Whether a course was useful and whether it was applied. It is about the course, not a score on the person: it changes no pay, status, certificate or appraisal. A participant's answer is confidential: it is shown here only once ${MIN_GROUP} people have answered, as a count, an average and unnamed comments. A manager's evaluation is by name and is read by the employee too.`}
      />
      <Section title="Results by course" flush>
        {results.length === 0 ? (
          <Empty>No programmes yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Course</TH>
                <TH>Participants who answered</TH>
                <TH>Average (1 to 5)</TH>
                <TH>Managers who answered</TH>
                <TH>Average (1 to 5)</TH>
              </TR>
            </THead>
            <TBody>
              {results.map((r) => (
                <TR key={r.programmeId}>
                  <TD className="font-medium">{r.name}</TD>
                  <TD>{shownCount(r.participant.count)}</TD>
                  <TD>{r.participant.average ?? "—"}</TD>
                  <TD>{shownCount(r.manager.count)}</TD>
                  <TD>{r.manager.average ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
      {results
        .filter((r) => r.comments && r.comments.length)
        .map((r) => (
          <Section key={r.programmeId} title={`Participants' comments: ${r.name}`} description="Unnamed, in alphabetical order.">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {r.comments!.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </Section>
        ))}
      <Section title="Evaluations a manager has not yet given" description="Courses attended long enough ago that the manager has been asked whether it was applied on the job." flush>
        {due.length === 0 ? (
          <Empty>None are waiting.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Course</TH>
                <TH>Attended</TH>
              </TR>
            </THead>
            <TBody>
              {due.map((d) => (
                <TR key={d.enrolmentId}>
                  <TD>
                    {fullName(d.employee)}
                    <div className="text-xs text-muted-foreground">{d.employee.employeeNumber}</div>
                  </TD>
                  <TD>{d.programmeName}</TD>
                  <TD className="text-xs">{fmtDate(d.sessionDate)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
      <Section title="Managers' evaluations, by name" flush>
        {managerRows.length === 0 ? (
          <Empty>No manager has given an evaluation yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Course</TH>
                <TH>Rating</TH>
                <TH>Comment</TH>
                <TH>By</TH>
              </TR>
            </THead>
            <TBody>
              {managerRows.map((m) => (
                <TR key={m.id}>
                  <TD>
                    {fullName(m.employee)}
                    <div className="text-xs text-muted-foreground">{m.employee.employeeNumber}</div>
                  </TD>
                  <TD>
                    {m.programmeName}
                    <div className="text-xs text-muted-foreground">{fmtDate(m.sessionDate)}</div>
                  </TD>
                  <TD>{m.rating}</TD>
                  <TD className="max-w-md whitespace-normal text-sm">{m.comment ?? "—"}</TD>
                  <TD className="text-xs">{m.byName}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
