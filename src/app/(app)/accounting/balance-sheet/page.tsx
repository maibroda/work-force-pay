import { requirePage } from "@/lib/auth/session";
import { balanceSheet } from "@/server/services/financial-statements";
import { iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const asOf = sp.asOf ?? iso(new Date());
  const bs = await balanceSheet(ctx, asOf);

  return (
    <>
      <PageHeader
        title="Balance sheet"
        description="Assets and liabilities as of a date, assembled from bank accounts, receivables, payables, fixed assets and posted payroll journals. Equity is a balancing figure (assets − liabilities), not independently tracked — this isn't a strictly GL-balanced statement."
      />
      <FilterBar>
        <FilterField label="As of">
          <Input type="date" name="asOf" defaultValue={asOf} />
        </FilterField>
      </FilterBar>

      <StatGrid cols={3}>
        <Stat label="Total assets" value={naira(bs.assets.total)} tone="green" />
        <Stat label="Total liabilities" value={naira(bs.liabilities.total)} tone="amber" />
        <Stat label="Equity (balancing figure)" value={naira(bs.equity)} />
      </StatGrid>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Assets" flush>
          <Table>
            <TBody>
              <TR>
                <TD>Cash (bank accounts)</TD>
                <TD className="text-right">{naira(bs.assets.cash)}</TD>
              </TR>
              <TR>
                <TD>Accounts receivable</TD>
                <TD className="text-right">{naira(bs.assets.accountsReceivable)}</TD>
              </TR>
              <TR>
                <TD>Fixed assets (net book value)</TD>
                <TD className="text-right">{naira(bs.assets.fixedAssetsNet)}</TD>
              </TR>
            </TBody>
            <TFoot>
              <TR className="font-semibold">
                <TD>Total assets</TD>
                <TD className="text-right">{naira(bs.assets.total)}</TD>
              </TR>
            </TFoot>
          </Table>
        </Section>

        <Section title="Liabilities & equity" flush>
          <Table>
            <THead>
              <TR>
                <TH>Account</TH>
                <TH className="text-right">Amount</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>Accounts payable</TD>
                <TD className="text-right">{naira(bs.liabilities.accountsPayable)}</TD>
              </TR>
              {bs.liabilities.payrollLiabilityRows.map((r) => (
                <TR key={r.account.id}>
                  <TD className="text-xs">
                    <span className="font-mono">{r.account.code}</span> {r.account.name}
                  </TD>
                  <TD className="text-right">{naira(r.amount)}</TD>
                </TR>
              ))}
              <TR className="font-medium">
                <TD>Total liabilities</TD>
                <TD className="text-right">{naira(bs.liabilities.total)}</TD>
              </TR>
              <TR>
                <TD>Equity (balancing figure)</TD>
                <TD className="text-right">{naira(bs.equity)}</TD>
              </TR>
            </TBody>
            <TFoot>
              <TR className="font-semibold">
                <TD>Total liabilities & equity</TD>
                <TD className="text-right">{naira(bs.assets.total)}</TD>
              </TR>
            </TFoot>
          </Table>
        </Section>
      </div>
    </>
  );
}
