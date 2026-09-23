import { requirePage } from "@/lib/auth/session";
import { clientProfitability, resolveRun } from "@/server/services/reports";
import { runOptions } from "@/server/options";
import { naira } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { RunPicker } from "@/components/run-picker";
import { BarsChart } from "@/components/charts";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function Profitability({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("analytics.view");
  const sp = await searchParams;
  const [run, runs] = await Promise.all([resolveRun(ctx, sp.runId), runOptions(ctx)]);
  const rows = run ? await clientProfitability(ctx, run.id) : [];
  return (
    <>
      <PageHeader
        title="Client profitability"
        description="Contract revenue = agreed rate × days billed. Margin (₦) = Revenue − Employee payroll − Employer pension − Other statutory-style employer costs (ITF, NSITF, Insurance, Uniform & Kits, Recruitment/Training, Leave Reliever/Outsourcing Leave Allowance, NHF/Medical). Margin % = Margin (₦) ÷ Revenue × 100."
      />
      <RunPicker runs={runs} runId={run?.id} />
      <Section title="Revenue vs payroll by client">
        <BarsChart
          data={rows}
          xKey="clientName"
          series={[
            { key: "revenue", label: "Revenue" },
            { key: "payroll", label: "Payroll" },
            { key: "contribution", label: "Margin (₦)" },
          ]}
        />
      </Section>
      <Section title="Profitability" flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH className="text-right">Headcount</TH>
              <TH className="text-right">Contract revenue</TH>
              <TH className="text-right">Employee payroll</TH>
              <TH className="text-right">Employer pension</TH>
              <TH className="text-right">Other statutory-style costs</TH>
              <TH className="text-right">Margin after statutory deductions (₦)</TH>
              <TH className="text-right">Margin %</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.clientName}>
                <TD>{r.clientName}</TD>
                <TD className="text-right">{r.headcount}</TD>
                <TD className="text-right">{naira(r.revenue)}</TD>
                <TD className="text-right">{naira(r.payroll)}</TD>
                <TD className="text-right">{naira(r.employerPension)}</TD>
                <TD className="text-right">{naira(r.otherCosts)}</TD>
                <TD className="text-right font-medium">{naira(r.contribution)}</TD>
                <TD
                  className={`text-right font-semibold ${r.marginPct < 20 ? "text-amber-700" : "text-emerald-700"}`}
                >
                  {r.marginPct.toFixed(1)}%
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
