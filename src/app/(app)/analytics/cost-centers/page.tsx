import { requirePage } from "@/lib/auth/session";
import { costCenterActuals, listCostCenterBudgets } from "@/server/services/cost-centers";
import { resolveRun } from "@/server/services/reports";
import { runOptions } from "@/server/options";
import { naira, num } from "@/lib/money";
import { Empty, PageHeader, Section } from "@/components/page";
import { RunPicker } from "@/components/run-picker";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function CostCenterPnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("analytics.view");
  const sp = await searchParams;
  const [run, runs] = await Promise.all([resolveRun(ctx, sp.runId), runOptions(ctx)]);
  const rows = run ? await costCenterActuals(ctx, run.id) : [];
  const budgets = run ? await listCostCenterBudgets(ctx, run.period.year) : [];
  const budgetFor = (costCenterId: string) =>
    run ? budgets.find((b) => b.costCenterId === costCenterId && b.month === run.period.month) : undefined;

  const totals = rows.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenue,
      cost: acc.cost + r.cost,
      margin: acc.margin + r.margin,
    }),
    { revenue: 0, cost: 0, margin: 0 },
  );

  return (
    <>
      <PageHeader
        title="Cost center P&L"
        description="Revenue and cost rolled up by cost center for the selected payroll run — each allocation counts toward exactly one cost center (beat's own assignment, then its contract's, then the employee's department's), so nothing is double-counted. Configure cost centers and their assignments under Settings → Cost Centers."
      />
      <RunPicker runs={runs} runId={run?.id} />
      {!run && <Empty>Select a payroll run.</Empty>}
      {run && (
        <Section title={`${run.period.name} — ${run.type === "REGULAR" ? "Regular" : "Supplementary"}`} flush>
          <Table>
            <THead>
              <TR>
                <TH>Cost center</TH>
                <TH className="text-right">Headcount</TH>
                <TH className="text-right">Revenue</TH>
                <TH className="text-right">Cost</TH>
                <TH className="text-right">Margin</TH>
                <TH className="text-right">Budget (this period)</TH>
                <TH className="text-right">Variance</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const budget = budgetFor(r.costCenterId);
                const variance = budget ? r.cost - num(budget.budgetedAmount) : null;
                return (
                  <TR
                    key={r.costCenterId}
                    className={r.costCenterId === "UNASSIGNED" ? "bg-amber-50/60" : ""}
                  >
                    <TD>
                      {r.code !== "—" && <span className="mr-1 font-mono text-xs">{r.code}</span>}
                      {r.name}
                    </TD>
                    <TD className="text-right">{r.headcount}</TD>
                    <TD className="text-right">{naira(r.revenue)}</TD>
                    <TD className="text-right">{naira(r.cost)}</TD>
                    <TD className={`text-right font-medium ${r.margin < 0 ? "text-red-700" : ""}`}>
                      {naira(r.margin)}
                    </TD>
                    <TD className="text-right">{budget ? naira(budget.budgetedAmount) : "—"}</TD>
                    <TD className={`text-right ${variance !== null && variance > 0 ? "text-red-700" : ""}`}>
                      {variance === null ? "—" : naira(variance)}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={2}>Total</TD>
                <TD className="text-right">{naira(totals.revenue)}</TD>
                <TD className="text-right">{naira(totals.cost)}</TD>
                <TD className="text-right">{naira(totals.margin)}</TD>
                <TD />
                <TD />
              </TR>
            </TFoot>
          </Table>
          {!rows.length && <Empty>No billed activity on this run.</Empty>}
        </Section>
      )}
    </>
  );
}
