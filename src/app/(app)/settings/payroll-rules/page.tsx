import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listPayrollRules } from "@/server/services/statutory";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
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
              { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
            ]}
            action={createPayrollRuleAction}
          />
        </FormPanel>
      )}
    </>
  );
}
