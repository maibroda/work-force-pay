import { requirePage } from "@/lib/auth/session";
import { dashboard } from "@/server/services/analytics";
import { db } from "@/lib/db";
import { naira, num, round2 } from "@/lib/money";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { BarsChart, LinesChart } from "@/components/charts";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function PayrollAnalytics() {
  const ctx = await requirePage("analytics.view");
  const dash = await dashboard(ctx);
  const runs = await db.payrollRun.findMany({
    where: { organizationId: ctx.orgId, type: "REGULAR" },
    include: { period: true },
    orderBy: [{ period: { year: "asc" } }, { period: { month: "asc" } }],
  });
  const stat = runs.map((r) => ({
    period: r.period.name.slice(0, 3),
    paye: num(r.totalPaye),
    employeePension: num(r.totalEmployeePension),
    employerPension: num(r.totalEmployerPension),
    overtime: num(r.totalOvertime),
    arrears: num(r.totalArrears),
    deductions: num(r.totalDeductions),
  }));
  const run = dash.run;
  return (
    <>
      <PageHeader title="Payroll analytics" description={run ? `Latest: ${run.period.name}` : ""} />
      {run && (
        <StatGrid cols={4}>
          <Stat label="Gross earnings" value={naira(run.totalGross)} />
          <Stat label="Net pay" value={naira(run.totalNet)} />
          <Stat
            label="Statutory (PAYE + pension)"
            value={naira(
              round2(num(run.totalPaye) + num(run.totalEmployeePension) + num(run.totalEmployerPension)),
            )}
          />
          <Stat label="Employer cost" value={naira(run.totalEmployerCost)} />
        </StatGrid>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Gross, net and employer cost by period">
          <LinesChart
            data={dash.trend}
            xKey="period"
            series={[
              { key: "gross", label: "Gross" },
              { key: "net", label: "Net" },
              { key: "employerCost", label: "Employer cost" },
            ]}
          />
        </Section>
        <Section title="Statutory by period">
          <BarsChart
            data={stat}
            xKey="period"
            series={[
              { key: "paye", label: "PAYE" },
              { key: "employeePension", label: "Employee pension" },
              { key: "employerPension", label: "Employer pension" },
            ]}
          />
        </Section>
        <Section title="Overtime, arrears & deductions by period">
          <BarsChart
            data={stat}
            xKey="period"
            series={[
              { key: "overtime", label: "Overtime" },
              { key: "arrears", label: "Arrears" },
              { key: "deductions", label: "Deductions" },
            ]}
          />
        </Section>
        <Section title="Period table" flush>
          <Table>
            <THead>
              <TR>
                <TH>Period</TH>
                <TH className="text-right">Headcount</TH>
                <TH className="text-right">Gross</TH>
                <TH className="text-right">Net</TH>
                <TH className="text-right">PAYE</TH>
                <TH className="text-right">Employer cost</TH>
              </TR>
            </THead>
            <TBody>
              {runs.map((r) => (
                <TR key={r.id}>
                  <TD>{r.period.name}</TD>
                  <TD className="text-right">{r.employeeCount}</TD>
                  <TD className="text-right">{naira(r.totalGross)}</TD>
                  <TD className="text-right">{naira(r.totalNet)}</TD>
                  <TD className="text-right">{naira(r.totalPaye)}</TD>
                  <TD className="text-right">{naira(r.totalEmployerCost)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      </div>
    </>
  );
}
