import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listPensionRules } from "@/server/services/statutory";
import { pensionSchedule, resolveRun } from "@/server/services/reports";
import { runOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { naira, num, round2 } from "@/lib/money";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { RunPicker } from "@/components/run-picker";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function PensionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const [rules, run, runs] = await Promise.all([
    listPensionRules(ctx),
    resolveRun(ctx, sp.runId),
    runOptions(ctx),
  ]);
  const rows = run ? await pensionSchedule(ctx, run.id) : [];
  const byPfa = new Map<string, { ee: number; er: number; n: number }>();
  for (const r of rows) {
    const c = byPfa.get(r.pfa) ?? { ee: 0, er: 0, n: 0 };
    c.ee += r.employeePension;
    c.er += r.employerPension;
    c.n++;
    byPfa.set(r.pfa, c);
  }
  const rule = rules[0];
  return (
    <>
      <PageHeader
        title="Pension"
        description="Employee pension is deducted from pay; employer pension is computed separately for remittance and never reduces net pay. It is funded from the 30% management share."
        actions={
          <Link className="text-sm text-primary underline" href="/settings/statutory">
            Pension rules →
          </Link>
        }
      />
      {rule && (
        <p className="mb-4 text-sm">
          Current rule <b>{rule.version}</b> (from {fmtDate(rule.effectiveFrom)}): employee{" "}
          <b>{num(rule.employeeRate)}%</b>, employer <b>{num(rule.employerRate)}%</b> of{" "}
          <b>{rule.pensionableCodes.join(" + ")}</b>.
        </p>
      )}
      <RunPicker runs={runs} runId={run?.id} />
      <StatGrid cols={4}>
        <Stat label="Employee pension" value={naira(rows.reduce((a, r) => a + r.employeePension, 0))} />
        <Stat label="Employer pension" value={naira(rows.reduce((a, r) => a + r.employerPension, 0))} />
        <Stat label="Total remittance" value={naira(rows.reduce((a, r) => a + r.total, 0))} />
        <Stat label="Contributors" value={rows.length} />
      </StatGrid>
      <Section title="Remittance by PFA" flush>
        <Table>
          <THead>
            <TR>
              <TH>PFA</TH>
              <TH className="text-right">Contributors</TH>
              <TH className="text-right">Employee (8%)</TH>
              <TH className="text-right">Employer (10%)</TH>
              <TH className="text-right">Total</TH>
            </TR>
          </THead>
          <TBody>
            {[...byPfa.entries()].map(([k, v]) => (
              <TR key={k}>
                <TD>{k}</TD>
                <TD className="text-right">{v.n}</TD>
                <TD className="text-right">{naira(round2(v.ee))}</TD>
                <TD className="text-right">{naira(round2(v.er))}</TD>
                <TD className="text-right font-medium">{naira(round2(v.ee + v.er))}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      <Link className="text-sm text-primary underline" href={`/reports/pension?runId=${run?.id ?? ""}`}>
        Full pension schedule by employee →
      </Link>
    </>
  );
}
