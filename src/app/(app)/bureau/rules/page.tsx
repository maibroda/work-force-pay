import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listReleases, releasableRules, RULE_KIND_LABELS } from "@/server/services/rule-library";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { proposeReleaseAction } from "@/app/actions/rule-library";

const TONE = { PROPOSED: "amber", VERIFIED: "blue", PUBLISHED: "green", WITHDRAWN: "gray" } as const;

export default async function RuleLibraryPage() {
  const ctx = await requirePage("bureau.view");
  const [releases, options] = await Promise.all([listReleases(ctx), can(ctx.role, "rules.manage") ? releasableRules(ctx) : Promise.resolve([])]);
  return (
    <>
      <PageHeader
        title="Statutory rule library"
        description="The bureau's own PAYE, pension and employer-contribution tables are the master set. A new version reaches clients only after one person from HR and one from Finance have verified it, and neither may be whoever proposed it. Clients cannot change these rules themselves."
      />

      {options.length > 0 && (
        <Section title="Put a rule version forward" description="Create the new version in the bureau's own tables first (Payroll → PAYE / Pension), then put it forward here with where the rate comes from.">
          <SmartForm
            columns={2}
            submitLabel="Propose for verification"
            action={proposeReleaseAction}
            fields={[
              { name: "rule", label: "Rule version", type: "select", required: true, options: options.map((o) => ({ value: `${o.kind}:${o.id}`, label: `${o.label} — from ${fmtDate(o.effectiveFrom)}` })) },
              { name: "source", label: "Source (law, gazette, circular)", required: true, placeholder: "e.g. Nigeria Tax Act 2025, s. 58; FIRS circular 2026/04" },
              { name: "summary", label: "What changed and why", type: "textarea", required: true, span: 2 },
            ]}
          />
        </Section>
      )}

      <Section title="Releases and change log" flush>
        <Table>
          <THead>
            <TR>
              <TH>Rule</TH>
              <TH>Effective from</TH>
              <TH>Status</TH>
              <TH>Proposed by</TH>
              <TH>HR</TH>
              <TH>Finance</TH>
              <TH className="text-right">Clients</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {releases.map((r) => (
              <TR key={r.id}>
                <TD>
                  <p className="font-medium">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{RULE_KIND_LABELS[r.kind]}</p>
                </TD>
                <TD>{fmtDate(r.effectiveFrom)}</TD>
                <TD>
                  <Badge tone={TONE[r.status]}>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</Badge>
                </TD>
                <TD className="text-xs">
                  {r.proposedBy}
                  <br />
                  {fmtDate(r.createdAt)}
                </TD>
                {(["HR", "FINANCE"] as const).map((slot) => {
                  const v = r.verifications.find((x) => x.slot === slot);
                  return (
                    <TD key={slot} className="text-xs">
                      {v ? `${v.verifierName}, ${fmtDate(v.createdAt)}` : "—"}
                    </TD>
                  );
                })}
                <TD className="text-right">{r._count.publications}</TD>
                <TD>
                  <Link className="text-primary underline" href={`/bureau/rules/${r.id}`}>
                    Open
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!releases.length && <Empty>No releases yet. Statutory rates a client uses today were copied from the bureau&apos;s tables when the client was onboarded.</Empty>}
      </Section>
    </>
  );
}
