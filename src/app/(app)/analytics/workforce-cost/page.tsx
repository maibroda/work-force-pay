import { requirePage } from "@/lib/auth/session";
import { resolveRun } from "@/server/services/reports";
import { runOptions } from "@/server/options";
import { db } from "@/lib/db";
import { naira, num, round2 } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { RunPicker } from "@/components/run-picker";
import { BarsChart } from "@/components/charts";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function WorkforceCost({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("analytics.view");
  const sp = await searchParams;
  const [run, runs] = await Promise.all([resolveRun(ctx, sp.runId), runOptions(ctx)]);
  const recs = run ? await db.payrollRecord.findMany({ where: { runId: run.id } }) : [];
  const group = (key: (r: (typeof recs)[number]) => string) => {
    const m = new Map<
      string,
      { name: string; headcount: number; gross: number; employerPension: number; employerCost: number }
    >();
    for (const r of recs) {
      const k = key(r);
      const g = m.get(k) ?? { name: k, headcount: 0, gross: 0, employerPension: 0, employerCost: 0 };
      g.headcount++;
      g.gross = round2(g.gross + num(r.totalEarnings));
      g.employerPension = round2(g.employerPension + num(r.employerPension));
      g.employerCost = round2(g.employerCost + num(r.employerCost));
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.employerCost - a.employerCost);
  };
  const byCat = group((r) => r.categoryName);
  const byDept = group((r) => r.departmentName ?? "—");
  const T = ({ rows }: { rows: typeof byCat }) => (
    <Table>
      <THead>
        <TR>
          <TH>Group</TH>
          <TH className="text-right">Headcount</TH>
          <TH className="text-right">Gross</TH>
          <TH className="text-right">Employer pension</TH>
          <TH className="text-right">Employer cost</TH>
          <TH className="text-right">Avg cost / head</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((g) => (
          <TR key={g.name}>
            <TD>{g.name}</TD>
            <TD className="text-right">{g.headcount}</TD>
            <TD className="text-right">{naira(g.gross)}</TD>
            <TD className="text-right">{naira(g.employerPension)}</TD>
            <TD className="text-right">{naira(g.employerCost)}</TD>
            <TD className="text-right">{naira(g.employerCost / g.headcount)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
  return (
    <>
      <PageHeader title="Workforce cost" description="Employer cost = total earnings + employer pension." />
      <RunPicker runs={runs} runId={run?.id} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Employer cost by category">
          <BarsChart data={byCat} xKey="name" series={[{ key: "employerCost", label: "Employer cost" }]} />
        </Section>
        <Section title="By category" flush>
          <T rows={byCat} />
        </Section>
        <Section title="By department" flush>
          <T rows={byDept} />
        </Section>
      </div>
    </>
  );
}
