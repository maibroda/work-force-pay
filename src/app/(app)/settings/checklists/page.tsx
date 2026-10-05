import { requirePage } from "@/lib/auth/session";
import { listChecklistTemplates } from "@/server/services/hr-policy";
import { options } from "@/server/options";
import { PageHeader, Section, FormPanel, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Tabs } from "@/components/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  addTemplateItemAction,
  deleteTemplateItemAction,
  editTemplateItemAction,
  toggleTemplateItemAction,
} from "@/app/actions/hr-lifecycle";

const yesNo = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.configure");
  const sp = await searchParams;
  const kind = sp.tab === "exit" ? "EXIT_CLEARANCE" : "ONBOARDING";
  const [items, o] = await Promise.all([listChecklistTemplates(ctx, kind), options(ctx)]);
  const exit = kind === "EXIT_CLEARANCE";
  return (
    <>
      <PageHeader
        title="Onboarding & exit checklists"
        description="The steps stamped onto every new hire and every approved exit. Change them to match your own process — existing employees keep the checklist they were given."
      />
      <Tabs
        base="/settings/checklists"
        active={exit ? "exit" : "onboarding"}
        tabs={[
          { key: "onboarding", label: "New-hire onboarding" },
          { key: "exit", label: "Exit clearance" },
        ]}
      />
      <Section
        title={exit ? "Exit clearance steps" : "Onboarding steps"}
        description={
          exit
            ? "‘Blocks settlement’ steps must be done (or waived) before the end-of-service settlement can be approved."
            : "Due dates are counted from the employee's start date."
        }
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>#</TH>
              <TH>Step</TH>
              <TH>{exit ? "Due (days from last day)" : "Due (days after start)"}</TH>
              <TH>Responsible</TH>
              <TH>Required</TH>
              {exit && <TH>Blocks settlement</TH>}
              <TH>Only for</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {items.map((i) => (
              <TR key={i.id} className={i.active ? "" : "opacity-50"}>
                <TD className="text-xs">{i.sortOrder + 1}</TD>
                <TD>
                  {i.taskName}
                  {i.systemKey && <Badge className="ml-2" tone="violet">auto-completes</Badge>}
                </TD>
                <TD className="text-xs">{i.dueOffsetDays > 0 ? `+${i.dueOffsetDays}` : i.dueOffsetDays}</TD>
                <TD className="text-xs">{i.responsibleRole ?? "—"}</TD>
                <TD className="text-xs">{i.mandatory ? "Yes" : "Optional"}</TD>
                {exit && <TD className="text-xs">{i.blocksSettlement ? "Yes" : "No"}</TD>}
                <TD className="text-xs">{i.category?.name ?? "Everyone"}</TD>
                <TD>
                  <Badge tone={i.active ? "green" : "gray"}>{i.active ? "ON" : "OFF"}</Badge>
                </TD>
                <TD>
                  <div className="flex gap-1">
                    <ActionButton action={toggleTemplateItemAction.bind(null, i.id, !i.active)} variant="outline">
                      {i.active ? "Switch off" : "Switch on"}
                    </ActionButton>
                    {!i.systemKey && (
                      <ActionButton action={deleteTemplateItemAction.bind(null, i.id)} confirm="Remove this step for good?" variant="outline">
                        Remove
                      </ActionButton>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!items.length && <Empty>No steps.</Empty>}
      </Section>

      <FormPanel title="Add a step">
        <SmartForm
          columns={3}
          submitLabel="Add step"
          action={addTemplateItemAction}
          fields={[
            { name: "kind", label: "", type: "hidden", defaultValue: kind },
            { name: "taskName", label: "Step", required: true, span: 2 },
            { name: "responsibleRole", label: "Responsible", placeholder: "HR, IT, Operations…" },
            { name: "dueOffsetDays", label: exit ? "Due (days from last day; negative = before)" : "Due (days after start)", type: "number", defaultValue: 0 },
            { name: "categoryId", label: "Only for this category", type: "select", options: o.categories, help: "Blank = every employee." },
            { name: "mandatory", label: "Required", type: "checkbox", defaultValue: true },
            ...(exit ? [{ name: "blocksSettlement", label: "Blocks settlement approval", type: "checkbox" as const, defaultValue: true }] : []),
          ]}
        />
      </FormPanel>
      <FormPanel title="Edit a step">
        <SmartForm
          columns={3}
          submitLabel="Save changes"
          action={editTemplateItemAction}
          fields={[
            { name: "id", label: "Step to edit", type: "select", required: true, options: items.map((i) => ({ value: i.id, label: i.taskName })), span: 2 },
            { name: "taskName", label: "New name (optional)" },
            { name: "responsibleRole", label: "Responsible" },
            { name: "dueOffsetDays", label: "Due offset (days)", type: "number" },
            { name: "sortOrder", label: "Position (0 = first)", type: "number", min: 0 },
            { name: "mandatory", label: "Required?", type: "select", options: yesNo, help: "Blank = leave as it is." },
            ...(exit ? [{ name: "blocksSettlement", label: "Blocks settlement approval?", type: "select" as const, options: yesNo, help: "Blank = leave as it is." }] : []),
          ]}
        />
      </FormPanel>
    </>
  );
}
