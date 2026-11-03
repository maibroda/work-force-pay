import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { fmtDate } from "@/lib/dates";
import { MODULES, PLANS, type ModuleKey, type PlanKey } from "@/lib/entitlements/catalogue";
import { getSubscription } from "@/server/services/subscriptions";
import { Empty, KV, PageHeader, Section } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const SOURCE: Record<string, string> = { PLAN: "In the plan", ADD_ON: "Added on", GRANDFATHERED: "Kept from before plans" };
const KIND: Record<string, string> = {
  CREATED: "Subscription made",
  PLAN_CHANGED: "Plan changed",
  MODULE_ADDED: "Module added",
  MODULE_REMOVED: "Module ended",
  LIMITS_CHANGED: "Limits changed",
  GRANDFATHERED: "Existing company given its modules",
};
const moduleName = (k: string) => MODULES[k as ModuleKey]?.name ?? k;
const planName = (k: string) => PLANS[k as PlanKey]?.name ?? k;

/** The company's own plan and modules, for reading. Changing them is for platform staff (and a bureau, for its clients) and is not on this page. */
export default async function SubscriptionPage() {
  const ctx = await requirePage("subscription.view");
  const sub = await getSubscription(ctx);
  return (
    <>
      <PageHeader
        title="Subscription"
        description="The plan and modules your company has. To change them, ask whoever looks after your account."
      />
      {!sub ? (
        <Section title="Plan">
          <Empty>
            This company has no subscription recorded yet. Nothing is switched off for that reason: every module stays available.
          </Empty>
        </Section>
      ) : (
        <>
          <Section title="Plan">
            <KV
              cols={4}
              items={[
                ["Plan", planName(sub.planKey)],
                ["Status", <StatusBadge key="s" status={sub.status} />],
                ["Employees included", sub.employeeLimit ?? "No limit set"],
                ["Sales users included", sub.crmUserLimit ?? "No limit set"],
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Limits are recorded only. Nothing stops anyone at a limit yet. Chosen from the module catalogue of {sub.catalogueVersion}.
            </p>
          </Section>
          <Section title="Modules" flush>
            <Table>
              <THead>
                <TR>
                  <TH>Module</TH>
                  <TH>How it came</TH>
                  <TH>From</TH>
                  <TH>Until</TH>
                  <TH>Now</TH>
                </TR>
              </THead>
              <TBody>
                {sub.modules.map((m) => (
                  <TR key={m.id}>
                    <TD>{moduleName(m.moduleKey)}</TD>
                    <TD>{SOURCE[m.source] ?? m.source}</TD>
                    <TD>{fmtDate(m.startsOn)}</TD>
                    <TD>{m.endsOn ? fmtDate(m.endsOn) : "—"}</TD>
                    <TD>
                      <StatusBadge status={m.active ? "ACTIVE" : "ENDED"} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
          <Section title="History" description="Every change, oldest first. It cannot be edited." flush>
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>What</TH>
                  <TH>By</TH>
                  <TH>Reason</TH>
                </TR>
              </THead>
              <TBody>
                {sub.events.map((e) => (
                  <TR key={e.id}>
                    <TD>{fmtDate(e.createdAt)}</TD>
                    <TD>{KIND[e.kind] ?? e.kind}</TD>
                    <TD>{e.byName}</TD>
                    <TD>{e.reason ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        </>
      )}
      {!can(ctx.role, "subscription.manage") && <p className="text-xs text-muted-foreground">Your role can look at this page but not change it.</p>}
    </>
  );
}
