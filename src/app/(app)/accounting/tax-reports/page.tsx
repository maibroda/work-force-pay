import { requirePage } from "@/lib/auth/session";
import { taxReport } from "@/server/services/tax-engine";
import { d, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function TaxReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const now = new Date();
  const from = sp.from ? d(sp.from) : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const to = sp.to ? d(sp.to) : new Date(Date.UTC(now.getUTCFullYear(), 11, 31));
  const r = await taxReport(ctx, { from, to });
  const sum = (f: (m: (typeof r.months)[number]) => number) => r.months.reduce((s, m) => s + f(m), 0);
  const balanced = Math.abs(r.tieOut.difference) < 0.01;
  return (
    <>
      <PageHeader
        title="Tax reports"
        description="VAT charged and withholding tax expected on invoices dated in the range, from the tax records written with each invoice (cancelled invoices are left out). Withholding is what the client is expected to deduct when paying; what they actually withheld is recorded as a deduction against the invoice. These figures follow the rates and bases as configured and are not a tax return: have them reviewed by your tax adviser before filing."
      />
      <FilterBar>
        <FilterField label="From">
          <Input type="date" name="from" defaultValue={iso(from)} />
        </FilterField>
        <FilterField label="To">
          <Input type="date" name="to" defaultValue={iso(to)} />
        </FilterField>
      </FilterBar>
      <StatGrid cols={4}>
        <Stat label="VAT charged" value={naira(sum((m) => m.vat))} />
        <Stat label="Taxable amount" value={naira(sum((m) => m.vatTaxable))} />
        <Stat label="Withholding expected" value={naira(sum((m) => m.whtExpected))} />
        <Stat label="Withheld by clients (recorded)" value={naira(r.whtWithheld)} tone="green" />
      </StatGrid>
      <p className={`mb-4 rounded-md p-3 text-sm ${balanced ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>
        {balanced
          ? `VAT on live invoices (${naira(r.tieOut.taxRecords)}) agrees with the VAT payable the invoice journals booked.`
          : `VAT on live invoices is ${naira(r.tieOut.taxRecords)} but the invoice journals booked ${naira(r.tieOut.ledger)} to VAT payable (difference ${naira(r.tieOut.difference)}). Run the ledger integrity check.`}
      </p>
      <Section title="By month" flush>
        <Table>
          <THead>
            <TR>
              <TH>Month</TH>
              <TH className="text-right">Invoices</TH>
              <TH className="text-right">Taxable amount</TH>
              <TH className="text-right">VAT charged</TH>
              <TH className="text-right">Withholding expected</TH>
            </TR>
          </THead>
          <TBody>
            {r.months.map((m) => (
              <TR key={m.month}>
                <TD>{m.month}</TD>
                <TD className="text-right">{m.invoices}</TD>
                <TD className="text-right">{naira(m.vatTaxable)}</TD>
                <TD className="text-right">{naira(m.vat)}</TD>
                <TD className="text-right">{naira(m.whtExpected)}</TD>
              </TR>
            ))}
          </TBody>
          {r.months.length > 0 && (
            <TFoot>
              <TR>
                <TD colSpan={2}>Total</TD>
                <TD className="text-right">{naira(sum((m) => m.vatTaxable))}</TD>
                <TD className="text-right">{naira(sum((m) => m.vat))}</TD>
                <TD className="text-right">{naira(sum((m) => m.whtExpected))}</TD>
              </TR>
            </TFoot>
          )}
        </Table>
        {!r.months.length && <Empty>No taxed invoices in this range.</Empty>}
      </Section>
      <Section title="By client" flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH className="text-right">VAT charged</TH>
              <TH className="text-right">Withholding expected</TH>
            </TR>
          </THead>
          <TBody>
            {r.clients.map((c) => (
              <TR key={c.clientId}>
                <TD>{c.name}</TD>
                <TD className="text-right">{naira(c.vat)}</TD>
                <TD className="text-right">{naira(c.whtExpected)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!r.clients.length && <Empty>No taxed invoices in this range.</Empty>}
      </Section>
    </>
  );
}
