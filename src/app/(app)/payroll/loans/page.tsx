import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listLoans, loansSummary } from "@/server/services/loans";
import { options, enumOptions } from "@/server/options";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FilterBar, FilterField, FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { requestLoanAction, scheduleInstallmentsAction } from "@/app/actions/loans";

const STATUSES = ["PENDING_APPROVAL", "ACTIVE", "COMPLETED", "REJECTED", "CANCELLED", "WRITTEN_OFF"];
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function LoansPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const manage = can(ctx.role, "loan.manage");
  const [rows, sum, o] = await Promise.all([listLoans(ctx, { status: sp.status, q: sp.q }), loansSummary(ctx), options(ctx)]);
  return (
    <>
      <PageHeader
        title="Staff loans & advances"
        description="Interest-free money lent to an employee and repaid from payroll. A request needs approval from someone else; approving it records the payout. Repayments are scheduled into a payroll period as deductions and count as repaid once that payroll is locked."
      />
      <StatGrid cols={4}>
        <Stat label="Awaiting approval" value={sum.pending} sub={naira(sum.pendingValue)} tone={sum.pending ? "amber" : undefined} />
        <Stat label="Loans being repaid" value={sum.active} />
        <Stat label="Outstanding" value={naira(sum.outstanding)} sub={`${naira(sum.queuedInPayroll)} queued in payroll`} />
        <Stat label="Owed by people who've left" value={sum.holdersWhoLeft} tone={sum.holdersWhoLeft ? "red" : undefined} sub="recover on their settlement" />
      </StatGrid>

      {manage && (
        <div className="grid gap-5 lg:grid-cols-2">
          <FormPanel title="Request a loan or advance">
            <SmartForm
              columns={2}
              submitLabel="Request"
              action={requestLoanAction}
              fields={[
                { name: "employeeId", label: "Employee", type: "select", required: true, span: 2, options: o.employees },
                { name: "type", label: "Type", type: "select", defaultValue: "LOAN", options: enumOptions(["LOAN", "SALARY_ADVANCE"]) },
                { name: "principal", label: "Amount (₦)", type: "number", required: true, min: 1 },
                { name: "installmentCount", label: "Monthly repayments", type: "number", min: 1, max: 60, defaultValue: 6, help: "A salary advance is always repaid in one." },
                { name: "firstDeductionYear", label: "First repayment — year", type: "number", help: "Blank = next month." },
                { name: "firstDeductionMonth", label: "First repayment — month (1–12)", type: "number", min: 1, max: 12 },
                { name: "reason", label: "Reason", required: true, span: 2 },
              ]}
            />
          </FormPanel>
          <FormPanel title="Schedule this month's repayments">
            <p className="mb-3 text-xs text-muted-foreground">
              Adds each active loan&apos;s next instalment to the chosen payroll period as an approved deduction. Safe to run twice — a loan already scheduled in that period is skipped.
            </p>
            <SmartForm
              columns={1}
              submitLabel="Schedule repayments"
              action={scheduleInstallmentsAction}
              fields={[{ name: "periodId", label: "Payroll period", type: "select", required: true, options: o.openPeriods }]}
            />
          </FormPanel>
        </div>
      )}

      <FilterBar>
        <FilterField label="Search">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Loan no., employee" className="w-52" />
        </FilterField>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>

      <Section title={`${rows.length} loan(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Loan</TH>
              <TH>Employee</TH>
              <TH>Type</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Monthly</TH>
              <TH>From</TH>
              <TH className="text-right">Repaid</TH>
              <TH className="text-right">Outstanding</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((l) => (
              <TR key={l.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/payroll/loans/${l.id}`}>
                    {l.loanNumber}
                  </Link>
                </TD>
                <TD>
                  <Link className="hover:underline" href={`/employees/${l.employeeId}`}>
                    {l.employee.employeeNumber} — {fullName(l.employee)}
                  </Link>
                </TD>
                <TD className="text-xs">{l.type === "SALARY_ADVANCE" ? "advance" : "loan"}</TD>
                <TD className="text-right">{naira(l.principal)}</TD>
                <TD className="text-right text-xs">{naira(l.installmentAmount)} × {l.installmentCount}</TD>
                <TD className="text-xs">
                  {MONTHS[l.firstDeductionMonth]} {l.firstDeductionYear}
                </TD>
                <TD className="text-right">{naira(l.repaid)}</TD>
                <TD className="text-right font-medium">{l.status === "ACTIVE" ? naira(l.outstanding) : "—"}</TD>
                <TD>
                  <StatusBadge status={l.effectiveStatus} />
                </TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR className="font-semibold">
              <TD colSpan={7}>Outstanding on active loans</TD>
              <TD className="text-right">{naira(rows.filter((r) => r.status === "ACTIVE").reduce((s, r) => s + r.outstanding, 0))}</TD>
              <TD />
            </TR>
          </TFoot>
        </Table>
        {!rows.length && <Empty>No loans yet.</Empty>}
      </Section>
    </>
  );
}
