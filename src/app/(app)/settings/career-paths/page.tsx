import { requirePage } from "@/lib/auth/session";
import { listCareerPaths, listRoles } from "@/server/services/career";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addCareerPathAction, setCareerPathActiveAction } from "@/app/actions/career";

export default async function CareerPathsPage() {
  const ctx = await requirePage("hr.configure");
  const [paths, roles] = await Promise.all([listCareerPaths(ctx), listRoles(ctx)]);
  const options = roles.map((r) => ({ value: r.id, label: r.name }));
  return (
    <>
      <PageHeader
        title="Career paths"
        description="Which role can lead to which, and what the company asks first. It is guidance only: it shows employees where they can go and warns whoever decides a promotion, but it never blocks one. The company starts with none."
      />
      <FormPanel title="Add a career path">
        <SmartForm
          columns={2}
          submitLabel="Add the path"
          action={addCareerPathAction}
          fields={[
            { name: "fromCategoryId", label: "From the role", type: "select", required: true, options },
            { name: "toCategoryId", label: "To the role", type: "select", required: true, options },
            { name: "minMonths", label: "Months in the current role asked for (blank = none)", type: "number", min: 0, max: 600 },
            { name: "requiredCourse", label: "A course asked for (the name as in Training requirements; blank = none)" },
          ]}
        />
      </FormPanel>
      <Section title={`${paths.length} path${paths.length === 1 ? "" : "s"}`} flush>
        {paths.length === 0 ? (
          <Empty>No career paths yet.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Move</TH>
                <TH>Months asked</TH>
                <TH>Course asked</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {paths.map((p) => (
                <TR key={p.id} className={p.active ? "" : "opacity-60"}>
                  <TD>
                    {p.fromCategory.name} → {p.toCategory.name}
                  </TD>
                  <TD>{p.minMonths ?? "—"}</TD>
                  <TD>{p.requiredCourse ?? "—"}</TD>
                  <TD>{p.active ? <Badge tone="green">On</Badge> : <Badge tone="gray">Off</Badge>}</TD>
                  <TD>
                    <ActionButton action={setCareerPathActiveAction.bind(null, p.id, !p.active)} variant="outline">
                      {p.active ? "Switch off" : "Switch on"}
                    </ActionButton>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
