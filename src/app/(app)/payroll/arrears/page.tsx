import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listArrears } from "@/server/services/inputs";
import { enumOptions, options } from "@/server/options";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveArrearsAction, createArrearsAction } from "@/app/actions/payroll";
import { ApproveReject } from "../_inputs";

export default async function ArrearsPage() {
  const ctx = await requirePage("payroll.view");
  const [rows, o] = await Promise.all([listArrears(ctx), options(ctx)]);
  return (
    <>
      <PageHeader
        title="Arrears administration"
        description="Adjustment request → review → approval → calculate gross, tax, pension and net impact against the affected period → included in the next payroll calculation → audit trail."
      />
      {can(ctx.role, "payroll.inputs") && (
        <FormPanel title="Request arrears">
          <SmartForm
            columns={3}
            fields={[
              { name: "employeeId", label: "Employee", type: "select", required: true, options: o.employees },
              {
                name: "originalPeriodId",
                label: "Affected (original) period",
                type: "select",
                required: true,
                options: o.periods,
              },
              {
                name: "arrearsType",
                label: "Arrears type",
                type: "select",
                required: true,
                options: enumOptions([
                  "SALARY_ADJUSTMENT",
                  "LATE_SALARY_INCREASE",
                  "PAYROLL_CORRECTION",
                  "MISSED_PAYMENT",
                  "RETROSPECTIVE_PROMOTION",
                  "APPROVED_ALLOWANCE",
                  "APPROVED_CORRECTION",
                ]),
              },
              {
                name: "correctedMonthlyGross",
                label: "Corrected monthly gross (₦)",
                type: "number",
                min: 1,
                help: "For salary adjustments — recalculated against that period's days",
              },
              { name: "originalAmount", label: "…or original amount (₦)", type: "number", min: 0 },
              { name: "correctedAmount", label: "…and corrected amount (₦)", type: "number", min: 0 },
              { name: "supportingDocument", label: "Supporting document" },
              { name: "reason", label: "Reason", required: true, span: 2 },
            ]}
            action={createArrearsAction}
            submitLabel="Calculate arrears"
          />
        </FormPanel>
      )}
      <Section title={`${rows.length} arrears record(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Affected period</TH>
              <TH>Type</TH>
              <TH className="text-right">Original</TH>
              <TH className="text-right">Corrected</TH>
              <TH className="text-right">Gross impact</TH>
              <TH className="text-right">Tax impact</TH>
              <TH className="text-right">Pension impact</TH>
              <TH className="text-right">Net impact</TH>
              <TH>Reason</TH>
              <TH>Requested / approved</TH>
              <TH>Processed in</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((a) => (
              <TR key={a.id}>
                <TD>
                  {a.employee.employeeNumber} — {fullName(a.employee)}
                </TD>
                <TD>{a.originalPeriod.name}</TD>
                <TD className="text-xs">{a.arrearsType.replace(/_/g, " ")}</TD>
                <TD className="text-right">{naira(a.originalAmount)}</TD>
                <TD className="text-right">{naira(a.correctedAmount)}</TD>
                <TD className="text-right font-medium">{naira(a.grossImpact)}</TD>
                <TD className="text-right">{naira(a.taxImpact)}</TD>
                <TD className="text-right">{naira(a.pensionImpact)}</TD>
                <TD className="text-right">{naira(a.netImpact)}</TD>
                <TD className="max-w-xs truncate text-xs" title={a.reason}>
                  {a.reason}
                </TD>
                <TD className="text-xs">
                  {a.requestedBy}
                  <div>{a.approvedBy ?? "—"}</div>
                </TD>
                <TD>{a.processedPeriod?.name ?? "—"}</TD>
                <TD>
                  <StatusBadge status={a.status} />
                </TD>
                <TD>
                  <ApproveReject
                    kind="arrears"
                    id={a.id}
                    status={a.status}
                    canApprove={can(ctx.role, "payroll.inputs.approve")}
                    approve={approveArrearsAction.bind(null, a.id)}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No arrears.</Empty>}
      </Section>
    </>
  );
}
