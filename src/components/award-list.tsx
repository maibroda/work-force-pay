import { AWARD_STATUS_LABELS, type AwardStatus } from "@/lib/recognition";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { ActionButton } from "@/components/action-button";
import { Empty } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveAwardAction, rejectAwardAction, withdrawAwardAction } from "@/app/actions/recognition";

export interface AwardRow {
  id: string;
  status: string;
  citation: string;
  nominatedBy: string;
  nominatedAt: Date;
  nominatedByUserId: string;
  decisionNote: string | null;
  withdrawReason: string | null;
  employee: { employeeNumber: string; firstName: string; lastName: string };
  type: { name: string };
}

const TONE: Record<string, "amber" | "green" | "red" | "gray"> = { NOMINATED: "amber", APPROVED: "green", REJECTED: "red", WITHDRAWN: "gray" };

/** Nominations and awards. HR (who can decide) sees approve / decline; a nomination's author may withdraw it while it is undecided. The service decides every one of these again on the server. */
export function AwardList({ rows, canDecide, userId }: { rows: AwardRow[]; canDecide: boolean; userId: string }) {
  if (!rows.length) return <Empty>No nominations.</Empty>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Employee</TH>
          <TH>Award</TH>
          <TH>Why</TH>
          <TH>Status</TH>
          <TH />
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => {
          const undecided = r.status === "NOMINATED";
          const mine = r.nominatedByUserId === userId;
          return (
            <TR key={r.id}>
              <TD>
                {fullName(r.employee)}
                <div className="text-xs text-muted-foreground">{r.employee.employeeNumber}</div>
              </TD>
              <TD>{r.type.name}</TD>
              <TD className="max-w-md whitespace-normal">
                <p className="whitespace-pre-line text-sm">{r.citation}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nominated by {r.nominatedBy} on {fmtDate(r.nominatedAt)}
                </p>
                {r.decisionNote && <p className="mt-1 text-xs text-red-700">Declined: {r.decisionNote}</p>}
                {r.withdrawReason && <p className="mt-1 text-xs text-red-700">Withdrawn: {r.withdrawReason}</p>}
              </TD>
              <TD>
                <Badge tone={TONE[r.status] ?? "gray"}>{AWARD_STATUS_LABELS[r.status as AwardStatus] ?? r.status}</Badge>
              </TD>
              <TD>
                <span className="flex flex-wrap gap-1">
                  {undecided && canDecide && !mine && (
                    <>
                      <ActionButton action={approveAwardAction.bind(null, r.id)} confirm="Approve this award? The employee will see it.">
                        Approve
                      </ActionButton>
                      <ActionButton action={rejectAwardAction.bind(null, r.id)} reason reasonPlaceholder="Why is it declined? (required)" variant="outline">
                        Decline
                      </ActionButton>
                    </>
                  )}
                  {undecided && canDecide && mine && <span className="text-xs text-muted-foreground">You nominated this: someone else decides.</span>}
                  {((undecided && mine) || (r.status === "APPROVED" && canDecide)) && (
                    <ActionButton action={withdrawAwardAction.bind(null, r.id)} reason reasonPlaceholder="Why is it withdrawn? (required)" variant="outline">
                      Withdraw
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
