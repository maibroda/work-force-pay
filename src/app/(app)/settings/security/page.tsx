import { requirePage } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { daysUntilEnforced } from "@/lib/two-factor-policy";
import { fmtDate } from "@/lib/dates";
import { getOwnSecurityInfo } from "@/server/services/security";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { changePasswordAction, logoutEverywhereAction } from "@/app/actions/auth";
import { TwoFactorPanel } from "./two-factor-panel";

export default async function SecuritySettingsPage() {
  const ctx = await requirePage("self.security", { allowUnenrolled: true });
  const [info, gate] = await Promise.all([getOwnSecurityInfo(ctx), twoFactorStateFor(ctx)]);
  const daysLeft = gate.enforceFrom ? daysUntilEnforced(gate.enforceFrom, new Date(new Date().toISOString().slice(0, 10))) : 0;
  return (
    <>
      <PageHeader
        title="My security"
        description={`Signed in as ${ctx.email}. Changes here only affect your own account.`}
      />
      {gate.state === "BLOCKED" && (
        <div className="mb-5 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <b>Two-factor authentication is compulsory for your role.</b> The rest of the system stays closed to you until you turn it on below.
        </div>
      )}
      {gate.state === "GRACE" && gate.enforceFrom && (
        <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Two-factor authentication becomes compulsory for your role on {fmtDate(gate.enforceFrom)}</b> ({daysLeft <= 0 ? "today" : `in ${daysLeft} day(s)`}). Turn it on below now so you are not locked out.
        </div>
      )}
      <Section title="Password">
        <SmartForm
          columns={2}
          submitLabel="Change password"
          action={changePasswordAction}
          fields={[
            {
              name: "currentPassword",
              label: "Current password",
              type: "password",
              required: true,
            },
            {
              name: "newPassword",
              label: "New password",
              type: "password",
              required: true,
              help: "At least 8 characters. This signs you out of your other devices.",
            },
          ]}
        />
      </Section>
      <Section title="Two-factor authentication">
        <TwoFactorPanel initiallyEnabled={info.totpEnabled} />
      </Section>
      <Section title="Sessions" description="If you've signed in on a device you no longer trust.">
        <ActionButton
          action={logoutEverywhereAction}
          confirm="Sign out of every device, including this one?"
          variant="outline"
        >
          Sign out everywhere
        </ActionButton>
      </Section>
    </>
  );
}
