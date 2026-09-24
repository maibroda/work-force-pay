import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listRecurringDeductionRules } from "@/server/services/deduction-rules";
import { options, enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  createRecurringDeductionRuleAction,
  setRecurringDeductionRuleActiveAction,
} from "@/app/actions/deduction-rules";

export default async function RecurringDeductionsPage() {
  const ctx = await requirePage("payroll.view");
  const [rules, o] = await Promise.all([listRecurringDeductionRules(ctx), options(ctx)]);
  const manage = can(ctx.role, "settings.manage");
  return (
    <>
      <PageHeader
        title="Recurring deductions"
        description="Deductions applied automatically on every regular payroll run — never on a supplementary run, so nothing is charged twice within the same period. Global applies to every paid employee; Location applies to everyone who worked at least one day at the chosen beat that period; Individual applies to one named employee."
      />
      <Section title="Rules" flush>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Code</TH>
              <TH>Scope</TH>
              <TH>Applies to</TH>
              <TH className="text-right">Amount</TH>
              <TH>Effective</TH>
              <TH>Status</TH>
              <TH>Reason</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rules.map((r) => (
              <TR key={r.id}>
                <TD>{r.name}</TD>
                <TD className="font-mono text-xs">{r.code}</TD>
                <TD>
                  <Badge tone={r.scope === "GLOBAL" ? "violet" : r.scope === "LOCATION" ? "blue" : "gray"}>
                    {r.scope}
                  </Badge>
                </TD>
                <TD className="text-xs">
                  {r.scope === "GLOBAL" && "Every paid employee"}
                  {r.scope === "LOCATION" && (r.beat ? `${r.beat.client.name} — ${r.beat.name}` : "—")}
                  {r.scope === "INDIVIDUAL" && (r.employee ? fullName(r.employee) : "—")}
                </TD>
                <TD className="text-right">
                  {r.calcType === "PERCENTAGE_OF_GROSS" ? `${num(r.percentage)}%` : naira(r.fixedAmount)}
                </TD>
                <TD className="text-xs">
                  {fmtDate(r.effectiveFrom)} → {r.effectiveTo ? fmtDate(r.effectiveTo) : "ongoing"}
                </TD>
                <TD>
                  <StatusBadge status={r.active ? "ACTIVE" : "INACTIVE"} />
                </TD>
                <TD className="max-w-xs truncate text-xs">{r.reason}</TD>
                <TD>
                  {manage && (
                    <ActionButton
                      action={setRecurringDeductionRuleActiveAction.bind(null, r.id, !r.active)}
                      confirm={r.active ? "Deactivate this rule?" : "Reactivate this rule?"}
                      variant="outline"
                    >
                      {r.active ? "Deactivate" : "Reactivate"}
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rules.length && <Empty>No recurring deduction rules yet.</Empty>}
      </Section>
      {manage && (
        <FormPanel title="Add recurring deduction rule">
          <SmartForm
            columns={3}
            submitLabel="Create rule"
            action={createRecurringDeductionRuleAction}
            fields={[
              { name: "name", label: "Name", required: true, placeholder: "e.g. Development Levy" },
              { name: "code", label: "Code", required: true, placeholder: "DEV_LEVY", span: 1 },
              {
                name: "scope",
                label: "Scope",
                type: "select",
                required: true,
                options: enumOptions(["GLOBAL", "LOCATION", "INDIVIDUAL"]),
                defaultValue: "GLOBAL",
                help: "Global = every paid employee. Location = a beat. Individual = one employee.",
              },
              { name: "beatId", label: "Beat (for Location scope)", type: "select", options: o.beats },
              {
                name: "employeeId",
                label: "Employee (for Individual scope)",
                type: "select",
                options: o.employees,
              },
              {
                name: "calcType",
                label: "Calculation",
                type: "select",
                required: true,
                options: enumOptions(["PERCENTAGE_OF_GROSS", "FIXED_AMOUNT"]),
                defaultValue: "FIXED_AMOUNT",
              },
              { name: "percentage", label: "Percentage (% of gross)", type: "number", min: 0, max: 100 },
              { name: "fixedAmount", label: "Fixed amount (₦)", type: "number", min: 0 },
              { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
              { name: "effectiveTo", label: "Effective to (optional)", type: "date" },
              {
                name: "reason",
                label: "Reason / justification",
                type: "textarea",
                required: true,
                span: 3,
              },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
