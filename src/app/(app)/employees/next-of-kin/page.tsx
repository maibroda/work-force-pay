import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { recordsOverview } from "@/server/services/personal-records";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

type Contact = Awaited<ReturnType<typeof recordsOverview>>["rows"][number]["contacts"][number];

function Who({ c }: { c?: Contact }) {
  if (!c) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {c.fullName} <span className="text-xs text-muted-foreground">({c.relationship})</span>
      <div className="font-mono text-xs">{c.phone}</div>
    </>
  );
}

export default async function NextOfKinPage() {
  const ctx = await requirePage("employee.sensitive");
  const { rows, totals, policy } = await recordsOverview(ctx);
  const main = (r: (typeof rows)[number], kind: Contact["kind"]) => {
    const list = r.contacts.filter((c) => c.kind === kind);
    return list.find((c) => c.isPrimary) ?? list[0];
  };
  const sorted = [...rows.filter((r) => r.gaps.nextOfKinMissing || r.gaps.emergencyMissing), ...rows.filter((r) => !r.gaps.nextOfKinMissing && !r.gaps.emergencyMissing)];
  return (
    <>
      <PageHeader
        title="Next of kin & emergency contacts"
        description={`Who to call when something happens to an employee. Policy: ${policy.nextOfKinRequired} next of kin and ${policy.emergencyContactsRequired} emergency contact(s) per employee (change under Settings → HR & Lifecycle Policy). Open an employee to add or edit — employees can also keep their own under My Contacts.`}
      />
      <StatGrid cols={4}>
        <Stat label="Employees" value={totals.employees} />
        <Stat label="No next of kin" value={totals.noNextOfKin} tone={totals.noNextOfKin ? "red" : "green"} />
        <Stat label="No emergency contact" value={totals.noEmergency} tone={totals.noEmergency ? "red" : "green"} />
        <Stat label="Beneficiary split not 100%" value={totals.badShares} tone={totals.badShares ? "amber" : "green"} />
      </StatGrid>
      <Section title="Employees" flush>
        <Table>
          <THead>
            <TR>
              <TH>Emp. No.</TH>
              <TH>Name</TH>
              <TH>Category</TH>
              <TH>Next of kin (main)</TH>
              <TH>Emergency contact (main)</TH>
              <TH>Flags</TH>
            </TR>
          </THead>
          <TBody>
            {sorted.map((r) => (
              <TR key={r.employee.id}>
                <TD>
                  <Link className="text-primary hover:underline" href={`/employees/${r.employee.id}?tab=contacts`}>
                    {r.employee.employeeNumber}
                  </Link>
                </TD>
                <TD>{fullName(r.employee)}</TD>
                <TD className="text-xs">{r.employee.category.name}</TD>
                <TD>
                  <Who c={main(r, "NEXT_OF_KIN")} />
                </TD>
                <TD>
                  <Who c={main(r, "EMERGENCY_CONTACT")} />
                </TD>
                <TD className="space-x-1">
                  {r.gaps.nextOfKinMissing > 0 && <Badge tone="red">No next of kin</Badge>}
                  {r.gaps.emergencyMissing > 0 && <Badge tone="red">No emergency contact</Badge>}
                  {r.shares.count > 0 && !r.shares.complete && <Badge tone="amber">Shares {r.shares.total}%</Badge>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
