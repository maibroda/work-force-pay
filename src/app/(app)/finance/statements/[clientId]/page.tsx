import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { clientStatement } from "@/server/services/receipts";
import { AGE_BUCKETS } from "@/lib/statements";
import { d, fmtDate, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function ClientStatementPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("gl.view");
  const { clientId } = await params;
  const sp = await searchParams;
  const asOf = sp.asOf ? iso(d(sp.asOf)) : iso(new Date());
  const s = await clientStatement(ctx, clientId, asOf).catch(() => null);
  if (!s) notFound();
  const agrees = Math.abs(s.closing - s.ledger) < 0.01;
  return (
    <>
      <PageHeader
        title={`Statement of account — ${s.client.name}`}
        crumbs={[{ href: "/finance/statements", label: "Receivables ageing" }]}
        description={`As at ${fmtDate(s.asOf)}. Every invoice and every payment, tax withheld or deduction that settled it, in date order with a running balance.`}
        actions={
          <span className="flex gap-2">
            <a className="text-sm text-primary underline" href={`/api/finance/statements/${clientId}?asOf=${asOf}`}>
              Download CSV
            </a>
            <PrintButton />
          </span>
        }
      />
      <FilterBar>
        <FilterField label="As at">
          <Input type="date" name="asOf" defaultValue={asOf} />
        </FilterField>
      </FilterBar>
      <StatGrid cols={4}>
        <Stat label="Owed" value={naira(s.closing)} />
        <Stat label="Advances held" value={naira(s.advances)} />
        <Stat label="Net owed" value={naira(s.net)} tone={s.net > 0 ? "amber" : "green"} />
        <Stat label="Ledger" value={agrees ? "Agrees" : naira(s.ledger)} tone={agrees ? "green" : "red"} />
      </StatGrid>
      {!agrees && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-900">The client&apos;s balance in the receivables account is {naira(s.ledger)}, but their invoices say {naira(s.closing)} is owed. Run the ledger integrity check.</p>}

      <Section title="Ageing" flush>
        <Table>
          <THead>
            <TR>
              {AGE_BUCKETS.map((b) => (
                <TH key={b} className="text-right">
                  {b}
                </TH>
              ))}
              <TH className="text-right">Total</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              {AGE_BUCKETS.map((b) => (
                <TD key={b} className="text-right">
                  {naira(s.ageing[b])}
                </TD>
              ))}
              <TD className="text-right font-medium">{naira(s.closing)}</TD>
            </TR>
          </TBody>
        </Table>
      </Section>

      <Section title="Still owing" flush>
        <Table>
          <THead>
            <TR>
              <TH>Invoice</TH>
              <TH>Due</TH>
              <TH className="text-right">Days past due</TH>
              <TH>Age</TH>
              <TH className="text-right">Owed</TH>
            </TR>
          </THead>
          <TBody>
            {s.outstanding.map((o) => (
              <TR key={o.invoiceId}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/finance/invoices/${o.invoiceId}`}>
                    {o.invoiceNumber}
                  </Link>
                </TD>
                <TD className="text-xs">{fmtDate(o.dueDate)}</TD>
                <TD className="text-right">{o.daysPastDue > 0 ? o.daysPastDue : "—"}</TD>
                <TD className="text-xs">{o.bucket}</TD>
                <TD className="text-right">{naira(o.balance)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!s.outstanding.length && <Empty>Nothing is owed.</Empty>}
      </Section>

      <Section title="Transactions" flush>
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Reference</TH>
              <TH>Description</TH>
              <TH className="text-right">Debit</TH>
              <TH className="text-right">Credit</TH>
              <TH className="text-right">Balance</TH>
            </TR>
          </THead>
          <TBody>
            {s.lines.map((l, i) => (
              <TR key={i}>
                <TD className="text-xs">{fmtDate(l.date)}</TD>
                <TD className="font-mono text-xs">{l.reference}</TD>
                <TD className="max-w-[24rem] whitespace-normal text-xs">{l.description}</TD>
                <TD className="text-right">{l.debit ? naira(l.debit) : ""}</TD>
                <TD className="text-right">{l.credit ? naira(l.credit) : ""}</TD>
                <TD className="text-right">{naira(l.balance)}</TD>
              </TR>
            ))}
          </TBody>
          {s.lines.length > 0 && (
            <TFoot>
              <TR>
                <TD colSpan={5}>Closing balance</TD>
                <TD className="text-right">{naira(s.closing)}</TD>
              </TR>
            </TFoot>
          )}
        </Table>
        {!s.lines.length && <Empty>No transactions as at this date.</Empty>}
      </Section>
    </>
  );
}
