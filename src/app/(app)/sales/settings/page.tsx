import { requirePage } from "@/lib/auth/session";
import { getSalesSetting } from "@/server/services/sales/setting";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { saveSalesSettingAction } from "@/app/actions/sales";

export default async function SalesSettingsPage() {
  const ctx = await requirePage("sales.configure");
  const s = await getSalesSetting(ctx);
  return (
    <>
      <PageHeader
        title="Sales settings"
        description="The sales module keeps this company's own prospects, contacts and enquiries. It is off until you switch it on, and switching it off again keeps everything already entered."
      />
      <Section title="Status">
        <p className="text-sm">{s.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</p>
      </Section>
      <Section
        title="Switch and mode"
        description="Classic: every enquiry is a lead first, and a real one is converted into an account, contact and deal. Simple: enquiries go straight to deals (for a small team where every enquiry is real)."
      >
        <SmartForm
          columns={2}
          submitLabel="Save"
          action={saveSalesSettingAction}
          fields={[
            { name: "enabled", label: "Sales module is on", type: "checkbox", defaultValue: s.enabled },
            {
              name: "mode",
              label: "Mode",
              type: "select",
              defaultValue: s.mode,
              options: [
                { value: "CLASSIC", label: "Classic (leads first)" },
                { value: "SIMPLE", label: "Simple (straight to deals)" },
              ],
            },
          ]}
        />
      </Section>
    </>
  );
}
