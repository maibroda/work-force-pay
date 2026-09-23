import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listCategories } from "@/server/services/employees";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createCategoryAction } from "@/app/actions/workforce";

export default async function CategoriesPage() {
  const ctx = await requirePage("employee.view");
  const rows = await listCategories(ctx);
  return (
    <>
      <PageHeader
        title="Employee categories"
        description="Categories drive the agreed client rate: CLIENT → CONTRACT → CATEGORY → STRUCTURE → RATE."
      />
      {can(ctx.role, "employee.manage") && (
        <FormPanel title="Add category">
          <SmartForm
            fields={[
              { name: "code", label: "Code", required: true },
              { name: "name", label: "Name", required: true },
              { name: "description", label: "Description", span: 2 },
            ]}
            action={createCategoryAction}
          />
        </FormPanel>
      )}
      <Section title="Categories" flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Description</TH>
              <TH className="text-right">Employees</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">{c.code}</TD>
                <TD>{c.name}</TD>
                <TD>{c.description ?? "—"}</TD>
                <TD className="text-right">{c._count.employees}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
