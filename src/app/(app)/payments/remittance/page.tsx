import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listRemittances, REMITTANCE_TYPE_LABELS } from "@/server/services/payments";
import { listRuns } from "@/server/services/payroll";
import { naira } from "@/lib/money";
import { FilterBar, FilterField, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { generateRemittancesAction, markRemittedAction } from "@/app/actions/payroll";

export default async function RemittancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const [allRows, runs] = await Promise.all([listRemittances(ctx), listRuns(ctx)]);
  const rows = sp.type ? allRows.filter((r) => r.type === sp.type) : allRows;
  const done = new Set(allRows.map((r) => r.runId));
  const ready = runs.filter((r) => ["LOCKED", "PAID"].includes(r.status) && !done.has(r.id));
  const manage = can(ctx.role, "payment.manage");
  const typesPresent = [...new Set(allRows.map((r) => r.type))];
  return (
    <>
      <PageHeader
        title="Statutory remittance"
        description="PAYE, pension, and every employer add-on cost (ITF, NSITF, insurance, uniform & kits, recruitment/training, leave reliever, outsourcing leave allowance, NHF/medical) — each has its own remittance schedule generated from locked payroll. Filter by type below for that cost's dedicated portal view."
      />
      {ready.length > 0 && manage && (
        <Section title="Locked runs without remittance schedules">
          <div className="flex flex-wrap gap-2">
            {ready.map((r) => (
              <span key={r.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                {r.period.name} #{r.runNumber}
                <ActionButton action={generateRemittancesAction.bind(null, r.id)}>Generate</ActionButton>
              </span>
            ))}
          </div>
        </Section>
      )}
      {sp.type && (
        <StatGrid cols={3}>
          <Stat label="Type" value={REMITTANCE_TYPE_LABELS[sp.type] ?? sp.type} />
          <Stat label="Total" value={naira(rows.reduce((a, r) => a + Number(r.totalAmount), 0))} />
          <Stat label="Schedules" value={String(rows.length)} />
        </StatGrid>
      )}
      <FilterBar>
        <FilterField label="Remittance type">
          <Select name="type" defaultValue={sp.type ?? ""}>
            <option value="">All types</option>
            {typesPresent.map((t) => (
              <option key={t} value={t}>
                {REMITTANCE_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section
        title={sp.type ? `${REMITTANCE_TYPE_LABELS[sp.type] ?? sp.type} remittances` : "Remittances"}
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Payroll</TH>
              <TH>Type</TH>
              <TH>Payee</TH>
              <TH className="text-right">Headcount</TH>
              <TH className="text-right">Employee</TH>
              <TH className="text-right">Employer</TH>
              <TH className="text-right">Total</TH>
              <TH>Reference</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD>
                  {r.run.period.name} #{r.run.runNumber}
                </TD>
                <TD>{r.type}</TD>
                <TD>{r.payee}</TD>
                <TD className="text-right">{r.headcount}</TD>
                <TD className="text-right">{naira(r.employeeAmount)}</TD>
                <TD className="text-right">{naira(r.employerAmount)}</TD>
                <TD className="text-right font-medium">{naira(r.totalAmount)}</TD>
                <TD className="text-xs">{r.reference ?? "—"}</TD>
                <TD>
                  <StatusBadge status={r.status} />
                </TD>
                <TD>
                  {manage && r.status !== "PAID" && (
                    <ActionButton
                      action={markRemittedAction.bind(null, r.id)}
                      reason
                      reasonPlaceholder="Remittance reference / RRR"
                      variant="success"
                    >
                      Mark remitted
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No remittance schedules yet.</Empty>}
      </Section>
    </>
  );
}
