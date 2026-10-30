import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { BusinessError } from "@/server/services/_base";
import { getOpportunity } from "@/server/services/sales/deals";
import { getHandoverForDeal } from "@/server/services/sales/handover";
import { listQuotes } from "@/server/services/sales/quotes";
import { bpsToPercent } from "@/lib/sales/quote";
import { annualValueKobo, weightedValueKobo } from "@/lib/sales/forecast";
import { koboToString } from "@/lib/money-exact";
import { fmtDate } from "@/lib/dates";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { updateOpportunityAction } from "@/app/actions/sales-deals";

const money = (s: string) => `₦${Number(s).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function SalesDealPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("sales.view");
  const { id } = await params;
  let v;
  try {
    v = await getOpportunity(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const o = v.opportunity;
  const closed = o.stage.stageType !== "OPEN";
  const names = new Map(v.stages.map((s) => [s.id, s.name]));
  const quotes = await listQuotes(ctx, id);
  const handover = await getHandoverForDeal(ctx, id);
  return (
    <>
      <PageHeader title={o.name} crumbs={[{ href: "/sales/board", label: "Deals board" }]} description={`${o.account.name}. Owner ${o.ownerName}.`} />
      <Section title="Where it stands">
        <ol className="mb-3 flex flex-wrap gap-1 text-xs">
          {v.stages.map((s) => (
            <li key={s.id} className={`rounded px-2 py-1 ${s.id === o.stageId ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {s.name}
            </li>
          ))}
        </ol>
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Monthly value</dt><dd>{money(koboToString(weightedValueKobo(o.monthlyContractValue, 100)))}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Yearly value (monthly x 12, not stored)</dt><dd>{money(koboToString(annualValueKobo(o.monthlyContractValue)))}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Probability and weighted value</dt><dd>{o.probability}% · {money(koboToString(weightedValueKobo(o.monthlyContractValue, o.probability)))}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Service</dt><dd>{label(o.serviceType)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Expected close</dt><dd>{o.expectedCloseDate ? fmtDate(o.expectedCloseDate) : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Expected start and term</dt><dd>{o.expectedStartDate ? fmtDate(o.expectedStartDate) : "—"}{o.contractTermMonths ? ` · ${o.contractTermMonths} months` : ""}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Contact</dt><dd>{o.primaryContact ? <Link className="underline" href={`/sales/contacts/${o.primaryContact.id}`}>{o.primaryContact.firstName} {o.primaryContact.lastName}</Link> : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Competitor</dt><dd>{o.competitor ?? "—"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Next step</dt><dd>{o.nextStep ?? "—"}</dd></div>
          {o.stage.stageType === "LOST" && (
            <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Why it was lost</dt><dd><Badge tone="red">{o.lostReason ? label(o.lostReason) : "—"}</Badge> {o.lostReasonDetail ?? ""}</dd></div>
          )}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">To move it to another stage, use the <Link className="underline" href="/sales/board">board</Link>.</p>
      </Section>

      {!closed && can(ctx.role, "sales.manage") && (
        <Section title="Change the deal" description="A value takes at most two decimals; more is refused, never rounded. Won needs a value, a term and a start date.">
          <SmartForm
            columns={3}
            submitLabel="Save"
            action={updateOpportunityAction}
            fields={[
              { name: "id", label: "", type: "hidden", defaultValue: o.id },
              { name: "name", label: "Deal name", defaultValue: o.name },
              { name: "monthlyContractValue", label: "Monthly value (naira)", defaultValue: koboToString(weightedValueKobo(o.monthlyContractValue, 100)) },
              { name: "probability", label: "Probability %", type: "number", defaultValue: o.probability },
              { name: "expectedCloseDate", label: "Expected close", type: "date", defaultValue: day(o.expectedCloseDate) },
              { name: "expectedStartDate", label: "Expected start", type: "date", defaultValue: day(o.expectedStartDate) },
              { name: "contractTermMonths", label: "Term (months)", type: "number", defaultValue: o.contractTermMonths ?? "" },
              { name: "competitor", label: "Competitor", defaultValue: o.competitor ?? "" },
              { name: "nextStep", label: "Next step", defaultValue: o.nextStep ?? "", span: 2 },
            ]}
          />
        </Section>
      )}

      <Section title={`${quotes.length} quote(s)`} flush>
        <Table>
          <THead><TR><TH>Quote</TH><TH>Status</TH><TH className="text-right">Monthly bill</TH><TH className="text-right">Margin</TH></TR></THead>
          <TBody>
            {quotes.map((x) => (
              <TR key={x.id}>
                <TD><Link className="underline" href={`/sales/quotes/${x.id}`}>{x.number} v{x.versionNo}</Link></TD>
                <TD><Badge>{label(x.status)}</Badge></TD>
                <TD className="text-right">{money(String(x.monthlyBill))}</TD>
                <TD className="text-right text-xs">{bpsToPercent(x.marginBps)}%{x.belowMinimum ? " (below the minimum)" : ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!quotes.length && <p className="px-4 py-4 text-sm text-muted-foreground">No quote yet.</p>}
        {!closed && can(ctx.role, "sales.manage") && (
          <p className="px-4 pb-4 text-sm">
            <Link className="underline" href={`/sales/opportunities/${o.id}/quote`}>Make a quote</Link> priced against what the guards cost.
          </p>
        )}
      </Section>

      {handover && (
        <Section title="Handover to Operations">
          <p className="text-sm">
            <Link className="underline" href={`/sales/handovers/${handover.id}`}>{handover.number}</Link>: <Badge>{label(handover.status)}</Badge>
            {handover.status === "DRAFT" || handover.status === "RETURNED" ? " Sales must complete it and send it to Operations." : handover.status === "SUBMITTED" ? " Waiting for Operations." : " Accepted by Operations."}
          </p>
        </Section>
      )}

      <Section title="Stage history" flush>
        <Table>
          <THead><TR><TH>When</TH><TH>From</TH><TH>To</TH><TH>By</TH><TH className="text-right">Days in the earlier stage</TH></TR></THead>
          <TBody>
            {v.history.map((h) => (
              <TR key={h.id}>
                <TD className="text-xs">{fmtDate(h.changedAt)}</TD>
                <TD className="text-xs">{h.fromStageId ? names.get(h.fromStageId) ?? "—" : "Created"}</TD>
                <TD className="text-xs">{names.get(h.toStageId) ?? "—"}</TD>
                <TD className="text-xs">{h.changedBy}</TD>
                <TD className="text-right text-xs">{h.daysInPreviousStage ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
