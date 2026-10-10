import { requirePage } from "@/lib/auth/session";
import { buildQuickPayslip, quickPayslipPresets } from "@/server/services/quick-payslip";
import { BusinessError } from "@/server/services/_base";
import { fmtDate, iso } from "@/lib/dates";
import { naira } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { QuickPayslipForm, type QuickValues } from "./quick-payslip-form";

type Built = Awaited<ReturnType<typeof buildQuickPayslip>>;

function Payslip({ r }: { r: Built }) {
  const s = r.slip;
  return (
    <Section title="Payslip">
      <div className="mx-auto max-w-3xl space-y-4 rounded-lg border bg-card p-5 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
          <div>
            <p className="text-lg font-semibold">{r.organization}</p>
            <p className="text-sm text-muted-foreground">Payslip for {fmtDate(r.payDate)}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{r.employeeName ?? "—"}</p>
            {r.position && <p className="text-muted-foreground">{r.position}</p>}
          </div>
        </div>

        <Table>
          <THead>
            <TR>
              <TH>Earnings</TH>
              <TH className="text-right">% of gross</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            {s.earnings.map((e) => (
              <TR key={e.code}>
                <TD>
                  {e.name}
                  {e.pensionable && <span className="ml-2 text-[10px] text-muted-foreground">pensionable</span>}
                </TD>
                <TD className="text-right">{e.pct}%</TD>
                <TD className="text-right">{naira(e.amount)}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR className="font-semibold">
              <TD colSpan={2}>Gross pay</TD>
              <TD className="text-right">{naira(s.gross)}</TD>
            </TR>
          </TFoot>
        </Table>

        <Table>
          <THead>
            <TR>
              <TH>Deductions</TH>
              <TH className="text-right">Amount</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <TD>PAYE tax{s.paye.exempt ? " (exempt)" : ""}</TD>
              <TD className="text-right">{naira(s.paye.paye)}</TD>
            </TR>
            <TR>
              <TD>
                Employee pension ({r.pensionRates.employee}% of {naira(s.pensionBase)})
              </TD>
              <TD className="text-right">{naira(s.employeePension)}</TD>
            </TR>
            {s.otherDeductions.map((d, i) => (
              <TR key={i}>
                <TD>{d.name}</TD>
                <TD className="text-right">{naira(d.amount)}</TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD>Total deductions</TD>
              <TD className="text-right">{naira(s.totalDeductions)}</TD>
            </TR>
            <TR className="text-base font-semibold">
              <TD>Net pay</TD>
              <TD className="text-right">{naira(s.netPay)}</TD>
            </TR>
          </TFoot>
        </Table>
        <p className="text-xs text-muted-foreground">Net pay is {s.netPct}% of gross.</p>

        <div className="grid gap-3 border-t pt-3 text-sm sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Employer cost</p>
            <p>
              Employer pension ({r.pensionRates.employer}%): <b>{naira(s.employerPension)}</b>
            </p>
            <p>
              Gross plus employer pension: <b>{naira(s.employerCost)}</b>
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">How the PAYE was worked out (annual)</p>
            <p>Taxable earnings: {naira(s.paye.annualGross)}</p>
            {s.paye.reliefBreakdown.map((x) => (
              <p key={x.code}>
                Less {x.name}: {naira(x.amount)}
              </p>
            ))}
            <p>Chargeable income: {naira(s.paye.annualChargeable)}</p>
            <p>
              Annual tax: <b>{naira(s.paye.annualTax)}</b> (monthly {naira(s.paye.paye)})
            </p>
            {s.paye.exempt && <p className="text-muted-foreground">Exempt under {s.paye.exemptionCode}.</p>}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Quick payslip, not a payroll record. Tax rule {r.taxRule}, pension rule {r.pensionRule}
          {r.structure ? `, other allowances split as in ${r.structure}` : ""}. Pensionable: {r.pensionableCodes.join(", ").toLowerCase()}. Tax rules must be verified against current law before relying on a figure.
        </p>
      </div>
    </Section>
  );
}

export default async function QuickPayslipPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("payroll.view");
  const sp = await searchParams;
  const presets = await quickPayslipPresets(ctx);
  const initial: QuickValues = {
    gross: sp.gross ?? "",
    payDate: sp.payDate ?? iso(new Date()),
    basicPct: sp.basicPct ?? String(presets.defaults.basicPct),
    housingPct: sp.housingPct ?? String(presets.defaults.housingPct),
    transportPct: sp.transportPct ?? String(presets.defaults.transportPct),
    structureId: sp.structureId ?? "",
    annualRent: sp.annualRent ?? "",
    deductionName: sp.deductionName ?? "",
    deductionAmount: sp.deductionAmount ?? "",
    employeeName: sp.employeeName ?? "",
    position: sp.position ?? "",
  };
  let built: Built | null = null;
  let error: string | null = null;
  if (sp.gross) {
    try {
      built = await buildQuickPayslip(ctx, initial as never);
    } catch (e) {
      error = e instanceof BusinessError ? e.message : "The payslip could not be worked out.";
    }
  }
  return (
    <>
      <PageHeader
        title="Quick payslip"
        description="Enter a monthly gross salary and say what share of it is Basic, Housing and Transport; the rest is other allowances. The payslip shows the pension and PAYE the payroll engine would deduct, under the tax and pension rules in force on the pay date. Nothing is saved. Use a salary structure to fill the percentages and to split the other allowances (entertainment, meal, utility and so on) the way you already do."
        actions={built ? <PrintButton /> : undefined}
      />
      <QuickPayslipForm
        initial={initial}
        structures={presets.structures.map((s) => ({ id: s.id, name: s.name, basicPct: s.basicPct, housingPct: s.housingPct, transportPct: s.transportPct, othersPct: s.othersPct }))}
      />
      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      {built && <Payslip r={built} />}
    </>
  );
}
