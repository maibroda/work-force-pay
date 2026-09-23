import { requirePage } from "@/lib/auth/session";
import { leaveBalances } from "@/server/services/leave";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { Empty, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function LeaveBalancesPage() {
  const ctx = await requirePage("leave.view");
  const { policy, rows } = await leaveBalances(ctx);
  const due = rows.filter((r) => r.balance.due);
  return (
    <>
      <PageHeader
        title="Leave balances"
        crumbs={[{ href: "/leave", label: "Leave management" }]}
        description={`${policy.annualDays} working days a year, due after ${policy.eligibilityMonths} months' service. Balances reset on each service anniversary.`}
      />
      <StatGrid cols={3}>
        <Stat label="Employees" value={rows.length} />
        <Stat label="Leave due" value={due.length} sub="can apply now" />
        <Stat label="Not yet due" value={rows.length - due.length} />
      </StatGrid>
      <Section title="Balances by employee" flush>
        {rows.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Beat</TH>
                <TH>Employed</TH>
                <TH>Leave year</TH>
                <TH className="text-right">Entitled</TH>
                <TH className="text-right">Taken</TH>
                <TH className="text-right">Pending</TH>
                <TH className="text-right">Remaining</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map(({ employee: e, balance: b }) => (
                <TR key={e.id}>
                  <TD>
                    {e.employeeNumber} — {fullName(e)}
                  </TD>
                  <TD className="text-xs">{e.currentBeat?.name ?? "—"}</TD>
                  <TD className="whitespace-nowrap text-xs">{fmtDate(e.employmentDate)}</TD>
                  {b.due && b.cycle ? (
                    <>
                      <TD className="whitespace-nowrap text-xs">
                        {fmtDate(b.cycle.start)} – {fmtDate(b.cycle.end)}
                      </TD>
                      <TD className="text-right">{b.entitled}</TD>
                      <TD className="text-right">{b.approved}</TD>
                      <TD className="text-right">{b.pending}</TD>
                      <TD className="text-right font-semibold">{b.remaining}</TD>
                    </>
                  ) : (
                    <>
                      <TD colSpan={5} className="text-xs text-muted-foreground">
                        <Badge tone="gray">Not yet due</Badge> falls due {fmtDate(b.nextDueDate)}
                      </TD>
                    </>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>No employees.</Empty>
        )}
      </Section>
    </>
  );
}
