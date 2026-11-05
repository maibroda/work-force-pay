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
import Link from "next/link";
import { options } from "@/server/options";
import { FormPanel } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { assignStructureToClientAction, createRoleStructureAction } from "@/app/actions/payroll";
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
  const o = await options(ctx);
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
            {s.client && <span className="text-xs">Owned by {s.client.name}</span>}
            {s.parent && (
              <span className="text-xs">
                Role structure under <Link className="text-primary underline" href={`/payroll/structures/${s.parent.id}`}>{s.parent.name}</Link>
                {s.category ? ` for ${s.category.name}` : ""}
              </span>
            )}
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
      {manage && !s.clientId && !s.parentId && !s.isDefault && o.clients.length > 0 && (
        <FormPanel title="Give this structure to a client">
          <SmartForm
            columns={2}
            submitLabel="Give to the client"
            action={assignStructureToClientAction}
            fields={[
              { name: "structureId", label: "", type: "hidden", defaultValue: s.id },
              { name: "clientId", label: "Client", type: "select", required: true, options: o.clients, help: "A client's structure can be used only on that client's contracts, and can then have role structures. Refused if it is already used on another client's contracts or for personal pay rates." },
            ]}
          />
        </FormPanel>
      )}
      {s.clientId && !s.parentId && (
        <Section title="Role structures" description="One for each job role (guard, supervisor, driver, cleaner). Each starts as a complete copy of this structure and can then be edited. Only one can be active for a role." flush>
          <Table>
            <THead>
              <TR>
                <TH>Role</TH>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {s.roles.map((r) => (
                <TR key={r.id}>
                  <TD>{r.category?.name ?? "—"}</TD>
                  <TD className="font-mono text-xs">{r.code}</TD>
                  <TD>
                    <Link className="font-medium text-primary hover:underline" href={`/payroll/structures/${r.id}`}>
                      {r.name}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!s.roles.length && <p className="px-4 py-3 text-sm text-muted-foreground">No role structures yet.</p>}
        </Section>
      )}
      {manage && s.clientId && !s.parentId && (
        <FormPanel title="Add a role structure">
          <SmartForm
            columns={3}
            submitLabel="Create role structure"
            action={createRoleStructureAction}
            fields={[
              { name: "parentId", label: "", type: "hidden", defaultValue: s.id },
              { name: "categoryId", label: "Job role (category)", type: "select", required: true, options: o.categories },
              { name: "code", label: "Code", required: true, placeholder: `${s.code}-GUARD` },
              { name: "name", label: "Name", placeholder: "Leave blank for “<client> — <role>”" },
            ]}
          />
        </FormPanel>
      )}
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
