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

export default async function StructuresPage() {
  const ctx = await requirePage("structure.view");
  const rows = await listStructures(ctx);
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
            {rows.map((s) => (
              <TR key={s.id}>
                <TD className="font-mono text-xs">{s.code}</TD>
                <TD>
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`/payroll/structures/${s.id}`}
                  >
                    {s.name}
                  </Link>{" "}
                  {s.isDefault && <Badge tone="blue">Default</Badge>}{" "}
                  {s.isPartial && <Badge tone="amber">Partial</Badge>}
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
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
