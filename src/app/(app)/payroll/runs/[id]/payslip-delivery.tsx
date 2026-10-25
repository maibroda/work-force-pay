import { can } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/auth/context";
import { fmtDate } from "@/lib/dates";
import { deliveryOverview, getPayslipSetting } from "@/server/services/payslips";
import { ActionButton } from "@/components/action-button";
import { Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { emailPayslipsAction, resendPayslipAction, setPayslipEmailAction } from "@/app/actions/payslips";

/** Payslips for an approved or locked payroll: download them, or email each to its employee. */
export async function PayslipDelivery({ ctx, runId }: { ctx: Ctx; runId: string }) {
  const [o, setting] = await Promise.all([deliveryOverview(ctx, runId), getPayslipSetting(ctx)]);
  const pending = o.rows.filter((r) => r.hasEmail && !r.sent).length;
  return (
    <Section
      title="Payslips"
      description="PDFs, one per employee. Account numbers, tax IDs and pension PINs are masked to their last four characters. Every download and email is recorded."
      actions={
        <a className={buttonVariants({ variant: "outline" })} href={`/api/payroll/runs/${runId}/payslips`}>
          Download all (zip)
        </a>
      }
    >
      {setting.emailEnabled ? (
        <div className="space-y-3">
          <p className="text-sm">
            {o.withEmail} employee(s) have an email address, {o.withoutEmail} do not; {o.alreadySent} already sent.
          </p>
          <ActionButton action={emailPayslipsAction.bind(null, runId)} confirm={`Email ${pending} payslip(s) to employees?`} variant="default">
            Email {pending} payslip(s)
          </ActionButton>
          {o.withoutEmail > 0 && <p className="text-xs text-muted-foreground">Those without an email address can be downloaded and given to them another way.</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Emailing payslips is off. Download them to give out yourself, or switch emailing on below.</p>
      )}
      {can(ctx.role, "settings.manage") && (
        <div className="mt-4">
          <SmartForm columns={3} submitLabel="Save" action={setPayslipEmailAction} fields={[{ name: "emailEnabled", label: "Allow payslips to be emailed to employees (they contain salary information)", type: "checkbox", defaultValue: setting.emailEnabled, span: 3 }]} />
        </div>
      )}
      {o.log.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-medium">Recently emailed</p>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>To</TH>
                <TH>By</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {o.log.map((l) => (
                <TR key={l.id}>
                  <TD>{fmtDate(l.sentAt)}</TD>
                  <TD className="text-xs">{l.toEmail}</TD>
                  <TD className="text-xs">{l.sentBy}</TD>
                  <TD>
                    {setting.emailEnabled && (
                      <ActionButton action={resendPayslipAction.bind(null, runId, l.recordId)} confirm="Send this payslip again?" variant="ghost">
                        Resend
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      {o.rows.some((r) => r.sent) && <Badge className="mt-3">{o.alreadySent} sent</Badge>}
    </Section>
  );
}
