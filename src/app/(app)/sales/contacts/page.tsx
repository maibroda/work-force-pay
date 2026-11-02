import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { listAccounts, listContacts } from "@/server/services/sales/records";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createContactAction } from "@/app/actions/sales";

const ROLES = ["DECISION_MAKER", "INFLUENCER", "USER", "FINANCE", "PROCUREMENT", "GATEKEEPER"];
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export default async function SalesContactsPage() {
  const ctx = await requirePage("sales.view");
  let contacts: Awaited<ReturnType<typeof listContacts>> = [];
  let accounts: Awaited<ReturnType<typeof listAccounts>> = [];
  let why = "";
  try {
    [contacts, accounts] = await Promise.all([listContacts(ctx), listAccounts(ctx)]);
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    why = e.message;
  }
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return (
    <>
      <PageHeader title="Contacts" description="The people at the companies you sell to: who decides, who influences, who pays." />
      {why && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {why}{" "}
          {can(ctx.role, "sales.configure") && (
            <Link className="underline" href="/sales/settings">
              Open Sales settings
            </Link>
          )}
        </p>
      )}
      {!why && (
        <Section title={`${contacts.length} contact(s)`} flush>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Account</TH>
                <TH>Role</TH>
                <TH>Phone</TH>
                <TH>Email</TH>
                <TH>Owner</TH>
              </TR>
            </THead>
            <TBody>
              {contacts.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link className="underline" href={`/sales/contacts/${c.id}`}>
                      {c.firstName} {c.lastName}
                    </Link>
                    {c.jobTitle ? <span className="text-xs text-muted-foreground"> · {c.jobTitle}</span> : null}
                  </TD>
                  <TD className="text-xs">{c.accountId ? names.get(c.accountId) ?? "—" : "—"}</TD>
                  <TD className="text-xs">{c.roleInDecision ? label(c.roleInDecision) : "—"}</TD>
                  <TD className="font-mono text-xs">{c.phoneE164 ?? "—"}</TD>
                  <TD className="text-xs">{c.email ?? "—"}</TD>
                  <TD className="text-xs">{c.ownerName}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!contacts.length && <p className="px-4 py-4 text-sm text-muted-foreground">No contacts yet.</p>}
        </Section>
      )}
      {!why && can(ctx.role, "sales.manage") && (
        <Section title="Add a contact">
          <SmartForm
            columns={3}
            submitLabel="Add contact"
            resetOnSuccess
            action={createContactAction}
            fields={[
              { name: "firstName", label: "First name", required: true },
              { name: "lastName", label: "Last name", required: true },
              { name: "jobTitle", label: "Job title" },
              { name: "accountId", label: "Account", type: "select", options: [{ value: "", label: "— none yet —" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] },
              { name: "roleInDecision", label: "Role in the decision", type: "select", options: [{ value: "", label: "—" }, ...ROLES.map((r) => ({ value: r, label: label(r) }))] },
              { name: "isPrimary", label: "Primary contact", type: "checkbox" },
              { name: "phone", label: "Phone" },
              { name: "whatsapp", label: "WhatsApp" },
              { name: "email", label: "Email", type: "email" },
              { name: "createAnyway", label: "Create anyway if it looks like a duplicate", type: "checkbox" },
            ]}
          />
        </Section>
      )}
    </>
  );
}
