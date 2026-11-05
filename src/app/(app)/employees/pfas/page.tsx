import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listPfas } from "@/server/services/pfas";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createPfaAction, deletePfaAction, setPfaActiveAction, updatePfaAction } from "@/app/actions/pfas";

export default async function PfasPage() {
  const ctx = await requirePage("employee.view");
  const pfas = await listPfas(ctx);
  const manage = can(ctx.role, "hr.configure");
  return (
    <>
      <PageHeader
        title="Pension fund administrators"
        description="The PFAs your employees can be registered with. The company administrator and the HR manager keep this list: add one, correct a name, record its PenCom number, or switch one off. An employee's PFA is chosen from it. Switching one off stops it being chosen for anyone new; people who already have it keep it."
      />
      <Section title="Your list" flush>
        <Table>
          <THead>
            <TR>
              <TH>Pension fund administrator</TH>
              <TH>PenCom number</TH>
              <TH className="text-right">Employees</TH>
              <TH>Status</TH>
              {manage && <TH />}
            </TR>
          </THead>
          <TBody>
            {pfas.map((p) => (
              <TR key={p.id}>
                <TD>{p.name}</TD>
                <TD className="font-mono text-xs">{p.penComNumber ?? "—"}</TD>
                <TD className="text-right">{p.employeeCount}</TD>
                <TD>
                  <StatusBadge status={p.active ? "ACTIVE" : "INACTIVE"} />
                </TD>
                {manage && (
                  <TD className="space-x-2 whitespace-nowrap text-right">
                    <ActionButton
                      action={setPfaActiveAction.bind(null, p.id, !p.active)}
                      confirm={p.active ? "Switch this PFA off? It can no longer be chosen for anyone; people who have it keep it." : "Switch this PFA on again?"}
                      variant="outline"
                    >
                      {p.active ? "Switch off" : "Switch on"}
                    </ActionButton>
                    {p.employeeCount === 0 && (
                      <ActionButton action={deletePfaAction.bind(null, p.id)} confirm="Remove this PFA from the list?" variant="outline">
                        Remove
                      </ActionButton>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
        {!pfas.length && <Empty>No PFAs on your list yet. Until you add one, a PFA can be typed freely on an employee&apos;s record.</Empty>}
      </Section>
      {manage ? (
        <>
          <FormPanel title="Add a pension fund administrator">
            <SmartForm
              columns={2}
              submitLabel="Add to the list"
              action={createPfaAction}
              fields={[
                { name: "name", label: "Name", required: true, placeholder: "e.g. ARM Pension Managers" },
                { name: "penComNumber", label: "PenCom number", help: "The regulator's licence number for this PFA. Optional." },
              ]}
            />
          </FormPanel>
          {pfas.length > 0 && (
            <FormPanel title="Correct a name or record a PenCom number">
              <SmartForm
                columns={3}
                submitLabel="Save"
                action={updatePfaAction}
                fields={[
                  { name: "pfaId", label: "Pension fund administrator", type: "select", required: true, options: pfas.map((p) => ({ value: p.id, label: p.name })) },
                  { name: "name", label: "New name", help: "Leave blank to keep the name. A new name is carried to the employees who have it; payrolls already calculated keep the name they were calculated with." },
                  { name: "penComNumber", label: "PenCom number", help: "Leave blank to keep it as it is." },
                ]}
              />
            </FormPanel>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Only the company administrator and the HR manager can change this list.</p>
      )}
    </>
  );
}
