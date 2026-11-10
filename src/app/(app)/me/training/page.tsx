import { requirePage } from "@/lib/auth/session";
import { myRequiredTraining, myTraining } from "@/server/services/training-plan";
import { evaluationsToGive, myTrainingEvaluations } from "@/server/services/training-evaluation";
import { STATE_LABELS } from "@/lib/training-compliance";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { evaluateParticipantAction } from "@/app/actions/training-evaluation";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function MyTrainingPage() {
  const ctx = await requirePage();
  const [t, required, toGive, aboutMe] = await Promise.all([myTraining(ctx), myRequiredTraining(ctx), evaluationsToGive(ctx), myTrainingEvaluations(ctx)]);
  const tone = (state: string) => (state === "VALID" ? "green" : state === "EXPIRING" || state === "GRACE" ? "amber" : "red");
  return (
    <>
      <PageHeader title="My training" description="The training sessions you are enrolled in, the courses you have attended, and the courses the company requires of your role. Your certificates are kept by HR." />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <>
          <Section title="What you are required to hold" description="The courses the company requires of your role, and where each stands on your record. If one is missing or expiring, tell your manager so they can ask for it." flush>
            {required.length === 0 ? (
              <Empty>The company has set no required course for your role.</Empty>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Course</TH>
                    <TH>Where it stands</TH>
                    <TH>Date</TH>
                  </TR>
                </THead>
                <TBody>
                  {required.map((r) => (
                    <TR key={r.courseName}>
                      <TD className="font-medium">{r.courseName}</TD>
                      <TD>
                        <Badge tone={tone(r.state)}>{STATE_LABELS[r.state]}</Badge>
                      </TD>
                      <TD className="text-xs">{r.state === "GRACE" && r.dueBy ? `Due by ${fmtDate(r.dueBy)}` : r.expires ? `Valid until ${fmtDate(r.expires)}` : r.state === "VALID" ? "Does not expire" : "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>
          <Section title="Coming up" flush>
            {t.upcoming.length === 0 ? (
              <Empty>You are not enrolled in any coming session.</Empty>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Course</TH>
                    <TH>Date</TH>
                    <TH>Where</TH>
                  </TR>
                </THead>
                <TBody>
                  {t.upcoming.map((u) => (
                    <TR key={u.sessionId}>
                      <TD className="font-medium">{u.programmeName}</TD>
                      <TD className="text-xs">
                        {fmtDate(u.sessionDate)}
                        {u.startTime ? ` at ${u.startTime}` : ""}
                      </TD>
                      <TD className="text-xs">{u.venue ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>
          <Section title="Courses you have attended" flush>
            {t.attended.length === 0 ? (
              <Empty>No attended courses recorded yet.</Empty>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Course</TH>
                    <TH>Attended</TH>
                    <TH>Certificate valid until</TH>
                  </TR>
                </THead>
                <TBody>
                  {t.attended.map((a, i) => (
                    <TR key={`${a.programmeName}-${i}`}>
                      <TD className="font-medium">{a.programmeName}</TD>
                      <TD className="text-xs">{fmtDate(a.sessionDate)}</TD>
                      <TD className="text-xs">{a.certificateExpires ? fmtDate(a.certificateExpires) : "Does not expire"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Section>
          {toGive.length > 0 && (
            <Section title="How did it go?" description="Optional. Was the course useful for your work? Your answer is confidential: HR sees results only once five people have answered, as an average and unnamed comments, and it changes nothing about you.">
              <div className="space-y-4">
                {toGive.map((g) => (
                  <div key={g.enrolmentId} className="rounded border p-3">
                    <p className="text-sm font-medium">
                      {g.programmeName}, attended {fmtDate(g.sessionDate)}
                    </p>
                    <div className="mt-2">
                      <SmartForm
                        columns={2}
                        submitLabel="Send my answer"
                        action={evaluateParticipantAction.bind(null, g.enrolmentId)}
                        fields={[
                          { name: "rating", label: "Useful for my work?", type: "select", required: true, options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n}${n === 5 ? " (very useful)" : n === 1 ? " (not useful)" : ""}` })) },
                          { name: "comment", label: "A line about it (optional, up to 300 characters)" },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {aboutMe.length > 0 && (
            <Section title="Your manager's evaluations of your training" description="Whether a course was applied on the job. You can read everything recorded about you." flush>
              <Table>
                <THead>
                  <TR>
                    <TH>Course</TH>
                    <TH>Rating (1 to 5)</TH>
                    <TH>Comment</TH>
                    <TH>From</TH>
                  </TR>
                </THead>
                <TBody>
                  {aboutMe.map((a, i) => (
                    <TR key={`${a.programmeName}-${i}`}>
                      <TD className="font-medium">{a.programmeName}</TD>
                      <TD>{a.rating}</TD>
                      <TD className="max-w-md whitespace-normal text-sm">{a.comment ?? "—"}</TD>
                      <TD className="text-xs">{a.byName}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Section>
          )}
        </>
      )}
    </>
  );
}
