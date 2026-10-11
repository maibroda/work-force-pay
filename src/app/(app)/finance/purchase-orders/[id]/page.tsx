import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getPurchaseOrder } from "@/server/services/purchase-orders";
import { listGoodsReceipts, orderPosition } from "@/server/services/matching";
import { RECEIPT_PROGRESS_LABELS } from "@/lib/three-way-match";
import { ReceiveForm } from "./receive-form";
import { cancelGoodsReceiptAction } from "@/app/actions/matching";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import {
  approvePurchaseOrderAction,
  cancelPurchaseOrderAction,
  convertPurchaseOrderAction,
  rejectPurchaseOrderAction,
  submitPurchaseOrderAction,
} from "@/app/actions/purchase-orders";

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("gl.view");
  const { id } = await params;
  const order = await getPurchaseOrder(ctx, id);
  if (!order) notFound();
  const manage = can(ctx.role, "payment.manage");
  const canApprove = can(ctx.role, "purchase.approve");
  const canReceive = can(ctx.role, "goods.receive");
  const [position, receipts] = await Promise.all([orderPosition(ctx, order.id), listGoodsReceipts(ctx, order.id)]);
  const received = order.status === "APPROVED" || order.status === "CONVERTED";
  const todayIso = iso(new Date());

  return (
    <>
      <PageHeader
        title={`Purchase order ${order.orderNumber}`}
        crumbs={[{ href: "/finance/purchase-orders", label: "Purchase orders" }]}
        actions={
          manage && (
            <>
              {order.status === "DRAFT" && (
                <ActionButton action={submitPurchaseOrderAction.bind(null, order.id)}>
                  Submit for approval
                </ActionButton>
              )}
              {order.status === "PENDING_APPROVAL" && canApprove && order.requestedByUserId !== ctx.userId && (
                <>
                  <ActionButton action={approvePurchaseOrderAction.bind(null, order.id)}>Approve</ActionButton>
                  <ActionButton
                    action={rejectPurchaseOrderAction.bind(null, order.id)}
                    reason
                    reasonPlaceholder="Reason for rejecting"
                    variant="outline"
                  >
                    Reject
                  </ActionButton>
                </>
              )}
              {(order.status === "DRAFT" || order.status === "APPROVED") && (
                <ActionButton
                  action={cancelPurchaseOrderAction.bind(null, order.id)}
                  reason
                  reasonPlaceholder="Reason for cancelling"
                  variant="outline"
                >
                  Cancel
                </ActionButton>
              )}
            </>
          )
        }
      />

      <Section title="Order details">
        <KV
          cols={2}
          items={[
            ["Vendor", order.vendor.name],
            ["Cost center", order.costCenter?.name ?? "—"],
            ["Status", <StatusBadge key="s" status={order.status} />],
            ["Requested by", `${order.requestedBy} — ${fmtDate(order.requestedAt)}`],
            [
              "Decision",
              order.decidedBy ? `${order.decidedBy} — ${fmtDate(order.decidedAt)}` : "—",
            ],
            ["Decision reason", order.decisionReason ?? "—"],
          ]}
        />
        {order.notes && <p className="mt-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{order.notes}</p>}
      </Section>

      <Section title="Line items" flush>
        <Table>
          <THead>
            <TR>
              <TH>Description</TH>
              <TH className="text-right">Quantity</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {order.lines.map((l) => (
              <TR key={l.id}>
                <TD>{l.description}</TD>
                <TD className="text-right">{num(l.quantity)}</TD>
                <TD className="text-right">{naira(l.rate)}</TD>
                <TD className="text-right">{naira(l.amount)}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={3}>Subtotal</TD>
              <TD className="text-right">{naira(order.subtotal)}</TD>
            </TR>
            {num(order.vatPct) > 0 && (
              <TR>
                <TD colSpan={3}>VAT ({num(order.vatPct)}%)</TD>
                <TD className="text-right">{naira(order.vatAmount)}</TD>
              </TR>
            )}
            <TR className="font-semibold">
              <TD colSpan={3}>Total</TD>
              <TD className="text-right">{naira(order.totalAmount)}</TD>
            </TR>
          </TFoot>
        </Table>
      </Section>

      {received && (
        <Section
          title="Goods received"
          description={`${RECEIPT_PROGRESS_LABELS[position.progress]}. The vendor's bill is matched to what was ordered and what is recorded here; a bill that doesn't match can't be paid until a second person approves it.`}
          flush
        >
          <Table>
            <THead>
              <TR>
                <TH>Line</TH>
                <TH className="text-right">Ordered</TH>
                <TH className="text-right">Received</TH>
                <TH className="text-right">Billed</TH>
                <TH className="text-right">Outstanding</TH>
              </TR>
            </THead>
            <TBody>
              {position.lines.map((l) => (
                <TR key={l.id}>
                  <TD>{l.description}</TD>
                  <TD className="text-right">{l.ordered}</TD>
                  <TD className="text-right">{l.received}</TD>
                  <TD className="text-right">{l.billed}</TD>
                  <TD className="text-right">{l.open}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      {received && receipts.length > 0 && (
        <Section title="Receipts" flush>
          <Table>
            <THead>
              <TR>
                <TH>Receipt</TH>
                <TH>Date</TH>
                <TH>Delivery note</TH>
                <TH>Received</TH>
                <TH>By</TH>
                <TH>Status</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {receipts.map((r) => (
                <TR key={r.id}>
                  <TD className="font-mono text-xs">{r.receiptNumber}</TD>
                  <TD>{fmtDate(r.receivedDate)}</TD>
                  <TD className="text-xs">{r.deliveryNote ?? "—"}</TD>
                  <TD className="text-xs">{r.lines.map((l) => `${num(l.quantity)} × ${l.orderLine.description}`).join("; ")}</TD>
                  <TD className="text-xs">{r.receivedBy}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                    {r.cancelReason && <span className="ml-1 text-xs text-muted-foreground">{r.cancelReason}</span>}
                  </TD>
                  <TD>
                    {canReceive && r.status === "POSTED" && (
                      <ActionButton action={cancelGoodsReceiptAction.bind(null, r.id)} reason reasonPlaceholder="Why is this receipt being cancelled?" variant="outline">
                        Cancel
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}

      {canReceive && received && position.lines.some((l) => l.open > 0) && order.requestedByUserId !== ctx.userId && (
        <Section title="Record goods received" description="Quantities default to what is still outstanding; change them to what actually arrived.">
          <ReceiveForm orderId={order.id} today={todayIso} lines={position.lines.filter((l) => l.open > 0).map((l) => ({ id: l.id, description: l.description, open: l.open }))} />
        </Section>
      )}

      {order.convertedInvoice && (
        <Section title="Converted bill">
          <p className="text-sm">
            This order was converted to purchase invoice{" "}
            <Link className="text-primary underline" href={`/finance/payables/${order.convertedInvoice.id}`}>
              {order.convertedInvoice.invoiceNumber}
            </Link>
            .
          </p>
        </Section>
      )}

      {manage && order.status === "APPROVED" && !order.convertedInvoice && (
        <Section
          title="Convert to a bill"
          description="Record the vendor's actual invoice once it arrives — vendor, cost center and lines carry over from this order."
        >
          <p className="mb-3 text-sm">
            <Link className="text-primary underline" href={`/finance/payables/new?po=${order.id}`}>
              The bill differs from the order? Record it with its own quantities and prices
            </Link>
          </p>
          <SmartForm
            columns={3}
            submitLabel="Convert to bill"
            action={convertPurchaseOrderAction}
            fields={[
              { name: "purchaseOrderId", label: "", type: "hidden", defaultValue: order.id },
              { name: "vendorRef", label: "Vendor's invoice/bill number" },
              {
                name: "invoiceDate",
                label: "Invoice date",
                type: "date",
                required: true,
                defaultValue: iso(new Date()),
              },
              { name: "dueDate", label: "Due date", type: "date", required: true },
            ]}
          />
        </Section>
      )}
    </>
  );
}
