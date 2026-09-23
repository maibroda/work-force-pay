import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listPeriods, listRuns } from "@/server/services/payroll";
import { naira } from "@/lib/money";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createSupplementaryAction } from "@/app/actions/payroll";

export default async function SupplementaryPage() {
  const ctx = await requirePage("payroll.view");
  const [periods, runs] = await Promise.all([listPeriods(ctx), listRuns(ctx)]);
  const locked = periods.filter((p) => ["LOCKED", "PAID", "CLOSED"].includes(p.status));
  const supp = runs.filter((r) => r.type === "SUPPLEMENTARY");
  return (
    <>
      <PageHeader
        title="Supplementary payroll"
        description="A locked payroll is never edited. Post-lock corrections — approved arrears, other earnings, deductions — for a locked period are paid through a supplementary run, taxed at the marginal rate on top of the locked run."
      />
      {can(ctx.role, "payroll.run") && (
        <FormPanel title="Create supplementary run" open>
          <p className="mb-3 text-xs text-muted-foreground">
            First record the correction under Earnings / Deductions / Arrears for the locked period and have
            it approved.
          </p>
          <SmartForm
            fields={[
              {
                name: "periodId",
                label: "Locked period",
                type: "select",
                required: true,
                options: locked.map((p) => ({ value: p.id, label: `${p.name} (${p.status.toLowerCase()})` })),
              },
              {
                name: "description",
                label: "Description",
                required: true,
                defaultValue: "Post-lock correction",
              },
            ]}
            action={createSupplementaryAction}
            submitLabel="Calculate supplementary run"
          />
        </FormPanel>
      )}
      <Section title="Supplementary runs" flush>
        <Table>
          <THead>
            <TR>
              <TH>Period</TH>
              <TH>Run</TH>
              <TH>Description</TH>
              <TH className="text-right">Employees</TH>
              <TH className="text-right">Gross</TH>
              <TH className="text-right">Net</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {supp.map((r) => (
              <TR key={r.id}>
                <TD>
                  <Link className="text-primary underline" href={`/payroll/runs/${r.id}`}>
                    {r.period.name}
                  </Link>
                </TD>
                <TD>#{r.runNumber}</TD>
                <TD>{r.description}</TD>
                <TD className="text-right">{r.employeeCount}</TD>
                <TD className="text-right">{naira(r.totalGross)}</TD>
                <TD className="text-right">{naira(r.totalNet)}</TD>
                <TD>
                  <StatusBadge status={r.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!supp.length && <Empty>No supplementary runs yet.</Empty>}
      </Section>
    </>
  );
}
