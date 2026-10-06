import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { recordsOverview } from "@/server/services/personal-records";
import { ageOn } from "@/lib/personal-records";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function DependantsPage() {
  const ctx = await requirePage("employee.sensitive");
  const { rows } = await recordsOverview(ctx);
  const today = new Date();
  const withDeps = rows.filter((r) => r.contacts.some((c) => c.kind === "DEPENDANT" || c.isBeneficiary));
  const dependants = rows.reduce((a, r) => a + r.contacts.filter((c) => c.kind === "DEPENDANT").length, 0);
  const children = rows.reduce((a, r) => a + r.contacts.filter((c) => c.kind === "DEPENDANT" && c.dateOfBirth && ageOn(c.dateOfBirth, today) < 18).length, 0);
  const bad = withDeps.filter((r) => r.shares.count > 0 && !r.shares.complete);
  return (
    <>
      <PageHeader
        title="Dependants & beneficiaries"
        description="Who relies on each employee, and who receives death-in-service, group-life and final-pay benefits. An employee's beneficiary shares should total 100%. Open an employee to add or change them."
      />
      <StatGrid cols={4}>
        <Stat label="Employees with dependants / beneficiaries" value={withDeps.length} />
        <Stat label="Dependants" value={dependants} />
        <Stat label="Under 18" value={children} />
        <Stat label="Split not 100%" value={bad.length} tone={bad.length ? "amber" : "green"} />
      </StatGrid>
      <Section title="Employees" flush>
        <Table>
          <THead>
            <TR>
              <TH>Emp. No.</TH>
              <TH>Name</TH>
              <TH>Dependants</TH>
              <TH>Beneficiaries</TH>
              <TH>Flags</TH>
            </TR>
          </THead>
          <TBody>
            {[...bad, ...withDeps.filter((r) => !bad.includes(r))].map((r) => (
              <TR key={r.employee.id}>
                <TD>
                  <Link className="text-primary hover:underline" href={`/employees/${r.employee.id}?tab=contacts`}>
                    {r.employee.employeeNumber}
                  </Link>
                </TD>
                <TD>{fullName(r.employee)}</TD>
                <TD className="max-w-xs whitespace-normal text-xs">
                  {r.contacts
                    .filter((c) => c.kind === "DEPENDANT")
                    .map((c) => `${c.fullName} (${c.relationship}${c.dateOfBirth ? `, ${ageOn(c.dateOfBirth, today)}` : ""})`)
                    .join("; ") || "—"}
                </TD>
                <TD className="max-w-xs whitespace-normal text-xs">
                  {r.contacts
                    .filter((c) => c.isBeneficiary)
                    .map((c) => `${c.fullName} ${c.benefitSharePct}%`)
                    .join("; ") || "—"}
                </TD>
                <TD>{r.shares.count > 0 && !r.shares.complete && <Badge tone="amber">Shares {r.shares.total}%</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!withDeps.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No dependants or beneficiaries recorded yet.</p>}
      </Section>
    </>
  );
}
