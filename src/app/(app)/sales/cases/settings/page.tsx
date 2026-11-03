import { requirePage } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getCalendarSettings, listSlaPolicies } from "@/server/services/sales/cases";
import { getHealthWeights } from "@/server/services/sales/health";
import { COMPONENTS, COMPONENT_LABELS } from "@/lib/sales/health";
import { saveHealthWeightsAction } from "@/app/actions/sales-health";
import { addHolidayAction, removeHolidayAction, removeSlaPolicyAction, saveBusinessHoursAction, saveSlaPolicyAction, setRenewalWindowAction, starterPoliciesAction } from "@/app/actions/sales-cases";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const span = (m: number) => (m % 1440 === 0 ? `${m / 1440} day(s)` : m % 60 === 0 ? `${m / 60} hour(s)` : `${m} minutes`);
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default async function CaseSettingsPage() {
  const ctx = await requirePage("sales.configure");
  const setting = await db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { enabled: true, renewalWindowDays: true } });
  if (!setting?.enabled) return <PageHeader title="Case settings" description="Switch the sales module on under Sales settings first." />;
  const weights = (await getHealthWeights(ctx)).weights;
  const [cal, policies, accounts] = await Promise.all([getCalendarSettings(ctx), listSlaPolicies(ctx), db.crmAccount.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  return (
    <>
      <PageHeader title="Case settings" description="When you are open, which days you are closed, how fast each priority of case must be answered and resolved, and when a renewal deal is opened. Changes apply to cases opened from now on: a case keeps the deadlines it was given." />
      <Section title="Business hours (Lagos time)" description={cal.isDefault ? "Not set yet: Monday to Friday, 08:00 to 17:00 is assumed. A policy set to business hours only counts time inside these hours." : "A policy set to business hours only counts time inside these hours."}>
        <SmartForm
          columns={3}
          submitLabel="Save hours"
          resetOnSuccess={false}
          action={saveBusinessHoursAction}
          fields={[
            { name: "open", label: "Opens (HH:MM)", defaultValue: hhmm(cal.openMinute), required: true },
            { name: "close", label: "Closes (HH:MM)", defaultValue: hhmm(cal.closeMinute), required: true },
            ...DAYS.map((d, i) => ({ name: d, label: label(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][i]), type: "checkbox" as const, defaultValue: cal.workDays.includes(i + 1) })),
          ]}
        />
      </Section>
      <Section title={`${cal.holidayRows.length} holiday(s)`} description="Days you are closed. Public holidays differ by year and are announced by government, so none are entered for you." flush>
        <Table>
          <THead><TR><TH>Date</TH><TH>Holiday</TH><TH /></TR></THead>
          <TBody>
            {cal.holidayRows.map((h) => (
              <TR key={h.id}>
                <TD className="text-xs">{h.date.toISOString().slice(0, 10)}</TD>
                <TD>{h.name}</TD>
                <TD><ActionButton action={removeHolidayAction.bind(null, h.id)} variant="outline" confirm="Remove this holiday?">Remove</ActionButton></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
      <Section title="Add a holiday">
        <SmartForm columns={3} submitLabel="Add" action={addHolidayAction} fields={[{ name: "date", label: "Date", type: "date", required: true }, { name: "name", label: "Name", required: true }]} />
      </Section>

      <Section title={`${policies.length} SLA polic${policies.length === 1 ? "y" : "ies"}`} description="For each priority: time to the first answer and to resolution. A policy for an account wins over the default for that priority." flush>
        <Table>
          <THead><TR><TH>For</TH><TH>Priority</TH><TH>First response</TH><TH>Resolution</TH><TH>Clock</TH><TH /></TR></THead>
          <TBody>
            {policies.map((p) => (
              <TR key={p.id}>
                <TD className="text-xs">{p.account?.name ?? "Everyone (default)"}</TD>
                <TD className="text-xs">{label(p.priority)}</TD>
                <TD className="text-xs">{span(p.firstResponseMinutes)}</TD>
                <TD className="text-xs">{span(p.resolutionMinutes)}</TD>
                <TD className="text-xs">{p.businessHoursOnly ? "Business hours" : "Around the clock"}</TD>
                <TD><ActionButton action={removeSlaPolicyAction.bind(null, p.id)} variant="outline" confirm="Remove this policy? Cases already open keep their deadlines.">Remove</ActionButton></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!policies.length && (
          <div className="space-y-2 px-4 py-4 text-sm">
            <p className="text-amber-800">No policy yet, so cases have no deadlines.</p>
            <ActionButton action={starterPoliciesAction} variant="outline">Make the starting policies (placeholders: correct them)</ActionButton>
          </div>
        )}
      </Section>
      <Section title="Set a policy" description="Saving a priority that already has a policy (for the same account, or the default) replaces it. Times are in hours.">
        <SmartForm
          columns={3}
          submitLabel="Save policy"
          action={saveSlaPolicyAction}
          fields={[
            { name: "accountId", label: "For", type: "select", options: [{ value: "", label: "Everyone (the default)" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))] },
            { name: "priority", label: "Priority", type: "select", defaultValue: "NORMAL", options: ["LOW", "NORMAL", "HIGH", "CRITICAL"].map((v) => ({ value: v, label: label(v) })) },
            { name: "businessHoursOnly", label: "Count business hours only", type: "checkbox", defaultValue: true },
            { name: "firstResponseHours", label: "First response within (hours)", type: "number", required: true, min: 0.1 },
            { name: "resolutionHours", label: "Resolved within (hours)", type: "number", required: true, min: 0.1 },
          ]}
        />
      </Section>
      <Section title="Account health weights" description="How much each measure counts towards a client account's health score (whole numbers adding up to 100). A measure with no data is left out and the others fill its place. The starting weights are my choice: change them to suit you.">
        <SmartForm columns={3} submitLabel="Save weights" resetOnSuccess={false} action={saveHealthWeightsAction} fields={COMPONENTS.map((k) => ({ name: k, label: COMPONENT_LABELS[k], type: "number" as const, defaultValue: weights[k], required: true, min: 0, max: 100 }))} />
      </Section>
      <Section title="Renewals" description="A contract that ends within this many days gets one renewal deal opened for it by the daily job.">
        <SmartForm columns={2} submitLabel="Save" resetOnSuccess={false} action={setRenewalWindowAction} fields={[{ name: "days", label: "Window (days)", type: "number", defaultValue: setting.renewalWindowDays, required: true, min: 1, max: 365 }]} />
      </Section>
    </>
  );
}
