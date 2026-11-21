import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getLeavePolicy, listLeave } from "@/server/services/leave";
import { listMedicalCertificates, listSickSpells } from "@/server/services/sick-leave";
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
  approveSickSpellAction,
  cancelApprovedSickSpellAction,
  cancelLeaveForAction,
  cancelSickSpellForAction,
  recordSickSpellForAction,
  rejectLeaveAction,
  rejectSickSpellAction,
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
  // paid sick leave for staff paid by the hour (H14): HR only (a supervisor never sees sickness)
  const sickSpells = can(ctx.role, "leave.manage") ? await listSickSpells(ctx, {}) : [];
  const certificates = can(ctx.role, "leave.manage") ? await listMedicalCertificates(ctx) : [];
  const sickWaiting = sickSpells.filter((s) => s.status === "PENDING");
  const sickWho = (s: (typeof sickSpells)[number]) => (
    <>
      {s.employee.employeeNumber} — {s.employee.firstName} {s.employee.lastName}
    </>
  );
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
              { name: "reason", label: "Reason", span: 2 },
              ...(policy.unpaidLeaveEnabled ? [{ name: "unpaid", label: "Unpaid leave", type: "checkbox" as const, help: "Not paid for those days; does not use up annual leave." }] : []),
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
                  <TD className="text-right">{r.workingDays}{r.unpaid ? " (unpaid)" : ""}</TD>
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

      {can(ctx.role, "leave.manage") && (
        <>
          <Section
            title={`Sickness: staff paid by the hour (${sickWaiting.length} awaiting approval)`}
            description={policy.sickDaysPerYear > 0 ? `Paid sick leave: ${policy.sickDaysPerYear} working days a year, in the same leave year as annual leave. A medical certificate is needed, and HR approves a spell: never the person who recorded it. Only the dates and the certificate are kept, never the illness.` : undefined}
            flush
          >
            {policy.sickDaysPerYear > 0 ? (
              <>
                <div className="px-4 pt-4">
                  {certificates.length ? (
                    <SmartForm
                      columns={3}
                      submitLabel="Record spell of sickness"
                      action={recordSickSpellForAction}
                      fields={[
                        { name: "certificateDocumentId", label: "Medical certificate (says whose it is)", type: "select", required: true, options: certificates.map((c) => ({ value: c.id, label: `${c.employeeNumber} ${c.employeeName}: ${c.typeName}, added ${fmtDate(c.createdAt)}` })), span: 3 },
                        { name: "startDate", label: "First day", type: "date", required: true, defaultValue: today },
                        { name: "endDate", label: "Last day", type: "date", required: true },
                      ]}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">To record a spell of sickness, first add the employee&apos;s medical certificate to their documents (a document in the medical category).</p>
                  )}
                </div>
                {sickSpells.length ? (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Employee</TH>
                        <TH>Sickness</TH>
                        <TH className="text-right">Working days</TH>
                        <TH>Status</TH>
                        <TH>Recorded / decided by</TH>
                        <TH />
                      </TR>
                    </THead>
                    <TBody>
                      {sickSpells.slice(0, 100).map((s) => (
                        <TR key={s.id}>
                          <TD>{sickWho(s)}</TD>
                          <TD className="whitespace-nowrap">
                            {fmtDate(s.startDate)} – {fmtDate(s.endDate)}
                          </TD>
                          <TD className="text-right">{s.workingDays}</TD>
                          <TD>
                            <StatusBadge status={s.status} />
                          </TD>
                          <TD className="text-xs">
                            {s.recordedBy}
                            {s.decidedBy && <div className="text-muted-foreground">{s.status === "REJECTED" ? "Rejected" : "Approved"} by {s.decidedBy}{s.decisionNote ? ` — “${s.decisionNote}”` : ""}</div>}
                            {s.status === "CANCELLED" && s.cancelledBy && <div className="text-muted-foreground">Cancelled by {s.cancelledBy}{s.cancellationNote ? ` — “${s.cancellationNote}”` : ""}</div>}
                          </TD>
                          <TD className="space-x-1 whitespace-nowrap">
                            {s.status === "PENDING" &&
                              (s.recordedByUserId === ctx.userId || s.employeeId === ctx.employeeId ? (
                                <span className="text-xs text-muted-foreground">Needs another approver</span>
                              ) : (
                                <>
                                  <ActionButton action={approveSickSpellAction.bind(null, s.id)} variant="success">
                                    Approve
                                  </ActionButton>
                                  <ActionButton action={rejectSickSpellAction.bind(null, s.id)} reason variant="outline">
                                    Reject
                                  </ActionButton>
                                </>
                              ))}
                            {s.status === "PENDING" && (
                              <ActionButton action={cancelSickSpellForAction.bind(null, s.id)} variant="outline" confirm="Cancel this spell of sickness?">
                                Cancel
                              </ActionButton>
                            )}
                            {s.status === "APPROVED" && s.employeeId !== ctx.employeeId && (
                              <ActionButton action={cancelApprovedSickSpellAction.bind(null, s.id)} reason variant="outline">
                                Cancel (approved)
                              </ActionButton>
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <Empty>No spells of sickness recorded.</Empty>
                )}
              </>
            ) : (
              <Empty>Paid sick leave is not set up: set the paid sick days a year in the Leave policy.</Empty>
            )}
          </Section>
        </>
      )}

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
                  <TD className="text-right">{r.workingDays}{r.unpaid ? " (unpaid)" : ""}</TD>
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
