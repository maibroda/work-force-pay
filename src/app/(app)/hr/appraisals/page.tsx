import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { appraisalAttention, listCycles, myQueue } from "@/server/services/appraisals";
import { todayUtc } from "@/server/services/hr-policy";
import { options } from "@/server/options";
import { KIND_LABELS } from "@/lib/appraisal";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { launchCycleAction } from "@/app/actions/appraisals";

export default async function AppraisalsPage() {
  const ctx = await requirePage("appraisal.view");
  const manage = can(ctx.role, "appraisal.manage");
  const today = todayUtc();
  const [cycles, attention, queue, o] = await Promise.all([listCycles(ctx), appraisalAttention(ctx.orgId, today), myQueue(ctx), options(ctx)]);
  const open = cycles.filter((c) => c.status === "OPEN");
  return (
    <>
      <PageHeader
        title="Performance appraisals"
        description="Launch a review cycle, follow its progress, and sign off results. Employees rate themselves, their manager rates them, someone other than the manager signs it off, and the employee responds."
        actions={
          manage ? (
            <Link className="text-sm text-primary underline" href="/settings/appraisal-criteria">
              Criteria & weights
            </Link>
          ) : undefined
        }
      />
      <StatGrid cols={4}>
        <Stat label="Open cycles" value={open.length} />
        <Stat label="Reviews overdue" value={attention.overdue.length} tone={attention.overdue.length ? "red" : "green"} />
        <Stat label="Awaiting sign-off" value={attention.awaiting.length} tone={attention.awaiting.length ? "amber" : "green"} />
        <Stat label="Waiting for you to sign off" value={queue.toApprove.length} tone={queue.toApprove.length ? "amber" : undefined} />
      </StatGrid>

      {manage && (
        <FormPanel title="Launch a cycle" open={!cycles.length}>
          <p className="mb-3 text-xs text-muted-foreground">
            One appraisal is created for each eligible employee, using the criteria switched on now. Leave category and employee blank for everyone; pick an employee for a probation or ad-hoc review (their service length is then not checked).
          </p>
          <SmartForm
            columns={3}
            submitLabel="Launch cycle"
            resetOnSuccess={false}
            action={launchCycleAction}
            fields={[
              { name: "name", label: "Cycle name", required: true, placeholder: "2026 annual review" },
              { name: "kind", label: "Type", type: "select", required: true, defaultValue: "ANNUAL", options: Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label })) },
              { name: "dueDate", label: "Reviews due by", type: "date", required: true },
              { name: "periodStart", label: "Period from", type: "date", required: true },
              { name: "periodEnd", label: "Period to", type: "date", required: true },
              { name: "categoryId", label: "Only this category (optional)", type: "select", options: o.categories },
              { name: "employeeId", label: "Only this employee (optional)", type: "select", options: o.employees },
            ]}
          />
        </FormPanel>
      )}

      <Section title="Cycles" flush>
        <Table>
          <THead>
            <TR>
              <TH>Cycle</TH>
              <TH>Type</TH>
              <TH>Period</TH>
              <TH>Due</TH>
              <TH>Progress</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {cycles.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link className="text-primary hover:underline" href={`/hr/appraisals/cycle/${c.id}`}>
                    {c.name}
                  </Link>
                </TD>
                <TD className="text-xs">{KIND_LABELS[c.kind]}</TD>
                <TD className="text-xs">
                  {fmtDate(c.periodStart)} – {fmtDate(c.periodEnd)}
                </TD>
                <TD className="text-xs">{fmtDate(c.dueDate)}</TD>
                <TD className="text-xs">
                  {c.completed}/{c.total} signed off
                  {c.counts.SUBMITTED > 0 && <span className="text-muted-foreground"> · {c.counts.SUBMITTED} awaiting sign-off</span>}
                </TD>
                <TD>
                  <StatusBadge status={c.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!cycles.length && <Empty>No cycles yet.</Empty>}
      </Section>

      {attention.overdue.length > 0 && (
        <Section title="Overdue reviews" flush>
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Cycle</TH>
                <TH>Reviewer</TH>
                <TH>Was due</TH>
              </TR>
            </THead>
            <TBody>
              {attention.overdue.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link className="text-primary hover:underline" href={`/hr/appraisals/${a.id}`}>
                      {a.employee.employeeNumber} {fullName(a.employee)}
                    </Link>
                  </TD>
                  <TD className="text-xs">{a.cycle.name}</TD>
                  <TD className="text-xs">{a.reviewerName ?? <Badge tone="amber">not assigned</Badge>}</TD>
                  <TD className="text-xs">{fmtDate(a.cycle.dueDate)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
