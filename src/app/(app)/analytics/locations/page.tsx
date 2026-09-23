import { requirePage } from "@/lib/auth/session";
import { locationAnalytics } from "@/server/services/analytics";
import { resolveRun } from "@/server/services/reports";
import { runOptions } from "@/server/options";
import { naira } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { RunPicker } from "@/components/run-picker";
import { BarsChart } from "@/components/charts";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function LocationAnalytics({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("analytics.view");
  const sp = await searchParams;
  const [run, runs] = await Promise.all([resolveRun(ctx, sp.runId), runOptions(ctx)]);
  const rows = run ? ((await locationAnalytics(ctx, run.id)) ?? []) : [];
  const byRegion = [
    ...rows
      .reduce((m, r) => m.set(r.region, (m.get(r.region) ?? 0) + r.payroll), new Map<string, number>())
      .entries(),
  ].map(([name, value]) => ({ name, value }));
  return (
    <>
      <PageHeader
        title="Location analytics"
        description="Employees, payroll, attendance, overtime and vacancy by beat."
      />
      <RunPicker runs={runs} runId={run?.id} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Payroll by beat">
          <BarsChart
            data={[...rows].sort((a, b) => b.payroll - a.payroll)}
            xKey="beat"
            series={[{ key: "payroll", label: "Payroll" }]}
            horizontal
            height={460}
          />
        </Section>
        <Section title="Attendance % by beat">
          <BarsChart
            data={[...rows].filter((r) => r.attendancePct).sort((a, b) => a.attendancePct - b.attendancePct)}
            xKey="beat"
            series={[{ key: "attendancePct", label: "Attendance %" }]}
            horizontal
            height={460}
            money={false}
          />
        </Section>
        <Section title="Payroll by region">
          <BarsChart data={byRegion} xKey="name" series={[{ key: "value", label: "Payroll" }]} />
        </Section>
        <Section title="Overtime hours by beat">
          <BarsChart
            data={rows.filter((r) => r.overtimeHours)}
            xKey="beat"
            series={[{ key: "overtimeHours", label: "Overtime hours" }]}
            money={false}
          />
        </Section>
      </div>
      <Section title="By beat" flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Beat</TH>
              <TH>Region</TH>
              <TH className="text-right">Employees</TH>
              <TH className="text-right">Approved</TH>
              <TH className="text-right">Vacancy</TH>
              <TH className="text-right">Attendance</TH>
              <TH className="text-right">OT hours</TH>
              <TH className="text-right">OT amount</TH>
              <TH className="text-right">Payroll</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.client + r.beat}>
                <TD>{r.client}</TD>
                <TD>{r.beat}</TD>
                <TD>{r.region}</TD>
                <TD className="text-right">{r.employees}</TD>
                <TD className="text-right">{r.approved}</TD>
                <TD className="text-right">{r.vacancy || ""}</TD>
                <TD className="text-right">{r.attendancePct}%</TD>
                <TD className="text-right">{r.overtimeHours || ""}</TD>
                <TD className="text-right">{r.overtimeAmount ? naira(r.overtimeAmount) : ""}</TD>
                <TD className="text-right">{naira(r.payroll)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
