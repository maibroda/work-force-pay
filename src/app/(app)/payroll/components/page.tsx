import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { listStructures } from "@/server/services/structures";
import { naira, num } from "@/lib/money";
import { PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function ComponentsPage() {
  const ctx = await requirePage("structure.view");
  const structures = await listStructures(ctx);
  return (
    <>
      <PageHeader
        title="Salary components"
        description="Every component across all salary structures. Edit components on the structure (drafts) or clone an active structure."
      />
      <Section title="Components" flush>
        <Table>
          <THead>
            <TR>
              <TH>Structure</TH>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>Value</TH>
              <TH>Taxable</TH>
              <TH>Pensionable</TH>
              <TH>Employer cost</TH>
              <TH>Active</TH>
            </TR>
          </THead>
          <TBody>
            {structures.flatMap((s) =>
              s.components.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link className="text-primary hover:underline" href={`/payroll/structures/${s.id}`}>
                      {s.name}
                    </Link>{" "}
                    <StatusBadge status={s.status} />
                  </TD>
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
                  <TD>{c.employerCost ? "Yes" : "No"}</TD>
                  <TD>{c.active ? "Yes" : "No"}</TD>
                </TR>
              )),
            )}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
