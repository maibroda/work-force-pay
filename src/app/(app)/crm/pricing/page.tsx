import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getRateCard } from "@/server/services/proposals";
import { PACKAGE_NAMES } from "@/lib/pricing";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { confirmRateCardAction, saveAddOnAction, savePackageAction, saveSettingAction } from "@/app/actions/proposals";
import { crmGate } from "../_gate";

export default async function PricingPage() {
  const ctx = await requirePage("crm.view");
  const gate = await crmGate(ctx, "Pricing");
  if (gate) return gate;
  const c = await getRateCard(ctx);
  const owner = can(ctx.role, "pricing.manage");
  return (
    <>
      <PageHeader
        title="Pricing"
        crumbs={[{ href: "/crm", label: "Sales pipeline" }]}
        description="The rate card behind every proposal: package prices, add-ons, and what delivering the work costs the bureau. A proposal is priced from it, and nothing can be sent while it is unconfirmed."
      />
      {c.confirmed ? (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">
          Confirmed by {c.confirmed.by} on {fmtDate(c.confirmed.at)}. Changing any figure below takes the confirmation back.
        </p>
      ) : (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          <p>
            <b>These prices are placeholders until they are confirmed.</b> No proposal can be sent until whoever owns pricing has checked every figure and confirmed the rate card.
          </p>
          {owner && (
            <div className="mt-3">
              <SmartForm columns={1} submitLabel="Confirm the rate card" resetOnSuccess action={confirmRateCardAction} fields={[{ name: "note", label: "What did you check?", type: "textarea", required: true, help: "For example: package prices against our costs and two competitors' quotes" }]} />
            </div>
          )}
        </div>
      )}

      <Section title="Packages" description={`Fees are excluding VAT (${c.setting.vatRatePct}%). The margin target is ${c.setting.targetMarginPct}%.`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Package</TH>
              <TH className="text-right">Per employee</TH>
              <TH className="text-right">Monthly minimum</TH>
              <TH className="text-right">Set-up fee</TH>
              {owner && <TH className="text-right">Officer hours</TH>}
              <TH />
            </TR>
          </THead>
          <TBody>
            {c.packages.map((p) => (
              <TR key={p.key}>
                <TD>{PACKAGE_NAMES[p.key as keyof typeof PACKAGE_NAMES] ?? p.key}</TD>
                <TD className="text-right text-xs">{naira(p.perEmployeeRate)}</TD>
                <TD className="text-right text-xs">{naira(p.monthlyMinimum)}</TD>
                <TD className="text-right text-xs">{naira(p.onboardingFee)}</TD>
                {owner && <TD className="text-right text-xs">{p.hours ? `${p.hours.base} + ${p.hours.perEmployee} min each` : ""}</TD>}
                <TD>{p.active ? null : <Badge>Off</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      {c.packages.map((p) => (
        <details key={p.key} className="mb-3 rounded-lg border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            {PACKAGE_NAMES[p.key as keyof typeof PACKAGE_NAMES] ?? p.key}: what is included and what the client does
          </summary>
          <div className="space-y-3 px-4 pb-4">
            {owner ? (
              <SmartForm
                columns={3}
                submitLabel="Save package"
                resetOnSuccess={false}
                action={savePackageAction.bind(null, p.key)}
                fields={[
                  { name: "perEmployeeRate", label: "Per employee (₦ a month)", type: "number", min: 0, required: true, defaultValue: p.perEmployeeRate },
                  { name: "monthlyMinimum", label: "Monthly minimum (₦)", type: "number", min: 0, required: true, defaultValue: p.monthlyMinimum },
                  { name: "onboardingFee", label: "Set-up fee (₦)", type: "number", min: 0, required: true, defaultValue: p.onboardingFee },
                  { name: "baseHours", label: "Officer hours a month", type: "number", min: 0, required: true, defaultValue: p.hours?.base },
                  { name: "minutesPerEmployee", label: "Minutes a month per employee", type: "number", min: 0, required: true, defaultValue: p.hours?.perEmployee },
                  { name: "active", label: "On offer", type: "checkbox", defaultValue: p.active },
                  { name: "scope", label: "What is included (one line each)", type: "textarea", required: true, span: 3, defaultValue: p.scope },
                  { name: "responsibilities", label: "What the client must do (one line each)", type: "textarea", required: true, span: 3, defaultValue: p.responsibilities, help: "Describe the process and what is included, never a guaranteed result." },
                ]}
              />
            ) : (
              <>
                <p className="text-xs font-medium">Included</p>
                <ul className="list-disc pl-5 text-sm">
                  {p.scope.split("\n").map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <p className="text-xs font-medium">The client</p>
                <ul className="list-disc pl-5 text-sm">
                  {p.responsibilities.split("\n").map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>
      ))}

      <Section title="Add-ons" flush>
        <Table>
          <THead>
            <TR>
              <TH>Add-on</TH>
              <TH className="text-right">Monthly</TH>
              <TH className="text-right">Per employee</TH>
              <TH className="text-right">Set-up</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {c.addOns.map((a) => (
              <TR key={a.code}>
                <TD>
                  {a.name} <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                  {a.description && <p className="text-xs text-muted-foreground">{a.description}</p>}
                </TD>
                <TD className="text-right text-xs">{naira(a.monthlyFee)}</TD>
                <TD className="text-right text-xs">{naira(a.perEmployeeFee)}</TD>
                <TD className="text-right text-xs">{naira(a.onboardingFee)}</TD>
                <TD>{a.active ? null : <Badge>Off</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      {owner && (
        <>
          <FormPanel title="Add or change an add-on">
            <p className="mb-3 text-xs text-muted-foreground">Use an existing code to change that add-on; a new code adds one. Untick “On offer” to withdraw it from new proposals.</p>
            <SmartForm
              columns={3}
              submitLabel="Save add-on"
              resetOnSuccess
              action={saveAddOnAction}
              fields={[
                { name: "code", label: "Code", required: true, placeholder: "e.g. EXTRA_SITE" },
                { name: "name", label: "Name", required: true },
                { name: "monthlyFee", label: "Monthly fee (₦)", type: "number", min: 0, defaultValue: 0 },
                { name: "perEmployeeFee", label: "Per employee (₦)", type: "number", min: 0, defaultValue: 0 },
                { name: "onboardingFee", label: "Set-up fee (₦)", type: "number", min: 0, defaultValue: 0 },
                { name: "hours", label: "Officer hours a month", type: "number", min: 0, defaultValue: 0 },
                { name: "minutesPerEmployee", label: "Minutes a month per employee", type: "number", min: 0, defaultValue: 0 },
                { name: "active", label: "On offer", type: "checkbox", defaultValue: true },
                { name: "description", label: "Description (on the proposal)", span: 3 },
              ]}
            />
          </FormPanel>
          <FormPanel title="What delivering the work costs, and the targets">
            <p className="mb-3 text-xs text-muted-foreground">
              These set the cost of serving a client (officer hours, software, overhead) and the lowest price that still earns the margin target. They are internal: the sales role sees the resulting margin on a proposal, not these figures.
            </p>
            <SmartForm
              columns={3}
              submitLabel="Save"
              resetOnSuccess={false}
              action={saveSettingAction}
              fields={[
                { name: "hourlyCost", label: "Cost of one officer hour (₦)", type: "number", min: 0, required: true, defaultValue: c.setting.hourlyCost },
                { name: "softwareFixed", label: "Software and support per client per month (₦)", type: "number", min: 0, required: true, defaultValue: c.setting.softwareFixed },
                { name: "softwarePerEmployee", label: "Software and support per employee per month (₦)", type: "number", min: 0, required: true, defaultValue: c.setting.softwarePerEmployee },
                { name: "overheadPct", label: "Overhead on top (%)", type: "number", min: 0, max: 300, required: true, defaultValue: c.setting.overheadPct },
                { name: "targetMarginPct", label: "Target gross margin (%)", type: "number", min: 0, max: 95, required: true, defaultValue: c.setting.targetMarginPct },
                { name: "vatRatePct", label: "VAT rate (%)", type: "number", min: 0, max: 50, required: true, defaultValue: c.setting.vatRatePct, help: "Confirm the current rate with your tax adviser." },
                { name: "validityDays", label: "A proposal stays open (days)", type: "number", min: 1, max: 180, required: true, defaultValue: c.setting.validityDays },
              ]}
            />
          </FormPanel>
        </>
      )}
    </>
  );
}
