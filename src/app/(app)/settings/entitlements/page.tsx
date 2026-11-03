import { requirePage } from "@/lib/auth/session";
import { fmtDate } from "@/lib/dates";
import { listSwitches, organizationsWithoutSubscription, switchHistory } from "@/server/services/entitlement-switch";
import { Empty, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { setModuleModeAction } from "@/app/actions/entitlements";

const MODE_HELP: Record<string, string> = { OFF: "Nothing is checked.", REPORT: "Let it through and log what would have been refused.", ENFORCE: "Refuse a company that did not buy it." };

/** Platform staff only. Every module starts OFF, so nothing is checked until someone decides. */
export default async function EntitlementSwitchPage() {
  const ctx = await requirePage("subscription.manage");
  const [switches, missing, history] = await Promise.all([listSwitches(ctx), organizationsWithoutSubscription(), switchHistory(ctx)]);
  return (
    <>
      <PageHeader
        title="Module switch"
        description="Whether a company's modules are checked at all, module by module. OFF means nothing is checked (how every module starts). REPORT lets everything through and logs what enforcement would have refused. ENFORCE refuses a company that did not buy the module. Platform staff only."
      />
      {missing.length > 0 && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>{missing.length} compan{missing.length === 1 ? "y has" : "ies have"} no subscription</b> ({missing.slice(0, 8).map((m) => m.code).join(", ")}
          {missing.length > 8 ? " and others" : ""}). No module can be set to REPORT or ENFORCE until every company has one, or those companies would be locked out of what they use.
        </div>
      )}
      <Section title="Modules" flush>
        <Table>
          <THead>
            <TR>
              <TH>Module</TH>
              <TH>Now</TH>
            </TR>
          </THead>
          <TBody>
            {switches.map((s) => (
              <TR key={s.moduleKey}>
                <TD>{s.name}</TD>
                <TD>
                  <StatusBadge status={s.mode === "OFF" ? "INACTIVE" : s.mode === "REPORT" ? "PENDING" : "ACTIVE"} /> {s.mode} <span className="text-xs text-muted-foreground">{MODE_HELP[s.mode]}</span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      <Section title="Change a module" description="Every change is recorded with your reason and cannot be edited afterwards.">
        <SmartForm
          columns={3}
          submitLabel="Save"
          action={setModuleModeAction}
          fields={[
            { name: "moduleKey", label: "Module", type: "select", required: true, options: switches.map((s) => ({ value: s.moduleKey, label: s.name })) },
            { name: "mode", label: "Set to", type: "select", required: true, options: ["OFF", "REPORT", "ENFORCE"].map((m) => ({ value: m, label: `${m}: ${MODE_HELP[m]}` })) },
            { name: "reason", label: "Reason", required: true, span: 3 },
          ]}
        />
      </Section>
      <Section title="History" description="Oldest first." flush>
        {history.length === 0 ? (
          <Empty>No change yet. Every module is OFF.</Empty>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Module</TH>
                <TH>From</TH>
                <TH>To</TH>
                <TH>By</TH>
                <TH>Reason</TH>
              </TR>
            </THead>
            <TBody>
              {history.map((e) => (
                <TR key={e.id}>
                  <TD>{fmtDate(e.createdAt)}</TD>
                  <TD>{e.moduleKey}</TD>
                  <TD>{e.fromMode}</TD>
                  <TD>{e.toMode}</TD>
                  <TD>{e.byName}</TD>
                  <TD>{e.reason}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </>
  );
}
