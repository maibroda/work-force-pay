import { PROMOTION_STATUS_LABELS, PROMOTION_WARNING_LABELS, type PromotionStatus, type PromotionWarning } from "@/lib/career";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { ActionButton } from "@/components/action-button";
import { Empty } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { applyPromotionAction, approvePromotionAction, declinePromotionAction, withdrawPromotionAction } from "@/app/actions/career";

export interface PromotionRow {
  id: string;
  status: string;
  reason: string;
  intendedOn: Date;
  proposedBy: string;
  proposedAt: Date;
  proposedByUserId: string;
  decisionNote: string | null;
  withdrawReason: string | null;
  appliedAt: Date | null;
  /** Present only for someone who reads HR records: the warnings are for the decider. */
  warnings?: string[];
  employee: { employeeNumber: string; firstName: string; lastName: string };
  fromCategory: { name: string };
  toCategory: { name: string };
}

const TONE: Record<string, "amber" | "green" | "red" | "gray" | "blue"> = { PROPOSED: "amber", APPROVED: "blue", DECLINED: "red", WITHDRAWN: "gray", APPLIED: "green" };

/** Promotion proposals. HR who can decide sees approve / decline; the proposer may withdraw while it is undecided; HR marks an approved one applied. The service decides every one again on the server. */
export function PromotionList({ rows, canDecide, canApply, userId }: { rows: PromotionRow[]; canDecide: boolean; canApply: boolean; userId: string }) {
  if (!rows.length) return <Empty>No proposals.</Empty>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Employee</TH>
          <TH>Move</TH>
          <TH>Why</TH>
          <TH>Status</TH>
          <TH />
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => {
          const undecided = r.status === "PROPOSED";
          const mine = r.proposedByUserId === userId;
          const warned = (r.warnings?.length ?? 0) > 0;
          return (
            <TR key={r.id}>
              <TD>
                {fullName(r.employee)}
                <div className="text-xs text-muted-foreground">{r.employee.employeeNumber}</div>
              </TD>
              <TD className="whitespace-normal text-sm">
                {r.fromCategory.name} → {r.toCategory.name}
                <div className="text-xs text-muted-foreground">Intended {fmtDate(r.intendedOn)}</div>
              </TD>
              <TD className="max-w-md whitespace-normal">
                <p className="whitespace-pre-line text-sm">{r.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Proposed by {r.proposedBy} on {fmtDate(r.proposedAt)}
                </p>
                {warned && (
                  <ul className="mt-1 list-disc pl-4 text-xs text-amber-800">
                    {r.warnings!.map((w) => (
                      <li key={w}>{PROMOTION_WARNING_LABELS[w as PromotionWarning] ?? w}</li>
                    ))}
                  </ul>
                )}
                {r.decisionNote && <p className="mt-1 text-xs">Decision note: {r.decisionNote}</p>}
                {r.withdrawReason && <p className="mt-1 text-xs text-red-700">Withdrawn: {r.withdrawReason}</p>}
              </TD>
              <TD>
                <Badge tone={TONE[r.status] ?? "gray"}>{PROMOTION_STATUS_LABELS[r.status as PromotionStatus] ?? r.status}</Badge>
                {r.appliedAt && <div className="mt-1 text-xs text-muted-foreground">on {fmtDate(r.appliedAt)}</div>}
              </TD>
              <TD>
                <span className="flex flex-wrap gap-1">
                  {undecided && canDecide && !mine && (
                    <>
                      {warned ? (
                        <ActionButton action={approvePromotionAction.bind(null, r.id)} reason reasonPlaceholder="A warning applies: why approve? (required)">
                          Approve
                        </ActionButton>
                      ) : (
                        <ActionButton action={approvePromotionAction.bind(null, r.id)} confirm="Approve this proposal? Nothing about the employee changes yet.">
                          Approve
                        </ActionButton>
                      )}
                      <ActionButton action={declinePromotionAction.bind(null, r.id)} reason reasonPlaceholder="Why is it declined? (required)" variant="outline">
                        Decline
                      </ActionButton>
                    </>
                  )}
                  {undecided && canDecide && mine && <span className="text-xs text-muted-foreground">You proposed this: someone else decides.</span>}
                  {((undecided && mine) || (r.status === "APPROVED" && canDecide)) && (
                    <ActionButton action={withdrawPromotionAction.bind(null, r.id)} reason reasonPlaceholder="Why is it withdrawn? (required)" variant="outline">
                      Withdraw
                    </ActionButton>
                  )}
                  {r.status === "APPROVED" && canApply && (
                    <ActionButton action={applyPromotionAction.bind(null, r.id)} confirm="Mark applied? First change the employee's role on their record, and their pay through the pay-rate proposal.">
                      Mark applied
                    </ActionButton>
                  )}
                </span>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
