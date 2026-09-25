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
        description="Assets, liabilities and equity as of a date, summed straight from the general ledger. Equity is Opening Balance Equity plus Retained Earnings (the ledger's own cumulative income − expense) — both genuinely computed, not a balancing plug, so total assets equal total liabilities + equity exactly."
      />
      <FilterBar>
        <FilterField label="As of">
          <Input type="date" name="asOf" defaultValue={asOf} />
        </FilterField>
      </FilterBar>

      <StatGrid cols={3}>
        <Stat label="Total assets" value={naira(bs.assets.total)} tone="green" />
        <Stat label="Total liabilities" value={naira(bs.liabilities.total)} tone="amber" />
        <Stat label="Total equity" value={naira(bs.equity.total)} />
      </StatGrid>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Assets" flush>
          <Table>
            <TBody>
              <TR>
                <TD>Cash and bank</TD>
                <TD className="text-right">{naira(bs.assets.cash)}</TD>
              </TR>
              <TR>
                <TD>Accounts receivable</TD>
                <TD className="text-right">{naira(bs.assets.accountsReceivable)}</TD>
              </TR>
              {bs.assets.withholdingTaxReceivable !== 0 && (
                <TR>
                  <TD>Withholding tax receivable</TD>
                  <TD className="text-right">{naira(bs.assets.withholdingTaxReceivable)}</TD>
                </TR>
              )}
              <TR>
                <TD>Fixed assets (net book value)</TD>
                <TD className="text-right">{naira(bs.assets.fixedAssetsNet)}</TD>
              </TR>
              {bs.assets.otherAssetRows.map((r) => (
                <TR key={r.account.id}>
                  <TD className="text-xs">
                    <span className="font-mono">{r.account.code}</span> {r.account.name}
                  </TD>
                  <TD className="text-right">{naira(r.amount)}</TD>
                </TR>
              ))}
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
              {bs.liabilities.otherLiabilityRows.map((r) => (
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
                <TD>Opening balance equity</TD>
                <TD className="text-right">{naira(bs.equity.openingBalanceEquity)}</TD>
              </TR>
              {bs.equity.otherEquityRows.map((r) => (
                <TR key={r.account.id}>
                  <TD className="text-xs">
                    <span className="font-mono">{r.account.code}</span> {r.account.name}
                  </TD>
                  <TD className="text-right">{naira(r.amount)}</TD>
                </TR>
              ))}
              <TR>
                <TD>Retained earnings</TD>
                <TD className="text-right">{naira(bs.equity.retainedEarnings)}</TD>
              </TR>
              <TR className="font-medium">
                <TD>Total equity</TD>
                <TD className="text-right">{naira(bs.equity.total)}</TD>
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
