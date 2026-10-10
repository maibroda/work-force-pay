import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getInvoice } from "@/server/services/billing";
import { db } from "@/lib/db";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { enumOptions } from "@/server/options";
import { KV, PageHeader, Section } from "@/components/page";
import { BASE_LABELS, SOURCE_LABELS, type BillingBase, type RuleSource } from "@/lib/billing-rules";
import { ActionButton } from "@/components/action-button";
import { PrintButton } from "@/components/print-button";
import { SmartForm } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { cancelInvoiceAction, recordDeductionAction, recordReceiptAction } from "@/app/actions/billing";

const DEDUCTION_TYPES = ["WITHHOLDING_TAX", "LEAVE_ALLOWANCE", "OTHER"];

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("client.view");
  const { id } = await params;
  const inv = await getInvoice(ctx, id);
  if (!inv) notFound();
  const org = await db.organization.findUnique({ where: { id: ctx.orgId } });
  const manage = can(ctx.role, "payment.manage");
  const balance = num(inv.totalAmount) - num(inv.amountPaid) - num(inv.totalDeductions);
  // how each contract on the invoice was billed (invoices from before billing rules have none recorded)
  type Treatment = { contract: string; source: string; directPct: number; indirectPct: number; vatBase: string; whtBase: string; vat: { code: string | null; ratePct: number; source: string }; wht: { code: string | null; ratePct: number; source: string } };
  const treatments = ((inv.taxBasis ?? {}) as { contracts?: Treatment[] }).contracts ?? [];
  const vatBases = [...new Set(treatments.map((t) => t.vatBase))];
  const vatOnIndirectOnly = !treatments.length || (vatBases.length === 1 && vatBases[0] === "INDIRECT");
  const overdue = balance > 0 && iso(inv.dueDate) < iso(new Date()) && inv.status !== "CANCELLED";

  return (
    <>
      <PageHeader
        title={`Invoice ${inv.invoiceNumber}`}
        crumbs={[{ href: "/finance/invoices", label: "Billing & receivables" }]}
        actions={
          <>
            {manage &&
              balance <= 0.01 &&
              inv.status !== "CANCELLED" &&
              num(inv.amountPaid) === 0 &&
              num(inv.totalDeductions) === 0 && (
                <ActionButton
                  action={cancelInvoiceAction.bind(null, inv.id)}
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
            <p className="text-lg font-semibold">{org?.name}</p>
            <p className="text-xs text-muted-foreground">{org?.address}</p>
            <p className="text-xs text-muted-foreground">
              {org?.phone} {org?.email ? `· ${org.email}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold">INVOICE</p>
            <p className="font-mono text-sm">{inv.invoiceNumber}</p>
            <StatusBadge status={overdue ? "OVERDUE" : inv.status} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-b py-4">
          <div>
            <p className="text-[11px] font-medium uppercase text-muted-foreground">Bill to</p>
            <p className="font-semibold">{inv.client.name}</p>
            {inv.client.contactPerson && <p>{inv.client.contactPerson}</p>}
            {inv.client.address && <p className="text-xs text-muted-foreground">{inv.client.address}</p>}
          </div>
          <div className="text-right">
            <p>
              <span className="text-muted-foreground">Invoice date:</span> {fmtDate(inv.invoiceDate)}
            </p>
            <p>
              <span className="text-muted-foreground">Due date:</span> {fmtDate(inv.dueDate)}
            </p>
            <p>
              <span className="text-muted-foreground">Billing period:</span> {inv.period.name}
            </p>
          </div>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Description</TH>
              <TH className="text-right">Quantity</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Direct charge ({num(inv.directChargePct)}%)</TH>
              <TH className="text-right">Indirect charge ({num(inv.indirectChargePct)}%)</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {inv.lines.map((l) => (
              <TR key={l.id}>
                <TD>{l.description}</TD>
                <TD className="text-right">{l.headcount}</TD>
                <TD className="text-right">{naira(l.rate)}</TD>
                <TD className="text-right">{naira(l.directCharge)}</TD>
                <TD className="text-right">{naira(l.indirectCharge)}</TD>
                <TD className="text-right">{naira(l.amount)}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={3}>Subtotal</TD>
              <TD className="text-right">{naira(inv.totalDirectCharge)}</TD>
              <TD className="text-right">{naira(inv.totalIndirectCharge)}</TD>
              <TD className="text-right">{naira(inv.subtotal)}</TD>
            </TR>
            {num(inv.vatPct) > 0 && (
              <TR>
                <TD colSpan={5}>VAT ({num(inv.vatPct)}%{vatOnIndirectOnly ? " of indirect charge" : ""})</TD>
                <TD className="text-right">{naira(inv.vatAmount)}</TD>
              </TR>
            )}
            <TR className="text-base">
              <TD colSpan={5}>Total due</TD>
              <TD className="text-right">{naira(inv.totalAmount)}</TD>
            </TR>
            <TR>
              <TD colSpan={5}>Paid to date</TD>
              <TD className="text-right">{naira(inv.amountPaid)}</TD>
            </TR>
            {num(inv.totalDeductions) > 0 && (
              <TR>
                <TD colSpan={5}>Deductions (WHT / other — see below)</TD>
                <TD className="text-right">{naira(inv.totalDeductions)}</TD>
              </TR>
            )}
            <TR className="font-semibold">
              <TD colSpan={5}>Balance due</TD>
              <TD className="text-right">{naira(balance)}</TD>
            </TR>
          </TFoot>
        </Table>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Each line splits into a Direct charge ({num(inv.directChargePct)}% of the charge-out rate) and an
          Indirect charge ({num(inv.indirectChargePct)}%).
          {vatOnIndirectOnly ? ` VAT is computed on the total Indirect charge of ${naira(inv.totalIndirectCharge)} only, not on the full subtotal.` : ""}
        </p>
        {treatments.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
            {treatments.map((t, i) => (
              <li key={i}>
                {t.contract}: {SOURCE_LABELS[t.source as RuleSource] ?? t.source}, split {t.directPct}/{t.indirectPct}, VAT {t.vat.ratePct}% on {BASE_LABELS[t.vatBase as BillingBase]?.toLowerCase()}, withholding {t.wht.ratePct}% on {BASE_LABELS[t.whtBase as BillingBase]?.toLowerCase()}.
              </li>
            ))}
          </ul>
        )}
        {num(inv.whtPct) > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Expected withholding tax credit @ {num(inv.whtPct)}%: {naira(inv.whtAmount)}. This does not reduce
            the total due above — record the actual amount withheld as a deduction (with the WHT credit note
            reference) when payment is received.
          </p>
        )}
        {inv.notes && (
          <p className="mt-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{inv.notes}</p>
        )}
        <p className="mt-4 text-[10px] text-muted-foreground">
          Generated from {inv.run.type === "SUPPLEMENTARY" ? "supplementary" : "regular"} payroll run #
          {inv.run.runNumber} for {inv.period.name}. Payment due within 30 days of the invoice date.
        </p>
      </div>

      <Section title="Payments received" flush>
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
            {inv.receipts.map((r) => (
              <TR key={r.id}>
                <TD>{fmtDate(r.receivedDate)}</TD>
                <TD className="text-right">{naira(r.amount)}</TD>
                <TD className="text-xs">{r.method ?? "—"}</TD>
                <TD className="text-xs">{r.reference ?? "—"}</TD>
                <TD className="text-xs">{r.recordedBy}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!inv.receipts.length && (
          <p className="px-4 py-4 text-sm text-muted-foreground">No payments recorded yet.</p>
        )}
      </Section>

      <Section
        title="Deductions"
        flush
        description="Withholding tax, a leave-allowance credit or any other amount the client deducted instead of paying in cash — each requires a documented reason and a supporting reference."
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
                action={recordReceiptAction}
                fields={[
                  { name: "invoiceId", label: "", type: "hidden", defaultValue: inv.id },
                  {
                    name: "amount",
                    label: "Amount received (₦)",
                    type: "number",
                    required: true,
                    min: 1,
                    max: balance,
                    defaultValue: balance,
                  },
                  {
                    name: "receivedDate",
                    label: "Date received",
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
            description="For withholding tax, a leave-allowance credit, or any other client-side deduction — a reason and supporting document reference are both required."
          >
            <SmartForm
              columns={3}
              submitLabel="Record deduction"
              resetOnSuccess
              action={recordDeductionAction}
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
                {
                  name: "amount",
                  label: "Amount (₦)",
                  type: "number",
                  required: true,
                  min: 1,
                  max: balance,
                  defaultValue: num(inv.whtAmount) > 0 ? Math.min(num(inv.whtAmount), balance) : undefined,
                  help:
                    num(inv.whtPct) > 0
                      ? `Expected WHT @ ${num(inv.whtPct)}%: ${naira(inv.whtAmount)}`
                      : undefined,
                },
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
