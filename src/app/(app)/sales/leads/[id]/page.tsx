import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { findPersonDuplicates } from "@/server/services/sales/duplicates";
import { getLead, listAccounts, listContacts } from "@/server/services/sales/records";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { convertLeadAction } from "@/app/actions/sales";

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export default async function SalesLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("sales.view");
  const { id } = await params;
  let lead;
  try {
    lead = await getLead(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const canManage = can(ctx.role, "sales.manage");
  const convertible = canManage && !["CONVERTED", "VOID"].includes(lead.status);
  const [accounts, contacts, dupes] = await Promise.all([
    convertible ? listAccounts(ctx) : [],
    convertible ? listContacts(ctx) : [],
    lead.status === "CONVERTED" || lead.status === "VOID" ? { visible: [], hidden: [] } : findPersonDuplicates(ctx, { phone: lead.phoneE164 ?? undefined, email: lead.email ?? undefined }, lead.id),
  ]);
  return (
    <>
      <PageHeader title={`${lead.number} · ${lead.companyName}`} crumbs={[{ href: "/sales/leads", label: "Leads" }]} description={`Owner ${lead.ownerName}. Added ${fmtDate(lead.createdAt)}.`} />
      <Section title="Details">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Status</dt><dd><Badge>{label(lead.status)}</Badge></dd></div>
          <div><dt className="text-xs text-muted-foreground">Contact</dt><dd>{[lead.contactName, lead.jobTitle].filter(Boolean).join(", ") || "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Phone</dt><dd className="font-mono">{lead.phoneE164 ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Email</dt><dd>{lead.email ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Service wanted</dt><dd>{label(lead.serviceInterest)}{lead.estimatedGuards ? `, about ${lead.estimatedGuards} guards` : ""}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Source</dt><dd>{label(lead.source)}{lead.sourceDetail ? ` (${lead.sourceDetail})` : ""}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Where</dt><dd>{[lead.address, lead.lga, lead.state].filter(Boolean).join(", ") || "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Industry</dt><dd>{lead.industry ?? "—"}</dd></div>
        </dl>
      </Section>

      {(dupes.visible.length > 0 || dupes.hidden.length > 0) && (
        <Section title="Possible duplicates" description="Records that share this lead's phone or email. Check before converting, so the same person is not held twice.">
          <ul className="space-y-1 text-sm">
            {dupes.visible.map((m) => (
              <li key={m.id}>
                {m.kind === "CONTACT" ? "Contact" : "Lead"}: {m.label} · {m.reason} · owner {m.ownerName}
              </li>
            ))}
            {dupes.hidden.map((m, i) => (
              <li key={i} className="text-amber-800">
                A record owned by {m.ownerName} matches ({m.reason.toLowerCase()}). Ask them or a manager.
              </li>
            ))}
          </ul>
        </Section>
      )}

      {lead.status === "CONVERTED" && (
        <Section title="Converted">
          <p className="text-sm">
            Converted {lead.convertedAt ? fmtDate(lead.convertedAt) : ""} by {lead.convertedBy}. This lead is now read-only: its details live on the{" "}
            <Link className="underline" href="/sales/accounts">account</Link>, <Link className="underline" href="/sales/contacts">contact</Link>
            {lead.convertedOpportunityId ? (
              <>
                {" "}and the <Link className="underline" href="/sales/opportunities">deal</Link>
              </>
            ) : null}{" "}
            it became.
          </p>
        </Section>
      )}

      {convertible && (
        <Section
          title="Convert this lead"
          description="One step: an account, a contact and (if ticked) a deal. Choose an existing account or contact to add to it instead; an existing record is only filled where it is empty, never overwritten, and its owner does not change."
        >
          <SmartForm
            columns={2}
            submitLabel="Convert"
            action={convertLeadAction}
            fields={[
              { name: "leadId", label: "", type: "hidden", defaultValue: lead.id },
              { name: "accountId", label: "Account", type: "select", options: [{ value: "", label: "Create a new account from this lead" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] },
              { name: "contactId", label: "Contact", type: "select", options: [{ value: "", label: "Create a new contact from this lead" }, ...contacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))] },
              { name: "createDeal", label: "Also create a deal in the New business pipeline", type: "checkbox", defaultValue: true },
            ]}
          />
        </Section>
      )}
    </>
  );
}
