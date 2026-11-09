import { FEEDBACK_KIND_LABELS, type FeedbackKind } from "@/lib/feedback";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { ActionButton } from "@/components/action-button";
import { Empty } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { voidFeedbackAction } from "@/app/actions/feedback";

export interface FeedbackRow {
  id: string;
  kind: string;
  body: string;
  relatesOn: Date;
  authorName: string;
  employeeReply: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  employee: { employeeNumber: string; firstName: string; lastName: string };
}

/** Feedback about employees, for HR (who can void an entry) and for a manager (their own direct reports). */
export function FeedbackList({ rows, canVoid }: { rows: FeedbackRow[]; canVoid: boolean }) {
  if (!rows.length) return <Empty>No feedback.</Empty>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Employee</TH>
          <TH>Kind</TH>
          <TH>About</TH>
          <TH>Feedback</TH>
          {canVoid && <TH />}
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id} className={r.voidedAt ? "opacity-60" : ""}>
            <TD>
              {fullName(r.employee)}
              <div className="text-xs text-muted-foreground">{r.employee.employeeNumber}</div>
            </TD>
            <TD>
              <Badge tone={r.kind === "RECOGNITION" ? "green" : "amber"}>{FEEDBACK_KIND_LABELS[r.kind as FeedbackKind]}</Badge>
            </TD>
            <TD className="text-xs">
              {fmtDate(r.relatesOn)}
              <div className="text-muted-foreground">by {r.authorName}</div>
            </TD>
            <TD className="max-w-md whitespace-normal">
              <p className="whitespace-pre-line text-sm">{r.body}</p>
              {r.employeeReply && (
                <p className="mt-1 rounded bg-muted/50 px-2 py-1 text-xs">
                  <b>Employee&apos;s reply:</b> {r.employeeReply}
                </p>
              )}
              {r.voidedAt && (
                <p className="mt-1 text-xs text-red-700">
                  <b>Voided:</b> {r.voidReason}
                </p>
              )}
            </TD>
            {canVoid && (
              <TD>
                {!r.voidedAt && (
                  <ActionButton action={voidFeedbackAction.bind(null, r.id)} reason reasonPlaceholder="Why is it being voided? (required)" variant="outline">
                    Void
                  </ActionButton>
                )}
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
