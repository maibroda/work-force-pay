import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { caseStats, listCases } from "@/server/services/relations";
import { options, enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Input, Select } from "@/components/ui/input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { raiseCaseAction } from "@/app/actions/hr-lifecycle";

const TYPES = ["GRIEVANCE", "MISCONDUCT", "HARASSMENT", "WHISTLEBLOWING", "COUNSELLING", "MEDIATION", "OTHER"];
const STATUSES = ["OPEN", "INVESTIGATING", "HEARING", "RESOLVED", "CLOSED"];

export default async function RelationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const [rows, stats, o] = await Promise.all([
    listCases(ctx, { status: sp.status, type: sp.type, q: sp.q, overdue: sp.overdue === "1" }),
    caseStats(ctx),
    options(ctx),
  ]);
  return (
    <>
      <PageHeader
        title="Employee relations"
        description="Grievances, misconduct investigations, harassment and whistleblowing concerns, counselling and mediation — each a case with an append-only file. Confidential cases show only their existence to read-only viewers."
      />
      <StatGrid cols={3}>
        <Stat label="Open cases" value={stats.open} />
        <Stat label="Past their resolution target" value={stats.overdue} tone={stats.overdue ? "red" : undefined} />
        <Stat label="Average time to resolve (12 months)" value={stats.avgResolutionDays === null ? "—" : `${stats.avgResolutionDays} days`} />
      </StatGrid>

      {can(ctx.role, "hr.manage") && (
        <FormPanel title="Open a case">
          <SmartForm
            columns={3}
            submitLabel="Open case"
            action={raiseCaseAction}
            fields={[
              { name: "employeeId", label: "Employee the case is about", type: "select", required: true, options: o.employees },
              { name: "type", label: "Type", type: "select", required: true, options: enumOptions(TYPES) },
              { name: "severity", label: "Severity", type: "select", defaultValue: "MEDIUM", options: enumOptions(["LOW", "MEDIUM", "HIGH"]) },
              { name: "summary", label: "Summary", required: true, span: 2 },
              { name: "confidential", label: "Confidential (harassment and whistleblowing always are)", type: "checkbox" },
              { name: "description", label: "What happened", type: "textarea", required: true, span: 3 },
            ]}
          />
        </FormPanel>
      )}

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
        <FilterField label="Type">
          <Select name="type" defaultValue={sp.type ?? ""}>
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
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
              <TH>Type</TH>
              <TH>Summary</TH>
              <TH>Severity</TH>
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
                  <Link className="text-primary underline" href={`/hr/relations/${c.id}`}>
                    {c.caseNumber}
                  </Link>
                </TD>
                <TD>
                  {c.employee.employeeNumber} — {fullName(c.employee)}
                </TD>
                <TD className="text-xs">
                  {c.type.replace(/_/g, " ").toLowerCase()}
                  {c.confidential && <Badge tone="violet" className="ml-1">confidential</Badge>}
                </TD>
                <TD className="max-w-xs truncate text-xs">{c.summary}</TD>
                <TD>
                  <StatusBadge status={c.severity} />
                </TD>
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
        {!rows.length && <Empty>No cases match.</Empty>}
      </Section>
    </>
  );
}
