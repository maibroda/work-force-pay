import Link from "next/link";
import type { yearEndStatus } from "@/server/services/year-end";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { closeFiscalYearAction, reopenFiscalYearAction } from "@/app/actions/periods";

type Status = Awaited<ReturnType<typeof yearEndStatus>>;

/** The year-end close for one financial year: what stops it, what it would do, or what it did and how to undo it. */
export function YearEnd({ status: s, canClose, canReopen }: { status: Status; canClose: boolean; canReopen: boolean }) {
  const y = s.year;
  return (
    <div className="border-t bg-muted/20 px-4 py-3 text-sm">
      <p className="mb-1 font-medium">Year-end close</p>
      {y.closedAt ? (
        <div className="space-y-2">
          <p>
            Closed {fmtDate(y.closedAt)} by {y.closedBy}. The closing journal{" "}
            {s.closing ? (
              <Link className="text-primary underline" href={`/accounting/journals/${s.closing.id}`}>
                {s.closing.entryNumber}
              </Link>
            ) : null}{" "}
            brought every income and expense account to nil and moved the profit or loss to retained earnings. Nothing more can be posted to income or expense accounts dated in this year.
          </p>
          {canReopen && (
            <ActionButton action={reopenFiscalYearAction.bind(null, y.id)} reason reasonPlaceholder="Why the year is being reopened (a sentence or two; it is recorded)" variant="outline">
              Reopen the year
            </ActionButton>
          )}
        </div>
      ) : s.problems.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {s.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : s.nothingToClose ? (
        <p className="text-muted-foreground">There are no income or expense postings in this year to close.</p>
      ) : (
        <div className="space-y-2">
          <p>
            Ready. Closing posts one journal dated {fmtDate(y.endDate)} that brings {s.closingLines} income and expense balance{s.closingLines === 1 ? "" : "s"} to nil and moves the {s.profit >= 0 ? "profit" : "loss"} of <b>{naira(Math.abs(s.profit))}</b> to the retained earnings account you choose. Close the last period afterwards in the usual way.
          </p>
          {canClose && (
            <SmartForm
              columns={2}
              submitLabel="Close the year"
              action={closeFiscalYearAction.bind(null, y.id)}
              fields={[
                {
                  name: "retainedEarningsAccountId",
                  label: "Move the profit or loss to",
                  type: "select",
                  required: true,
                  defaultValue: s.suggestedAccountId ?? "",
                  options: s.equity.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
                },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}
