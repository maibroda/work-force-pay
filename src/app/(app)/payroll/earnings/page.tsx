import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listOtherEarnings } from "@/server/services/inputs";
import { resolveRun } from "@/server/services/reports";
import { options, runOptions } from "@/server/options";
import { db } from "@/lib/db";
import { naira, round2 } from "@/lib/money";
import { fullName } from "@/lib/utils";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { RunPicker } from "@/components/run-picker";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TFoot } from "@/components/ui/table";
import { approveOtherEarningAction, createOtherEarningAction } from "@/app/actions/payroll";
import { ApproveReject } from "../_inputs";

export default async function EarningsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const [run, runs, o, others] = await Promise.all([
    resolveRun(ctx, sp.runId),
    runOptions(ctx),
    options(ctx),
    listOtherEarnings(ctx),
  ]);
  const recs = run
    ? await db.payrollRecord.findMany({ where: { runId: run.id }, select: { lines: true } })
    : [];
  const totals = new Map<string, { name: string; amount: number; count: number }>();
  for (const r of recs)
    for (const l of r.lines as Array<{ type: string; code: string; name: string; amount: number }>)
      if (l.type === "EARNING") {
        const k = l.code === "OTHER" ? `OTHER:${l.name}` : l.code;
        const t = totals.get(k) ?? { name: l.code === "OTHER" ? l.name : l.name, amount: 0, count: 0 };
        t.amount = round2(t.amount + l.amount);
        t.count++;
        totals.set(k, t);
      }
  const total = [...totals.values()].reduce((a, t) => a + t.amount, 0);
  return (
    <>
      <PageHeader
        title="Earnings"
        description="Earnings by component for a payroll run, plus approved other earnings (bonuses, allowances, refunds)."
      />
      <RunPicker runs={runs} runId={run?.id} />
      <Section title={`Earnings by component — ${run?.period.name ?? ""}`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Component</TH>
              <TH className="text-right">Employees</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Share</TH>
            </TR>
          </THead>
          <TBody>
            {[...totals.entries()].map(([k, t]) => (
              <TR key={k}>
                <TD>{t.name}</TD>
                <TD className="text-right">{t.count}</TD>
                <TD className="text-right">{naira(t.amount)}</TD>
                <TD className="text-right">{total ? ((t.amount / total) * 100).toFixed(1) : 0}%</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD>Total</TD>
              <TD />
              <TD className="text-right">{naira(total)}</TD>
              <TD />
            </TR>
          </TFoot>
        </Table>
      </Section>
      {can(ctx.role, "payroll.inputs") && (
        <FormPanel title="Add other earning">
          <SmartForm
            columns={3}
            fields={[
              { name: "employeeId", label: "Employee", type: "select", required: true, options: o.employees },
              {
                name: "periodId",
                label: "Payroll period",
                type: "select",
                required: true,
                options: o.periods,
                help: "Locked period → paid via supplementary payroll",
              },
              { name: "name", label: "Earning name", required: true, placeholder: "Commendation award" },
              { name: "amount", label: "Amount (₦)", type: "number", required: true, min: 1 },
              { name: "taxable", label: "Taxable", type: "checkbox", defaultValue: true },
              { name: "reason", label: "Reason", required: true },
            ]}
            action={createOtherEarningAction}
            submitLabel="Save earning"
          />
        </FormPanel>
      )}
      <Section title="Other earnings" flush>
        <Table>
          <THead>
            <TR>
              <TH>Period</TH>
              <TH>Employee</TH>
              <TH>Earning</TH>
              <TH className="text-right">Amount</TH>
              <TH>Taxable</TH>
              <TH>Reason</TH>
              <TH>Approved by</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {others.map((x) => (
              <TR key={x.id}>
                <TD>{x.period.name}</TD>
                <TD>
                  {x.employee.employeeNumber} — {fullName(x.employee)}
                </TD>
                <TD>{x.name}</TD>
                <TD className="text-right">{naira(x.amount)}</TD>
                <TD>{x.taxable ? "Yes" : "No"}</TD>
                <TD className="text-xs">{x.reason}</TD>
                <TD className="text-xs">{x.approvedBy ?? "—"}</TD>
                <TD>
                  <StatusBadge status={x.status} />
                </TD>
                <TD>
                  <ApproveReject
                    kind="otherEarning"
                    id={x.id}
                    status={x.status}
                    canApprove={can(ctx.role, "payroll.inputs.approve")}
                    approve={approveOtherEarningAction.bind(null, x.id)}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!others.length && <Empty>None.</Empty>}
      </Section>
    </>
  );
}
