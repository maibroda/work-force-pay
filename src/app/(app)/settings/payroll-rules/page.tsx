import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listPayrollRules } from "@/server/services/statutory";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createPayrollRuleAction } from "@/app/actions/payroll";

export default async function PayrollRulesPage() {
  const ctx = await requirePage("payroll.view");
  const rules = await listPayrollRules(ctx);
  const r = rules[0];
  return (
    <>
      <PageHeader
        title="Payroll rules"
        description="Proration basis, default sharing ratio, overtime calculation and control limits. Versioned and effective-dated."
      />
      <Section title="Versions" flush>
        <Table>
          <THead>
            <TR>
              <TH>Version</TH>
              <TH>Proration</TH>
              <TH>Default share</TH>
              <TH>Std hours/day</TH>
              <TH>OT multiplier</TH>
              <TH>Max OT hrs/month</TH>
              <TH>Max deductions % of earnings</TH>
              <TH>Back office charge %</TH>
              <TH>NHF rate (voluntary)</TH>
              <TH>Take-home floor</TH>
              <TH>Hourly minimum pay</TH>
              <TH>Hourly leave pay</TH>
              <TH>State of residence</TH>
              <TH>Effective</TH>
            </TR>
          </THead>
          <TBody>
            {rules.map((x) => (
              <TR key={x.id}>
                <TD>{x.version}</TD>
                <TD>{x.prorationBasis.replace("_", " ")}</TD>
                <TD>
                  {num(x.defaultOperativeSharePct)}:{100 - num(x.defaultOperativeSharePct)}
                </TD>
                <TD>{num(x.standardHoursPerDay)}</TD>
                <TD>×{num(x.overtimeMultiplier)}</TD>
                <TD>{num(x.maxOvertimeHoursPerMonth)}</TD>
                <TD>{num(x.maxDeductionPctOfGross)}%</TD>
                <TD>{num(x.backOfficeChargePct)}%</TD>
                <TD>{num(x.nhfEmployeeRatePct) > 0 ? `${num(x.nhfEmployeeRatePct)}% of basic` : <span className="text-muted-foreground text-xs">not offered</span>}</TD>
                <TD>{num(x.minTakeHomePctOfGross) > 0 ? `${num(x.minTakeHomePctOfGross)}% of gross` : <span className="text-muted-foreground text-xs">no floor</span>}</TD>
                <TD>{num(x.hourlyMinMonthlyPay) > 0 ? naira(x.hourlyMinMonthlyPay) : <span className="text-muted-foreground text-xs">no check</span>}</TD>
                <TD>{num(x.hourlyLeavePct) > 0 ? `${num(x.hourlyLeavePct)}% of hours worked` : <span className="text-muted-foreground text-xs">none</span>}</TD>
                <TD>{x.requirePayeState ? <Badge tone="amber">required to approve</Badge> : <span className="text-muted-foreground text-xs">warning only</span>}</TD>
                <TD>
                  {fmtDate(x.effectiveFrom)} →{" "}
                  {x.effectiveTo ? fmtDate(x.effectiveTo) : <Badge tone="green">current</Badge>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      {can(ctx.role, "settings.manage") && r && (
        <FormPanel title="Create new version">
          <SmartForm
            columns={3}
            fields={[
              { name: "version", label: "Version", required: true },
              {
                name: "prorationBasis",
                label: "Proration basis",
                type: "select",
                required: true,
                options: [
                  { value: "CALENDAR_DAYS", label: "Calendar days in month" },
                  { value: "FIXED_30", label: "Fixed 30 days" },
                ],
                defaultValue: r.prorationBasis,
              },
              {
                name: "defaultOperativeSharePct",
                label: "Default operative share %",
                type: "number",
                required: true,
                defaultValue: num(r.defaultOperativeSharePct),
              },
              {
                name: "standardHoursPerDay",
                label: "Standard hours / day",
                type: "number",
                required: true,
                defaultValue: num(r.standardHoursPerDay),
              },
              {
                name: "overtimeMultiplier",
                label: "Overtime multiplier",
                type: "number",
                required: true,
                defaultValue: num(r.overtimeMultiplier),
              },
              {
                name: "maxOvertimeHoursPerMonth",
                label: "Max overtime hours / month",
                type: "number",
                required: true,
                defaultValue: num(r.maxOvertimeHoursPerMonth),
              },
              {
                name: "maxDeductionPctOfGross",
                label: "Max deductions % of earnings (warning)",
                type: "number",
                required: true,
                defaultValue: num(r.maxDeductionPctOfGross),
              },
              {
                name: "backOfficeChargePct",
                label: "Back office charge % (Contract Profitability)",
                type: "number",
                required: true,
                min: 0,
                max: 100,
                defaultValue: num(r.backOfficeChargePct),
              },
              {
                name: "nhfEmployeeRatePct",
                label: "NHF contribution rate % of basic pay (voluntary)",
                type: "number",
                min: 0,
                max: 100,
                defaultValue: num(r.nhfEmployeeRatePct),
                help: "The National Housing Fund is voluntary: this rate (2.5 as shipped) is taken ONLY from employees marked as contributing, as its own deduction, and is remitted by the end of the month. Set 0 to stop offering it.",
              },
              {
                name: "minTakeHomePctOfGross",
                label: "Take-home floor % of gross (loan and salary-advance recoveries)",
                type: "number",
                min: 0,
                max: 100,
                defaultValue: num(r.minTakeHomePctOfGross),
                help: "0 = no floor. Above 0, loan and salary-advance recoveries are limited so net pay is not taken below this share of gross; the part not taken stays owed on the loan and is scheduled again next month. Penalties and other deductions are never reduced. A client-specific policy, not a statutory one.",
                span: 3,
              },
              {
                name: "hourlyMinMonthlyPay",
                label: "Minimum monthly pay for staff paid by the hour (₦)",
                type: "number",
                min: 0,
                defaultValue: num(r.hourlyMinMonthlyPay),
                help: "0 = no check. A figure you or your adviser enter: no figure is built in. Above 0, the payroll raises a warning for anyone paid only by the hour whose pay from hours in the month is below it. It is a warning only: pay is never blocked or changed.",
                span: 3,
              },
              {
                name: "hourlyLeavePct",
                label: "Leave pay for staff paid by the hour (% added to every hour worked)",
                type: "number",
                min: 0,
                max: 100,
                defaultValue: num(r.hourlyLeavePct),
                help: "0 = none. A figure you or your adviser enter: no figure is built in. Above 0, a person paid by the hour is paid this percentage of the pay for every hour they work, as their annual leave pay, from the day they complete the annual-leave service period in the leave policy (12 months as shipped). It is part of their gross, and shown on the payslip as Leave pay.",
                span: 3,
              },
              {
                name: "requirePayeState",
                label: "Require every taxed worker to have a state of residence before approval",
                type: "checkbox",
                defaultValue: r.requirePayeState,
                help: "Off (the default): a worker with PAYE and no state is a warning and their PAYE goes on a 'State not recorded' line. On: it is a critical finding that blocks approval until the state is set, or Finance overrides it with a reason.",
                span: 3,
              },
              { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
            ]}
            action={createPayrollRuleAction}
          />
        </FormPanel>
      )}
    </>
  );
}
