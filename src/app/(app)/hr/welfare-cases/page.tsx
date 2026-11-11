import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listCases } from "@/server/services/relations";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, PageHeader, Section, Empty } from "@/components/page";
import { Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { WELFARE_KIND_LABELS, type WelfareKind } from "@/lib/welfare";

const STATUSES = ["OPEN", "INVESTIGATING", "HEARING", "RESOLVED", "CLOSED"];

/** Welfare support cases only, for whoever holds the Welfare function (the HR administrator, or a Delegated HR Officer who was granted it). No other kind of case is listed here. */
export default async function WelfareCasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("welfare.manage");
  const sp = await searchParams;
  const rows = await listCases(ctx, { status: sp.status, q: sp.q, type: "WELFARE", overdue: sp.overdue === "1" });
  return (
    <>
      <PageHeader title="Welfare cases" description="Requests for bereavement, hardship, health or family support. They are the most sensitive records we hold: only people who hold the Welfare function see them." />
      <FilterBar>
        <FilterField label="Search">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Case no., summary, employee" className="w-56" />
        </FilterField>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Overdue only">
          <Select name="overdue" defaultValue={sp.overdue ?? ""}>
            <option value="">No</option>
            <option value="1">Yes</option>
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} case(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Case</TH>
              <TH>Employee</TH>
              <TH>Kind of support</TH>
              <TH>Assigned to</TH>
              <TH>Opened</TH>
              <TH>Target</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id} className={c.overdue ? "bg-red-50/60" : ""}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/hr/welfare-cases/${c.id}`}>
                    {c.caseNumber}
                  </Link>
                </TD>
                <TD>
                  {c.employee.employeeNumber} — {fullName(c.employee)}
                </TD>
                <TD className="text-xs">{c.welfareKind ? WELFARE_KIND_LABELS[c.welfareKind as WelfareKind] : "—"}</TD>
                <TD className="text-xs">{c.assignedTo ?? "—"}</TD>
                <TD className="text-xs">{fmtDate(c.openedAt)}</TD>
                <TD className={c.overdue ? "text-xs font-medium text-red-700" : "text-xs"}>{fmtDate(c.dueDate)}</TD>
                <TD>
                  <StatusBadge status={c.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No welfare cases match.</Empty>}
      </Section>
    </>
  );
}
