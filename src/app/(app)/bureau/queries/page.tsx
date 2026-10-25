import { requirePage } from "@/lib/auth/session";
import { bureauOpenQueries, RESPONSE_TARGET_HOURS } from "@/server/services/client-queries";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function OpenQueriesPage() {
  const ctx = await requirePage("bureau.view");
  const { rows, averageResponseHours } = await bureauOpenQueries(ctx);
  const late = rows.filter((r) => r.overdue).length;
  return (
    <>
      <PageHeader
        title="Open queries"
        description={`Queries from the clients you work on that are not closed, oldest first. A first reply is expected within ${RESPONSE_TARGET_HOURS} hours${averageResponseHours !== null ? `; the average so far is ${averageResponseHours} hours` : ""}. ${late ? `${late} waiting too long.` : "None waiting too long."}`}
      />
      <Section title={`${rows.length} open`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>No.</TH>
              <TH>Title</TH>
              <TH>Raised by</TH>
              <TH>Raised</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id} className={r.overdue ? "bg-red-50/60" : ""}>
                <TD>{r.clientName}</TD>
                <TD className="font-mono text-xs">{r.number}</TD>
                <TD>{r.subject}</TD>
                <TD className="text-xs">{r.raisedBy}</TD>
                <TD className="text-xs">{fmtDate(r.createdAt)}</TD>
                <TD>{r.status === "ANSWERED" ? <Badge tone="blue">Answered</Badge> : <Badge tone={r.overdue ? "red" : "amber"}>{r.waitingHours !== null ? `waiting ${r.waitingHours} h` : "Open"}</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No open queries.</Empty>}
      </Section>
      <p className="text-xs text-muted-foreground">To answer one, work in that client (Bureau → Clients) and open Service Desk.</p>
    </>
  );
}
