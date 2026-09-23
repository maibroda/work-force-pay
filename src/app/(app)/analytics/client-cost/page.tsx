import { requirePage } from "@/lib/auth/session";
import { payrollByClientAndBeat, resolveRun } from "@/server/services/reports";
import { runOptions } from "@/server/options";
import { naira, round2 } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { RunPicker } from "@/components/run-picker";
import { BarsChart } from "@/components/charts";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function ClientCost({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("analytics.view");
  const sp = await searchParams;
  const [run, runs] = await Promise.all([resolveRun(ctx, sp.runId), runOptions(ctx)]);
  const lines = run ? await payrollByClientAndBeat(ctx, run.id) : [];
  return (
    <>
      <PageHeader
        title="Client & beat cost"
        description="Workforce cost allocated to every client and beat actually worked."
      />
      <RunPicker runs={runs} runId={run?.id} />
      <Section title="Cost by client">
        <BarsChart
          data={lines.map((c) => ({
            name: c.clientName,
            cost: round2(c.gross + c.overtime + c.employerPension + c.businessCosts),
          }))}
          xKey="name"
          series={[{ key: "cost", label: "Workforce cost" }]}
        />
      </Section>
      {lines.map((c) => (
        <Section
          key={c.clientName}
          title={c.clientName}
          description={`${c.headcount} employees · cost ${naira(c.gross + c.overtime + c.employerPension + c.businessCosts)} · billing ${naira(c.clientBilling)}`}
          flush
        >
          <Table>
            <THead>
              <TR>
                <TH>Beat</TH>
                <TH>Region</TH>
                <TH className="text-right">Headcount</TH>
                <TH className="text-right">Days</TH>
                <TH className="text-right">Pay</TH>
                <TH className="text-right">Overtime</TH>
                <TH className="text-right">Employer pension</TH>
                <TH className="text-right">Other workforce costs</TH>
                <TH className="text-right">Total cost</TH>
                <TH className="text-right">Billing</TH>
              </TR>
            </THead>
            <TBody>
              {c.beats.map((b) => (
                <TR key={b.beatCode + b.beatName}>
                  <TD>{b.beatName}</TD>
                  <TD>{b.region ?? "—"}</TD>
                  <TD className="text-right">{b.headcount}</TD>
                  <TD className="text-right">{b.days}</TD>
                  <TD className="text-right">{naira(b.gross)}</TD>
                  <TD className="text-right">{naira(b.overtime)}</TD>
                  <TD className="text-right">{naira(b.employerPension)}</TD>
                  <TD className="text-right">{naira(b.businessCosts)}</TD>
                  <TD className="text-right font-medium">
                    {naira(b.gross + b.overtime + b.employerPension + b.businessCosts)}
                  </TD>
                  <TD className="text-right">{naira(b.clientBilling)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ))}
    </>
  );
}
