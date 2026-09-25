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
        description="Revenue from client billing, expenses from posted payroll journals plus fixed-asset depreciation, for a period. Revenue and depreciation aren't posted to the GL — they're pulled directly from Billing & Receivables and the Fixed Asset Register."
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

      <Section title="Expenses" flush description="From posted payroll journals, plus fixed-asset depreciation for the period.">
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Account</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {stmt.payrollExpenseRows.map((r) => (
              <TR key={r.account.id}>
                <TD className="font-mono text-xs">{r.account.code}</TD>
                <TD>{r.account.name}</TD>
                <TD className="text-right">{naira(r.amount)}</TD>
              </TR>
            ))}
            <TR>
              <TD className="font-mono text-xs">—</TD>
              <TD>Depreciation expense (Fixed Asset Register)</TD>
              <TD className="text-right">{naira(stmt.depreciationExpense)}</TD>
            </TR>
          </TBody>
          <TFoot>
            <TR className="font-semibold">
              <TD colSpan={2}>Total expenses</TD>
              <TD className="text-right">{naira(stmt.totalExpenses)}</TD>
            </TR>
          </TFoot>
        </Table>
        {!stmt.payrollExpenseRows.length && stmt.depreciationExpense === 0 && (
          <Empty>No expenses in this period.</Empty>
        )}
      </Section>
    </>
  );
}
