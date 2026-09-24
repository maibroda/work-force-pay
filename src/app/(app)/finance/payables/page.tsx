import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { payablesSummary } from "@/server/services/payables";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";

export default async function PayablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const manage = can(ctx.role, "payment.manage");
  const summary = await payablesSummary(ctx, { from: sp.from, to: sp.to });
  const today = iso(new Date());
  const invoices = sp.vendorId
    ? summary.invoices.filter((i) => i.vendorId === sp.vendorId)
    : summary.invoices;
  const vendorOptions = [...new Map(summary.invoices.map((i) => [i.vendorId, i.vendor.name])).entries()];

  return (
    <>
      <PageHeader
        title="Billing & payables"
        description="Vendor bills and what's outstanding — the accounts-payable side of the business. Record a bill, then track payments and any deductions (e.g. withholding tax) against it."
        actions={
          manage && (
            <Link className={buttonVariants()} href="/finance/payables/new">
              + Record bill
            </Link>
          )
        }
      />
      <StatGrid cols={5}>
        <Stat label="Total billed" value={naira(summary.totals.billed)} />
        <Stat label="Paid" value={naira(summary.totals.paid)} tone="green" />
        <Stat label="Deducted (WHT etc.)" value={naira(summary.totals.deducted)} />
        <Stat label="Outstanding" value={naira(summary.totals.outstanding)} tone="amber" />
        <Stat
          label="Overdue"
          value={naira(summary.totals.overdue)}
          tone={summary.totals.overdue ? "red" : undefined}
        />
      </StatGrid>

      <Section
        title="Payables by vendor"
        flush
        description="Across every invoice in the selected date range."
      >
        <Table>
          <THead>
            <TR>
              <TH>Vendor</TH>
              <TH className="text-right">Invoices</TH>
              <TH className="text-right">Billed</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Deducted</TH>
              <TH className="text-right">Outstanding</TH>
              <TH className="text-right">Overdue</TH>
            </TR>
          </THead>
          <TBody>
            {summary.rows.map((r) => (
              <TR key={r.vendorName} className={r.overdue ? "bg-red-50/60" : ""}>
                <TD>{r.vendorName}</TD>
                <TD className="text-right">{r.invoices}</TD>
                <TD className="text-right">{naira(r.billed)}</TD>
                <TD className="text-right">{naira(r.paid)}</TD>
                <TD className="text-right">{r.deducted ? naira(r.deducted) : "—"}</TD>
                <TD className="text-right font-medium">{naira(r.outstanding)}</TD>
                <TD className={`text-right ${r.overdue ? "font-semibold text-red-700" : ""}`}>
                  {r.overdue ? naira(r.overdue) : "—"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!summary.rows.length && <Empty>No billed vendors in this range.</Empty>}
      </Section>

      <FilterBar>
        <FilterField label="Vendor">
          <Select name="vendorId" defaultValue={sp.vendorId ?? ""}>
            <option value="">All vendors</option>
            {vendorOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="From">
          <Input type="date" name="from" defaultValue={sp.from} />
        </FilterField>
        <FilterField label="To">
          <Input type="date" name="to" defaultValue={sp.to} />
        </FilterField>
      </FilterBar>

      <Section title={`${invoices.length} invoice(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Invoice</TH>
              <TH>Vendor</TH>
              <TH>Description</TH>
              <TH>Invoice date</TH>
              <TH>Due date</TH>
              <TH className="text-right">Total</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Deducted</TH>
              <TH className="text-right">Balance</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {invoices.map((inv) => {
              const balance = num(inv.totalAmount) - num(inv.amountPaid) - num(inv.totalDeductions);
              const overdue = balance > 0 && iso(inv.dueDate) < today && inv.status !== "CANCELLED";
              return (
                <TR key={inv.id} className={overdue ? "bg-red-50/60" : ""}>
                  <TD className="font-mono text-xs">
                    <Link className="text-primary underline" href={`/finance/payables/${inv.id}`}>
                      {inv.invoiceNumber}
                    </Link>
                  </TD>
                  <TD>{inv.vendor.name}</TD>
                  <TD className="max-w-xs truncate text-xs">{inv.description}</TD>
                  <TD>{fmtDate(inv.invoiceDate)}</TD>
                  <TD className={overdue ? "font-medium text-red-700" : ""}>
                    {fmtDate(inv.dueDate)}
                    {overdue ? " (overdue)" : ""}
                  </TD>
                  <TD className="text-right">{naira(inv.totalAmount)}</TD>
                  <TD className="text-right">{naira(inv.amountPaid)}</TD>
                  <TD className="text-right">
                    {num(inv.totalDeductions) ? naira(inv.totalDeductions) : "—"}
                  </TD>
                  <TD className="text-right font-medium">{naira(balance)}</TD>
                  <TD>
                    <StatusBadge status={inv.status} />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {!invoices.length && <Empty>No purchase invoices yet — record one above.</Empty>}
      </Section>
    </>
  );
}
