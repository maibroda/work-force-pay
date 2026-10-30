import Link from "next/link";
import { ActivityPanel } from "@/components/sales/activity-panel";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { contactView } from "@/server/services/sales/views";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { recordConsentAction } from "@/app/actions/sales-import";

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const CHANNELS = ["EMAIL", "WHATSAPP", "SMS", "PHONE", "IN_PERSON", "WEB_FORM", "OTHER"];

export default async function SalesContactPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("sales.view");
  const { id } = await params;
  let v;
  try {
    v = await contactView(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const c = v.contact;
  const tone = (s: string) => (s === "GRANTED" ? "green" : s === "WITHDRAWN" ? "red" : undefined);
  return (
    <>
      <PageHeader title={`${c.firstName} ${c.lastName}`} crumbs={[{ href: "/sales/contacts", label: "Contacts" }]} description={`Owner ${c.ownerName}.`} />
      {c.status === "VOID" && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This contact is voided{c.voidReason ? `: ${c.voidReason}` : ""}.{" "}
          {c.mergedInto && (
            <Link className="underline" href={`/sales/contacts/${c.mergedInto.id}`}>
              Open {c.mergedInto.firstName} {c.mergedInto.lastName}
            </Link>
          )}
        </p>
      )}
      <Section title="Details">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Account</dt><dd>{c.account ? <Link className="underline" href={`/sales/accounts/${c.account.id}`}>{c.account.name}</Link> : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Job title</dt><dd>{c.jobTitle ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Role in the decision</dt><dd>{c.roleInDecision ? label(c.roleInDecision) : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Email</dt><dd>{c.email ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Phone</dt><dd className="font-mono">{c.phoneE164 ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">WhatsApp</dt><dd className="font-mono">{c.whatsappE164 ?? "—"}</dd></div>
        </dl>
      </Section>

      <Section title="Marketing consent" description="Marketing may be sent only while the latest record says granted. No record means unknown, which also blocks it. A service message about an active contract is a separate purpose. Every record is kept; nothing is edited.">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <span>Marketing: <Badge tone={tone(v.marketing)}>{label(v.marketing)}</Badge></span>
          <span>Service messages: <Badge tone={tone(v.service)}>{label(v.service)}</Badge></span>
        </div>
        {v.consents.length > 0 && (
          <Table>
            <THead><TR><TH>When</TH><TH>Purpose</TH><TH>Status</TH><TH>Channel</TH><TH>Where it came from</TH><TH>Recorded by</TH></TR></THead>
            <TBody>
              {v.consents.map((r) => (
                <TR key={r.id}>
                  <TD className="text-xs">{fmtDate(r.recordedAt)}</TD>
                  <TD className="text-xs">{label(r.purpose)}</TD>
                  <TD><Badge tone={tone(r.status)}>{label(r.status)}</Badge></TD>
                  <TD className="text-xs">{label(r.channel)}</TD>
                  <TD className="whitespace-normal text-xs">{r.source}{r.evidenceRef ? ` (${r.evidenceRef})` : ""}</TD>
                  <TD className="text-xs">{r.recordedBy}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {can(ctx.role, "sales.manage") && c.status === "ACTIVE" && (
          <div className="mt-4">
            <SmartForm
              columns={3}
              submitLabel="Record"
              resetOnSuccess
              action={recordConsentAction}
              fields={[
                { name: "contactId", label: "", type: "hidden", defaultValue: c.id },
                { name: "purpose", label: "For", type: "select", defaultValue: "MARKETING", options: [{ value: "MARKETING", label: "Marketing" }, { value: "SERVICE", label: "Service messages" }] },
                { name: "status", label: "They", type: "select", defaultValue: "GRANTED", options: [{ value: "GRANTED", label: "Agreed" }, { value: "WITHDRAWN", label: "Withdrew (opted out)" }] },
                { name: "channel", label: "Through", type: "select", defaultValue: "EMAIL", options: CHANNELS.map((x) => ({ value: x, label: label(x) })) },
                { name: "source", label: "Where it came from (the form, call or message)", required: true, span: 2 },
                { name: "evidenceRef", label: "Reference (form number, file name)" },
              ]}
            />
          </div>
        )}
      </Section>

      <Section title={`${v.opportunities.length} deal(s) naming this contact`} flush>
        <Table>
          <THead><TR><TH>Deal</TH><TH>Stage</TH><TH className="text-right">Monthly value</TH></TR></THead>
          <TBody>
            {v.opportunities.map((o) => (
              <TR key={o.id}>
                <TD>{o.name}</TD>
                <TD><Badge>{o.stage.name}</Badge></TD>
                <TD className="text-right">{naira(o.monthlyContractValue)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!v.opportunities.length && <p className="px-4 py-4 text-sm text-muted-foreground">No deals yet.</p>}
      </Section>
      <ActivityPanel ctx={ctx} target={{ contactId: id }} />
    </>
  );
}
