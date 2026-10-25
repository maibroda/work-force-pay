import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { calendarOverview, getCalendarSetting } from "@/server/services/payroll-calendar";
import { getReminderSetting, previewReminders, recentReminders } from "@/server/services/payroll-reminders";
import { INPUT_KIND_LABELS, INPUT_KINDS, MILESTONES } from "@/lib/payroll-calendar";
import { fmtDate } from "@/lib/dates";
import { ActionButton } from "@/components/action-button";
import { Empty, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { generateMissingCalendarsAction, saveCalendarSettingAction, saveReminderSettingAction, sendRemindersNowAction } from "@/app/actions/payroll-calendar";

const TONE = { DONE: "green", OVERDUE: "red", DUE_SOON: "amber", UPCOMING: "gray" } as const;
const WORDS = { DONE: "Done", OVERDUE: "Overdue", DUE_SOON: "Due soon", UPCOMING: "Upcoming" } as const;

export default async function CalendarPage() {
  const ctx = await requirePage("payroll.view");
  const [rows, setting, reminders, preview, sent] = await Promise.all([calendarOverview(ctx), getCalendarSetting(ctx), getReminderSetting(ctx), previewReminders(ctx), recentReminders(ctx)]);
  const canInputs = can(ctx.role, "payroll.inputs");
  const missing = rows.filter((r) => !r.dates).length;
  return (
    <>
      <PageHeader
        title="Payroll calendar"
        description="The dates each month runs to, and where each deadline stands. Draft, approval, pay and remittance are read from the payroll itself, so a deadline is never ticked off by hand."
        actions={
          canInputs &&
          missing > 0 && (
            <ActionButton action={generateMissingCalendarsAction}>Generate dates for {missing} month(s)</ActionButton>
          )
        }
      />
      <Section title="Months" flush>
        <Table>
          <THead>
            <TR>
              <TH>Month</TH>
              {MILESTONES.map((m) => (
                <TH key={m.key}>{m.label}</TH>
              ))}
              <TH>Next</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.period.id}>
                <TD className="font-medium">
                  {r.period.name}
                  {r.adjusted && <Badge className="ml-2">adjusted</Badge>}
                </TD>
                {MILESTONES.map((m) => {
                  const ms = r.milestones.find((x) => x.key === m.key);
                  return (
                    <TD key={m.key} className="text-xs">
                      {r.dates ? (
                        <>
                          {fmtDate(r.dates[m.key])}
                          <br />
                          <Badge tone={TONE[ms!.state]}>{WORDS[ms!.state]}</Badge>
                        </>
                      ) : (
                        "—"
                      )}
                    </TD>
                  );
                })}
                <TD className="text-xs">{r.next ? r.next.label : r.dates ? "All done" : "No dates yet"}</TD>
                <TD>
                  <Link className="text-primary underline" href={`/payroll/calendar/${r.period.id}`}>
                    Open
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No payroll periods yet.</Empty>}
      </Section>

      <Section
        title="Email reminders"
        description={
          reminders.enabled
            ? "On. Reminders go out on working days, once a day at most for the same thing: to the client's contact about inputs and approval they owe, and to the team about anything overdue or due soon."
            : "Off for this client. Switch them on below; until then nothing is sent."
        }
        actions={canInputs && reminders.enabled && <ActionButton action={sendRemindersNowAction}>Send today&apos;s reminders now</ActionButton>}
      >
        <p className="text-sm font-medium">What would go out today</p>
        {preview.notes.map((n) => (
          <p key={n} className="text-xs text-amber-800">
            {n}
          </p>
        ))}
        {preview.outcomes.length ? (
          <ul className="mt-1 list-disc pl-5 text-xs">
            {preview.outcomes.map((o, i) => (
              <li key={i}>
                {o.periodName}: {o.kind === "CLIENT_INPUTS" ? "inputs reminder" : o.kind === "CLIENT_APPROVAL" ? "approval reminder" : "team digest"} to {o.to}
                {o.status === "ALREADY_SENT_TODAY" ? " (already sent today)" : o.status === "LIMIT_REACHED" ? " (limit for this month reached)" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing is due for a reminder today.</p>
        )}
        {sent.length > 0 && (
          <>
            <p className="mt-4 text-sm font-medium">Recently sent</p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {sent.map((s) => (
                <li key={s.id}>
                  {fmtDate(s.sentAt)}: {s.subject} → {s.toEmail}
                </li>
              ))}
            </ul>
          </>
        )}
        {can(ctx.role, "settings.manage") && (
          <div className="mt-4">
            <SmartForm
              columns={3}
              submitLabel="Save reminder settings"
              action={saveReminderSettingAction}
              fields={[
                { name: "enabled", label: "Send reminders for this client", type: "checkbox", defaultValue: reminders.enabled },
                { name: "remindClient", label: "Email the client's contact (from the engagement)", type: "checkbox", defaultValue: reminders.remindClient },
                { name: "remindTeam", label: "Email the team working on this client", type: "checkbox", defaultValue: reminders.remindTeam },
                { name: "leadDays", label: "Remind this many days before a deadline", type: "number", min: 0, max: 14, defaultValue: reminders.leadDays },
                { name: "extraEmails", label: "Extra team addresses (comma separated)", span: 2, defaultValue: reminders.extraEmails.join(", ") },
              ]}
            />
          </div>
        )}
      </Section>

      {can(ctx.role, "settings.manage") && (
        <Section
          title="This client's rhythm"
          description="Agreed once with the client. Dates for each new month are worked out from it, then can be adjusted for a holiday or an agreed exception. Weekends move a date to the working day before; public holidays are not known, so adjust the month when one falls on a deadline."
        >
          <SmartForm
            columns={3}
            submitLabel="Save rhythm"
            action={saveCalendarSettingAction}
            fields={[
              { name: "inputCutoffDay", label: "Inputs due on day of the month", type: "number", required: true, min: 1, max: 28, defaultValue: setting.rule.inputCutoffDay },
              { name: "draftWorkingDays", label: "Draft due (working days after cut-off)", type: "number", required: true, min: 1, max: 15, defaultValue: setting.rule.draftWorkingDays },
              { name: "approvalWorkingDays", label: "Client approval due (working days after draft)", type: "number", required: true, min: 1, max: 15, defaultValue: setting.rule.approvalWorkingDays },
              { name: "payDayOfMonth", label: "Pay day (day of the month)", type: "number", required: true, min: 1, max: 31, defaultValue: setting.rule.payDayOfMonth },
              { name: "remittanceDueDay", label: "Remittances due (day of the next month)", type: "number", required: true, min: 1, max: 31, defaultValue: setting.rule.remittanceDueDay, help: "Check the statutory dates for each remittance with HR and Finance." },
              ...INPUT_KINDS.map((k) => ({ name: `input_${k}`, label: `Expect: ${INPUT_KIND_LABELS[k]}`, type: "checkbox" as const, defaultValue: setting.expectedInputs.includes(k) })),
            ]}
          />
        </Section>
      )}
    </>
  );
}
