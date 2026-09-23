import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listContracts } from "@/server/services/clients";
import { options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { splitAgreedRate } from "@/lib/payroll/structure";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addContractRateAction } from "@/app/actions/clients";

export default async function RatesPage() {
  const ctx = await requirePage("client.view");
  const [contracts, o] = await Promise.all([listContracts(ctx), options(ctx)]);
  return (
    <>
      <PageHeader
        title="Client salary structures & agreed rates"
        description="CLIENT → CONTRACT → EMPLOYEE CATEGORY → SALARY STRUCTURE → AGREED RATE. The operative's monthly gross = agreed rate × operative share (default 70%); the remaining 30% is management cost. Rates are effective-dated — history is never overwritten."
      />
      {can(ctx.role, "client.manage") && (
        <FormPanel title="Set agreed rate (effective-dated)">
          <SmartForm
            columns={3}
            fields={[
              {
                name: "contractId",
                label: "Contract",
                type: "select",
                required: true,
                options: o.contracts,
                span: 2,
              },
              {
                name: "categoryId",
                label: "Employee category",
                type: "select",
                required: true,
                options: o.categories,
              },
              {
                name: "salaryStructureId",
                label: "Salary structure",
                type: "select",
                required: true,
                options: o.activeStructures,
              },
              {
                name: "agreedRate",
                label: "Agreed rate per head / month (₦)",
                type: "number",
                required: true,
                min: 1,
              },
              {
                name: "operativeSharePct",
                label: "Operative share % override",
                type: "number",
                min: 1,
                max: 100,
                help: "Blank = contract's ratio (70:30)",
              },
              { name: "effectiveFrom", label: "Effective from", type: "date", required: true },
            ]}
            action={addContractRateAction}
            submitLabel="Save agreed rate"
          />
        </FormPanel>
      )}
      <Section title="Agreed rates" flush>
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Contract</TH>
              <TH>Category</TH>
              <TH>Salary structure</TH>
              <TH className="text-right">Agreed rate</TH>
              <TH>Share</TH>
              <TH className="text-right">Operative gross</TH>
              <TH className="text-right">Management</TH>
              <TH>Effective</TH>
            </TR>
          </THead>
          <TBody>
            {contracts.flatMap((c) =>
              c.rates.map((r) => {
                const share =
                  r.operativeSharePct != null ? num(r.operativeSharePct) : num(c.operativeSharePct);
                const sp = splitAgreedRate(num(r.agreedRate), share);
                return (
                  <TR key={r.id} className={r.effectiveTo ? "text-muted-foreground" : ""}>
                    <TD>{c.client.name}</TD>
                    <TD className="font-mono text-xs">{c.contractNumber}</TD>
                    <TD>{r.category.name}</TD>
                    <TD>{r.salaryStructure.name}</TD>
                    <TD className="text-right font-medium">{naira(r.agreedRate)}</TD>
                    <TD>
                      {share}:{100 - share}
                    </TD>
                    <TD className="text-right">{naira(sp.operativeGross)}</TD>
                    <TD className="text-right">{naira(sp.managementShare)}</TD>
                    <TD>
                      {fmtDate(r.effectiveFrom)} →{" "}
                      {r.effectiveTo ? fmtDate(r.effectiveTo) : <Badge tone="green">current</Badge>}
                    </TD>
                  </TR>
                );
              }),
            )}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
