import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getPurchaseInvoice } from "@/server/services/payables";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { enumOptions } from "@/server/options";
import { KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { PrintButton } from "@/components/print-button";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import {
  cancelPurchaseInvoiceAction,
  recordPurchaseInvoiceDeductionAction,
  recordVendorPaymentAction,
} from "@/app/actions/payables";

const DEDUCTION_TYPES = ["WITHHOLDING_TAX", "OTHER"];

export default async function PurchaseInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("gl.view");
  const { id } = await params;
  const inv = await getPurchaseInvoice(ctx, id);
  if (!inv) notFound();
  const manage = can(ctx.role, "payment.manage");
  const balance = num(inv.totalAmount) - num(inv.amountPaid) - num(inv.totalDeductions);
  const overdue = balance > 0 && iso(inv.dueDate) < iso(new Date()) && inv.status !== "CANCELLED";

  return (
    <>
      <PageHeader
        title={`Purchase invoice ${inv.invoiceNumber}`}
        crumbs={[{ href: "/finance/payables", label: "Billing & payables" }]}
        actions={
          <>
            {manage &&
              balance <= 0.01 &&
              inv.status !== "CANCELLED" &&
              num(inv.amountPaid) === 0 &&
              num(inv.totalDeductions) === 0 && (
                <ActionButton
                  action={cancelPurchaseInvoiceAction.bind(null, inv.id)}
                  reason
                  reasonPlaceholder="Reason for cancelling"
                  variant="outline"
                >
                  Cancel invoice
                </ActionButton>
              )}
            <PrintButton />
          </>
        }
      />

      <div className="print-area mx-auto max-w-3xl rounded-lg border bg-white p-6 text-sm shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div>
            <p className="text-lg font-semibold">{inv.vendor.name}</p>
            <p className="text-xs text-muted-foreground">{inv.vendor.address}</p>
            <p className="text-xs text-muted-foreground">
              {inv.vendor.phone} {inv.vendor.email ? `· ${inv.vendor.email}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold">PURCHASE INVOICE</p>
            <p className="font-mono text-sm">{inv.invoiceNumber}</p>
            {inv.vendorRef && <p className="text-xs text-muted-foreground">Vendor ref: {inv.vendorRef}</p>}
            <StatusBadge status={overdue ? "OVERDUE" : inv.status} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-b py-4">
          <div>
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Description</p>
            <p>{inv.description}</p>
            {inv.costCenter && (
              <p className="text-xs text-muted-foreground">Cost center: {inv.costCenter.name}</p>
            )}
          </div>
          <div className="text-right">
            <p>
              <span className="text-muted-foreground">Invoice date:</span> {fmtDate(inv.invoiceDate)}
            </p>
            <p>
              <span className="text-muted-foreground">Due date:</span> {fmtDate(inv.dueDate)}
            </p>
          </div>
        </div>
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
            {inv.lines.map((l) => (
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
              <TD className="text-right">{naira(inv.subtotal)}</TD>
            </TR>
            {num(inv.vatPct) > 0 && (
              <TR>
                <TD colSpan={3}>VAT ({num(inv.vatPct)}%)</TD>
                <TD className="text-right">{naira(inv.vatAmount)}</TD>
              </TR>
            )}
            <TR className="text-base">
              <TD colSpan={3}>Total payable</TD>
              <TD className="text-right">{naira(inv.totalAmount)}</TD>
            </TR>
            <TR>
              <TD colSpan={3}>Paid to date</TD>
              <TD className="text-right">{naira(inv.amountPaid)}</TD>
            </TR>
            {num(inv.totalDeductions) > 0 && (
              <TR>
                <TD colSpan={3}>Deductions (WHT / other — see below)</TD>
                <TD className="text-right">{naira(inv.totalDeductions)}</TD>
              </TR>
            )}
            <TR className="font-semibold">
              <TD colSpan={3}>Balance due</TD>
              <TD className="text-right">{naira(balance)}</TD>
            </TR>
          </TFoot>
        </Table>
        {inv.notes && (
          <p className="mt-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{inv.notes}</p>
        )}
      </div>

      <Section title="Payments made" flush>
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH className="text-right">Amount</TH>
              <TH>Method</TH>
              <TH>Reference</TH>
              <TH>Recorded by</TH>
            </TR>
          </THead>
          <TBody>
            {inv.payments.map((p) => (
              <TR key={p.id}>
                <TD>{fmtDate(p.paidDate)}</TD>
                <TD className="text-right">{naira(p.amount)}</TD>
                <TD className="text-xs">{p.method ?? "—"}</TD>
                <TD className="text-xs">{p.reference ?? "—"}</TD>
                <TD className="text-xs">{p.recordedBy}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!inv.payments.length && (
          <p className="px-4 py-4 text-sm text-muted-foreground">No payments recorded yet.</p>
        )}
      </Section>

      <Section
        title="Deductions"
        flush
        description="Withholding tax we withheld, or any other short-payment agreed with the vendor — each requires a documented reason and a supporting reference."
      >
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Type</TH>
              <TH className="text-right">Amount</TH>
              <TH>Reason</TH>
              <TH>Supporting document</TH>
              <TH>Recorded by</TH>
            </TR>
          </THead>
          <TBody>
            {inv.deductions.map((x) => (
              <TR key={x.id}>
                <TD className="text-xs">{fmtDate(x.createdAt)}</TD>
                <TD className="text-xs">{x.type.replace(/_/g, " ")}</TD>
                <TD className="text-right">{naira(x.amount)}</TD>
                <TD className="max-w-xs whitespace-normal text-xs">{x.reason}</TD>
                <TD className="text-xs">{x.supportingDocument}</TD>
                <TD className="text-xs">{x.recordedBy}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!inv.deductions.length && (
          <p className="px-4 py-4 text-sm text-muted-foreground">No deductions recorded yet.</p>
        )}
      </Section>

      {manage && balance > 0.01 && inv.status !== "CANCELLED" && (
        <>
          <Section title="Record a payment">
            <KV
              cols={2}
              items={[
                ["Outstanding balance", <b key="b">{naira(balance)}</b>],
                [
                  "Overdue",
                  overdue ? (
                    <Badge key="o" tone="red">
                      Yes — due {fmtDate(inv.dueDate)}
                    </Badge>
                  ) : (
                    "No"
                  ),
                ],
              ]}
            />
            <div className="mt-4">
              <SmartForm
                columns={3}
                submitLabel="Record payment"
                action={recordVendorPaymentAction}
                fields={[
                  { name: "invoiceId", label: "", type: "hidden", defaultValue: inv.id },
                  {
                    name: "amount",
                    label: "Amount paid (₦)",
                    type: "number",
                    required: true,
                    min: 1,
                    max: balance,
                    defaultValue: balance,
                  },
                  {
                    name: "paidDate",
                    label: "Date paid",
                    type: "date",
                    required: true,
                    defaultValue: iso(new Date()),
                  },
                  { name: "method", label: "Method", placeholder: "Bank transfer, cheque, …" },
                  { name: "reference", label: "Reference", span: 2 },
                ]}
              />
            </div>
          </Section>

          <Section
            title="Record a deduction"
            description="Withholding tax withheld, or another agreed short-payment — a reason and supporting document reference are both required."
          >
            <SmartForm
              columns={3}
              submitLabel="Record deduction"
              resetOnSuccess
              action={recordPurchaseInvoiceDeductionAction}
              fields={[
                { name: "invoiceId", label: "", type: "hidden", defaultValue: inv.id },
                {
                  name: "type",
                  label: "Type",
                  type: "select",
                  required: true,
                  options: enumOptions(DEDUCTION_TYPES),
                  defaultValue: "WITHHOLDING_TAX",
                },
                { name: "amount", label: "Amount (₦)", type: "number", required: true, min: 1, max: balance },
                {
                  name: "supportingDocument",
                  label: "Supporting document",
                  required: true,
                  placeholder: "WHT credit note no., correspondence ref., …",
                },
                {
                  name: "reason",
                  label: "Reason / justification",
                  type: "textarea",
                  required: true,
                  span: 3,
                },
              ]}
            />
          </Section>
        </>
      )}
    </>
  );
}
