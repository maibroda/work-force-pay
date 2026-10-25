import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { portalChangeRequests, portalEmployees } from "@/server/services/portal";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function PortalEmployeesPage() {
  const ctx = await requirePage("portal.changes");
  const [emps, requests] = await Promise.all([portalEmployees(ctx), portalChangeRequests(ctx)]);
  const label = { BANK: "bank details", TAX: "tax details", PENSION: "pension details" } as const;
  return (
    <>
      <PageHeader title="Your employees" description="Ask the bureau to change an employee's bank, tax or pension details. Nothing changes until the bureau has checked and approved the request. Account numbers, tax IDs and pension PINs are shown with only their last four characters." />
      <Section title={`${emps.length} employee(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>No.</TH>
              <TH>Name</TH>
              <TH>Department</TH>
              <TH>Bank</TH>
              <TH>Tax ID</TH>
              <TH>Pension PIN</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {emps.map((e) => (
              <TR key={e.id}>
                <TD className="font-mono text-xs">{e.employeeNumber}</TD>
                <TD>{e.name}</TD>
                <TD className="text-xs">{e.department}</TD>
                <TD className="text-xs">{e.bank}</TD>
                <TD className="font-mono text-xs">{e.taxId}</TD>
                <TD className="font-mono text-xs">{e.pensionPin}</TD>
                <TD className="text-xs">
                  {e.pending.length > 0 && <Badge tone="amber">{e.pending.length} waiting</Badge>}{" "}
                  <Link className="text-primary underline" href={`/portal/employees/${e.id}`}>
                    Ask for a change
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!emps.length && <Empty>No employees yet.</Empty>}
      </Section>
      {requests.length > 0 && (
        <Section title="Your requests" flush>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Employee</TH>
                <TH>Change</TH>
                <TH>Status</TH>
                <TH>Bureau&apos;s note</TH>
              </TR>
            </THead>
            <TBody>
              {requests.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs">{fmtDate(r.createdAt)}</TD>
                  <TD className="text-xs">
                    {r.employee.employeeNumber} {r.employee.firstName} {r.employee.lastName}
                  </TD>
                  <TD className="text-xs">{label[r.kind as keyof typeof label]}</TD>
                  <TD>{r.status === "PENDING" ? <Badge tone="amber">Waiting for the bureau</Badge> : r.status === "APPROVED" ? <Badge tone="green">Approved</Badge> : <Badge tone="red">{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge>}</TD>
                  <TD className="whitespace-normal text-xs">{r.decisionNote ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
