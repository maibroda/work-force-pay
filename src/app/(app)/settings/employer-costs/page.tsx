import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listEmployerCostRules } from "@/server/services/statutory";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createEmployerCostRuleAction } from "@/app/actions/payroll";

export default async function EmployerCostRulesPage() {
  const ctx = await requirePage("payroll.view");
  const rules = await listEmployerCostRules(ctx);
  const r = rules[0];
  return (
    <>
      <PageHeader
        title="Employer cost rules"
        description="Employer add-on costs beyond employer pension — ITF, NSITF-ECA, insurance, uniform & kits, recruitment/training/vetting and annual leave reliever for GUARDING contracts; the same, minus uniform & kits and plus an outsourcing leave allowance (% of Basic), for OUTSOURCING contracts. Back-office (no-contract) pay is never charged these. Versioned and effective-dated."
      />
      <Section title="Versions" flush>
        <Table>
          <THead>
            <TR>
              <TH>Version</TH>
              <TH className="text-right">ITF</TH>
              <TH className="text-right">NSITF</TH>
              <TH className="text-right">NHF/Medical</TH>
              <TH className="text-right">Insurance</TH>
              <TH className="text-right">Uniform & Kits</TH>
              <TH className="text-right">Recruitment/Training</TH>
              <TH className="text-right">Leave Reliever</TH>
              <TH className="text-right">Outsourcing Leave Allow.</TH>
              <TH>Effective</TH>
            </TR>
          </THead>
          <TBody>
            {rules.map((x) => (
              <TR key={x.id}>
                <TD>{x.version}</TD>
                <TD className="text-right">{num(x.itfPct)}%</TD>
                <TD className="text-right">{num(x.nsitfPct)}%</TD>
                <TD className="text-right">{num(x.nhfMedicalPct)}%</TD>
                <TD className="text-right">{num(x.insurancePct)}%</TD>
                <TD className="text-right">{num(x.uniformKitsPct)}%</TD>
                <TD className="text-right">{num(x.recruitmentTrainingPct)}%</TD>
                <TD className="text-right">{num(x.leaveRelieverPct)}%</TD>
                <TD className="text-right">{num(x.outsourcingLeaveAllowancePct)}%</TD>
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
                name: "itfPct",
                label: "ITF (% of gross salary)",
                type: "number",
                required: true,
                min: 0,
                max: 100,
                defaultValue: num(r.itfPct),
              },
              {
                name: "nsitfPct",
                label: "NSITF-ECA (% of gross salary)",
                type: "number",
                required: true,
                min: 0,
                max: 100,
                defaultValue: num(r.nsitfPct),
              },
              {
                name: "nhfMedicalPct",
                label: "NHF / Medical (% of gross salary)",
                type: "number",
                min: 0,
                max: 100,
                defaultValue: num(r.nhfMedicalPct),
                help: "0 = not provided.",
              },
              {
                name: "insurancePct",
                label: "Insurance (% of management fee less statutory)",
                type: "number",
                required: true,
                min: 0,
                max: 100,
                defaultValue: num(r.insurancePct),
              },
              {
                name: "uniformKitsPct",
                label: "Uniform & Kits (% of management fee less statutory)",
                type: "number",
                required: true,
                min: 0,
                max: 100,
                defaultValue: num(r.uniformKitsPct),
                help: "GUARDING contracts only.",
              },
              {
                name: "recruitmentTrainingPct",
                label: "Recruitment, Training & Vetting (% of management fee less statutory)",
                type: "number",
                required: true,
                min: 0,
                max: 100,
                defaultValue: num(r.recruitmentTrainingPct),
              },
              {
                name: "leaveRelieverPct",
                label: "Annual Leave Reliever (% of management fee less statutory)",
                type: "number",
                required: true,
                min: 0,
                max: 100,
                defaultValue: num(r.leaveRelieverPct),
              },
              {
                name: "outsourcingLeaveAllowancePct",
                label: "Outsourcing Leave Allowance (% of Basic)",
                type: "number",
                required: true,
                min: 0,
                max: 100,
                defaultValue: num(r.outsourcingLeaveAllowancePct),
                help: "OUTSOURCING contracts only.",
              },
              { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
            ]}
            action={createEmployerCostRuleAction}
          />
        </FormPanel>
      )}
    </>
  );
}
