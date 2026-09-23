import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listPensionRules, listTaxRules } from "@/server/services/statutory";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createPensionRuleAction } from "@/app/actions/payroll";
import { TaxRuleForm } from "./tax-rule-form";

export default async function StatutoryPage() {
  const ctx = await requirePage("payroll.view");
  const [tax, pension] = await Promise.all([listTaxRules(ctx), listPensionRules(ctx)]);
  const manage = can(ctx.role, "settings.manage");
  const current = tax.find((t) => !t.effectiveTo) ?? tax[0];
  return (
    <>
      <PageHeader
        title="Statutory rules"
        description="PAYE and pension rules are versioned data. A change creates a new version and end-dates the old one; historic payroll keeps the version it used."
      />
      <Section title="PAYE rule versions" flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Version</TH>
              <TH>Effective</TH>
              <TH>Bands</TH>
              <TH>Reliefs</TH>
            </TR>
          </THead>
          <TBody>
            {tax.map((t) => (
              <TR key={t.id}>
                <TD className="font-mono text-xs">{t.code}</TD>
                <TD>{t.name}</TD>
                <TD>{t.version}</TD>
                <TD>
                  {fmtDate(t.effectiveFrom)} →{" "}
                  {t.effectiveTo ? fmtDate(t.effectiveTo) : <Badge tone="green">current</Badge>}
                </TD>
                <TD className="whitespace-normal text-xs">
                  {t.bands
                    .map(
                      (b) =>
                        `${num(b.rate)}% ${naira(b.lowerBound)}–${b.upperBound ? naira(b.upperBound) : "∞"}`,
                    )
                    .join(" · ")}
                </TD>
                <TD className="whitespace-normal text-xs">
                  {t.reliefs
                    .filter((r) => r.active)
                    .map((r) => r.name)
                    .join("; ")}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      {manage && current && (
        <FormPanel title="Create new PAYE rule version">
          <TaxRuleForm
            current={{
              code: current.code,
              name: current.name,
              bands: current.bands
                .map(
                  (b) =>
                    `${num(b.lowerBound)},${b.upperBound === null ? "" : num(b.upperBound)},${num(b.rate)}`,
                )
                .join("\n"),
              reliefs: current.reliefs
                .filter((r) => r.active)
                .map((r) => ({
                  code: r.code,
                  name: r.name,
                  type: r.type,
                  rate: r.rate === null ? null : num(r.rate),
                  amount: r.amount === null ? null : num(r.amount),
                  cap: r.cap === null ? null : num(r.cap),
                })),
              exemptions: current.exemptions.map((x) => ({
                code: x.code,
                description: x.description,
                annualGrossCeiling: num(x.annualGrossCeiling),
              })),
            }}
          />
        </FormPanel>
      )}
      <Section title="Pension rule versions" flush>
        <Table>
          <THead>
            <TR>
              <TH>Version</TH>
              <TH className="text-right">Employee</TH>
              <TH className="text-right">Employer</TH>
              <TH>Pensionable components</TH>
              <TH>Effective</TH>
            </TR>
          </THead>
          <TBody>
            {pension.map((p) => (
              <TR key={p.id}>
                <TD>{p.version}</TD>
                <TD className="text-right">{num(p.employeeRate)}%</TD>
                <TD className="text-right">{num(p.employerRate)}%</TD>
                <TD>{p.pensionableCodes.join(" + ")}</TD>
                <TD>
                  {fmtDate(p.effectiveFrom)} →{" "}
                  {p.effectiveTo ? fmtDate(p.effectiveTo) : <Badge tone="green">current</Badge>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      {manage && (
        <FormPanel title="Create new pension rule version">
          <SmartForm
            columns={3}
            fields={[
              { name: "version", label: "Version label", required: true },
              {
                name: "employeeRate",
                label: "Employee rate %",
                type: "number",
                required: true,
                defaultValue: 8,
              },
              {
                name: "employerRate",
                label: "Employer rate %",
                type: "number",
                required: true,
                defaultValue: 10,
              },
              {
                name: "pensionableCodes",
                label: "Pensionable component codes (comma separated)",
                required: true,
                defaultValue: "BASIC,HOUSING,TRANSPORT",
                span: 2,
              },
              { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
            ]}
            action={createPensionRuleAction}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Note: the pensionable base uses each salary component&apos;s “Pensionable” flag; keep these codes
            aligned with your structures.
          </p>
        </FormPanel>
      )}
    </>
  );
}
