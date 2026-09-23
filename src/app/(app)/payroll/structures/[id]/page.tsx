import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getStructure } from "@/server/services/structures";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { computeComponents, percentageTotal, validateStructure } from "@/lib/payroll/structure";
import { toStructureDef } from "@/server/services/structures";
import { KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR, TFoot } from "@/components/ui/table";
import { StructureBuilder } from "@/components/structure-builder";
import {
  activateStructureAction,
  cloneStructureAction,
  deactivateStructureAction,
  updateStructureAction,
} from "@/app/actions/payroll";

export default async function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("structure.view");
  const { id } = await params;
  const s = await getStructure(ctx, id);
  if (!s) notFound();
  const def = toStructureDef(s);
  const errors = validateStructure(def);
  const sample = computeComponents(def, 84000, 1);
  const manage = can(ctx.role, "structure.manage");
  return (
    <>
      <PageHeader
        title={s.name}
        crumbs={[{ href: "/payroll/structures", label: "Salary structures" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s.status} />
            {s.isDefault && <Badge tone="blue">Default</Badge>}
            {s.isPartial && <Badge tone="amber">Partial</Badge>}
            <code className="text-xs">{s.code}</code>
          </span>
        }
        actions={
          manage && (
            <>
              {s.status !== "ACTIVE" && (
                <ActionButton action={activateStructureAction.bind(null, s.id)} variant="success">
                  Activate
                </ActionButton>
              )}
              {s.status === "ACTIVE" && !s.isDefault && (
                <ActionButton
                  action={deactivateStructureAction.bind(null, s.id)}
                  variant="outline"
                  confirm="Deactivate?"
                >
                  Deactivate
                </ActionButton>
              )}
              <ActionButton
                action={cloneStructureAction.bind(null, s.id)}
                variant="outline"
                reason
                reasonPlaceholder="New structure code, e.g. ABC-GUARD-V2"
              >
                Clone as new version
              </ActionButton>
            </>
          )
        }
      />
      {errors.length > 0 && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errors.join(" ")}
        </p>
      )}
      <Section title="Details">
        <KV
          cols={4}
          items={[
            ["Method", s.calculationMethod.replace(/_/g, " ")],
            ["Effective", `${fmtDate(s.effectiveFrom)} → ${fmtDate(s.effectiveTo)}`],
            ["Percentage total", `${percentageTotal(def.components)}%`],
            ["Description", s.description],
          ]}
        />
      </Section>
      <Section
        title="Components"
        description="Illustration at ₦120,000 agreed rate × 70% = ₦84,000 operative gross, full month."
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>#</TH>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>Value</TH>
              <TH>Taxable</TH>
              <TH>Pensionable</TH>
              <TH>Active</TH>
              <TH className="text-right">At ₦84,000</TH>
            </TR>
          </THead>
          <TBody>
            {s.components.map((c, i) => (
              <TR key={c.id}>
                <TD>{i + 1}</TD>
                <TD className="font-mono text-xs">{c.code}</TD>
                <TD>{c.name}</TD>
                <TD className="text-xs">{c.calcType}</TD>
                <TD>
                  {c.calcType === "PERCENTAGE" ? (
                    `${num(c.percentage)}%`
                  ) : c.calcType === "FIXED_AMOUNT" ? (
                    naira(c.fixedAmount)
                  ) : (
                    <code className="text-xs">{c.formula}</code>
                  )}
                </TD>
                <TD>{c.taxable ? "Yes" : "No"}</TD>
                <TD>{c.pensionable ? "Yes" : "No"}</TD>
                <TD>{c.active ? "Yes" : "No"}</TD>
                <TD className="text-right tabular-nums">
                  {naira(sample.find((x) => x.code === c.code)?.amount ?? 0)}
                </TD>
              </TR>
            ))}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={8}>Total</TD>
              <TD className="text-right">{naira(sample.reduce((a, c) => a + c.amount, 0))}</TD>
            </TR>
          </TFoot>
        </Table>
      </Section>
      <Section
        title="Assigned to"
        description="CLIENT → CONTRACT → CATEGORY → this structure → agreed rate"
        flush
      >
        <Table>
          <THead>
            <TR>
              <TH>Client</TH>
              <TH>Contract</TH>
              <TH>Category</TH>
              <TH className="text-right">Agreed rate</TH>
              <TH>Effective</TH>
            </TR>
          </THead>
          <TBody>
            {s.contractRates.map((r) => (
              <TR key={r.id}>
                <TD>{r.contract.client.name}</TD>
                <TD className="font-mono text-xs">{r.contract.contractNumber}</TD>
                <TD>{r.category.name}</TD>
                <TD className="text-right">{naira(r.agreedRate)}</TD>
                <TD>
                  {fmtDate(r.effectiveFrom)} → {fmtDate(r.effectiveTo)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      {manage && s.status === "DRAFT" && (
        <Section title="Edit draft">
          <StructureBuilder
            action={updateStructureAction.bind(null, s.id) as never}
            submitLabel="Save draft"
            initial={{
              code: s.code,
              name: s.name,
              description: s.description ?? "",
              calculationMethod: s.calculationMethod,
              isPartial: s.isPartial,
              effectiveFrom: iso(s.effectiveFrom),
              effectiveTo: s.effectiveTo ? iso(s.effectiveTo) : "",
              activate: false,
              components: s.components.map((c) => ({
                code: c.code,
                name: c.name,
                calcType: c.calcType,
                percentage: c.percentage === null ? "" : String(num(c.percentage)),
                fixedAmount: c.fixedAmount === null ? "" : String(num(c.fixedAmount)),
                formula: c.formula ?? "",
                taxable: c.taxable,
                pensionable: c.pensionable,
                employerCost: c.employerCost,
                active: c.active,
              })),
            }}
          />
        </Section>
      )}
    </>
  );
}
