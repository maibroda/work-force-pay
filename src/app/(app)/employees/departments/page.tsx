import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listDepartments } from "@/server/services/employees";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createDepartmentAction } from "@/app/actions/workforce";

export default async function DepartmentsPage() {
  const ctx = await requirePage("employee.view");
  const rows = await listDepartments(ctx);
  return (
    <>
      <PageHeader title="Departments" />
      {can(ctx.role, "employee.manage") && (
        <FormPanel title="Add department">
          <SmartForm
            fields={[
              { name: "code", label: "Code", required: true },
              { name: "name", label: "Name", required: true },
            ]}
            action={createDepartmentAction}
          />
        </FormPanel>
      )}
      <Section title="Departments" flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH className="text-right">Employees</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">{c.code}</TD>
                <TD>{c.name}</TD>
                <TD className="text-right">{c._count.employees}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
