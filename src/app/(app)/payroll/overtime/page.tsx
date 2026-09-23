import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listOvertime } from "@/server/services/inputs";
import { options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveOvertimeAction, createOvertimeAction } from "@/app/actions/payroll";
import { ApproveReject } from "../_inputs";

export default async function OvertimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const [rows, o] = await Promise.all([listOvertime(ctx, sp.periodId), options(ctx)]);
  return (
    <>
      <PageHeader
        title="Overtime"
        description="Receive schedule → validate personnel, values, client & location → approve → include in payroll. Only authorized schedules (with an approval reference) are processed."
      />
      {can(ctx.role, "payroll.inputs") && (
        <FormPanel title="Enter overtime from client schedule">
          <SmartForm
            columns={3}
            fields={[
              {
                name: "periodId",
                label: "Payroll period",
                type: "select",
                required: true,
                options: o.openPeriods,
              },
              { name: "employeeId", label: "Employee", type: "select", required: true, options: o.employees },
              { name: "beatId", label: "Client / beat", type: "select", required: true, options: o.beats },
              { name: "date", label: "Date", type: "date", required: true },
              { name: "hours", label: "Hours", type: "number", required: true, min: 0.5, max: 24 },
              {
                name: "rate",
                label: "Hourly rate (₦)",
                type: "number",
                min: 0,
                help: "Blank = (operative gross ÷ days ÷ hours) × multiplier",
              },
              {
                name: "amount",
                label: "Schedule amount (₦)",
                type: "number",
                min: 0,
                help: "Optional — checked against the configured calculation",
              },
              { name: "approvalReference", label: "Client approval reference" },
              {
                name: "source",
                label: "Source",
                type: "select",
                options: [
                  { value: "CLIENT_SCHEDULE", label: "Client schedule" },
                  { value: "MANUAL", label: "Manual" },
                ],
                defaultValue: "CLIENT_SCHEDULE",
              },
            ]}
            action={createOvertimeAction}
            submitLabel="Validate & save"
          />
        </FormPanel>
      )}
      <FilterBar>
        <FilterField label="Period">
          <Select name="periodId" defaultValue={sp.periodId ?? ""}>
            <option value="">All</option>
            {o.periods.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} overtime line(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Period</TH>
              <TH>Date</TH>
              <TH>Employee</TH>
              <TH>Client</TH>
              <TH>Beat</TH>
              <TH className="text-right">Hours</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Amount</TH>
              <TH>Approval ref.</TH>
              <TH>Approved by</TH>
              <TH>Source</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>{r.period.name}</TD>
                <TD>{fmtDate(r.date)}</TD>
                <TD>
                  {r.employee.employeeNumber} — {fullName(r.employee)}
                </TD>
                <TD>{r.client.name}</TD>
                <TD>{r.beat.name}</TD>
                <TD className="text-right">{num(r.hours)}</TD>
                <TD className="text-right">{naira(r.rate)}</TD>
                <TD className="text-right">{naira(r.amount)}</TD>
                <TD className="text-xs">{r.approvalReference ?? "—"}</TD>
                <TD className="text-xs">{r.approvedBy ?? "—"}</TD>
                <TD className="text-xs">{r.source}</TD>
                <TD>
                  <StatusBadge status={r.status} />
                </TD>
                <TD>
                  <ApproveReject
                    kind="overtime"
                    id={r.id}
                    status={r.status}
                    canApprove={can(ctx.role, "payroll.inputs.approve")}
                    approve={approveOvertimeAction.bind(null, r.id)}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No overtime.</Empty>}
      </Section>
    </>
  );
}
