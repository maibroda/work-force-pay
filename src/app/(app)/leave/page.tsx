import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getLeavePolicy, listLeave } from "@/server/services/leave";
import { options } from "@/server/options";
import { fmtDate, iso } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import {
  Empty,
  FilterBar,
  FilterField,
  FormPanel,
  PageHeader,
  Section,
  Stat,
  StatGrid,
} from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  applyLeaveForAction,
  approveLeaveAction,
  cancelLeaveForAction,
  rejectLeaveAction,
} from "@/app/actions/leave";

type Row = Awaited<ReturnType<typeof listLeave>>[number];

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("leave.view");
  const sp = await searchParams;
  const [rows, policy] = await Promise.all([
    listLeave(ctx, { status: sp.status }),
    getLeavePolicy(ctx.orgId),
  ]);
  const canApprove = can(ctx.role, "leave.approve");
  const today = iso(new Date());
  const pending = rows.filter((r) => r.status === "PENDING");
  const onLeave = rows.filter(
    (r) => r.status === "APPROVED" && iso(r.startDate) <= today && iso(r.endDate) >= today,
  );
  const o = can(ctx.role, "leave.manage") ? await options(ctx) : null;

  const who = (r: Row) => (
    <>
      {r.employee.employeeNumber} — {fullName(r.employee)}
      <div className="text-[11px] text-muted-foreground">{r.employee.currentBeat?.name ?? "No beat"}</div>
    </>
  );
  // A supervisor cannot decide their own leave; the table hides the buttons instead of failing later.
  const mine = (r: Row) => r.employeeId === ctx.employeeId;

  return (
    <>
      <PageHeader
        title="Leave management"
        description={`Every employee is entitled to ${policy.annualDays} working days of annual leave, due after ${policy.eligibilityMonths} months' service and renewed each year. Requests are approved by the employee's supervisor; approved days are recorded as paid leave in the work register.`}
        actions={
          <>
            <Link className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" href="/leave/balances">
              Leave balances
            </Link>
            {can(ctx.role, "leave.manage") && (
              <Link className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent" href="/settings/leave">
                Leave policy
              </Link>
            )}
          </>
        }
      />
      <StatGrid cols={3}>
        <Stat label="Awaiting approval" value={pending.length} tone={pending.length ? "amber" : undefined} />
        <Stat label="On leave today" value={onLeave.length} />
        <Stat label="Requests shown" value={rows.length} />
      </StatGrid>

      {o && (
        <FormPanel title="Apply on an employee's behalf">
          <SmartForm
            columns={3}
            submitLabel="Submit request"
            action={applyLeaveForAction}
            fields={[
              { name: "employeeId", label: "Employee", type: "select", required: true, options: o.employees },
              { name: "startDate", label: "First day", type: "date", required: true, defaultValue: today },
              { name: "endDate", label: "Last day", type: "date", required: true },
              { name: "reason", label: "Reason", span: 3 },
            ]}
          />
        </FormPanel>
      )}

      <Section
        title={`Awaiting approval (${pending.length})`}
        description={ctx.role === "SUPERVISOR" ? "Guards on the beats you supervise." : undefined}
        flush
      >
        {pending.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Leave</TH>
                <TH className="text-right">Working days</TH>
                <TH>Reason</TH>
                <TH>Requested by</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {pending.map((r) => (
                <TR key={r.id}>
                  <TD>{who(r)}</TD>
                  <TD className="whitespace-nowrap">
                    {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                  </TD>
                  <TD className="text-right">{r.workingDays}</TD>
                  <TD className="max-w-xs truncate text-xs">{r.reason ?? "—"}</TD>
                  <TD className="text-xs">{r.requestedBy}</TD>
                  <TD className="space-x-1 whitespace-nowrap">
                    {canApprove && !mine(r) ? (
                      <>
                        <ActionButton action={approveLeaveAction.bind(null, r.id)} variant="success">
                          Approve
                        </ActionButton>
                        <ActionButton action={rejectLeaveAction.bind(null, r.id)} reason variant="outline">
                          Reject
                        </ActionButton>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {mine(r) ? "Needs another approver" : "Awaiting supervisor"}
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>Nothing is waiting for approval.</Empty>
        )}
      </Section>

      <Section title="All requests" flush>
        <div className="px-4 pt-4">
          <FilterBar>
            <FilterField label="Status">
              <Select name="status" defaultValue={sp.status ?? ""}>
                <option value="">All</option>
                {["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        </div>
        {rows.length ? (
          <Table>
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Leave</TH>
                <TH className="text-right">Days</TH>
                <TH>Status</TH>
                <TH>Decided by</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>{who(r)}</TD>
                  <TD className="whitespace-nowrap">
                    {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                  </TD>
                  <TD className="text-right">{r.workingDays}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="text-xs">
                    {r.decidedBy ?? "—"}
                    {r.decisionNote && <div className="text-muted-foreground">“{r.decisionNote}”</div>}
                  </TD>
                  <TD>
                    {canApprove && r.status === "APPROVED" && iso(r.startDate) > today && (
                      <ActionButton
                        action={cancelLeaveForAction.bind(null, r.id)}
                        variant="outline"
                        confirm="Cancel this approved leave?"
                      >
                        Cancel
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>No leave requests.</Empty>
        )}
      </Section>
    </>
  );
}
