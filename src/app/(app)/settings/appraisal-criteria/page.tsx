import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listCriteria } from "@/server/services/appraisals";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addCriterionAction, toggleCriterionAction, updateCriterionAction } from "@/app/actions/appraisals";

export default async function CriteriaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("appraisal.manage");
  const sp = await searchParams;
  const criteria = await listCriteria(ctx);
  const total = criteria.filter((c) => c.active).reduce((a, c) => a + c.weight, 0);
  const editing = criteria.find((c) => c.id === sp.edit);
  return (
    <>
      <PageHeader
        title="Appraisal criteria"
        description="What employees are rated on, and how much each counts. Weights are relative — a criterion of 20 counts twice as much as one of 10. A cycle takes a copy of the criteria when it's launched, so changes here affect only the next cycle."
      />
      <Section title="Criteria" description={`Active weights total ${total}.`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Criterion</TH>
              <TH>What it looks at</TH>
              <TH>Weight</TH>
              <TH>Share</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {criteria.map((c) => (
              <TR key={c.id} className={c.active ? "" : "opacity-60"}>
                <TD>
                  {c.name} {!c.active && <Badge tone="gray">off</Badge>}
                </TD>
                <TD className="max-w-md whitespace-normal text-xs">{c.description ?? "—"}</TD>
                <TD>{c.weight}</TD>
                <TD className="text-xs">{c.active && total ? `${Math.round((c.weight / total) * 100)}%` : "—"}</TD>
                <TD className="space-x-1 whitespace-nowrap text-right">
                  <Link className="text-xs text-primary underline" href={`/settings/appraisal-criteria?edit=${c.id}`}>
                    Edit
                  </Link>
                  <ActionButton action={toggleCriterionAction.bind(null, c.id, !c.active)} variant="outline">
                    {c.active ? "Switch off" : "Switch on"}
                  </ActionButton>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      <FormPanel title={editing ? `Edit “${editing.name}”` : "Add a criterion"} open={Boolean(editing)}>
        <div key={editing?.id ?? "new"}>
          <SmartForm
            columns={2}
            submitLabel={editing ? "Save changes" : "Add"}
            resetOnSuccess={!editing}
            action={editing ? updateCriterionAction.bind(null, editing.id) : addCriterionAction}
            fields={[
              { name: "name", label: "Name", required: true, defaultValue: editing?.name },
              { name: "weight", label: "Weight", type: "number", required: true, min: 1, max: 100, defaultValue: editing?.weight ?? 10 },
              { name: "description", label: "What it looks at", type: "textarea", span: 2, defaultValue: editing?.description ?? undefined },
            ]}
          />
          {editing && (
            <Link className="mt-2 inline-block text-xs text-primary underline" href="/settings/appraisal-criteria">
              Cancel
            </Link>
          )}
        </div>
      </FormPanel>
    </>
  );
}
