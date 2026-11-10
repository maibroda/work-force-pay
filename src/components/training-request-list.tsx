import { TRAINING_REQUEST_STATUS_LABELS, type TrainingRequestStatus } from "@/lib/training-evaluation";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { ActionButton } from "@/components/action-button";
import { Empty } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { acceptRequestAction, declineRequestAction, withdrawRequestAction } from "@/app/actions/training-evaluation";

export interface RequestRow {
  id: string;
  courseName: string;
  reason: string;
  status: string;
  requestedBy: string;
  requestedByUserId: string;
  requestedAt: Date;
  decisionNote: string | null;
  withdrawReason: string | null;
  employee: { employeeNumber: string; firstName: string; lastName: string };
}

const TONE: Record<string, "amber" | "green" | "red" | "gray"> = { REQUESTED: "amber", ACCEPTED: "green", DECLINED: "red", WITHDRAWN: "gray" };

/** Training requests. HR who can decide sees accept / decline; whoever made a request may withdraw it while undecided. The service decides every one again on the server. */
export function RequestList({ rows, canDecide, userId }: { rows: RequestRow[]; canDecide: boolean; userId: string }) {
  if (!rows.length) return <Empty>No requests.</Empty>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Employee</TH>
          <TH>Course</TH>
          <TH>Why</TH>
          <TH>Status</TH>
          <TH />
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => {
          const undecided = r.status === "REQUESTED";
          const mine = r.requestedByUserId === userId;
          return (
            <TR key={r.id}>
              <TD>
                {fullName(r.employee)}
                <div className="text-xs text-muted-foreground">{r.employee.employeeNumber}</div>
              </TD>
              <TD>{r.courseName}</TD>
              <TD className="max-w-md whitespace-normal">
                <p className="whitespace-pre-line text-sm">{r.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Asked by {r.requestedBy} on {fmtDate(r.requestedAt)}
                </p>
                {r.decisionNote && <p className="mt-1 text-xs text-red-700">Declined: {r.decisionNote}</p>}
                {r.withdrawReason && <p className="mt-1 text-xs text-red-700">Withdrawn: {r.withdrawReason}</p>}
              </TD>
              <TD>
                <Badge tone={TONE[r.status] ?? "gray"}>{TRAINING_REQUEST_STATUS_LABELS[r.status as TrainingRequestStatus] ?? r.status}</Badge>
              </TD>
              <TD>
                <span className="flex flex-wrap gap-1">
                  {undecided && canDecide && !mine && (
                    <>
                      <ActionButton action={acceptRequestAction.bind(null, r.id)} confirm="Accept this request? It is added to the training needs list; nothing else changes.">
                        Accept
                      </ActionButton>
                      <ActionButton action={declineRequestAction.bind(null, r.id)} reason reasonPlaceholder="Why is it declined? (required)" variant="outline">
                        Decline
                      </ActionButton>
                    </>
                  )}
                  {undecided && canDecide && mine && <span className="text-xs text-muted-foreground">You made this request: someone else decides.</span>}
                  {undecided && (mine || canDecide) && (
                    <ActionButton action={withdrawRequestAction.bind(null, r.id)} reason reasonPlaceholder="Why is it withdrawn? (required)" variant="outline">
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
