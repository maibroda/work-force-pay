import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { listAccounts, listContacts } from "@/server/services/sales/records";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { mergeAccountsAction, mergeContactsAction } from "@/app/actions/sales";

export default async function SalesMergePage() {
  const ctx = await requirePage("sales.view.all");
  let accounts: Awaited<ReturnType<typeof listAccounts>> = [];
  let contacts: Awaited<ReturnType<typeof listContacts>> = [];
  let why = "";
  try {
    [accounts, contacts] = await Promise.all([listAccounts(ctx), listContacts(ctx)]);
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    why = e.message;
  }
  const manage = can(ctx.role, "sales.manage");
  return (
    <>
      <PageHeader
        title="Merge records"
        description="When the same company or person was entered twice. The first record you pick survives and keeps its values; where it is empty, the other fills it. Everything that pointed at the second (contacts, deals) moves to the first, and the second is voided with a note pointing to the first. Nothing is deleted, and a contact's consent history is kept so a withdrawal is never lost."
      />
      {why && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {why} <Link className="underline" href="/sales/settings">Open Sales settings</Link>
        </p>
      )}
      {!why && !manage && <p className="text-sm text-muted-foreground">You can see everything, but merging needs permission to change sales records.</p>}
      {!why && manage && (
        <>
          <Section title="Merge two accounts">
            <SmartForm
              columns={2}
              submitLabel="Merge accounts"
              action={mergeAccountsAction}
              fields={[
                { name: "survivorId", label: "Keep this account", type: "select", required: true, options: [{ value: "", label: "— choose —" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] },
                { name: "loserId", label: "Merge this account into it", type: "select", required: true, options: [{ value: "", label: "— choose —" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] },
              ]}
            />
          </Section>
          <Section title="Merge two contacts">
            <SmartForm
              columns={2}
              submitLabel="Merge contacts"
              action={mergeContactsAction}
              fields={[
                { name: "survivorId", label: "Keep this contact", type: "select", required: true, options: [{ value: "", label: "— choose —" }, ...contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))] },
                { name: "loserId", label: "Merge this contact into it", type: "select", required: true, options: [{ value: "", label: "— choose —" }, ...contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))] },
              ]}
            />
          </Section>
        </>
      )}
    </>
  );
}
