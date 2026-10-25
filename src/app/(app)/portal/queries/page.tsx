import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listQueries, QUERY_CATEGORIES, QUERY_CATEGORY_LABELS } from "@/server/services/client-queries";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { raiseQueryAction } from "@/app/actions/client-queries";

export default async function PortalQueriesPage() {
  const ctx = await requirePage("portal.query");
  const queries = await listQueries(ctx);
  return (
    <>
      <PageHeader title="Your queries" description="Ask the bureau anything about your payroll. They reply here, and you are emailed when they do." />
      <Section title="Ask a question">
        <SmartForm
          columns={2}
          submitLabel="Send to the bureau"
          action={raiseQueryAction}
          fields={[
            { name: "subject", label: "Title", required: true, placeholder: "e.g. Two staff left in September" },
            { name: "category", label: "About", type: "select", required: true, options: QUERY_CATEGORIES.map((c) => ({ value: c, label: QUERY_CATEGORY_LABELS[c] })), defaultValue: "PAYROLL" },
            { name: "body", label: "What do you need?", type: "textarea", required: true, span: 2 },
          ]}
        />
      </Section>
      <Section title="Your queries" flush>
        <Table>
          <THead>
            <TR>
              <TH>No.</TH>
              <TH>Title</TH>
              <TH>Raised</TH>
              <TH>Status</TH>
              <TH>First reply</TH>
            </TR>
          </THead>
          <TBody>
            {queries.map((q) => (
              <TR key={q.id}>
                <TD className="font-mono text-xs">{q.number}</TD>
                <TD>
                  <Link className="text-primary underline" href={`/portal/queries/${q.id}`}>
                    {q.subject}
                  </Link>
                </TD>
                <TD className="text-xs">{fmtDate(q.createdAt)}</TD>
                <TD>{q.status === "CLOSED" ? <Badge>Closed</Badge> : q.status === "ANSWERED" ? <Badge tone="blue">Answered</Badge> : <Badge tone="amber">Open</Badge>}</TD>
                <TD className="text-xs">{q.responseHours !== null ? `${q.responseHours} h` : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!queries.length && <Empty>No queries yet.</Empty>}
      </Section>
    </>
  );
}
