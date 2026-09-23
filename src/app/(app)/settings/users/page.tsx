import { requirePage } from "@/lib/auth/session";
import { listUsers } from "@/server/services/users";
import { enumOptions, options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createUserAction, setUserActiveAction } from "@/app/actions/workforce";

export default async function UsersPage() {
  const ctx = await requirePage("users.manage");
  const [users, o] = await Promise.all([listUsers(ctx), options(ctx)]);
  return (
    <>
      <PageHeader title="Users" />
      <FormPanel title="Create user">
        <SmartForm
          columns={3}
          fields={[
            { name: "name", label: "Full name", required: true },
            { name: "email", label: "Email", type: "email", required: true },
            {
              name: "role",
              label: "Role",
              type: "select",
              required: true,
              options: enumOptions([
                "COMPANY_ADMIN",
                "HR_ADMIN",
                "OPERATIONS",
                "PAYROLL_ADMIN",
                "FINANCE",
                "AUDITOR",
                "SUPERVISOR",
                "EMPLOYEE",
              ]),
            },
            {
              name: "password",
              label: "Initial password",
              type: "password",
              required: true,
              help: "Min 8 characters",
            },
            {
              name: "employeeId",
              label: "Linked employee (for EMPLOYEE role)",
              type: "select",
              options: o.employees,
              span: 2,
            },
          ]}
          action={createUserAction}
          submitLabel="Create user"
        />
      </FormPanel>
      <Section title={`${users.length} user(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Employee</TH>
              <TH>Last login</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD>{u.name}</TD>
                <TD>{u.email}</TD>
                <TD>
                  <Badge tone="blue">{u.role}</Badge>
                </TD>
                <TD className="font-mono text-xs">{u.employee?.employeeNumber ?? "—"}</TD>
                <TD className="text-xs">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "—"}</TD>
                <TD>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                <TD>
                  {u.id !== ctx.userId && (
                    <ActionButton action={setUserActiveAction.bind(null, u.id, !u.active)} variant="outline">
                      {u.active ? "Deactivate" : "Activate"}
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
