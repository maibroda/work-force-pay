import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { receivablesAgeing } from "@/server/services/receipts";
import { AGE_BUCKETS } from "@/lib/statements";
import { d, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function StatementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const asOf = sp.asOf ? iso(d(sp.asOf)) : iso(new Date());
  const rows = await receivablesAgeing(ctx, asOf);
  const total = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  return (
    <>
      <PageHeader
        title="Receivables ageing"
        description="What each client owes as at a date, by how long past its due date it is. A client's balance here is the sum of what is outstanding on their invoices, and it agrees with the client's balance in the receivables account (the last column says so, or by how much it differs). Open a client for their statement of account."
      />
      <FilterBar>
        <FilterField label="As at">
          <Input type="date" name="asOf" defaultValue={asOf} />
        </FilterField>
      </FilterBar>
      <StatGrid cols={3}>
        <Stat label="Owed" value={naira(total((r) => r.closing))} />
        <Stat label="Over 60 days" value={naira(total((r) => r.ageing["61–90 days"] + r.ageing["Over 90 days"]))} tone={total((r) => r.ageing["61–90 days"] + r.ageing["Over 90 days"]) ? "red" : "green"} />
        <Stat label="Advances held" value={naira(total((r) => r.advances))} />
      </StatGrid>
      <Section title="By client" flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              {AGE_BUCKETS.map((b) => (
                <TH key={b} className="text-right">
                  {b}
                </TH>
              ))}
              <TH className="text-right">Owed</TH>
              <TH className="text-right">Advances</TH>
              <TH>Ledger</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.clientId}>
                <TD>
                  <Link className="text-primary underline" href={`/finance/statements/${r.clientId}?asOf=${asOf}`}>
                    {r.name}
                  </Link>
                </TD>
                {AGE_BUCKETS.map((b) => (
                  <TD key={b} className="text-right">
                    {r.ageing[b] ? naira(r.ageing[b]) : "—"}
                  </TD>
                ))}
                <TD className="text-right font-medium">{naira(r.closing)}</TD>
                <TD className="text-right">{r.advances ? naira(r.advances) : "—"}</TD>
                <TD className="text-xs">{Math.abs(r.closing - r.ledger) < 0.01 ? "Agrees" : `Differs by ${naira(r.closing - r.ledger)}`}</TD>
              </TR>
            ))}
          </TBody>
          {rows.length > 0 && (
            <TFoot>
              <TR>
                <TD>Total</TD>
                {AGE_BUCKETS.map((b) => (
                  <TD key={b} className="text-right">
                    {naira(total((r) => r.ageing[b]))}
                  </TD>
                ))}
                <TD className="text-right">{naira(total((r) => r.closing))}</TD>
                <TD className="text-right">{naira(total((r) => r.advances))}</TD>
                <TD />
              </TR>
            </TFoot>
          )}
        </Table>
        {!rows.length && <Empty>Nothing is owed as at this date.</Empty>}
      </Section>
    </>
  );
}
