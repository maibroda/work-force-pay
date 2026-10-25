import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listQueries } from "@/server/services/client-queries";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function ServiceDeskPage() {
  const ctx = await requirePage("query.respond");
  const queries = await listQueries(ctx);
  return (
    <>
      <PageHeader title="Service desk" description="This client's queries. Answer them here; the client is emailed. To see every client's open queries at once, use Bureau → Open Queries." />
      <Section title={`${queries.length} query(ies)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>No.</TH>
              <TH>Title</TH>
              <TH>Raised by</TH>
              <TH>Raised</TH>
              <TH>Status</TH>
              <TH>First reply</TH>
            </TR>
          </THead>
          <TBody>
            {queries.map((q) => (
              <TR key={q.id} className={q.overdue ? "bg-red-50/60" : ""}>
                <TD className="font-mono text-xs">{q.number}</TD>
                <TD>
                  <Link className="text-primary underline" href={`/service-desk/${q.id}`}>
                    {q.subject}
                  </Link>
                </TD>
                <TD className="text-xs">{q.raisedBy}</TD>
                <TD className="text-xs">{fmtDate(q.createdAt)}</TD>
                <TD>{q.status === "CLOSED" ? <Badge>Closed</Badge> : q.status === "ANSWERED" ? <Badge tone="blue">Answered</Badge> : <Badge tone={q.overdue ? "red" : "amber"}>Open</Badge>}</TD>
                <TD className="text-xs">{q.responseHours !== null ? `${q.responseHours} h` : q.waitingHours !== null ? `waiting ${q.waitingHours} h` : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!queries.length && <Empty>No queries.</Empty>}
      </Section>
    </>
  );
}
