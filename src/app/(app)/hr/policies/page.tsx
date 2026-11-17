import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listPolicies } from "@/server/services/policies";
import { options } from "@/server/options";
import { fmtDate, iso } from "@/lib/dates";
import { POLICY_KIND_LABELS } from "@/lib/policies";
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
        title="Policies, handbook & procedures"
        description="Publish a policy to everyone or one category. Employees read and acknowledge the current version themselves (under My Policies), or HR records a paper sign-off. A new version means everyone is asked again."
      />
      <StatGrid cols={3}>
        <Stat label="Active documents" value={active.length} />
        <Stat label="Acknowledgements outstanding" value={owed} tone={owed ? "amber" : "green"} />
        <Stat label="Overdue" value={overdue} tone={overdue ? "red" : "green"} />
      </StatGrid>

      {configure && (
        <FormPanel title="Publish a policy, the handbook or a procedure" open={!active.length}>
          <SmartForm
            columns={2}
            submitLabel="Publish"
            resetOnSuccess={false}
            action={createPolicyAction}
            fields={[
              { name: "title", label: "Name", required: true, placeholder: "Code of Conduct" },
              { name: "kind", label: "What it is", type: "select", required: true, defaultValue: "POLICY", options: [{ value: "POLICY", label: "Policy" }, { value: "HANDBOOK", label: "Handbook" }, { value: "SOP", label: "Procedure (SOP)" }], help: "Fixed once made." },
              { name: "acknowledgementRequired", label: "Employees must acknowledge it", type: "select", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No, it is there to be read" }], help: "Blank = yes for a policy, no for a handbook or procedure." },
              { name: "reviewDueOn", label: "Review due on (required for a procedure)", type: "date", help: "A procedure (SOP) must have one, no later than the company's setting (12 months unless changed) after it takes effect. Once this day has passed it appears in the HR digest until it is marked reviewed." },
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
              <TH>Document</TH>
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
                  <span className="ml-2 text-[10px] uppercase text-muted-foreground">{POLICY_KIND_LABELS[c.policy.kind]}</span>
                  {c.policy.summary && <div className="text-xs text-muted-foreground">{c.policy.summary}</div>}
                  {c.policy.kind === "SOP" && !c.policy.reviewDueOn && <div className="text-xs text-amber-700">No review date set: the next edit must set one</div>}
                  {c.policy.reviewDueOn && (
                    <div className={`text-xs ${iso(c.policy.reviewDueOn) < iso(new Date()) ? "text-red-700" : "text-muted-foreground"}`}>
                      {iso(c.policy.reviewDueOn) < iso(new Date()) ? "Review overdue since" : "Review due"} {fmtDate(c.policy.reviewDueOn)}
                    </div>
                  )}
                </TD>
                <TD className="text-xs">{c.policy.category?.name ?? "Everyone"}</TD>
                <TD className="text-xs">
                  {c.current ? `v${c.current.version} · ${fmtDate(c.current.effectiveDate)}` : <Badge tone="amber">not yet in effect</Badge>}
                  {c.scheduled && <div className="text-muted-foreground">v{c.scheduled.version} starts {fmtDate(c.scheduled.effectiveDate)}</div>}
                </TD>
                <TD className="text-xs">{c.policy.acknowledgementRequired ? `${c.totals.acknowledged}/${c.totals.applicable}` : "not required"}</TD>
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
