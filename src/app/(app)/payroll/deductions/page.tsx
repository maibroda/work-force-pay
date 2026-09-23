import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listDeductions } from "@/server/services/inputs";
import { enumOptions, options } from "@/server/options";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { DEDUCTION_AUTHORITY_ERROR } from "@/lib/payroll/engine";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveDeductionAction, createDeductionAction } from "@/app/actions/payroll";
import { ApproveReject } from "../_inputs";

export default async function DeductionsPage() {
  const ctx = await requirePage("payroll.view");
  const [rows, o] = await Promise.all([listDeductions(ctx), options(ctx)]);
  return (
    <>
      <PageHeader
        title="Penalties & other deductions"
        description={`Controlled deductions. Without documented authority the system rejects the entry: "${DEDUCTION_AUTHORITY_ERROR}"`}
      />
      {can(ctx.role, "payroll.inputs") && (
        <FormPanel title="Record deduction">
          <SmartForm
            columns={3}
            fields={[
              { name: "employeeId", label: "Employee", type: "select", required: true, options: o.employees },
              {
                name: "deductionType",
                label: "Type",
                type: "select",
                required: true,
                options: enumOptions(["PENALTY", "RECOVERY", "LOAN", "SALARY_ADVANCE", "OTHER"]),
              },
              { name: "amount", label: "Amount (₦)", type: "number", required: true, min: 1 },
              {
                name: "periodId",
                label: "Payroll period",
                type: "select",
                required: true,
                options: o.periods,
              },
              {
                name: "authorityReference",
                label: "Authority / reference",
                help: "Required — e.g. disciplinary panel ref.",
              },
              { name: "supportingDocument", label: "Supporting document" },
              { name: "reason", label: "Reason", required: true, span: 3 },
            ]}
            action={createDeductionAction}
            submitLabel="Save deduction"
          />
        </FormPanel>
      )}
      <Section title={`${rows.length} deduction(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Period</TH>
              <TH>Employee</TH>
              <TH>Type</TH>
              <TH className="text-right">Amount</TH>
              <TH>Reason</TH>
              <TH>Authority</TH>
              <TH>Document</TH>
              <TH>Requested / approved</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>{r.period.name}</TD>
                <TD>
                  {r.employee.employeeNumber} — {fullName(r.employee)}
                </TD>
                <TD className="text-xs">{r.deductionType}</TD>
                <TD className="text-right">{naira(r.amount)}</TD>
                <TD className="max-w-xs truncate text-xs">{r.reason}</TD>
                <TD className="text-xs">{r.authorityReference}</TD>
                <TD className="text-xs">{r.supportingDocument ?? "—"}</TD>
                <TD className="text-xs">
                  {r.requestedBy}
                  <div>{r.approvedBy ?? "—"}</div>
                </TD>
                <TD>
                  <StatusBadge status={r.status} />
                </TD>
                <TD>
                  <ApproveReject
                    kind="deduction"
                    id={r.id}
                    status={r.status}
                    canApprove={can(ctx.role, "payroll.inputs.approve")}
                    approve={approveDeductionAction.bind(null, r.id)}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No deductions.</Empty>}
      </Section>
    </>
  );
}
