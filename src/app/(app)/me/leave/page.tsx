import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { myLeave } from "@/server/services/leave";
import { fmtDate, iso } from "@/lib/dates";
import { Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { applyLeaveAction, cancelLeaveAction } from "@/app/actions/leave";

/** Mobile-first: an employee's annual-leave balance, application form and request history. */
export default async function MyLeavePage() {
  const ctx = await requirePage("leave.apply");
  const data = await myLeave(ctx);
  if (!data) return <Empty>Your user account is not linked to an employee record.</Empty>;
  const { balance: b, policy, requests } = data;
  const today = iso(new Date());
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-lg font-semibold">My annual leave</h1>
        <Link href="/me" className="text-xs text-primary underline">
          ← My dashboard
        </Link>
      </div>

      <Card className="p-4">
        {b.due && b.cycle ? (
          <>
            <p className="text-xs text-muted-foreground">
              Leave year {fmtDate(b.cycle.start)} – {fmtDate(b.cycle.end)}
            </p>
            <p className="text-3xl font-bold tabular-nums">
              {b.remaining}
              <span className="text-base font-normal text-muted-foreground">
                {" "}
                of {b.entitled} working days left
              </span>
            </p>
            <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[11px]">
              <div className="rounded bg-emerald-50 p-1">
                <b className="block text-base text-emerald-700">{b.approved}</b>Taken / approved
              </div>
              <div className="rounded bg-amber-50 p-1">
                <b className="block text-base text-amber-700">{b.pending}</b>Awaiting approval
              </div>
              <div className="rounded bg-slate-100 p-1">
                <b className="block text-base">{b.remaining}</b>Available
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Leave must start before {fmtDate(b.cycle.end)}. Your next {policy.annualDays} days fall due on{" "}
              {fmtDate(b.nextDueDate)}.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Annual leave entitlement</p>
            <p className="text-lg font-semibold">Not due yet</p>
            <p className="text-sm text-muted-foreground">
              You earn {policy.annualDays} working days of leave after {policy.eligibilityMonths} months&apos;
              service. Yours falls due on <b>{fmtDate(b.nextDueDate)}</b> — you can apply from that day.
            </p>
          </>
        )}
      </Card>

      {b.due && b.remaining > 0 && (
        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold">Apply for leave</p>
          <SmartForm
            columns={1}
            submitLabel="Submit for approval"
            action={applyLeaveAction}
            fields={[
              {
                name: "startDate",
                label: "First day of leave",
                type: "date",
                required: true,
                defaultValue: today,
              },
              {
                name: "endDate",
                label: "Last day of leave",
                type: "date",
                required: true,
                help: `Working days only are counted (${policy.workingDaysPerWeek}-day week). Your supervisor approves the request.`,
              },
              { name: "reason", label: "Reason (optional)", type: "textarea" },
            ]}
          />
        </Card>
      )}
      {b.due && b.remaining === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">
          You have used or requested all {b.entitled} days for this leave year.
        </Card>
      )}

      <Card className="p-4">
        <p className="mb-2 text-sm font-semibold">My requests</p>
        {requests.length ? (
          <ul className="divide-y">
            {requests.map((r) => {
              const cancellable =
                r.status === "PENDING" || (r.status === "APPROVED" && iso(r.startDate) > today);
              return (
                <li key={r.id} className="space-y-1 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.workingDays} working day(s)
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                  {r.decidedBy && (
                    <p className="text-xs text-muted-foreground">
                      {r.status === "REJECTED" ? "Rejected" : "Approved"} by {r.decidedBy}
                      {r.decisionNote ? ` — “${r.decisionNote}”` : ""}
                    </p>
                  )}
                  {cancellable && (
                    <ActionButton
                      action={cancelLeaveAction.bind(null, r.id)}
                      variant="outline"
                      confirm="Cancel this request?"
                    >
                      Cancel request
                    </ActionButton>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">You have not requested any leave yet.</p>
        )}
      </Card>
    </div>
  );
}
