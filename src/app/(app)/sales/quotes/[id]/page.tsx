import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { BusinessError } from "@/server/services/_base";
import { getQuote, listQuotes } from "@/server/services/sales/quotes";
import { bpsToPercent } from "@/lib/sales/quote";
import { fmtDate } from "@/lib/dates";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { approveBelowMarginAction, decideQuoteAction, reviseQuoteAction, sendQuoteAction } from "@/app/actions/sales-quotes";

const money = (s: unknown) => `₦${Number(s).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export default async function SalesQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("sales.view");
  const { id } = await params;
  let q;
  try {
    q = await getQuote(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const deal = await db.crmOpportunity.findUniqueOrThrow({ where: { id: q.opportunityId }, select: { id: true, name: true, account: { select: { name: true } } } });
  const versions = await listQuotes(ctx, q.opportunityId);
  const manage = can(ctx.role, "sales.manage");
  const manager = can(ctx.role, "sales.view.all") && manage;
  const tone = q.status === "ACCEPTED" ? "green" : q.status === "REJECTED" ? "red" : undefined;
  return (
    <>
      <PageHeader
        title={`Quote ${q.number}, version ${q.versionNo}`}
        crumbs={[{ href: `/sales/opportunities/${deal.id}`, label: deal.name }]}
        description={`${deal.account.name}. Made by ${q.createdBy}${q.validUntil ? `, open until ${fmtDate(q.validUntil)}` : ""}.`}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={tone}>{label(q.status)}</Badge>
        <span>Margin {bpsToPercent(q.marginBps)}%</span>
        {q.minMarginBpsAtQuote > 0 && <span className="text-muted-foreground">minimum when priced: {bpsToPercent(q.minMarginBpsAtQuote)}%</span>}
        {q.belowMinimum && <Badge tone="red">Below the minimum margin</Badge>}
        {q.belowMarginApproved && <Badge tone="green">Approved by {q.approvedBy}</Badge>}
        <a className="underline" href={`/api/sales/quotes/${q.id}/pdf`}>
          Download the client&apos;s PDF
        </a>
      </div>

      <Section title="Lines (internal: includes the company's cost and margin)" flush>
        <Table>
          <THead>
            <TR>
              <TH>Site, post and people</TH>
              <TH className="text-right">Bill each</TH>
              <TH className="text-right">Cost each</TH>
              <TH className="text-right">Monthly bill</TH>
              <TH className="text-right">Monthly cost</TH>
              <TH className="text-right">Margin</TH>
            </TR>
          </THead>
          <TBody>
            {q.lines.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-normal text-xs">
                  {l.siteName}
                  {l.postLabel ? `, ${l.postLabel}` : ""}
                  {l.shiftPattern ? `, ${l.shiftPattern}` : ""}, {l.headcount} billed{l.requiredPersonnel !== l.headcount ? `, ${l.requiredPersonnel} needed to cover the shifts` : ""}
                  <div className="text-muted-foreground">
                    {l.structureName}, guard share {Number(l.operativeSharePct)}%, rules {(l.ruleVersions as { pension: string }).pension} / {(l.ruleVersions as { employerCost: string }).employerCost}
                  </div>
                </TD>
                <TD className="text-right">{money(l.billPerHead)}</TD>
                <TD className="text-right">{money(l.costPerHead)}</TD>
                <TD className="text-right">{money(l.lineBill)}</TD>
                <TD className="text-right">{money(l.lineCost)}</TD>
                <TD className="text-right">{money(l.lineMargin)}</TD>
              </TR>
            ))}
            <TR>
              <TD className="font-medium">Total a month</TD>
              <TD />
              <TD />
              <TD className="text-right font-medium">{money(q.monthlyBill)}</TD>
              <TD className="text-right font-medium">{money(q.monthlyCost)}</TD>
              <TD className="text-right font-medium">{money(q.monthlyMargin)}</TD>
            </TR>
          </TBody>
        </Table>
      </Section>
      {q.notes && <p className="text-sm">Notes for the client: {q.notes}</p>}

      {manage && (
        <Section title="What next">
          <div className="flex flex-wrap items-center gap-3">
            {q.status === "DRAFT" && (!q.belowMinimum || q.belowMarginApproved) && <ActionButton action={sendQuoteAction.bind(null, { id: q.id })} confirm="Mark this quote as sent to the client? Its lines can no longer be changed.">Mark as sent</ActionButton>}
            {q.status === "SENT" && (
              <>
                <ActionButton action={decideQuoteAction.bind(null, { id: q.id, decision: "ACCEPTED" })} confirm="The client accepted. This quote's monthly total becomes the deal's value.">Client accepted</ActionButton>
                <ActionButton action={decideQuoteAction.bind(null, { id: q.id, decision: "REJECTED" })} variant="outline">Client rejected</ActionButton>
              </>
            )}
            {["SENT", "ACCEPTED", "REJECTED"].includes(q.status) && <ActionButton action={reviseQuoteAction.bind(null, { id: q.id })} variant="outline" confirm="Make a new draft version, priced again on today's rules? This version will be marked superseded.">Make a new version</ActionButton>}
          </div>
          {q.status === "DRAFT" && q.belowMinimum && !q.belowMarginApproved && (
            <div className="mt-3 space-y-2">
              <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This quote&apos;s margin ({bpsToPercent(q.marginBps)}%) is below the minimum ({bpsToPercent(q.minMarginBpsAtQuote)}%). A sales manager other than {q.createdBy} must approve it, with a reason, before it can be sent.
              </p>
              {manager && q.createdByUserId !== ctx.userId && (
                <SmartForm columns={2} submitLabel="Approve below the minimum" action={approveBelowMarginAction} fields={[{ name: "id", label: "", type: "hidden", defaultValue: q.id }, { name: "note", label: "Reason", required: true, span: 2 }]} />
              )}
            </div>
          )}
        </Section>
      )}

      <Section title="Versions of this quote" flush>
        <Table>
          <THead><TR><TH>Version</TH><TH>Status</TH><TH className="text-right">Monthly bill</TH><TH className="text-right">Margin</TH></TR></THead>
          <TBody>
            {versions.map((v) => (
              <TR key={v.id}>
                <TD><Link className="underline" href={`/sales/quotes/${v.id}`}>{v.number} v{v.versionNo}</Link></TD>
                <TD><Badge>{label(v.status)}</Badge></TD>
                <TD className="text-right">{money(v.monthlyBill)}</TD>
                <TD className="text-right text-xs">{bpsToPercent(v.marginBps)}%</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
