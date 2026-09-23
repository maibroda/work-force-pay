import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listRuns } from "@/server/services/payroll";
import { naira } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const runs = (await listRuns(ctx)).filter((r) => !sp.status || r.status === sp.status);
  return (
    <>
      <PageHeader
        title={sp.status ? `Payroll runs — ${sp.status.replace("_", " ").toLowerCase()}` : "Payroll runs"}
        description="Regular runs can be recalculated any number of times while the period is open. Supplementary runs handle post-lock corrections."
      />
      <Section title={`${runs.length} run(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Period</TH>
              <TH>Run</TH>
              <TH>Type</TH>
              <TH className="text-right">Employees</TH>
              <TH className="text-right">Gross</TH>
              <TH className="text-right">Net</TH>
              <TH className="text-right">PAYE</TH>
              <TH className="text-right">Employer pension</TH>
              <TH className="text-right">Calcs</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {runs.map((r) => (
              <TR key={r.id}>
                <TD>
                  <Link className="font-medium text-primary hover:underline" href={`/payroll/runs/${r.id}`}>
                    {r.period.name}
                  </Link>
                </TD>
                <TD>#{r.runNumber}</TD>
                <TD>
                  <StatusBadge status={r.type} />
                </TD>
                <TD className="text-right">{r.employeeCount}</TD>
                <TD className="text-right">{naira(r.totalGross)}</TD>
                <TD className="text-right">{naira(r.totalNet)}</TD>
                <TD className="text-right">{naira(r.totalPaye)}</TD>
                <TD className="text-right">{naira(r.totalEmployerPension)}</TD>
                <TD className="text-right">{r.calculationCount}</TD>
                <TD>
                  <StatusBadge status={r.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
