import { requirePage } from "@/lib/auth/session";
import { getOwnSecurityInfo } from "@/server/services/security";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { changePasswordAction, logoutEverywhereAction } from "@/app/actions/auth";
import { TwoFactorPanel } from "./two-factor-panel";

export default async function SecuritySettingsPage() {
  const ctx = await requirePage("self.security");
  const info = await getOwnSecurityInfo(ctx);
  return (
    <>
      <PageHeader
        title="My security"
        description={`Signed in as ${ctx.email}. Changes here only affect your own account.`}
      />
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
