import { requirePage } from "@/lib/auth/session";
import { payrollVariance, resolveRun } from "@/server/services/reports";
import { runOptions } from "@/server/options";
import { naira } from "@/lib/money";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { RunPicker } from "@/components/run-picker";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function Variance({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("analytics.view");
  const sp = await searchParams;
  const [run, runs] = await Promise.all([resolveRun(ctx, sp.runId), runOptions(ctx)]);
  const v = run ? await payrollVariance(ctx, run.id) : null;
  const rows = (v?.rows ?? []).filter((r) => r.status !== "UNCHANGED" || sp.all === "1");
  return (
    <>
      <PageHeader
        title="Variance analysis"
        description={v ? `${v.current.period.name} vs ${v.previousPeriod?.name ?? "—"}` : ""}
      />
      <RunPicker
        runs={runs}
        runId={run?.id}
        extra={
          <label className="flex items-center gap-1 pb-2 text-xs">
            <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} /> Include unchanged
          </label>
        }
      />
      {v && (
        <StatGrid cols={4}>
          <Stat
            label="Previous gross"
            value={naira(v.totals.previousGross)}
            sub={`${v.totals.previousHeadcount} employees`}
          />
          <Stat
            label="Current gross"
            value={naira(v.totals.currentGross)}
            sub={`${v.totals.currentHeadcount} employees`}
          />
          <Stat
            label="Change"
            value={naira(v.totals.currentGross - v.totals.previousGross)}
            tone={v.totals.currentGross >= v.totals.previousGross ? "amber" : "green"}
          />
          <Stat label="Employees changed" value={v.rows.filter((r) => r.status !== "UNCHANGED").length} />
        </StatGrid>
      )}
      <Section title="Employee variances (largest first)" flush>
        <Table>
          <THead>
            <TR>
              <TH>Emp. No.</TH>
              <TH>Name</TH>
              <TH className="text-right">Previous gross</TH>
              <TH className="text-right">Current gross</TH>
              <TH className="text-right">Change</TH>
              <TH className="text-right">%</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.employeeNumber}>
                <TD className="font-mono text-xs">{r.employeeNumber}</TD>
                <TD>{r.employeeName}</TD>
                <TD className="text-right">{naira(r.previousGross)}</TD>
                <TD className="text-right">{naira(r.currentGross)}</TD>
                <TD className={`text-right ${r.change < 0 ? "text-red-700" : ""}`}>{naira(r.change)}</TD>
                <TD className="text-right">{r.changePct === null ? "—" : `${r.changePct}%`}</TD>
                <TD>
                  <Badge tone={r.status === "CHANGED" ? "amber" : r.status === "UNCHANGED" ? "gray" : "blue"}>
                    {r.status}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
