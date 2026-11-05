import Link from "next/link";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { fullName } from "@/lib/utils";
import type { listPayRateProposals } from "@/server/services/pay-rate-proposals";
import { approvePayRateAction, cancelPayRateProposalAction, rejectPayRateAction } from "@/app/actions/pay-rate-proposals";
import { ActionButton } from "@/components/action-button";
import { Empty } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Row = Awaited<ReturnType<typeof listPayRateProposals>>[number];

/** Proposed personal monthly grosses, with the buttons each person may use: approve or reject (a payroll manager, never for their own proposal or their own pay), withdraw (the proposer). */
export function PayRateProposalsTable({ ctx, rows, showEmployee = true }: { ctx: Ctx; rows: Row[]; showEmployee?: boolean }) {
  if (!rows.length) return <Empty>No pay rate proposals.</Empty>;
  const approver = can(ctx.role, "payrate.approve");
  return (
    <Table>
      <THead>
        <TR>
          {showEmployee && <TH>Employee</TH>}
          <TH className="text-right">Monthly gross</TH>
          <TH>Structure</TH>
          <TH>From</TH>
          <TH>Reason</TH>
          <TH>Proposed by</TH>
          <TH>Status</TH>
          <TH />
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            {showEmployee && (
              <TD>
                <Link className="text-primary underline" href={`/employees/${r.employee.id}?tab=salary`}>
                  {r.employee.employeeNumber} — {fullName(r.employee)}
                </Link>
              </TD>
            )}
            <TD className="text-right">{naira(r.monthlyGross)}</TD>
            <TD>{r.structureCode ?? "default"}</TD>
            <TD>{fmtDate(r.effectiveFrom)}</TD>
            <TD className="max-w-xs whitespace-normal text-xs">
              {r.reason}
              {r.decisionNote && <div className="text-muted-foreground">Decision: {r.decisionNote}</div>}
            </TD>
            <TD className="text-xs">
              {r.proposedBy}
              <div className="text-muted-foreground">{fmtDate(r.createdAt)}</div>
            </TD>
            <TD>
              <StatusBadge status={r.status} />
            </TD>
            <TD className="space-x-1 whitespace-nowrap text-right">
              {r.status === "PENDING" && approver && r.proposedByUserId !== ctx.userId && ctx.employeeId !== r.employee.id && (
                <>
                  <ActionButton action={approvePayRateAction.bind(null, r.id)} confirm="Approve this pay rate? It becomes the employee's pay rate from its effective date." variant="success">
                    Approve
                  </ActionButton>
                  <ActionButton action={rejectPayRateAction.bind(null, r.id)} reason variant="outline">
                    Reject
                  </ActionButton>
                </>
              )}
              {r.status === "PENDING" && r.proposedByUserId === ctx.userId && (
                <ActionButton action={cancelPayRateProposalAction.bind(null, r.id)} confirm="Withdraw this proposal?" variant="outline">
                  Withdraw
                </ActionButton>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
