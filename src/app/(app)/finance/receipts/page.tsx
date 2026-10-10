import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listClientReceipts, pendingRefunds } from "@/server/services/receipts";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { Empty, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { decideRefundAction } from "@/app/actions/receipts";

export default async function ReceiptsPage() {
  const ctx = await requirePage("gl.view");
  const [receipts, refunds] = await Promise.all([listClientReceipts(ctx), pendingRefunds(ctx)]);
  const manage = can(ctx.role, "payment.manage");
  const approve = can(ctx.role, "receipt.approve");
  const held = receipts.reduce((s, r) => s + r.position.held, 0);
  return (
    <>
      <PageHeader
        title="Client receipts"
        description="A receipt is money from a client, recorded once and applied across as many of their invoices as it settles, with any tax the client withheld. What isn't applied is held as an advance, to apply to invoices later or to refund (a refund is asked for by one person and approved by another). An allocation is never edited or deleted: if it went to the wrong invoice it is taken back, with a reason, and applied again. Receipts that settle a single invoice are still recorded on that invoice's page."
        actions={
          manage ? (
            <Link href="/finance/receipts/new" className={buttonVariants({})}>
              Record a receipt
            </Link>
          ) : undefined
        }
      />
      <StatGrid cols={3}>
        <Stat label="Receipts" value={receipts.length} />
        <Stat label="Held as advances" value={naira(held)} tone={held ? "amber" : "green"} />
        <Stat label="Refunds waiting for approval" value={refunds.length} tone={refunds.length ? "amber" : "green"} />
      </StatGrid>

      {refunds.length > 0 && (
        <Section title="Refunds waiting for approval" flush>
          <Table>
            <THead>
              <TR>
                <TH>Refund</TH>
                <TH>Client</TH>
                <TH>Receipt</TH>
                <TH className="text-right">Amount</TH>
                <TH>Why</TH>
                <TH>Asked by</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {refunds.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-xs">{r.refundNumber}</TD>
                  <TD>{r.client.name}</TD>
                  <TD className="font-mono text-xs">
                    <Link className="text-primary underline" href={`/finance/receipts/${r.receipt.id}`}>
                      {r.receipt.receiptNumber}
                    </Link>
                  </TD>
                  <TD className="text-right">{naira(num(r.amount))}</TD>
                  <TD className="max-w-[20rem] whitespace-normal text-xs">{r.reason}</TD>
                  <TD className="text-xs">{r.requestedBy}</TD>
                  <TD className="space-x-1 whitespace-nowrap text-right">
                    {approve && r.requestedByUserId !== ctx.userId && (
                      <>
                        <ActionButton action={decideRefundAction.bind(null, r.id, true)} confirm={`Approve returning ${naira(num(r.amount))} to ${r.client.name}? The refund is posted to the ledger.`} variant="success">
                          Approve
                        </ActionButton>
                        <ActionButton action={decideRefundAction.bind(null, r.id, false)} reason reasonPlaceholder="Why it is being turned down" variant="outline">
                          Turn down
                        </ActionButton>
                      </>
                    )}
                    {r.requestedByUserId === ctx.userId && <span className="text-xs text-muted-foreground">Waiting for someone else</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      <Section title="Receipts" flush>
        <Table>
          <THead>
            <TR>
              <TH>Receipt</TH>
              <TH>Client</TH>
              <TH>Received</TH>
              <TH className="text-right">Cash</TH>
              <TH className="text-right">Tax withheld</TH>
              <TH className="text-right">Held as advance</TH>
              <TH>Reference</TH>
            </TR>
          </THead>
          <TBody>
            {receipts.map((r) => (
              <TR key={r.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/finance/receipts/${r.id}`}>
                    {r.receiptNumber}
                  </Link>
                </TD>
                <TD>{r.client.name}</TD>
                <TD className="text-xs">{fmtDate(r.receivedDate)}</TD>
                <TD className="text-right">{naira(num(r.amount))}</TD>
                <TD className="text-right">{num(r.whtWithheld) ? naira(num(r.whtWithheld)) : "—"}</TD>
                <TD className="text-right">{r.position.held ? naira(r.position.held) : "—"}</TD>
                <TD className="text-xs">{r.reference ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!receipts.length && <Empty>No client receipts yet.</Empty>}
      </Section>
    </>
  );
}
