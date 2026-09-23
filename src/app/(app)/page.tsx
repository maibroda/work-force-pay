import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { dashboard } from "@/server/services/analytics";
import { activationSummary } from "@/server/services/clients";
import { db } from "@/lib/db";
import { compactNaira, naira, num } from "@/lib/money";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { BarsChart, LinesChart } from "@/components/charts";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function DashboardPage() {
  const ctx = await requirePage("dashboard.view");
  const [dash, act] = await Promise.all([dashboard(ctx), activationSummary(ctx)]);
  const run = dash.run;
  const issues = run
    ? await db.payrollValidationIssue.groupBy({
        by: ["severity"],
        where: { runId: run.id, resolved: false, overridden: false },
        _count: { _all: true },
      })
    : [];
  const count = (s: string) => issues.find((i) => i.severity === s)?._count._all ?? 0;
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={
          run ? (
            <>
              Current payroll: <b>{run.period.name}</b> <StatusBadge status={run.period.status} /> —
              calculated {run.calculationCount}×{" "}
            </>
          ) : (
            "No payroll has been run yet."
          )
        }
        actions={
          run && (
            <Link className="text-sm text-primary underline" href={`/payroll/runs/${run.id}`}>
              Open Payroll Control Centre →
            </Link>
          )
        }
      />
      <StatGrid cols={4}>
        <Stat label="Total employees" value={dash.employees} sub={`${dash.activeEmployees} active`} />
        <Stat label="Active clients" value={dash.activeClients} />
        <Stat label="Active beats / locations" value={dash.activeBeats} />
        <Stat label="Payroll population" value={run?.employeeCount ?? 0} sub={run?.period.name} />
      </StatGrid>
      {run && (
        <StatGrid cols={6}>
          <Stat label="Gross earnings" value={compactNaira(run.totalGross)} sub={naira(run.totalGross)} />
          <Stat label="Net pay" value={compactNaira(run.totalNet)} />
          <Stat label="PAYE" value={compactNaira(run.totalPaye)} />
          <Stat label="Employee pension" value={compactNaira(run.totalEmployeePension)} />
          <Stat label="Employer pension" value={compactNaira(run.totalEmployerPension)} />
          <Stat label="Employer cost" value={compactNaira(run.totalEmployerCost)} />
          <Stat label="Overtime" value={compactNaira(run.totalOvertime)} />
          <Stat label="Arrears" value={compactNaira(run.totalArrears)} />
          <Stat label="Deductions" value={compactNaira(run.totalDeductions)} />
          <Stat
            label="Client billing"
            value={compactNaira(run.totalClientBilling)}
            sub="Agreed rates × days"
          />
          <Stat label="Management share (30%)" value={compactNaira(run.totalManagementShare)} />
          <Stat
            label="Margin after employer pension"
            value={compactNaira(num(run.totalManagementShare) - num(run.totalEmployerPension))}
            tone="green"
          />
        </StatGrid>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Payroll control" description="Unresolved validation results">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-red-50 p-3">
              <p className="text-2xl font-semibold text-red-700">{count("CRITICAL")}</p>
              <p className="text-xs text-red-800">Critical</p>
            </div>
            <div className="rounded-md bg-amber-50 p-3">
              <p className="text-2xl font-semibold text-amber-700">{count("WARNING")}</p>
              <p className="text-xs text-amber-800">Warnings</p>
            </div>
            <div className="rounded-md bg-blue-50 p-3">
              <p className="text-2xl font-semibold text-blue-700">{count("INFO")}</p>
              <p className="text-xs text-blue-800">Info</p>
            </div>
          </div>
        </Section>
        <Section
          title="Activation monitoring"
          description="Prevent mapping errors entering payroll"
          actions={
            <Link className="text-xs text-primary underline" href="/operations/activation">
              Details
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-2 text-sm">
            <p>
              New activations this month: <b>{act.newActivations}</b>
            </p>
            <p>
              Unmapped beats: <b className="text-red-700">{act.unmapped.length}</b>
            </p>
            <p>
              Unassigned employees: <b className="text-amber-700">{act.unassigned.length}</b>
            </p>
            <p>
              Below strength: <b className="text-amber-700">{act.below.length}</b>
            </p>
            <p>
              Above strength: <b className="text-red-700">{act.above.length}</b>
            </p>
          </div>
        </Section>
        <Section title="Workforce by status">
          <Table>
            <TBody>
              {dash.statusGroups.map((s) => (
                <TR key={s.status}>
                  <TD>
                    <StatusBadge status={s.status} />
                  </TD>
                  <TD className="text-right tabular-nums">{s.count}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Payroll trend" description="Regular payroll by period">
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
        <Section title="Payroll by client" description={run?.period.name}>
          <BarsChart
            data={dash.byClient}
            xKey="name"
            series={[
              { key: "billing", label: "Client billing" },
              { key: "gross", label: "Payroll" },
            ]}
          />
        </Section>
        <Section title="Top beats by payroll" description="Gross + overtime">
          <BarsChart
            data={dash.byBeat.slice(0, 10)}
            xKey="name"
            series={[{ key: "value", label: "Payroll" }]}
            horizontal
            height={320}
          />
        </Section>
        <Section title="Payroll by region">
          <BarsChart
            data={dash.byRegion}
            xKey="name"
            series={[{ key: "value", label: "Payroll" }]}
            height={320}
          />
        </Section>
      </div>
      <Section title="Client summary" flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH className="text-right">Headcount</TH>
              <TH className="text-right">Client billing</TH>
              <TH className="text-right">Payroll</TH>
              <TH className="text-right">Margin</TH>
            </TR>
          </THead>
          <TBody>
            {dash.byClient.map((c) => (
              <TR key={c.name}>
                <TD>{c.name}</TD>
                <TD className="text-right">{c.headcount}</TD>
                <TD className="text-right">{naira(c.billing)}</TD>
                <TD className="text-right">{naira(c.gross)}</TD>
                <TD className="text-right">{naira(c.margin)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
