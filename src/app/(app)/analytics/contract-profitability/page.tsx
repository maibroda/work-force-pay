import { requirePage } from "@/lib/auth/session";
import { contractProfitability, resolveRun } from "@/server/services/reports";
import { options, runOptions } from "@/server/options";
import { naira } from "@/lib/money";
import { Empty, FilterField, PageHeader, Section } from "@/components/page";
import { RunPicker } from "@/components/run-picker";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";

export default async function ContractProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("analytics.view");
  const sp = await searchParams;
  const [run, runs, o] = await Promise.all([resolveRun(ctx, sp.runId), runOptions(ctx), options(ctx)]);
  const rows = run ? await contractProfitability(ctx, run.id, sp.contractId || undefined) : [];

  return (
    <>
      <PageHeader
        title="Contract profitability"
        description="Revenue and cost broken down by employee category, other (statutory-style) costs shown individually, and a flat back-office overhead allocation — Gross Contribution before back office, Net Contribution after."
      />
      <RunPicker
        runs={runs}
        runId={run?.id}
        extra={
          <FilterField label="Contract">
            <Select name="contractId" defaultValue={sp.contractId ?? ""} className="min-w-64">
              <option value="">All contracts</option>
              {o.contracts.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </FilterField>
        }
      />

      {!rows.length && <Empty>No billed contracts for this run.</Empty>}

      {rows.map((c) => (
        <Section
          key={c.contractId}
          title={`${c.contractName} — ${c.clientName}`}
          description={
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs">{c.contractNumber}</span>
              <Badge tone={c.businessLine === "GUARDING" ? "blue" : "violet"}>{c.businessLine}</Badge>
            </span>
          }
          flush
        >
          <Table>
            <THead>
              <TR>
                <TH>Description</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">Sub total</TH>
                <TH className="text-right">Total</TH>
              </TR>
            </THead>
            <TBody>
              <TR className="bg-muted/40 font-semibold">
                <TD colSpan={5}>Revenue</TD>
              </TR>
              {c.categories.map((cat) => (
                <TR key={`rev-${cat.categoryName}`}>
                  <TD>{cat.categoryName}</TD>
                  <TD className="text-right">{cat.headcount}</TD>
                  <TD className="text-right">{cat.revenue ? naira(cat.revenueRate) : "—"}</TD>
                  <TD className="text-right">{cat.revenue ? naira(cat.revenue) : "—"}</TD>
                  <TD />
                </TR>
              ))}
              <TR className="font-medium">
                <TD colSpan={4}>Total revenue</TD>
                <TD className="text-right">{naira(c.revenue)}</TD>
              </TR>

              <TR className="bg-muted/40 font-semibold">
                <TD colSpan={5}>Cost (operatives&apos; pay)</TD>
              </TR>
              {c.categories.map((cat) => (
                <TR key={`cost-${cat.categoryName}`}>
                  <TD>{cat.categoryName} salaries</TD>
                  <TD className="text-right">{cat.headcount}</TD>
                  <TD className="text-right">{cat.cost ? naira(cat.costRate) : "—"}</TD>
                  <TD className="text-right">{cat.cost ? naira(cat.cost) : "—"}</TD>
                  <TD />
                </TR>
              ))}
              <TR className="font-medium">
                <TD colSpan={4}>Total direct cost</TD>
                <TD className="text-right">{naira(c.totalDirectCost)}</TD>
              </TR>

              <TR className="bg-muted/40 font-semibold">
                <TD colSpan={5}>Other costs (employer add-ons)</TD>
              </TR>
              {(
                [
                  ["Employer Pension", c.employerPension],
                  ["ITF", c.itf],
                  ["NSITF-ECA", c.nsitf],
                  ["NHF / Medical", c.nhfMedical],
                  ["Insurance", c.insurance],
                  ["Uniform & Kits", c.uniformKits],
                  ["Recruitment, Training & Vetting", c.recruitmentTraining],
                  ["Annual Leave Reliever", c.leaveReliever],
                  ["Outsourcing Leave Allowance", c.outsourcingLeaveAllowance],
                ] as const
              )
                .filter(([, v]) => v > 0)
                .map(([label, v]) => (
                  <TR key={label}>
                    <TD>{label}</TD>
                    <TD className="text-right" colSpan={2} />
                    <TD className="text-right">{naira(v)}</TD>
                    <TD />
                  </TR>
                ))}
              <TR className="font-medium">
                <TD colSpan={4}>Total other costs</TD>
                <TD className="text-right">{naira(c.totalOtherCost)}</TD>
              </TR>

              <TR className="border-t-2 font-semibold">
                <TD colSpan={4}>Total cost</TD>
                <TD className="text-right">{naira(c.totalCost)}</TD>
              </TR>
            </TBody>
            <TFoot>
              <TR className="font-semibold">
                <TD colSpan={4}>
                  Gross contribution (Margin after Employer Pension + other statutory-style costs)
                </TD>
                <TD className="text-right">{naira(c.grossContribution)}</TD>
              </TR>
              <TR>
                <TD colSpan={4}>Gross contribution %</TD>
                <TD className="text-right">{c.grossContributionPct}%</TD>
              </TR>
              <TR>
                <TD colSpan={4}>Back office charges @ {c.backOfficeChargePct}%</TD>
                <TD className="text-right">{naira(c.backOfficeCharges)}</TD>
              </TR>
              <TR>
                <TD colSpan={4}>Total cost (incl. back office)</TD>
                <TD className="text-right">{naira(c.totalCostInclBackOffice)}</TD>
              </TR>
              <TR className={`font-semibold ${c.netContribution < 0 ? "text-red-700" : "text-emerald-700"}`}>
                <TD colSpan={4}>Net contribution</TD>
                <TD className="text-right">
                  {c.netContribution < 0
                    ? `(${naira(Math.abs(c.netContribution))})`
                    : naira(c.netContribution)}
                </TD>
              </TR>
              <TR className={`font-semibold ${c.netContribution < 0 ? "text-red-700" : "text-emerald-700"}`}>
                <TD colSpan={4}>Net contribution %</TD>
                <TD className="text-right">{c.netContributionPct}%</TD>
              </TR>
            </TFoot>
          </Table>
        </Section>
      ))}
    </>
  );
}
