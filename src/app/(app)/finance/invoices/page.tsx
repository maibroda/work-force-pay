import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { receivablesSummary, unbilledRuns } from "@/server/services/billing";
import { defaultsOn } from "@/server/services/tax-engine";
import { options } from "@/server/options";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { generateInvoicesAction } from "@/app/actions/billing";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("client.view");
  const sp = await searchParams;
  const manage = can(ctx.role, "payment.manage");
  const [summary, ready, o] = await Promise.all([
    receivablesSummary(ctx, { from: sp.from, to: sp.to }),
    manage ? unbilledRuns(ctx) : Promise.resolve([]),
    options(ctx),
  ]);
  const today = iso(new Date());
  // the rates each run's invoices would use, so the form says what a blank field means
  const rates = await Promise.all(ready.map((r) => defaultsOn(ctx, r.period.endDate)));
  const rateText = (x: Awaited<ReturnType<typeof defaultsOn>>["VAT"]) => ("error" in x ? x.error : x.source === "NONE" ? "no tax code is set up, so 0%" : `${x.ratePct}% (${x.code})`);
  const invoices = sp.clientId
    ? summary.invoices.filter((i) => i.clientId === sp.clientId)
    : summary.invoices;

  return (
    <>
      <PageHeader
        title="Billing & receivables"
        description="One invoice per client per payroll run, generated from that run's client billing. Record client payments and deductions here to track what's outstanding."
        actions={
          <Link className="text-sm text-primary underline" href="/analytics/contract-profitability">
            Contract profitability →
          </Link>
        }
      />
      <StatGrid cols={5}>
        <Stat label="Total billed" value={naira(summary.totals.billed)} />
        <Stat label="Received" value={naira(summary.totals.received)} tone="green" />
        <Stat label="Deducted (WHT etc.)" value={naira(summary.totals.deducted)} />
        <Stat label="Outstanding" value={naira(summary.totals.outstanding)} tone="amber" />
        <Stat
          label="Overdue"
          value={naira(summary.totals.overdue)}
          tone={summary.totals.overdue ? "red" : undefined}
        />
      </StatGrid>

      {ready.length > 0 && manage && (
        <Section
          title="Locked payrolls without invoices"
          description="Each employer category's charge-out amount splits into a Direct charge (default 90%) and an Indirect charge (default 10%) — VAT applies to the Indirect charge total only. Leave VAT % and withholding % blank to use the rate in force on the invoice date from Tax Codes & Rates; type a number (0 included) to use that for this run instead, which is recorded on the invoice as typed. Withholding tax is informational."
        >
          <div className="space-y-3">
            {ready.map((r, i) => (
              <div key={r.id} className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">
                  {r.period.name} #{r.runNumber} — {naira(r.totalClientBilling)}
                </p>
                <SmartForm
                  columns={3}
                  submitLabel="Generate invoices"
                  action={generateInvoicesAction}
                  fields={[
                    { name: "runId", label: "", type: "hidden", defaultValue: r.id },
                    {
                      name: "directChargePct",
                      label: "Direct charge %",
                      type: "number",
                      min: 0,
                      max: 100,
                      defaultValue: 90,
                      help: "Must add up to 100% with indirect.",
                    },
                    {
                      name: "indirectChargePct",
                      label: "Indirect charge %",
                      type: "number",
                      min: 0,
                      max: 100,
                      defaultValue: 10,
                    },
                    {
                      name: "vatPct",
                      label: "VAT % (on indirect charge)",
                      type: "number",
                      min: 0,
                      max: 100,
                      placeholder: "from tax codes",
                      help: `Blank: ${rateText(rates[i].VAT)}`,
                    },
                    {
                      name: "whtPct",
                      label: "Withholding tax %",
                      type: "number",
                      min: 0,
                      max: 100,
                      placeholder: "from tax codes",
                      help: `Blank: ${rateText(rates[i].WHT)}`,
                    },
                  ]}
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Receivables by client"
        flush
        description="Across every invoice in the selected date range."
      >
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH className="text-right">Invoices</TH>
              <TH className="text-right">Billed</TH>
              <TH className="text-right">Received</TH>
              <TH className="text-right">Deducted</TH>
              <TH className="text-right">Outstanding</TH>
              <TH className="text-right">Overdue</TH>
            </TR>
          </THead>
          <TBody>
            {summary.rows.map((r) => (
              <TR key={r.clientName} className={r.overdue ? "bg-red-50/60" : ""}>
                <TD>{r.clientName}</TD>
                <TD className="text-right">{r.invoices}</TD>
                <TD className="text-right">{naira(r.billed)}</TD>
                <TD className="text-right">{naira(r.received)}</TD>
                <TD className="text-right">{r.deducted ? naira(r.deducted) : "—"}</TD>
                <TD className="text-right font-medium">{naira(r.outstanding)}</TD>
                <TD className={`text-right ${r.overdue ? "font-semibold text-red-700" : ""}`}>
                  {r.overdue ? naira(r.overdue) : "—"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!summary.rows.length && <Empty>No billed clients in this range.</Empty>}
      </Section>

      <FilterBar>
        <FilterField label="Client">
          <Select name="clientId" defaultValue={sp.clientId ?? ""}>
            <option value="">All clients</option>
            {o.clients.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
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
              <TH>Client</TH>
              <TH>Period</TH>
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
                    <Link className="text-primary underline" href={`/finance/invoices/${inv.id}`}>
                      {inv.invoiceNumber}
                    </Link>
                  </TD>
                  <TD>{inv.client.name}</TD>
                  <TD>{inv.period.name}</TD>
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
        {!invoices.length && <Empty>No invoices yet — generate them from a locked payroll run above.</Empty>}
      </Section>
    </>
  );
}
