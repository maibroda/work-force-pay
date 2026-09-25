import { requirePage } from "@/lib/auth/session";
import { incomeStatement } from "@/server/services/financial-statements";
import { iso, monthStart, monthEnd } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const now = new Date();
  const from = sp.from ?? iso(monthStart(now.getUTCFullYear(), now.getUTCMonth() + 1));
  const to = sp.to ?? iso(monthEnd(now.getUTCFullYear(), now.getUTCMonth() + 1));
  const stmt = await incomeStatement(ctx, from, to);

  return (
    <>
      <PageHeader
        title="Income statement"
        description="Revenue and expenses for a period, summed straight from the general ledger — every client invoice, vendor bill, payment, deduction, bank account opening and depreciation run posts here automatically."
      />
      <FilterBar>
        <FilterField label="From">
          <Input type="date" name="from" defaultValue={from} />
        </FilterField>
        <FilterField label="To">
          <Input type="date" name="to" defaultValue={to} />
        </FilterField>
      </FilterBar>

      <StatGrid cols={3}>
        <Stat label="Revenue" value={naira(stmt.revenue)} tone="green" />
        <Stat label="Total expenses" value={naira(stmt.totalExpenses)} tone="amber" />
        <Stat
          label="Net income"
          value={naira(stmt.netIncome)}
          tone={stmt.netIncome >= 0 ? "green" : "red"}
        />
      </StatGrid>

      <Section title="Revenue" flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Account</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {stmt.incomeRows.map((r) => (
              <TR key={r.account.id}>
                <TD className="font-mono text-xs">{r.account.code}</TD>
                <TD>{r.account.name}</TD>
                <TD className="text-right">{naira(r.amount)}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR className="font-semibold">
              <TD colSpan={2}>Total revenue</TD>
              <TD className="text-right">{naira(stmt.revenue)}</TD>
            </TR>
          </TFoot>
        </Table>
        {!stmt.incomeRows.length && <Empty>No revenue in this period.</Empty>}
      </Section>

      <Section title="Expenses" flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Account</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {stmt.expenseRows.map((r) => (
              <TR key={r.account.id}>
                <TD className="font-mono text-xs">{r.account.code}</TD>
                <TD>{r.account.name}</TD>
                <TD className="text-right">{naira(r.amount)}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR className="font-semibold">
              <TD colSpan={2}>Total expenses</TD>
              <TD className="text-right">{naira(stmt.totalExpenses)}</TD>
            </TR>
          </TFoot>
        </Table>
        {!stmt.expenseRows.length && <Empty>No expenses in this period.</Empty>}
      </Section>
    </>
  );
}
