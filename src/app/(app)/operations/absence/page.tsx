import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fmtDate, iso, d } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function AbsencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("operations.view");
  const sp = await searchParams;
  const now = new Date();
  const from = sp.from ?? iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const to = sp.to ?? iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
  const rows = await db.workRegister.findMany({
    where: {
      organizationId: ctx.orgId,
      date: { gte: d(from), lte: d(to) },
      attendanceStatus: { in: ["ABSENT", "SUSPENDED", "LEAVE"] },
    },
    include: { employee: true, beat: true, client: true },
    orderBy: [{ date: "desc" }],
    take: 500,
  });
  const by = (s: string) => rows.filter((r) => r.attendanceStatus === s).length;
  return (
    <>
      <PageHeader
        title="Absence"
        description="Absent and suspension days are unpaid; leave days are paid. Absences at a beat may require a replacement (relief movement)."
      />
      <FilterBar>
        <FilterField label="From">
          <Input type="date" name="from" defaultValue={from} />
        </FilterField>
        <FilterField label="To">
          <Input type="date" name="to" defaultValue={to} />
        </FilterField>
      </FilterBar>
      <StatGrid cols={3}>
        <Stat label="Absent days" value={by("ABSENT")} tone="red" />
        <Stat label="Suspension days" value={by("SUSPENDED")} tone="amber" />
        <Stat label="Leave days" value={by("LEAVE")} />
      </StatGrid>
      <Section title="Absence register" flush>
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Employee</TH>
              <TH>Client</TH>
              <TH>Beat</TH>
              <TH>Status</TH>
              <TH>Remarks</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>{fmtDate(r.date)}</TD>
                <TD>
                  {r.employee.employeeNumber} — {fullName(r.employee)}
                </TD>
                <TD>{r.client.name}</TD>
                <TD>{r.beat.name}</TD>
                <TD>
                  <StatusBadge status={r.attendanceStatus} />
                </TD>
                <TD>{r.remarks ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No absences in this range.</Empty>}
      </Section>
    </>
  );
}
