import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listStructures } from "@/server/services/structures";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { percentageTotal } from "@/lib/payroll/structure";
import { PageHeader, Section } from "@/components/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { arrangeStructures } from "@/lib/structure-groups";
import { options } from "@/server/options";
import { FormPanel } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { createClientStructureAction } from "@/app/actions/payroll";

export default async function StructuresPage() {
  const ctx = await requirePage("structure.view");
  const [rows, o] = await Promise.all([listStructures(ctx), options(ctx)]);
  const groups = arrangeStructures(rows);
  return (
    <>
      <PageHeader
        title="Salary structures"
        description="Components are percentages of the operative's share of the agreed rate (70% by default). The default structure is never changed when new structures are created."
        actions={
          can(ctx.role, "structure.manage") && (
            <Link href="/payroll/structures/new" className={buttonVariants()}>
              + Create salary structure
            </Link>
          )
        }
      />
      <p className="no-print mb-3 text-sm text-muted-foreground">
        Related: <Link href="/payroll/components" className="font-medium text-primary underline">every salary component across the structures</Link>, and <Link href="/contracts/rates" className="font-medium text-primary underline">the contract rates that use these structures</Link>.
      </p>
      <Section title={`${rows.length} structure(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Components</TH>
              <TH className="text-right">% total</TH>
              <TH>Effective</TH>
              <TH className="text-right">Used by rates</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {groups.flatMap((g) => [
              <TR key={`h-${g.heading}`}>
                <TD colSpan={7} className="bg-muted/50 font-semibold">
                  {g.heading}
                </TD>
              </TR>,
              ...g.rows.map(({ structure: s, depth }) => (
              <TR key={s.id}>
                <TD className="font-mono text-xs">{s.code}</TD>
                <TD className={depth === 1 ? "pl-8" : undefined}>
                  {depth === 1 && <span className="mr-1 text-muted-foreground">↳</span>}
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`/payroll/structures/${s.id}`}
                  >
                    {s.name}
                  </Link>{" "}
                  {s.isDefault && <Badge tone="blue">Default</Badge>}{" "}
                  {s.isPartial && <Badge tone="amber">Partial</Badge>}{" "}
                  {s.category && <span className="text-xs text-muted-foreground">for {s.category.name}</span>}
                </TD>
                <TD className="max-w-md whitespace-normal text-xs text-muted-foreground">
                  {s.components
                    .map(
                      (c) =>
                        `${c.name} ${c.calcType === "PERCENTAGE" ? `${num(c.percentage)}%` : c.calcType === "FIXED_AMOUNT" ? `₦${num(c.fixedAmount).toLocaleString()}` : "ƒ"}`,
                    )
                    .join(" · ")}
                </TD>
                <TD className="text-right">
                  {percentageTotal(s.components.map((c) => ({ ...c, percentage: num(c.percentage) })))}%
                </TD>
                <TD>
                  {fmtDate(s.effectiveFrom)}
                  {s.effectiveTo ? ` → ${fmtDate(s.effectiveTo)}` : ""}
                </TD>
                <TD className="text-right">{s._count.contractRates}</TD>
                <TD>
                  <StatusBadge status={s.status} />
                </TD>
              </TR>
              )),
            ])}
          </TBody>
        </Table>
      </Section>
      {can(ctx.role, "structure.manage") && o.clients.length > 0 && (
        <FormPanel title="Create a salary structure for a client">
          <SmartForm
            columns={2}
            submitLabel="Create client structure"
            action={createClientStructureAction}
            fields={[
              { name: "clientId", label: "Client", type: "select", required: true, options: o.clients },
              { name: "code", label: "Code", required: true, placeholder: "ABC-BANK" },
              { name: "name", label: "Name", placeholder: "Leave blank for “<client> salary structure”" },
              { name: "copyFromId", label: "Start from", type: "select", options: rows.map((r) => ({ value: r.id, label: r.name })), help: "The structure whose components it starts as a copy of. Blank: the company's default." },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
