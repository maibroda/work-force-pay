import { requirePage } from "@/lib/auth/session";
import { myCases } from "@/server/services/relations";
import { enumOptions } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { raiseCaseAction } from "@/app/actions/hr-lifecycle";

export default async function MyGrievancesPage() {
  const ctx = await requirePage("relations.raise");
  const rows = await myCases(ctx);
  return (
    <>
      <PageHeader
        title="My grievances & concerns"
        description="Raise a grievance, a harassment complaint or a whistleblowing concern. Harassment and whistleblowing cases are always confidential. HR investigates and you can follow the status here."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <FormPanel title="Raise a concern" open={!rows.length}>
          <SmartForm
            columns={2}
            submitLabel="Submit"
            action={raiseCaseAction}
            fields={[
              { name: "type", label: "What is it about?", type: "select", required: true, options: enumOptions(["GRIEVANCE", "HARASSMENT", "WHISTLEBLOWING"]) },
              { name: "severity", label: "How serious is it?", type: "select", defaultValue: "MEDIUM", options: enumOptions(["LOW", "MEDIUM", "HIGH"]) },
              { name: "summary", label: "Summary", required: true, span: 2 },
              { name: "description", label: "What happened (who, when, where)", type: "textarea", required: true, span: 2 },
            ]}
          />
        </FormPanel>
      )}
      <Section title="My cases" flush>
        <Table>
          <THead>
            <TR>
              <TH>Case</TH>
              <TH>Type</TH>
              <TH>Summary</TH>
              <TH>Raised</TH>
              <TH>Response due</TH>
              <TH>Status</TH>
              <TH>Outcome</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">{c.caseNumber}</TD>
                <TD className="text-xs">{c.type.replace(/_/g, " ").toLowerCase()}</TD>
                <TD className="max-w-xs whitespace-normal text-xs">{c.summary}</TD>
                <TD className="text-xs">{fmtDate(c.openedAt)}</TD>
                <TD className="text-xs">{fmtDate(c.dueDate)}</TD>
                <TD>
                  <StatusBadge status={c.status} />
                </TD>
                <TD className="max-w-xs whitespace-normal text-xs">
                  {c.outcome ? (
                    <>
                      <StatusBadge status={c.outcome} />
                      {c.resolution && <p className="mt-1">{c.resolution}</p>}
                    </>
                  ) : (
                    "—"
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>You haven&apos;t raised anything.</Empty>}
      </Section>
    </>
  );
}
