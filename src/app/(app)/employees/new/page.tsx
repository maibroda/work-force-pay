import { requirePage } from "@/lib/auth/session";
import { options } from "@/server/options";
import { previewNextNumber } from "@/server/services/numbering";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { employeeFields } from "@/components/forms/fields";
import { createEmployeeAction } from "@/app/actions/workforce";

export default async function NewEmployeePage() {
  const ctx = await requirePage("employee.manage");
  const [o, next] = await Promise.all([options(ctx), previewNextNumber(ctx, "EMPLOYEE")]);
  return (
    <>
      <PageHeader
        title="New employee"
        crumbs={[{ href: "/employees", label: "Employees" }]}
        description={
          <>
            Employee number is <b>generated automatically</b> on save — next number:{" "}
            <code className="rounded bg-muted px-1">{next}</code>
          </>
        }
      />
      <Section title="Employee details">
        <SmartForm
          fields={employeeFields(o)}
          action={createEmployeeAction}
          submitLabel="Create employee"
          columns={3}
        />
      </Section>
    </>
  );
}
