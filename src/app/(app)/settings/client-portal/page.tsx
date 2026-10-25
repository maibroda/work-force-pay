import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listClientUsers } from "@/server/services/portal";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { inviteClientUserAction, setClientApprovalRequiredAction } from "@/app/actions/portal";

export default async function ClientPortalSettingsPage() {
  const ctx = await requirePage("users.manage");
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, bureauOrganizationId: true, clientApprovalRequired: true } });
  if (!org.bureauOrganizationId)
    return <PageHeader title="Client portal" description="The client portal is for the clients of a payroll bureau. Work in a client (Bureau → Clients) to set it up." />;
  const users = await listClientUsers(ctx);
  return (
    <>
      <PageHeader title={`Client portal — ${org.name}`} description="The client's own approver and HR contact sign in here, with a second factor, and see only this client's payroll." />

      <Section title="People" description="Each invited person gets an email with a link to choose their own password; nobody else ever knows it. The first sign-in asks them to set up two-factor sign-in." flush>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Two-factor</TH>
              <TH>Last sign-in</TH>
            </TR>
          </THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD>
                  {u.name} {!u.active && <Badge>inactive</Badge>}
                </TD>
                <TD className="text-xs">{u.email}</TD>
                <TD className="text-xs">{u.role === "CLIENT_APPROVER" ? "Approver" : "HR contact"}</TD>
                <TD>{u.totpEnabled ? <Badge tone="green">On</Badge> : <Badge tone="amber">Not set up</Badge>}</TD>
                <TD className="text-xs">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "Never"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!users.length && <p className="px-4 py-4 text-sm text-muted-foreground">Nobody has been invited yet.</p>}
      </Section>

      <Section title="Invite someone">
        <SmartForm
          columns={3}
          submitLabel="Send invitation"
          resetOnSuccess
          action={inviteClientUserAction}
          fields={[
            { name: "name", label: "Name", required: true },
            { name: "email", label: "Email", type: "email", required: true },
            { name: "role", label: "Role", type: "select", required: true, options: [{ value: "CLIENT_APPROVER", label: "Approver: reviews and approves payrolls" }, { value: "CLIENT_HR", label: "HR contact: sees the calendar and inputs" }], defaultValue: "CLIENT_APPROVER" },
          ]}
        />
      </Section>

      <Section title="Client approval" description="Where this is on, a payroll cannot be locked until the client's approver has approved its current figures. A payroll calculated again needs a fresh approval.">
        <SmartForm columns={3} submitLabel="Save" action={setClientApprovalRequiredAction} fields={[{ name: "required", label: "A payroll needs the client's approval before it can be locked", type: "checkbox", defaultValue: org.clientApprovalRequired, span: 3 }]} />
      </Section>
    </>
  );
}
