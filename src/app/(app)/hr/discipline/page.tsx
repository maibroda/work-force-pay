import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { caseStats, listCases } from "@/server/services/relations";
import { listSanctions } from "@/server/services/hr";
import { ActionButton } from "@/components/action-button";
import { approveDisciplinaryAction, rejectDisciplinaryAction } from "@/app/actions/hr";
import { options, enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Input, Select } from "@/components/ui/input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { raiseCaseAction } from "@/app/actions/hr-lifecycle";
import { otherHolders } from "@/server/services/second-person";

const STATUSES = ["OPEN", "INVESTIGATING", "HEARING", "RESOLVED", "CLOSED"];

export default async function DisciplinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("discipline.view");
  const sp = await searchParams;
  // governance step 2b: the person who raised a sanction does not also approve it, unless nobody else could (then they give a reason)
  const approveOthers = can(ctx.role, "hr.approve") && can(ctx.role, "discipline.manage") ? await otherHolders(ctx, ["hr.approve", "discipline.manage"]) : 1;
  const [rows, stats, o, sanctions] = await Promise.all([
    listCases(ctx, { status: sp.status, type: sp.type, q: sp.q, overdue: sp.overdue === "1", scope: "discipline" }),
    caseStats(ctx, "discipline"),
    options(ctx),
    listSanctions(ctx, { status: "PENDING" }),
  ]);
  return (
    <>
      <PageHeader
        title="Disciplinary"
        description="Misconduct cases: investigation, hearing, finding, appeal and the sanctions that follow, each a case with an append-only file. Grievances, harassment and the rest are under Employee relations. Sanctions are raised as pending and signed off by a second person."
      />
      <StatGrid cols={3}>
        <Stat label="Open cases" value={stats.open} />
        <Stat label="Past their resolution target" value={stats.overdue} tone={stats.overdue ? "red" : undefined} />
        <Stat label="Average time to resolve (12 months)" value={stats.avgResolutionDays === null ? "—" : `${stats.avgResolutionDays} days`} />
      </StatGrid>

      {can(ctx.role, "hr.manage") && can(ctx.role, "discipline.manage") && (
        <FormPanel title="Open a misconduct case">
          <SmartForm
            columns={3}
            submitLabel="Open case"
            action={raiseCaseAction}
            fields={[
              { name: "employeeId", label: "Employee the case is about", type: "select", required: true, options: o.employees },
              { name: "type", label: "Type", type: "hidden", defaultValue: "MISCONDUCT" },
              { name: "severity", label: "Severity", type: "select", defaultValue: "MEDIUM", options: enumOptions(["LOW", "MEDIUM", "HIGH"]) },
              { name: "summary", label: "Summary", required: true, span: 2 },
              { name: "confidential", label: "Confidential", type: "checkbox" },
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
                            <TH />
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
                  <Link className="text-primary underline" href={`/hr/discipline/${c.id}`}>
                    {c.caseNumber}
                  </Link>
                </TD>
                <TD>
                  {c.employee.employeeNumber} — {fullName(c.employee)}
                </TD>
                <TD className="text-xs">{c.confidential && <Badge tone="violet">confidential</Badge>}</TD>
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

      <Section title={`Sanctions awaiting sign-off (${sanctions.length})`} description="Raised by one person and signed off by another. Commendations are not discipline and are signed off on the employee's record." flush>
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Sanction</TH>
              <TH>Incident</TH>
              <TH>What happened</TH>
              <TH>Raised by</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {sanctions.map((r) => (
              <TR key={r.id}>
                <TD>
                  <Link className="text-primary underline" href={`/employees/${r.employeeId}?tab=conduct`}>
                    {r.employee.employeeNumber} — {fullName(r.employee)}
                  </Link>
                </TD>
                <TD className="text-xs">{r.type.replace(/_/g, " ").toLowerCase()}</TD>
                <TD className="text-xs">{fmtDate(r.incidentDate)}</TD>
                <TD className="max-w-xs whitespace-normal text-xs">{r.description}</TD>
                <TD className="text-xs">{r.issuedBy}</TD>
                <TD>
                  {can(ctx.role, "hr.approve") && can(ctx.role, "discipline.manage") && (
                    <div className="flex gap-1">
{r.type !== "COMMENDATION" && r.issuedByUserId === ctx.userId && approveOthers > 0 ? (
                        <span className="text-xs text-muted-foreground">You raised this: a different person approves it.</span>
                      ) : (
                        <ActionButton action={approveDisciplinaryAction.bind(null, r.id)} reason={r.type !== "COMMENDATION" && r.issuedByUserId === ctx.userId} reasonPlaceholder="You raised this and you are the only person who can approve it: why? (at least 20 characters)" variant="success">
                      Approve
                        </ActionButton>
                      )}
                      <ActionButton action={rejectDisciplinaryAction.bind(null, r.id)} reason reasonPlaceholder="Reason for rejecting" variant="outline">
                        Reject
                      </ActionButton>
                    </div>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!sanctions.length && <Empty>No sanctions are waiting.</Empty>}
      </Section>
    </>
  );
}
