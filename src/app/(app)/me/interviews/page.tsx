import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { mySeats } from "@/server/services/recruitment-panel";
import { Empty, PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function MyInterviewsPage() {
  const ctx = await requirePage();
  const seats = await mySeats(ctx);
  return (
    <>
      <PageHeader
        title="My interviews"
        description="Interviews where you sit on the panel. Score each criterion yourself: you cannot see a colleague's scorecard until the panel's scoring is closed. Scores are advice for the people deciding, not a decision."
      />
      <Section title="Panels I sit on" flush>
        {seats.length === 0 ? (
          <Empty>You are not on any interview panel.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Candidate</TH>
                <TH>Role</TH>
                <TH>Round</TH>
                <TH>When</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {seats.map((s) => (
                <TR key={s.interviewId}>
                  <TD>{s.candidateName}</TD>
                  <TD>{s.jobTitle}</TD>
                  <TD>{s.round}</TD>
                  <TD className="text-xs">{s.scheduledAt.toISOString().slice(0, 16).replace("T", " ")}</TD>
                  <TD>
                    <StatusBadge status={s.closed ? "CLOSED" : s.submitted ? "SUBMITTED" : "AWAITING_SCORECARD"} />
                  </TD>
                  <TD>
                    <Link className="text-primary underline" href={`/me/interviews/${s.interviewId}`}>
                      Open
                    </Link>
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
