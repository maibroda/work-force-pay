import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getPurchaseOrder } from "@/server/services/purchase-orders";
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
              {order.status === "PENDING_APPROVAL" && (
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
