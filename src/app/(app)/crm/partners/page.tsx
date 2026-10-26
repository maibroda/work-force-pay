import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { partnerSummary } from "@/server/services/crm";
import { PARTNER_KINDS, PARTNER_KIND_LABELS } from "@/lib/crm";
import { fmtDate, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createPartnerAction, recordPayoutAction, setPartnerActiveAction } from "@/app/actions/crm";
import { crmGate } from "../_gate";

export default async function PartnersPage() {
  const ctx = await requirePage("crm.view");
  const gate = await crmGate(ctx, "Referral partners");
  if (gate) return gate;
  const partners = await partnerSummary(ctx);
  const manage = can(ctx.role, "crm.manage");
  const owing = partners.flatMap((p) => p.lines.filter((l) => l.owed > 0).map((l) => ({ partner: p.partner, ...l })));
  return (
    <>
      <PageHeader
        title="Referral partners"
        crumbs={[{ href: "/crm", label: "Sales pipeline" }]}
        description="Accountants and HR consultants who send business. Commission is the partner's percentage of the lead's monthly fee for the agreed months, earned only when the lead is won, and paid on the record below."
      />
      <Section title="Partners" flush>
        <Table>
          <THead>
            <TR>
              <TH>Partner</TH>
              <TH>Terms</TH>
              <TH className="text-right">Referred</TH>
              <TH className="text-right">Won</TH>
              <TH className="text-right">Earned</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Owed</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {partners.map((p) => (
              <TR key={p.partner.id}>
                <TD>
                  {p.partner.name} <span className="text-xs text-muted-foreground">{PARTNER_KIND_LABELS[p.partner.kind]}</span>
                  {!p.partner.active && <Badge>Switched off</Badge>}
                  {(p.partner.contactName || p.partner.email) && <p className="text-xs text-muted-foreground">{[p.partner.contactName, p.partner.email, p.partner.phone].filter(Boolean).join(" · ")}</p>}
                </TD>
                <TD className="text-xs">
                  {Number(p.partner.commissionPct)}% for {p.partner.commissionMonths} months
                </TD>
                <TD className="text-right">{p.referred}</TD>
                <TD className="text-right">{p.won}</TD>
                <TD className="text-right text-xs">{naira(p.earned)}</TD>
                <TD className="text-right text-xs">{naira(p.paid)}</TD>
                <TD className={`text-right text-xs ${p.owed > 0 ? "font-medium text-amber-700" : ""}`}>{naira(p.owed)}</TD>
                <TD>
                  {manage && (
                    <ActionButton action={setPartnerActiveAction.bind(null, p.partner.id, !p.partner.active)} variant="outline">
                      {p.partner.active ? "Switch off" : "Switch on"}
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!partners.length && <Empty>No referral partners yet.</Empty>}
      </Section>

      <Section title="Commission still owed" flush>
        <Table>
          <THead>
            <TR>
              <TH>Partner</TH>
              <TH>Lead</TH>
              <TH className="text-right">Earned</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Owed</TH>
            </TR>
          </THead>
          <TBody>
            {owing.map((l) => (
              <TR key={l.leadId}>
                <TD className="text-xs">{l.partner.name}</TD>
                <TD className="text-xs">
                  <Link className="text-primary underline" href={`/crm/leads/${l.leadId}`}>
                    {l.number} {l.company}
                  </Link>
                </TD>
                <TD className="text-right text-xs">{naira(l.earned)}</TD>
                <TD className="text-right text-xs">{naira(l.paid)}</TD>
                <TD className="text-right text-xs font-medium">{naira(l.owed)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!owing.length && <Empty>Nothing is owed.</Empty>}
      </Section>

      {manage && (
        <>
          <FormPanel title="Add a referral partner">
            <SmartForm
              columns={3}
              submitLabel="Add partner"
              resetOnSuccess
              action={createPartnerAction}
              fields={[
                { name: "name", label: "Name", required: true },
                { name: "kind", label: "Kind", type: "select", required: true, options: PARTNER_KINDS.map((k) => ({ value: k, label: PARTNER_KIND_LABELS[k] })), defaultValue: "ACCOUNTANT" },
                { name: "contactName", label: "Contact" },
                { name: "email", label: "Email", type: "email" },
                { name: "phone", label: "Phone" },
                { name: "commissionPct", label: "Commission (% of monthly fee)", type: "number", min: 0, max: 100, required: true, defaultValue: 10 },
                { name: "commissionMonths", label: "For how many months", type: "number", min: 1, max: 60, required: true, defaultValue: 12 },
                { name: "notes", label: "Notes", type: "textarea", span: 3 },
              ]}
            />
          </FormPanel>
          {owing.length > 0 && (
            <FormPanel title="Record a commission payment">
              <p className="mb-3 text-xs text-muted-foreground">A mistake is corrected with a negative amount and a reference saying what it corrects; entries are never edited.</p>
              <SmartForm
                columns={3}
                submitLabel="Record payment"
                resetOnSuccess
                action={recordPayoutAction}
                fields={[
                  { name: "partnerId", label: "Partner", type: "select", required: true, options: partners.filter((p) => p.lines.length).map((p) => ({ value: p.partner.id, label: p.partner.name })) },
                  { name: "leadId", label: "For which lead", type: "select", required: true, options: owing.map((l) => ({ value: l.leadId, label: `${l.partner.name}: ${l.number} ${l.company} (owed ${naira(l.owed)})` })), help: "Must be a lead this partner referred" },
                  { name: "amount", label: "Amount (₦)", type: "number", required: true },
                  { name: "paidOn", label: "Paid on", type: "date", required: true, defaultValue: iso(new Date()) },
                  { name: "reference", label: "Reference", help: "Transfer reference, or what a correction corrects" },
                ]}
              />
            </FormPanel>
          )}
        </>
      )}

      <Section title="Recent payments" flush>
        <Table>
          <THead>
            <TR>
              <TH>Paid on</TH>
              <TH>Partner</TH>
              <TH className="text-right">Amount</TH>
              <TH>Reference</TH>
              <TH>Recorded by</TH>
            </TR>
          </THead>
          <TBody>
            {partners
              .flatMap((p) => p.payouts.map((x) => ({ ...x, partner: p.partner.name })))
              .sort((a, b) => b.paidOn.getTime() - a.paidOn.getTime())
              .slice(0, 20)
              .map((x) => (
                <TR key={x.id}>
                  <TD className="text-xs">{fmtDate(x.paidOn)}</TD>
                  <TD className="text-xs">{x.partner}</TD>
                  <TD className="text-right text-xs">{naira(x.amount)}</TD>
                  <TD className="text-xs">{x.reference ?? ""}</TD>
                  <TD className="text-xs">{x.byName}</TD>
                </TR>
              ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
