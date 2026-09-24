import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listCostCenters } from "@/server/services/cost-centers";
import { options, enumOptions } from "@/server/options";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  assignCostCenterAction,
  createCostCenterAction,
  setCostCenterActiveAction,
  setCostCenterBudgetAction,
} from "@/app/actions/cost-centers";

export default async function CostCentersPage() {
  const ctx = await requirePage("payroll.view");
  const [centers, o] = await Promise.all([listCostCenters(ctx), options(ctx)]);
  const manage = can(ctx.role, "settings.manage");
  return (
    <>
      <PageHeader
        title="Cost centers"
        description="An independent cost-grouping dimension — assign it to departments, contracts, and beats to group costs your own way (e.g. by region or business unit), separate from the client/contract structure. Feeds the Cost Center P&L and budget-vs-actual reports."
      />
      <Section title="Cost centers" flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Description</TH>
              <TH className="text-right">Departments</TH>
              <TH className="text-right">Contracts</TH>
              <TH className="text-right">Beats</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {centers.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">{c.code}</TD>
                <TD>{c.name}</TD>
                <TD className="max-w-xs truncate text-xs">{c.description ?? "—"}</TD>
                <TD className="text-right">{c._count.departments}</TD>
                <TD className="text-right">{c._count.contracts}</TD>
                <TD className="text-right">{c._count.beats}</TD>
                <TD>
                  <StatusBadge status={c.active ? "ACTIVE" : "INACTIVE"} />
                </TD>
                <TD>
                  {manage && (
                    <ActionButton
                      action={setCostCenterActiveAction.bind(null, c.id, !c.active)}
                      confirm={c.active ? "Deactivate this cost center?" : "Reactivate this cost center?"}
                      variant="outline"
                    >
                      {c.active ? "Deactivate" : "Reactivate"}
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!centers.length && <Empty>No cost centers yet.</Empty>}
      </Section>
      {manage && (
        <>
          <FormPanel title="Add cost center">
            <SmartForm
              columns={3}
              submitLabel="Create"
              action={createCostCenterAction}
              fields={[
                { name: "code", label: "Code", required: true, placeholder: "LAGOS_REGION" },
                { name: "name", label: "Name", required: true, placeholder: "Lagos Region" },
                { name: "description", label: "Description", span: 3 },
              ]}
            />
          </FormPanel>
          <FormPanel title="Assign a cost center">
            <SmartForm
              columns={3}
              submitLabel="Save assignment"
              action={assignCostCenterAction}
              fields={[
                {
                  name: "ownerType",
                  label: "Assign to",
                  type: "select",
                  required: true,
                  options: enumOptions(["DEPARTMENT", "CONTRACT", "BEAT"]),
                  defaultValue: "CONTRACT",
                },
                {
                  name: "ownerId",
                  label: "Department / Contract / Beat",
                  type: "select",
                  required: true,
                  options: [...o.departments, ...o.contracts, ...o.beats],
                  help: "Pick the department, contract or beat matching the type selected above.",
                },
                { name: "costCenterId", label: "Cost center", type: "select", options: o.costCenters },
              ]}
            />
          </FormPanel>
          <FormPanel title="Set a monthly budget">
            <SmartForm
              columns={3}
              submitLabel="Save budget"
              action={setCostCenterBudgetAction}
              fields={[
                {
                  name: "costCenterId",
                  label: "Cost center",
                  type: "select",
                  required: true,
                  options: o.costCenters,
                },
                {
                  name: "year",
                  label: "Year",
                  type: "number",
                  required: true,
                  defaultValue: new Date().getFullYear(),
                },
                { name: "month", label: "Month (1-12)", type: "number", required: true, min: 1, max: 12 },
                {
                  name: "budgetedAmount",
                  label: "Budgeted amount (₦)",
                  type: "number",
                  required: true,
                  min: 0,
                },
                { name: "notes", label: "Notes", span: 3 },
              ]}
            />
          </FormPanel>
        </>
      )}
    </>
  );
}
