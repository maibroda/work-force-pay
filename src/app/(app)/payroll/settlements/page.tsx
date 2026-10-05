import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listSettlements } from "@/server/services/settlements";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, PageHeader, Section, Empty } from "@/components/page";
import { Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "RELEASED", "CANCELLED"];

export default async function SettlementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const rows = await listSettlements(ctx, { status: sp.status });
  return (
    <>
      <PageHeader
        title="End-of-service settlements"
        description="What each leaver is owed beyond their final month's pay, calculated from the HR policy, approved by someone other than the preparer, then released into the payroll period of their last working day."
      />
      <FilterBar>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} settlement(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Settlement</TH>
              <TH>Employee</TH>
              <TH>Exit</TH>
              <TH>Last day</TH>
              <TH className="text-right">Earnings</TH>
              <TH className="text-right">Recoveries</TH>
              <TH className="text-right">Net</TH>
              <TH>Payroll period</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((s) => (
              <TR key={s.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/payroll/settlements/${s.id}`}>
                    {s.settlementNumber}
                  </Link>
                </TD>
                <TD>
                  {s.employee.employeeNumber} — {fullName(s.employee)}
                </TD>
                <TD className="text-xs">{s.exitRecord.exitType.replace(/_/g, " ").toLowerCase()}</TD>
                <TD className="text-xs">{fmtDate(s.exitRecord.lastWorkingDate)}</TD>
                <TD className="text-right">{naira(s.grossEarnings)}</TD>
                <TD className="text-right">{naira(s.totalDeductions)}</TD>
                <TD className="text-right font-medium">{naira(s.netSettlement)}</TD>
                <TD className="text-xs">{s.payrollPeriod?.name ?? "—"}</TD>
                <TD>
                  <StatusBadge status={s.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No settlements yet — they start from an approved exit.</Empty>}
      </Section>
    </>
  );
}
