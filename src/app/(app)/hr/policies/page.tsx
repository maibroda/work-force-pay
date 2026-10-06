import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listPolicies } from "@/server/services/policies";
import { options } from "@/server/options";
import { fmtDate } from "@/lib/dates";
import { FormPanel, PageHeader, Section, Stat, StatGrid, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createPolicyAction } from "@/app/actions/policies";

export default async function PoliciesPage() {
  const ctx = await requirePage("hr.view");
  const configure = can(ctx.role, "hr.configure");
  const [{ active, archived }, o] = await Promise.all([listPolicies(ctx), options(ctx)]);
  const overdue = active.reduce((a, c) => a + c.totals.overdue, 0);
  const owed = active.reduce((a, c) => a + c.totals.pending + c.totals.overdue, 0);
  return (
    <>
      <PageHeader
        title="Policies & acknowledgements"
        description="Publish a policy to everyone or one category. Employees read and acknowledge the current version themselves (under My Policies), or HR records a paper sign-off. A new version means everyone is asked again."
      />
      <StatGrid cols={3}>
        <Stat label="Active policies" value={active.length} />
        <Stat label="Acknowledgements outstanding" value={owed} tone={owed ? "amber" : "green"} />
        <Stat label="Overdue" value={overdue} tone={overdue ? "red" : "green"} />
      </StatGrid>

      {configure && (
        <FormPanel title="Publish a policy" open={!active.length}>
          <SmartForm
            columns={2}
            submitLabel="Publish"
            resetOnSuccess={false}
            action={createPolicyAction}
            fields={[
              { name: "title", label: "Policy name", required: true, placeholder: "Code of Conduct" },
              { name: "categoryId", label: "Applies to", type: "select", options: o.categories, help: "Leave blank for every employee." },
              { name: "summary", label: "One-line summary", span: 2 },
              { name: "body", label: "The policy text employees will read", type: "textarea", span: 2, help: "Or give a document reference below, or both." },
              { name: "documentReference", label: "Document reference", help: "File name or number of the signed-off document." },
              { name: "effectiveDate", label: "Effective from", type: "date", help: "Blank = today. A future date schedules it." },
              { name: "graceDays", label: "Days to acknowledge", type: "number", min: 0, max: 365, defaultValue: 14, help: "From the later of the effective date and the employee joining." },
            ]}
          />
        </FormPanel>
      )}

      <Section title="Active policies" flush>
        <Table>
          <THead>
            <TR>
              <TH>Policy</TH>
              <TH>Applies to</TH>
              <TH>Current version</TH>
              <TH>Acknowledged</TH>
              <TH>Overdue</TH>
            </TR>
          </THead>
          <TBody>
            {active.map((c) => (
              <TR key={c.policy.id}>
                <TD>
                  <Link className="text-primary hover:underline" href={`/hr/policies/${c.policy.id}`}>
                    {c.policy.title}
                  </Link>
                  {c.policy.summary && <div className="text-xs text-muted-foreground">{c.policy.summary}</div>}
                </TD>
                <TD className="text-xs">{c.policy.category?.name ?? "Everyone"}</TD>
                <TD className="text-xs">
                  {c.current ? `v${c.current.version} · ${fmtDate(c.current.effectiveDate)}` : <Badge tone="amber">not yet in effect</Badge>}
                  {c.scheduled && <div className="text-muted-foreground">v{c.scheduled.version} starts {fmtDate(c.scheduled.effectiveDate)}</div>}
                </TD>
                <TD className="text-xs">
                  {c.totals.acknowledged}/{c.totals.applicable}
                </TD>
                <TD>{c.totals.overdue ? <Badge tone="red">{c.totals.overdue}</Badge> : 0}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!active.length && <Empty>No policies yet.</Empty>}
      </Section>

      {archived.length > 0 && (
        <Section title="Archived" flush>
          <Table>
            <TBody>
              {archived.map((p) => (
                <TR key={p.id} className="opacity-70">
                  <TD>
                    <Link className="text-primary hover:underline" href={`/hr/policies/${p.id}`}>
                      {p.title}
                    </Link>
                  </TD>
                  <TD className="text-xs">{p.versions.length} version(s)</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </>
  );
}
