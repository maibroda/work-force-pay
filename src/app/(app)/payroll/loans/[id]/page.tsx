import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getLoan } from "@/server/services/loans";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FormPanel, KV, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  approveLoanAction,
  cancelLoanAction,
  cashRepaymentAction,
  rejectLoanAction,
  writeOffLoanAction,
} from "@/app/actions/loans";

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("payroll.view");
  const { id } = await params;
  const l = await getLoan(ctx, id);
  if (!l) notFound();
  const manage = can(ctx.role, "loan.manage");
  const approve = can(ctx.role, "loan.approve");
  const own = l.requestedById === ctx.userId;
  const kind = l.type === "SALARY_ADVANCE" ? "advance" : "loan";
  return (
    <>
      <PageHeader
        title={`${l.loanNumber} — ${l.employee.employeeNumber} ${fullName(l.employee)}`}
        crumbs={[{ href: "/payroll/loans", label: "Loans & advances" }]}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={l.effectiveStatus} /> {kind} of {naira(l.principal)}
          </span>
        }
        actions={
          <>
            {approve && l.status === "PENDING_APPROVAL" && !own && (
              <>
                <ActionButton action={approveLoanAction.bind(null, l.id)} variant="success">
                  Approve & pay out
                </ActionButton>
                <ActionButton action={rejectLoanAction.bind(null, l.id)} reason reasonPlaceholder="Reason for rejecting" variant="outline">
                  Reject
                </ActionButton>
              </>
            )}
            {manage && l.status === "PENDING_APPROVAL" && (
              <ActionButton action={cancelLoanAction.bind(null, l.id)} confirm="Cancel this request?" variant="outline">
                Cancel request
              </ActionButton>
            )}
            {approve && l.status === "ACTIVE" && l.outstanding > 0 && !own && (
              <ActionButton action={writeOffLoanAction.bind(null, l.id)} reason reasonPlaceholder="Why is the balance being written off?" variant="outline">
                Write off balance
              </ActionButton>
            )}
          </>
        }
      />
      {l.status === "PENDING_APPROVAL" && own && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You requested this {kind}, so someone else has to approve it.
        </p>
      )}

      <StatGrid cols={4}>
        <Stat label="Amount" value={naira(l.principal)} />
        <Stat label="Repaid" value={naira(l.repaid)} tone="green" />
        <Stat label="Queued in payroll" value={naira(l.scheduled)} sub="counts as repaid once that payroll is locked" />
        <Stat label="Outstanding" value={l.status === "ACTIVE" ? naira(l.outstanding) : "—"} tone={l.outstanding > 0 && l.status === "ACTIVE" ? "amber" : undefined} />
      </StatGrid>

      <Section title="Terms">
        <KV
          cols={4}
          items={[
            ["Repayment", `${naira(l.installmentAmount)} × ${l.installmentCount} month(s)`],
            ["First repayment", `${MONTHS[l.firstDeductionMonth]} ${l.firstDeductionYear}`],
            ["Reason", l.reason],
            ["Requested by", `${l.requestedBy} · ${fmtDate(l.createdAt)}`],
            ["Decision", l.approvedBy ? `${l.approvedBy} · ${fmtDate(l.approvedAt)}` : "—"],
            ["Decision note", l.decisionNote],
            ["Paid out on", l.disbursedOn ? fmtDate(l.disbursedOn) : "—"],
            ["Written off", l.writtenOffAmount ? `${naira(l.writtenOffAmount)} — ${l.writtenOffReason}` : "—"],
          ]}
        />
      </Section>

      <Section title="Repayments" flush>
        <Table>
          <THead>
            <TR>
              <TH>How</TH>
              <TH>Period / date</TH>
              <TH className="text-right">Amount</TH>
              <TH>State</TH>
              <TH>Reference</TH>
              <TH>Recorded by</TH>
            </TR>
          </THead>
          <TBody>
            {l.installmentRows.map((i) => (
              <TR key={i.id}>
                <TD className="text-xs">{i.kind === "PAYROLL" ? "Payroll deduction" : i.kind === "SETTLEMENT" ? "Settlement recovery" : "Cash / transfer"}</TD>
                <TD className="text-xs">{i.periodName ?? (i.paidOn ? fmtDate(i.paidOn) : "—")}</TD>
                <TD className="text-right">{naira(i.amount)}</TD>
                <TD>{i.kind === "CASH" ? <StatusBadge status="PROCESSED" /> : i.deductionState ? <StatusBadge status={i.deductionState} /> : "—"}</TD>
                <TD className="text-xs">{i.reference ?? "—"}</TD>
                <TD className="text-xs">{i.createdBy}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!l.installmentRows.length && <Empty>No repayments yet — schedule them from the Loans page.</Empty>}
      </Section>

      {manage && l.status === "ACTIVE" && l.unscheduled > 0 && (
        <FormPanel title="Record a cash repayment">
          <SmartForm
            columns={3}
            submitLabel="Record"
            action={cashRepaymentAction.bind(null, l.id)}
            fields={[
              { name: "amount", label: "Amount (₦)", type: "number", required: true, min: 0.01, help: `Up to ${naira(l.unscheduled)} (the rest is queued in payroll).` },
              { name: "paidOn", label: "Paid on", type: "date" },
              { name: "reference", label: "Reference" },
            ]}
          />
        </FormPanel>
      )}
      <p className="mb-8 text-xs text-muted-foreground">
        <Link className="underline" href={`/employees/${l.employeeId}`}>
          Employee record
        </Link>{" "}
        · If {l.employee.firstName} leaves with a balance, add it to their end-of-service settlement with one click.
      </p>
    </>
  );
}
