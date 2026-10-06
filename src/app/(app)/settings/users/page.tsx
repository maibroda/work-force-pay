import { requirePage } from "@/lib/auth/session";
import { listUsers } from "@/server/services/users";
import { getTwoFactorRequirement, ROLES } from "@/server/services/security";
import { iso } from "@/lib/dates";
import { enumOptions, options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createUserAction, setUserActiveAction } from "@/app/actions/workforce";
import { resetUserTwoFactorAction, setTwoFactorRequirementAction } from "@/app/actions/auth";

export default async function UsersPage() {
  const ctx = await requirePage("users.manage");
  const [users, o, tf] = await Promise.all([listUsers(ctx), options(ctx), getTwoFactorRequirement(ctx)]);
  const enrolled = new Set(users.filter((u) => u.totpEnabled).map((u) => u.id));
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
      <Section
        title="Two-factor sign-in"
        description={
          tf.roles.length && tf.enforceFrom
            ? `Required for ${tf.roles.map((r) => r.replace(/_/g, " ").toLowerCase()).join(", ")} from ${iso(tf.enforceFrom)}. ${tf.missing} of ${tf.covered} active user(s) in those roles haven't set it up${tf.missing ? " — from that day they can reach nothing but My security until they do" : ""}.`
            : "Not required for any role. Pick the roles that must use an authenticator app, and the first day it is compulsory: until then they are only reminded."
        }
      >
        <SmartForm
          columns={3}
          submitLabel="Save"
          resetOnSuccess={false}
          action={setTwoFactorRequirementAction}
          fields={[
            ...ROLES.filter((r) => r !== "EMPLOYEE" && r !== "SUPERVISOR").map((r) => ({ name: `role_${r}`, label: r.replace(/_/g, " "), type: "checkbox" as const, defaultValue: tf.roles.includes(r) })),
            { name: "enforceFrom", label: "Compulsory from", type: "date", defaultValue: tf.enforceFrom ? iso(tf.enforceFrom) : undefined, help: "Leave every box clear to switch it off." },
          ]}
        />
      </Section>
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
                  {u.id !== ctx.userId && enrolled.has(u.id) && (
                    <ActionButton action={resetUserTwoFactorAction.bind(null, u.id)} reason reasonPlaceholder="Why, and how you checked it's really them" variant="outline">
                      Reset 2FA
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
