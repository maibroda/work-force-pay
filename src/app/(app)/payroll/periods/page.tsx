import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listPeriods } from "@/server/services/payroll";
import { fmtDate, MONTHS } from "@/lib/dates";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createPeriodAction, runPayrollAction } from "@/app/actions/payroll";
import { closePeriodAction } from "@/app/actions/accounting";

export default async function PeriodsPage() {
  const ctx = await requirePage("payroll.view");
  const periods = await listPeriods(ctx);
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Payroll periods"
        description="OPEN → PENDING VALIDATION → PENDING APPROVAL → APPROVED → LOCKED → PAID → CLOSED. Payroll can be recalculated repeatedly while the period is open. Locking (or closing) a period posts its payroll heads to the general ledger."
      />
      {can(ctx.role, "payroll.run") && (
        <FormPanel title="Open a payroll period">
          <SmartForm
            columns={3}
            fields={[
              {
                name: "year",
                label: "Year",
                type: "number",
                required: true,
                defaultValue: now.getUTCFullYear(),
              },
              {
                name: "month",
                label: "Month",
                type: "select",
                required: true,
                options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
              },
            ]}
            action={createPeriodAction}
            submitLabel="Open period"
          />
        </FormPanel>
      )}
      <Section title="Periods" flush>
        <Table>
          <THead>
            <TR>
              <TH>Period</TH>
              <TH>Start</TH>
              <TH>End</TH>
              <TH>Runs</TH>
              <TH>Approved</TH>
              <TH>Locked</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {periods.map((p) => {
              const regular = p.runs.filter((r) => r.type === "REGULAR").at(-1);
              const open = !["APPROVED", "LOCKED", "PAID", "CLOSED"].includes(p.status);
              return (
                <TR key={p.id}>
                  <TD className="font-medium">{p.name}</TD>
                  <TD>{fmtDate(p.startDate)}</TD>
                  <TD>{fmtDate(p.endDate)}</TD>
                  <TD className="space-x-2 text-xs">
                    {p.runs.map((r) => (
                      <Link key={r.id} className="text-primary underline" href={`/payroll/runs/${r.id}`}>
                        #{r.runNumber} {r.type === "SUPPLEMENTARY" ? "supp." : ""}
                      </Link>
                    ))}
                  </TD>
                  <TD className="text-xs">{p.approvedBy ?? "—"}</TD>
                  <TD className="text-xs">{p.lockedBy ?? "—"}</TD>
                  <TD>
                    <StatusBadge status={p.status} />
                  </TD>
                  <TD>
                    {open && can(ctx.role, "payroll.run") && (
                      <ActionButton action={runPayrollAction.bind(null, p.id)}>
                        {regular ? "Recalculate payroll" : "Run payroll"}
                      </ActionButton>
                    )}
                    {["LOCKED", "PAID"].includes(p.status) && can(ctx.role, "payroll.lock") && (
                      <ActionButton
                        action={closePeriodAction.bind(null, p.id)}
                        variant="outline"
                        confirm={`Close ${p.name}? Any unposted payroll goes to the ledger.`}
                      >
                        Close period
                      </ActionButton>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
