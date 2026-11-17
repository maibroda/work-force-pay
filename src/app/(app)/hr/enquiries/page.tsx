import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listEnquiries } from "@/server/services/hr-enquiries";
import { ENQUIRY_CATEGORY_LABELS, ENQUIRY_STATUS_LABELS } from "@/lib/hr-enquiries";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const FILTERS = [
  { key: "", label: "All" },
  { key: "waiting", label: "Waiting for HR" },
  { key: "overdue", label: "Past the target" },
  { key: "answered", label: "Answered" },
  { key: "closed", label: "Closed" },
] as const;

export default async function HrEnquiriesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requirePage("enquiry.respond");
  const { show = "" } = await searchParams;
  const all = await listEnquiries(ctx);
  const rows = all.filter((r) => (show === "waiting" ? r.status === "OPEN" : show === "overdue" ? r.overdue : show === "answered" ? r.status === "ANSWERED" : show === "closed" ? r.status === "CLOSED" : true));
  return (
    <>
      <PageHeader
        title="HR enquiries"
        description="Questions employees have put to HR. Only the HR administrator reads these, and every time you open one it is recorded. The list shows the number, the category and the wait, never the words. A grievance, harassment, whistleblowing or welfare concern is not answered here: open it and move it into an Employee relations case."
      />
      <StatGrid cols={4}>
        <Stat label="Waiting for HR" value={all.filter((r) => r.status === "OPEN").length} />
        <Stat label="Past the first-reply target" value={all.filter((r) => r.overdue).length} tone={all.some((r) => r.overdue) ? "red" : undefined} />
        <Stat label="Answered" value={all.filter((r) => r.status === "ANSWERED").length} />
        <Stat label="Closed" value={all.filter((r) => r.status === "CLOSED").length} />
      </StatGrid>
      <p className="mb-3 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key ? `/hr/enquiries?show=${f.key}` : "/hr/enquiries"} className={`rounded border px-3 py-1 ${show === f.key ? "bg-primary text-primary-foreground" : ""}`}>
            {f.label}
          </Link>
        ))}
      </p>
      <Section title="Enquiries" flush>
        {rows.length === 0 ? (
          <Empty>Nothing here.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Enquiry</TH>
                <TH>From</TH>
                <TH>About</TH>
                <TH>Raised</TH>
                <TH>First reply due</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((q) => (
                <TR key={q.id}>
                  <TD className="font-mono text-xs">
                    <Link className="text-primary underline" href={`/hr/enquiries/${q.id}`}>
                      {q.number}
                    </Link>
                  </TD>
                  <TD className="text-xs">
                    {q.employee.employeeNumber} {q.employee.firstName} {q.employee.lastName}
                  </TD>
                  <TD className="text-xs">{ENQUIRY_CATEGORY_LABELS[q.category]}</TD>
                  <TD className="text-xs">{fmtDate(q.createdAt)}</TD>
                  <TD className="text-xs">{q.firstResponseAt ? "replied" : fmtDate(new Date(`${q.dueDay}T00:00:00Z`))}</TD>
                  <TD>
                    {q.movedToCaseId ? (
                      <Badge tone="gray">Moved to a case</Badge>
                    ) : (
                      <Badge tone={q.status === "CLOSED" ? "gray" : q.status === "ANSWERED" ? "blue" : q.overdue ? "red" : "amber"}>{q.overdue ? "Past the target" : ENQUIRY_STATUS_LABELS[q.status]}</Badge>
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
