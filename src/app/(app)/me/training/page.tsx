import { requirePage } from "@/lib/auth/session";
import { myTraining } from "@/server/services/training-plan";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function MyTrainingPage() {
  const ctx = await requirePage();
  const t = await myTraining(ctx);
  return (
    <>
      <PageHeader title="My training" description="The training sessions you are enrolled in, and the courses you have attended. Your certificates and what you are required to hold are kept by HR." />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <>
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
        </>
      )}
    </>
  );
}
