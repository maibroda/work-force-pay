import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getClientReceipt } from "@/server/services/receipts";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requestRefundAction, reverseAllocationAction } from "@/app/actions/receipts";
import { ReceiptEditor } from "../receipt-editor";

const tone = { PENDING: "amber", APPROVED: "green", REJECTED: "red" } as const;
const label = { PENDING: "Waiting for approval", APPROVED: "Paid", REJECTED: "Turned down" } as const;

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("gl.view");
  const { id } = await params;
  const r = await getClientReceipt(ctx, id);
  if (!r) notFound();
  const manage = can(ctx.role, "payment.manage");
  const today = iso(new Date());
  return (
    <>
      <PageHeader
        title={`Receipt ${r.receiptNumber}`}
        crumbs={[{ href: "/finance/receipts", label: "Client receipts" }]}
        description={`${r.client.name} · ${fmtDate(r.receivedDate)}${r.method ? ` · ${r.method}` : ""}${r.reference ? ` · ${r.reference}` : ""}`}
        actions={
          <Link className="text-sm text-primary underline" href={`/finance/statements/${r.client.id}`}>
            Statement →
          </Link>
        }
      />
      <Section title="Position">
        <KV
          cols={4}
          items={[
            ["Cash received", naira(num(r.amount))],
            ["Tax withheld", num(r.whtWithheld) ? `${naira(num(r.whtWithheld))} (${r.whtReference})` : "—"],
            ["Applied to invoices", naira(r.position.cashApplied + r.position.whtApplied)],
            ["Held as an advance", naira(r.position.held)],
          ]}
        />
        {r.notes && <p className="mt-3 text-sm text-muted-foreground">{r.notes}</p>}
      </Section>

      <Section title="Applied to invoices" flush>
        <Table>
          <THead>
            <TR>
              <TH>Invoice</TH>
              <TH>Applied on</TH>
              <TH className="text-right">Cash</TH>
              <TH className="text-right">Tax withheld</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {r.allocations.map((a) => (
              <TR key={a.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/finance/invoices/${a.invoice.id}`}>
                    {a.invoice.invoiceNumber}
                  </Link>
                </TD>
                <TD className="text-xs">{fmtDate(a.appliedOn)}</TD>
                <TD className="text-right">{naira(num(a.cashAmount))}</TD>
                <TD className="text-right">{num(a.whtAmount) ? naira(num(a.whtAmount)) : "—"}</TD>
                <TD className="max-w-[20rem] whitespace-normal text-xs">
                  {a.reversedAt ? (
                    <>
                      <Badge tone="gray">Taken back</Badge>
                      <div className="text-muted-foreground">
                        {a.reversedBy}, {fmtDate(a.reversedOn)}: {a.reversalReason}
                      </div>
                    </>
                  ) : (
                    <Badge tone="green">Applied</Badge>
                  )}
                </TD>
                <TD className="text-right">
                  {manage && !a.reversedAt && (
                    <ActionButton action={reverseAllocationAction.bind(null, a.id)} reason reasonPlaceholder="Why it is being taken back" variant="outline">
                      Take back
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!r.allocations.length && <p className="px-4 py-3 text-sm text-muted-foreground">Nothing applied yet: all of it is held as an advance.</p>}
      </Section>

      {manage && r.position.held > 0 && (
        <Section title="Apply what is held to invoices">
          <ReceiptEditor
            mode="apply"
            clientId={r.client.id}
            receiptId={r.id}
            today={today}
            available={{ cash: r.position.cashLeft, wht: r.position.whtLeft }}
            invoices={r.open.map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, dueDate: iso(i.dueDate), balance: i.balance }))}
          />
        </Section>
      )}

      <Section title="Refunds" flush>
        <Table>
          <THead>
            <TR>
              <TH>Refund</TH>
              <TH>Date</TH>
              <TH className="text-right">Amount</TH>
              <TH>Status</TH>
              <TH>Why</TH>
            </TR>
          </THead>
          <TBody>
            {r.refunds.map((x) => (
              <TR key={x.id}>
                <TD className="font-mono text-xs">{x.refundNumber}</TD>
                <TD className="text-xs">{fmtDate(x.refundDate)}</TD>
                <TD className="text-right">{naira(num(x.amount))}</TD>
                <TD>
                  <Badge tone={tone[x.status]}>{label[x.status]}</Badge>
                  {x.decidedBy && <div className="text-xs text-muted-foreground">{x.decidedBy}</div>}
                </TD>
                <TD className="max-w-[24rem] whitespace-normal text-xs">
                  {x.reason}
                  <div className="text-muted-foreground">Asked by {x.requestedBy}</div>
                  {x.decisionNote ? <div className="text-muted-foreground">Decision: {x.decisionNote}</div> : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!r.refunds.length && <p className="px-4 py-3 text-sm text-muted-foreground">No refunds.</p>}
        {manage && r.position.cashLeft > 0 && (
          <div className="border-t px-4 py-3">
            <p className="mb-2 text-sm font-medium">Return some of the held cash to the client</p>
            <SmartForm
              columns={3}
              submitLabel="Ask for a refund"
              action={requestRefundAction.bind(null, r.id)}
              fields={[
                { name: "amount", label: "Amount", type: "number", min: 0, max: r.position.cashLeft, required: true, help: `Up to ${naira(r.position.cashLeft)}` },
                { name: "refundDate", label: "Refund date", type: "date", required: true, defaultValue: today },
                { name: "method", label: "Method", type: "text", defaultValue: "Bank transfer" },
                { name: "reference", label: "Reference", type: "text" },
                { name: "reason", label: "Why the money is being returned", type: "text", required: true, span: 2 },
              ]}
            />
          </div>
        )}
      </Section>
    </>
  );
}
