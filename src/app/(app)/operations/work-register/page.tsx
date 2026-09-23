import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listWorkRegister, LOCATION_MISMATCH } from "@/server/services/operations";
import { enumOptions, options } from "@/server/options";
import { fmtDate, iso } from "@/lib/dates";
import { num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import {
  FilterBar,
  FilterField,
  FormPanel,
  PageHeader,
  Section,
  Stat,
  StatGrid,
  Empty,
} from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  importWorkRegisterAction,
  recordAttendanceAction,
  resolveMismatchAction,
} from "@/app/actions/operations";

export default async function WorkRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("operations.view");
  const sp = await searchParams;
  const now = new Date();
  const from = sp.from ?? iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const to = sp.to ?? iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
  const mismatchOnly = sp.exceptions === "1";
  const [rows, exceptions, o] = await Promise.all([
    listWorkRegister(ctx, {
      from,
      to,
      beatId: sp.beatId,
      clientId: sp.clientId,
      employeeId: sp.employeeId,
      mismatchOnly,
      take: 400,
    }),
    listWorkRegister(ctx, { from, to, mismatchOnly: true, take: 100 }),
    options(ctx),
  ]);
  const manage = can(ctx.role, "operations.manage");
  return (
    <>
      <PageHeader
        title="Work register"
        description="The operational source of truth for WHERE each employee worked each day. Payroll reads this — never the current location."
      />
      <StatGrid cols={4}>
        <Stat label="Records shown" value={rows.length} sub={`${fmtDate(from)} – ${fmtDate(to)}`} />
        <Stat
          label="Present / late"
          value={rows.filter((r) => ["PRESENT", "LATE"].includes(r.attendanceStatus)).length}
        />
        <Stat
          label="Absent / suspended"
          value={rows.filter((r) => ["ABSENT", "SUSPENDED"].includes(r.attendanceStatus)).length}
          tone="amber"
        />
        <Stat
          label="Open location exceptions"
          value={exceptions.length}
          tone={exceptions.length ? "red" : "green"}
          sub={
            exceptions.length ? (
              <Link className="underline" href="?exceptions=1">
                Review
              </Link>
            ) : undefined
          }
        />
      </StatGrid>
      {exceptions.length > 0 && (
        <Section title="Location exceptions" description={LOCATION_MISMATCH} className="border-red-300">
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Employee</TH>
                <TH>Recorded at</TH>
                <TH>Resolve</TH>
              </TR>
            </THead>
            <TBody>
              {exceptions.map((r) => (
                <TR key={r.id}>
                  <TD>{fmtDate(r.date)}</TD>
                  <TD>
                    {r.employee.employeeNumber} — {fullName(r.employee)}
                  </TD>
                  <TD>
                    {r.client.name} — {r.beat.name}
                  </TD>
                  <TD className="space-x-1">
                    {manage ? (
                      <>
                        <ActionButton
                          action={resolveMismatchAction.bind(null, r.id, "ACCEPT_AS_RELIEF")}
                          reason
                          reasonPlaceholder="Relief approval note…"
                          variant="outline"
                        >
                          Accept as relief
                        </ActionButton>
                        <ActionButton
                          action={resolveMismatchAction.bind(null, r.id, "CORRECT_TO_ASSIGNED_BEAT")}
                          reason
                          reasonPlaceholder="Correction note…"
                          variant="outline"
                        >
                          Correct to assigned beat
                        </ActionButton>
                        <ActionButton
                          action={resolveMismatchAction.bind(null, r.id, "ACKNOWLEDGE")}
                          reason
                          reasonPlaceholder="Documented reason…"
                          variant="ghost"
                        >
                          Acknowledge
                        </ActionButton>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Operations must resolve</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
      {can(ctx.role, "attendance.record") && (
        <div className="grid gap-5 lg:grid-cols-2">
          <FormPanel title="Manual entry">
            <SmartForm
              fields={[
                {
                  name: "employeeId",
                  label: "Employee",
                  type: "select",
                  required: true,
                  options: o.employees,
                  span: 2,
                },
                {
                  name: "beatId",
                  label: "Beat worked",
                  type: "select",
                  required: true,
                  options: o.beats,
                  span: 2,
                },
                { name: "date", label: "Date", type: "date", required: true },
                {
                  name: "status",
                  label: "Attendance",
                  type: "select",
                  required: true,
                  options: enumOptions(["PRESENT", "LATE", "ABSENT", "LEAVE", "OFF", "SUSPENDED"]),
                  defaultValue: "PRESENT",
                },
                {
                  name: "shift",
                  label: "Shift",
                  type: "select",
                  options: enumOptions(["FULL", "DAY", "NIGHT"]),
                  defaultValue: "FULL",
                },
                { name: "hoursWorked", label: "Hours worked", type: "number", min: 0, max: 24 },
                { name: "overtimeHours", label: "Overtime hours", type: "number", min: 0, max: 24 },
                { name: "supervisor", label: "Supervisor" },
                { name: "remarks", label: "Remarks", span: 2 },
              ]}
              action={recordAttendanceAction}
              submitLabel="Record"
            />
          </FormPanel>
          <FormPanel title="Bulk import (CSV)">
            <p className="mb-2 text-xs text-muted-foreground">
              Columns: <code>date,employee_number,beat_code,status,hours,overtime_hours,shift,remarks</code>.
              Example: <code>2026-09-22,EMP-000003,BT-00001,PRESENT,12,0,DAY,</code>
            </p>
            <SmartForm
              columns={1}
              fields={[
                {
                  name: "csv",
                  label: "CSV content",
                  type: "textarea",
                  required: true,
                  placeholder:
                    "date,employee_number,beat_code,status\n2026-09-22,EMP-000003,BT-00001,PRESENT",
                },
              ]}
              action={importWorkRegisterAction}
              submitLabel="Import"
            />
          </FormPanel>
        </div>
      )}
      <FilterBar>
        <FilterField label="From">
          <Input type="date" name="from" defaultValue={from} />
        </FilterField>
        <FilterField label="To">
          <Input type="date" name="to" defaultValue={to} />
        </FilterField>
        <FilterField label="Client">
          <Select name="clientId" defaultValue={sp.clientId ?? ""}>
            <option value="">All</option>
            {o.clients.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Beat">
          <Select name="beatId" defaultValue={sp.beatId ?? ""}>
            <option value="">All</option>
            {o.beats.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Employee">
          <Select name="employeeId" defaultValue={sp.employeeId ?? ""} className="w-56">
            <option value="">All</option>
            {o.employees.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <label className="flex items-center gap-1 pb-2 text-xs">
          <input type="checkbox" name="exceptions" value="1" defaultChecked={mismatchOnly} /> Exceptions only
        </label>
      </FilterBar>
      <Section
        title="Register"
        description="Showing up to 400 rows — narrow with filters or use the Work Register report for export."
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Emp. No.</TH>
              <TH>Name</TH>
              <TH>Client</TH>
              <TH>Contract</TH>
              <TH>Beat</TH>
              <TH>Category</TH>
              <TH>Shift</TH>
              <TH>Status</TH>
              <TH className="text-right">Hours</TH>
              <TH className="text-right">OT</TH>
              <TH>Supervisor</TH>
              <TH>Recorded by</TH>
              <TH>Flags</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id} className={r.locationMismatch && !r.mismatchResolved ? "bg-red-50" : ""}>
                <TD>{fmtDate(r.date)}</TD>
                <TD className="font-mono text-xs">{r.employee.employeeNumber}</TD>
                <TD>{fullName(r.employee)}</TD>
                <TD>{r.client.name}</TD>
                <TD className="font-mono text-xs">{r.contract.contractNumber}</TD>
                <TD>{r.beat.name}</TD>
                <TD>{r.category.name}</TD>
                <TD>{r.shift}</TD>
                <TD>
                  <StatusBadge status={r.attendanceStatus} />
                </TD>
                <TD className="text-right">{num(r.hoursWorked)}</TD>
                <TD className="text-right">{num(r.overtimeHours) || ""}</TD>
                <TD className="text-xs">{r.supervisor ?? "—"}</TD>
                <TD className="text-xs">
                  {r.recordedBy}
                  <div className="text-muted-foreground">{r.source}</div>
                </TD>
                <TD>
                  {r.locationMismatch && !r.mismatchResolved ? (
                    <Badge tone="red">Location mismatch</Badge>
                  ) : r.resolutionNote ? (
                    <Badge tone="green">Resolved</Badge>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No records for these filters.</Empty>}
      </Section>
    </>
  );
}
