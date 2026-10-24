import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { bureauDeadlines } from "@/server/services/payroll-calendar";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const TONE = { DONE: "green", OVERDUE: "red", DUE_SOON: "amber", UPCOMING: "gray" } as const;
const WORDS = { DONE: "Done", OVERDUE: "Overdue", DUE_SOON: "Due soon", UPCOMING: "Upcoming" } as const;

export default async function DeadlinesPage() {
  const ctx = await requirePage("bureau.view");
  const rows = await bureauDeadlines(ctx, 7);
  const overdue = rows.filter((r) => r.state === "OVERDUE").length;
  return (
    <>
      <PageHeader
        title="Due this week"
        description={`Payroll deadlines that are overdue or fall in the next 7 days, across the clients you work on. ${overdue ? `${overdue} overdue.` : "Nothing overdue."}`}
      />
      <Section title={`${rows.length} deadline(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Month</TH>
              <TH>Deadline</TH>
              <TH>Date</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={`${r.periodId}-${r.label}`} className={r.state === "OVERDUE" ? "bg-red-50/60" : ""}>
                <TD>{r.clientName}</TD>
                <TD>{r.period}</TD>
                <TD>{r.label}</TD>
                <TD>{fmtDate(r.due)}</TD>
                <TD>
                  <Badge tone={TONE[r.state]}>{WORDS[r.state]}</Badge>{" "}
                  <span className="text-xs text-muted-foreground">{r.days < 0 ? `${-r.days} day(s) late` : r.days === 0 ? "today" : `in ${r.days} day(s)`}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>Nothing is overdue or due this week.</Empty>}
      </Section>
      <p className="text-xs text-muted-foreground">
        To act on one, open the client (<Link className="underline" href="/bureau">Clients</Link>) and go to Payroll → Payroll calendar.
      </p>
    </>
  );
}
