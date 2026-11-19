import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { hourlyPayEnabled } from "@/server/services/hourly-pay";
import { listTimeEntries } from "@/server/services/time-entries";
import { options } from "@/server/options";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  approveTimeEntryAction,
  approveTimeEntryNoBreakAction,
  captureTimeEntryAction,
  completeClockOutAction,
  correctTimeEntryAction,
  rejectTimeEntryAction,
  submitTimeEntryAction,
  withdrawTimeEntryAction,
} from "@/app/actions/time-entries";

/** A time as Nigerian wall-clock time (UTC plus one hour), "2026-11-20 19:00". */
const wat = (d: Date | null) => (d ? new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16).replace("T", " ") : "no clock-out");
const hours = (minutes: number | null) => (minutes === null ? "—" : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`);

export default async function TimeEntriesPage() {
  const ctx = await requirePage("operations.view");
  if (!(await hourlyPayEnabled(ctx.orgId)))
    return (
      <>
        <PageHeader title="Hourly shifts" description="Clock-in and clock-out times for people who are paid by the hour." />
        <Section title="Hourly pay is not switched on for this company">
          <p className="text-sm text-muted-foreground">
            Shifts are entered only for people paid by the hour. A company administrator switches hourly pay on under{" "}
            <Link className="underline" href="/payroll/hourly-pay">
              Payroll › Hourly pay
            </Link>
            .
          </p>
        </Section>
      </>
    );
  const [{ entries }, o] = await Promise.all([listTimeEntries(ctx, {}), options(ctx)]);
  const capture = can(ctx.role, "attendance.record");
  const mayDecide = ctx.role === "SUPERVISOR" || can(ctx.role, "payroll.inputs.approve");
  const who = (e: (typeof entries)[number]) => `${e.employee.employeeNumber} — ${e.employee.firstName} ${e.employee.lastName}`;
  const submitted = entries.filter((e) => e.status === "SUBMITTED");
  const drafts = entries.filter((e) => e.status === "DRAFT");
  const approved = entries.filter((e) => e.status === "APPROVED");
  const rest = entries.filter((e) => !["SUBMITTED", "DRAFT", "APPROVED"].includes(e.status));
  const label = (e: (typeof entries)[number]) => `${who(e)}: ${wat(e.clockIn)} to ${wat(e.clockOut)}`;
  const head = (
    <THead>
      <TR>
        <TH>Employee</TH>
        <TH>Site</TH>
        <TH>Clock-in</TH>
        <TH>Clock-out</TH>
        <TH>Paid</TH>
        <TH>Status</TH>
        <TH />
      </TR>
    </THead>
  );
  const cells = (e: (typeof entries)[number]) => (
    <>
      <TD>{who(e)}</TD>
      <TD>{e.beat.name}</TD>
      <TD>{wat(e.clockIn)}</TD>
      <TD>{wat(e.clockOut)}</TD>
      <TD>{hours(e.payableMinutes)}</TD>
      <TD>
        <StatusBadge status={e.status} />
        {e.correctsId ? <span className="ml-1 text-xs text-muted-foreground">(a correction)</span> : null}
      </TD>
    </>
  );
  return (
    <>
      <PageHeader
        title="Hourly shifts"
        description="Clock-in and clock-out times (Nigerian time) for people who are paid by the hour. Someone captures a shift; a different person, the site's supervisor, approves it and records the breaks. Only approved shifts count, a shift with no clock-out is never paid, and an approved shift is never edited: a correction replaces it. The pay run does not read these yet."
      />
      <Section title={`Waiting for approval (${submitted.length})`} flush>
        {submitted.length ? (
          <Table>
            {head}
            <TBody>
              {submitted.map((e) => (
                <TR key={e.id}>
                  {cells(e)}
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {mayDecide && e.capturedByUserId !== ctx.userId && e.completedByUserId !== ctx.userId && (
                      <>
                        <ActionButton action={approveTimeEntryNoBreakAction.bind(null, e.id)} confirm="Approve this shift with no break?" variant="success">
                          Approve (no break)
                        </ActionButton>
                        <ActionButton action={rejectTimeEntryAction.bind(null, e.id)} reason variant="outline">
                          Reject
                        </ActionButton>
                      </>
                    )}
                    {e.capturedByUserId === ctx.userId && (
                      <ActionButton action={withdrawTimeEntryAction.bind(null, e.id)} confirm="Withdraw this entry?" variant="outline">
                        Withdraw
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>Nothing waiting.</Empty>
        )}
      </Section>
      {mayDecide && submitted.length > 0 && (
        <FormPanel title="Approve a shift with breaks">
          <SmartForm
            columns={2}
            submitLabel="Approve"
            action={approveTimeEntryAction}
            fields={[
              { name: "id", label: "Shift", type: "select", required: true, options: submitted.map((e) => ({ value: e.id, label: label(e) })) },
              { name: "breaks", label: "Breaks taken (clock times)", placeholder: "e.g. 13:00-13:30, 02:00-02:15", help: "Unpaid breaks come off the paid hours. Write the times the break started and ended, so a break after midnight comes off the right day." },
            ]}
          />
        </FormPanel>
      )}
      <Section title={`Drafts (${drafts.length})`} description="A draft with no clock-out is never paid until the clock-out is entered." flush>
        {drafts.length ? (
          <Table>
            {head}
            <TBody>
              {drafts.map((e) => (
                <TR key={e.id}>
                  {cells(e)}
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {capture && e.clockOut && (
                      <ActionButton action={submitTimeEntryAction.bind(null, e.id)} confirm="Submit this shift for approval?" variant="success">
                        Submit
                      </ActionButton>
                    )}
                    {capture && e.capturedByUserId === ctx.userId && (
                      <ActionButton action={withdrawTimeEntryAction.bind(null, e.id)} confirm="Withdraw this entry?" variant="outline">
                        Withdraw
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>No drafts.</Empty>
        )}
      </Section>
      {capture && (
        <FormPanel title="Enter a shift">
          <SmartForm
            columns={2}
            submitLabel="Save as draft"
            action={captureTimeEntryAction}
            fields={[
              { name: "employeeId", label: "Employee (paid by the hour)", type: "select", required: true, options: o.employees },
              { name: "beatId", label: "Site", type: "select", required: true, options: o.beats },
              { name: "clockIn", label: "Clock-in (Nigerian time)", required: true, placeholder: "2026-11-20 19:00" },
              { name: "clockOut", label: "Clock-out (Nigerian time)", placeholder: "2026-11-21 07:00", help: "Leave empty if it is missing: the shift is then never paid until a supervisor enters it." },
            ]}
          />
        </FormPanel>
      )}
      {capture && drafts.some((e) => !e.clockOut) && (
        <FormPanel title="Enter a missing clock-out">
          <SmartForm
            columns={2}
            submitLabel="Save"
            action={completeClockOutAction}
            fields={[
              { name: "id", label: "Shift with no clock-out", type: "select", required: true, options: drafts.filter((e) => !e.clockOut).map((e) => ({ value: e.id, label: label(e) })) },
              { name: "clockOut", label: "Real clock-out (Nigerian time)", required: true, placeholder: "2026-11-21 07:00", help: "Whoever enters it cannot approve the same shift." },
            ]}
          />
        </FormPanel>
      )}
      <Section title={`Approved (${approved.length})`} flush>
        {approved.length ? (
          <Table>
            {head}
            <TBody>
              {approved.map((e) => (
                <TR key={e.id}>
                  {cells(e)}
                  <TD />
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Empty>Nothing approved yet.</Empty>
        )}
      </Section>
      {capture && approved.length > 0 && (
        <FormPanel title="Correct an approved shift">
          <SmartForm
            columns={2}
            submitLabel="Start correction"
            action={correctTimeEntryAction}
            fields={[
              { name: "id", label: "Approved shift", type: "select", required: true, options: approved.map((e) => ({ value: e.id, label: label(e) })) },
              { name: "beatId", label: "Site (if it changes)", type: "select", options: o.beats },
              { name: "clockIn", label: "Correct clock-in (Nigerian time)", required: true, placeholder: "2026-11-20 09:00" },
              { name: "clockOut", label: "Correct clock-out (Nigerian time)", required: true, placeholder: "2026-11-20 17:00" },
              { name: "reason", label: "Why", required: true, span: 2, help: "The original stays as it is, and counts, until someone else approves the correction. Not possible once the pay period is approved or locked: that goes through a supplementary payroll." },
            ]}
          />
        </FormPanel>
      )}
      {rest.length > 0 && (
        <Section title="Rejected, withdrawn and replaced" description="Kept for the record." flush>
          <Table>
            {head}
            <TBody>
              {rest.map((e) => (
                <TR key={e.id}>
                  {cells(e)}
                  <TD />
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
