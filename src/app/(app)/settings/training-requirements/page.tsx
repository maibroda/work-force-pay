import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listRequirements } from "@/server/services/training";
import { options } from "@/server/options";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addRequirementAction, toggleRequirementAction, updateRequirementAction } from "@/app/actions/training";

export default async function TrainingRequirementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.configure");
  const sp = await searchParams;
  const [reqs, o] = await Promise.all([listRequirements(ctx), options(ctx)]);
  const editing = reqs.find((r) => r.id === sp.edit);
  return (
    <>
      <PageHeader
        title="Training requirements"
        description="The courses and certifications staff must hold — for everyone, or for one category. An employee is covered when a certificate with the same course name (case doesn't matter) is recorded on them and hasn't expired or been revoked. A new joiner gets the grace period before a missing certificate counts."
      />
      <Section title="Requirements" flush>
        <Table>
          <THead>
            <TR>
              <TH>Course / certification</TH>
              <TH>Required of</TH>
              <TH>New-joiner grace</TH>
              <TH>Notes</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {reqs.map((r) => (
              <TR key={r.id} className={r.active ? "" : "opacity-60"}>
                <TD>
                  {r.courseName} {!r.active && <Badge tone="gray">off</Badge>}
                </TD>
                <TD className="text-xs">{r.category?.name ?? "Everyone"}</TD>
                <TD className="text-xs">{r.graceDays} days</TD>
                <TD className="max-w-xs whitespace-normal text-xs">{r.description ?? "—"}</TD>
                <TD className="space-x-1 whitespace-nowrap text-right">
                  <Link className="text-xs text-primary underline" href={`/settings/training-requirements?edit=${r.id}`}>
                    Edit
                  </Link>
                  <ActionButton action={toggleRequirementAction.bind(null, r.id, !r.active)} variant="outline">
                    {r.active ? "Switch off" : "Switch on"}
                  </ActionButton>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!reqs.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No requirements yet — add the first below.</p>}
      </Section>
      <FormPanel title={editing ? `Edit “${editing.courseName}”` : "Add a requirement"} open={Boolean(editing) || !reqs.length}>
        <div key={editing?.id ?? "new"}>
          <SmartForm
            columns={2}
            submitLabel={editing ? "Save changes" : "Add"}
            resetOnSuccess={!editing}
            action={editing ? updateRequirementAction.bind(null, editing.id) : addRequirementAction}
            fields={[
              { name: "courseName", label: "Course / certification name", required: true, defaultValue: editing?.courseName, help: "Must match the name used when the certificate is recorded on an employee." },
              { name: "categoryId", label: "Required of", type: "select", defaultValue: editing?.categoryId ?? undefined, options: o.categories, help: "Leave blank for everyone." },
              { name: "graceDays", label: "New-joiner grace (days)", type: "number", min: 0, max: 365, defaultValue: editing?.graceDays ?? 30, help: "From the employment date, before a missing certificate counts." },
              { name: "description", label: "Notes", type: "textarea", span: 2, defaultValue: editing?.description ?? undefined },
            ]}
          />
          {editing && (
            <Link className="mt-2 inline-block text-xs text-primary underline" href="/settings/training-requirements">
              Cancel
            </Link>
          )}
        </div>
      </FormPanel>
    </>
  );
}
