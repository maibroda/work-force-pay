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
          fields={[
            ...employeeFields(o),
            {
              name: "monthlyGross",
              label: "Monthly gross (₦), optional",
              type: "number",
              min: 1,
              help: "Only for staff paid a personal monthly gross, not from a client contract rate (for example office staff). The MONTHLY amount, not annual. It is a proposal: a payroll manager approves it before it counts, and it starts on the employment date.",
              span: 2,
            },
            { name: "salaryStructure", label: "Salary structure for the gross", type: "select", options: o.structureCodes, help: "Blank means the company's default structure." },
          ]}
          action={createEmployeeAction}
          submitLabel="Create employee"
          columns={3}
        />
      </Section>
    </>
  );
}
