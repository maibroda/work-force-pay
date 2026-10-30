import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { describeCondition, type Condition } from "@/lib/sales/automation";
import { listRules, listRuns } from "@/server/services/sales/automation";
import { listPipelines } from "@/server/services/sales/pipelines";
import { setRuleEnabledAction } from "@/app/actions/sales-automation";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { RuleForm, RuleTester } from "./rule-form";

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const TRIGGER: Record<string, string> = { STAGE_ENTRY: "A deal enters", QUOTE_ACCEPTED: "The quote is accepted", HANDOVER_ACCEPTED: "The handover is accepted", NO_ACTIVITY: "No activity" };
const TONE = { DONE: "green", FAILED: "red", CANCELLED: undefined, SKIPPED: undefined, PENDING: "amber", RUNNING: "amber" } as const;
const when = (d: Date) => d.toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const delay = (m: number) => (m === 0 ? "at once" : m % 1440 === 0 ? `after ${m / 1440} day(s)` : `after ${m / 60} hour(s)`);

export default async function AutomationPage() {
  const ctx = await requirePage("sales.configure");
  const setting = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { enabled: true } });
  if (!setting?.enabled) return <PageHeader title="Automation" description="Switch the sales module on under Sales settings first." />;
  const [rules, runs, pipelines] = await Promise.all([listRules(ctx), listRuns(ctx, { take: 60 }), listPipelines(ctx)]);
  const salesRoles = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, "sales.view"));
  const people = await db.user.findMany({ where: { organizationId: ctx.orgId, active: true, role: { in: salesRoles as never } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const deals = await db.crmOpportunity.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="Automation" description="Rules that act when a deal enters a stage, when its quote or handover is accepted, or when it goes quiet. Every rule starts switched off and nothing happens until you switch it on. Acting as 'Automation', a rule uses the same stage gates, consent rules and audit as a person." />
      <Section title={`${rules.length} rule(s)`} flush>
        <Table>
          <THead>
            <TR><TH>Rule</TH><TH>When</TH><TH>Only if</TH><TH>Does</TH><TH /></TR>
          </THead>
          <TBody>
            {rules.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-normal text-xs font-medium">{r.name}{r.isStarter && <span className="ml-1 text-muted-foreground">(starter)</span>}</TD>
                <TD className="whitespace-normal text-xs">{TRIGGER[r.trigger]}{r.stage ? ` "${r.stage.name}"` : ""}{r.trigger === "NO_ACTIVITY" ? ` for ${r.quietDays} days` : `, ${delay(r.delayMinutes)}`}</TD>
                <TD className="whitespace-normal text-xs">{describeCondition(r.condition as Condition | null)}</TD>
                <TD className="text-xs">{label(r.actionType)}</TD>
                <TD>
                  {r.enabled ? (
                    <ActionButton action={setRuleEnabledAction.bind(null, { id: r.id, enabled: false })} variant="outline" confirm="Switch this rule off? What it has waiting is cancelled.">Switch off</ActionButton>
                  ) : (
                    <ActionButton action={setRuleEnabledAction.bind(null, { id: r.id, enabled: true })}>Switch on</ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      <Section title="Test a rule on a deal" description="See what a rule would do for a deal, without doing it.">
        <RuleTester rules={rules.map((r) => ({ id: r.id, name: r.name }))} deals={deals} />
      </Section>
      <Section title="Make a rule" description="To change a rule, switch it off and make a new one, so the log stays true. Unless you say otherwise, the Negotiation starter rule's threshold of ₦5,000,000 is only a placeholder.">
        <RuleForm data={{ pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) })), people }} />
      </Section>
      <Section title="What the rules have done" description="The most recent runs. Skipped means the rule held back on purpose (for example the condition was not met or consent was missing); cancelled means the deal moved on or the rule was switched off before it was due." flush>
        <Table>
          <THead>
            <TR><TH>When</TH><TH>Rule</TH><TH>Deal</TH><TH>Result</TH><TH>Why or what</TH><TH className="text-right">Time</TH></TR>
          </THead>
          <TBody>
            {runs.map((r) => (
              <TR key={r.id}>
                <TD className="text-xs">{when(r.createdAt)}</TD>
                <TD className="whitespace-normal text-xs">{r.rule.name}</TD>
                <TD className="whitespace-normal text-xs"><Link className="underline" href={`/sales/opportunities/${r.opportunity.id}`}>{r.opportunity.name}</Link></TD>
                <TD><Badge tone={TONE[r.status]}>{label(r.status)}</Badge></TD>
                <TD className="whitespace-normal text-xs">{r.error ?? (r.inputs && (r.inputs as { condition?: string }).condition) ?? ""}</TD>
                <TD className="text-right text-xs">{r.durationMs !== null ? `${r.durationMs} ms` : ""}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!runs.length && <p className="px-4 py-4 text-sm text-muted-foreground">Nothing has run yet.</p>}
      </Section>
    </>
  );
}
