import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listTaxRules } from "@/server/services/statutory";
import { payeSchedule, resolveRun } from "@/server/services/reports";
import { runOptions } from "@/server/options";
import { recordSensitiveAccess } from "@/server/services/sensitive-access";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { groupPayeByState, STATE_NOT_RECORDED } from "@/lib/nigeria-states";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { RunPicker } from "@/components/run-picker";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function PayePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const [rules, run, runs] = await Promise.all([
    listTaxRules(ctx),
    resolveRun(ctx, sp.runId),
    runOptions(ctx),
  ]);
  const rows = run ? await payeSchedule(ctx, run.id) : [];
  if (rows.length) await recordSensitiveAccess(ctx, { kind: "TAX", ref: "paye", count: rows.length });
  const current = rules.find((r) => !r.effectiveTo) ?? rules[0];
  return (
    <>
      <PageHeader
        title="PAYE"
        description="Versioned Nigerian PAYE rule engine. Each payroll run stores the tax-rule version it used."
        actions={
          <Link className="text-sm text-primary underline" href="/settings/statutory">
            Manage tax rules →
          </Link>
        }
      />
      <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Seeded with the Nigeria Tax Act 2025 schedule (effective 1 Jan 2026). Tax rules must be verified
        against applicable Nigerian law and official NRS / State IRS guidance before production use.
      </p>
      {current && (
        <Section
          title={`${current.name} — v${current.version}`}
          description={`Effective ${fmtDate(current.effectiveFrom)}${current.effectiveTo ? ` to ${fmtDate(current.effectiveTo)}` : ""}. ${current.legalBasis ?? ""}`}
        >
          <div className="grid gap-5 lg:grid-cols-3">
            <Table>
              <THead>
                <TR>
                  <TH>Annual chargeable income band</TH>
                  <TH className="text-right">Rate</TH>
                </TR>
              </THead>
              <TBody>
                {current.bands.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      {naira(b.lowerBound)} – {b.upperBound ? naira(b.upperBound) : "above"}
                    </TD>
                    <TD className="text-right">{num(b.rate)}%</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Table>
              <THead>
                <TR>
                  <TH>Relief</TH>
                  <TH>Active</TH>
                </TR>
              </THead>
              <TBody>
                {current.reliefs.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-normal text-xs">{r.name}</TD>
                    <TD>{r.active ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Table>
              <THead>
                <TR>
                  <TH>Exemption</TH>
                  <TH className="text-right">Annual gross ≤</TH>
                </TR>
              </THead>
              <TBody>
                {current.exemptions.map((x) => (
                  <TR key={x.id}>
                    <TD className="whitespace-normal text-xs">{x.description}</TD>
                    <TD className="text-right">{naira(x.annualGrossCeiling)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Section>
      )}
      <RunPicker runs={runs} runId={run?.id} />
      <StatGrid cols={3}>
        <Stat label="PAYE this run" value={naira(rows.reduce((a, r) => a + r.paye, 0))} />
        <Stat label="Employees taxed" value={rows.filter((r) => r.paye > 0).length} />
        <Stat label="Exempt / nil" value={rows.filter((r) => r.paye === 0).length} />
      </StatGrid>
      <Section title="PAYE by state of residence" description="PAYE is paid to the tax authority of the state each worker lives in. Anyone without a recognised state is on the last line." flush>
        <Table>
          <THead>
            <TR>
              <TH>State</TH>
              <TH className="text-right">Employees taxed</TH>
              <TH className="text-right">PAYE</TH>
            </TR>
          </THead>
          <TBody>
            {groupPayeByState(rows).map((l) => (
              <TR key={l.state}>
                <TD>{l.state === STATE_NOT_RECORDED ? <Badge tone="amber">{l.state}</Badge> : l.state}</TD>
                <TD className="text-right">{l.headcount}</TD>
                <TD className="text-right">{naira(l.paye)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      <Section title="PAYE by employee" flush>
        <Table>
          <THead>
            <TR>
              <TH>Emp. No.</TH>
              <TH>Name</TH>
              <TH>State</TH>
              <TH>Tax ID</TH>
              <TH className="text-right">Total earnings</TH>
              <TH className="text-right">Taxable</TH>
              <TH className="text-right">PAYE</TH>
              <TH>Rule version</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.employeeNumber}>
                <TD className="font-mono text-xs">{r.employeeNumber}</TD>
                <TD>{r.employeeName}</TD>
                <TD className="text-xs">{r.payeState}</TD>
                <TD className="text-xs">{r.taxId}</TD>
                <TD className="text-right">{naira(r.totalEarnings)}</TD>
                <TD className="text-right">{naira(r.taxableIncome)}</TD>
                <TD className="text-right">{naira(r.paye)}</TD>
                <TD className="text-xs">{r.taxRuleVersion}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
