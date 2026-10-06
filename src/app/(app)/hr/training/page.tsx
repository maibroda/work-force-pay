import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { complianceOverview } from "@/server/services/training";
import { STATE_LABELS, type ComplianceState } from "@/lib/training-compliance";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const tone = (s: ComplianceState) => (s === "MISSING" || s === "EXPIRED" ? "red" : s === "EXPIRING" || s === "GRACE" ? "amber" : "green");
const ORDER: Record<ComplianceState, number> = { EXPIRED: 0, MISSING: 1, EXPIRING: 2, GRACE: 3, VALID: 4 };

export default async function TrainingCompliancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("hr.view");
  const sp = await searchParams;
  const { rows, perRequirement, totals, policy } = await complianceOverview(ctx);
  const showAll = sp.show === "all";
  const items = rows
    .flatMap((r) => r.items.map((i) => ({ employee: r.employee, ...i })))
    .filter((i) => (sp.req ? i.requirement.id === sp.req : true))
    .filter((i) => (showAll ? true : i.assessment.state !== "VALID" ))
    .sort((a, b) => ORDER[a.assessment.state] - ORDER[b.assessment.state] || a.employee.employeeNumber.localeCompare(b.employee.employeeNumber));
  const none = !perRequirement.length;
  return (
    <>
      <PageHeader
        title="Training compliance"
        description={`Who holds the certifications the company requires. A certificate recorded on an employee (Documents & training tab) covers a requirement with the same course name. Expiring means within ${policy.trainingAlertDays} days.`}
        actions={
          can(ctx.role, "hr.configure") ? (
            <Link className="text-sm text-primary underline" href="/settings/training-requirements">
              Requirements
            </Link>
          ) : undefined
        }
      />
      {none ? (
        <Section title="No requirements yet">
          <p className="text-sm text-muted-foreground">
            Nothing is required yet.{" "}
            {can(ctx.role, "hr.configure") ? (
              <>
                Add the courses and certifications your staff must hold under{" "}
                <Link className="text-primary underline" href="/settings/training-requirements">
                  Settings → Training Requirements
                </Link>
                .
              </>
            ) : (
              "Ask an HR administrator to set them up."
            )}
          </p>
        </Section>
      ) : (
        <>
          <StatGrid cols={4}>
            <Stat label="Fully compliant" value={`${totals.compliant}/${totals.withRequirements}`} tone={totals.withGaps ? undefined : "green"} sub="employees with requirements" />
            <Stat label="Expired" value={totals.expired} tone={totals.expired ? "red" : "green"} />
            <Stat label="Missing" value={totals.missing} tone={totals.missing ? "red" : "green"} />
            <Stat label="Expiring soon" value={totals.expiring} tone={totals.expiring ? "amber" : "green"} />
          </StatGrid>

          <Section title="By requirement" flush>
            <Table>
              <THead>
                <TR>
                  <TH>Required course</TH>
                  <TH>Applies to</TH>
                  <TH>Staff</TH>
                  <TH>Valid</TH>
                  <TH>Expiring</TH>
                  <TH>Expired</TH>
                  <TH>Missing</TH>
                </TR>
              </THead>
              <TBody>
                {perRequirement.map((p) => (
                  <TR key={p.requirement.id} className={sp.req === p.requirement.id ? "bg-muted/50" : ""}>
                    <TD>
                      <Link className="text-primary hover:underline" href={sp.req === p.requirement.id ? "/hr/training" : `/hr/training?req=${p.requirement.id}`}>
                        {p.requirement.courseName}
                      </Link>
                    </TD>
                    <TD className="text-xs">{p.requirement.categoryId ? "One category" : "Everyone"}</TD>
                    <TD>{p.required}</TD>
                    <TD>{p.valid}</TD>
                    <TD>{p.expiring ? <Badge tone="amber">{p.expiring}</Badge> : 0}</TD>
                    <TD>{p.expired ? <Badge tone="red">{p.expired}</Badge> : 0}</TD>
                    <TD>{p.missing ? <Badge tone="red">{p.missing}</Badge> : 0}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>

          <Section
            title={showAll ? "Every requirement" : "Needs attention"}
            description={
              <span className="flex flex-wrap gap-2 text-xs">
                <Link className="text-primary underline" href={showAll ? `/hr/training${sp.req ? `?req=${sp.req}` : ""}` : `/hr/training?show=all${sp.req ? `&req=${sp.req}` : ""}`}>
                  {showAll ? "Show only what needs attention" : "Show everything, including valid"}
                </Link>
                {sp.req && (
                  <Link className="text-primary underline" href="/hr/training">
                    Clear the course filter
                  </Link>
                )}
              </span>
            }
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Category</TH>
                  <TH>Required course</TH>
                  <TH>Status</TH>
                  <TH>Valid until</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((i) => (
                  <TR key={`${i.employee.id}-${i.requirement.id}`}>
                    <TD>
                      <Link className="text-primary hover:underline" href={`/employees/${i.employee.id}?tab=documents`}>
                        {i.employee.employeeNumber}
                      </Link>{" "}
                      <span className="text-xs">{fullName(i.employee)}</span>
                    </TD>
                    <TD className="text-xs">{i.employee.category.name}</TD>
                    <TD>{i.requirement.courseName}</TD>
                    <TD>
                      <Badge tone={tone(i.assessment.state)}>{STATE_LABELS[i.assessment.state]}</Badge>
                    </TD>
                    <TD className="text-xs">
                      {i.assessment.expiryDate ? `${fmtDate(i.assessment.expiryDate)} (${i.assessment.daysLeft! < 0 ? `${-i.assessment.daysLeft!} days ago` : `in ${i.assessment.daysLeft} days`})` : "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!items.length && <Empty>{showAll ? "No one has a requirement." : "Everyone is covered."}</Empty>}
          </Section>
        </>
      )}
    </>
  );
}
