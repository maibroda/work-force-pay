import { requirePage } from "@/lib/auth/session";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { onboardClientAction } from "@/app/actions/bureau";
import { termsFields } from "../../terms-fields";

export default async function OnboardClientPage() {
  await requirePage("bureau.manage");
  return (
    <>
      <PageHeader
        title="Onboard a client"
        crumbs={[{ href: "/bureau", label: "Clients" }]}
        description="Creates the client's own organization, with the bureau's statutory rule tables copied in and a standard chart of accounts, and records the terms. Nobody but bureau managers can work in it until they are given access."
      />
      <Section title="Client and terms">
        <SmartForm
          columns={3}
          submitLabel="Onboard client"
          action={onboardClientAction}
          fields={[
            { name: "name", label: "Client name", required: true, span: 2 },
            { name: "code", label: "Short code", required: true, pattern: "^[A-Za-z0-9]{2,12}$", patternMessage: "2 to 12 letters or digits", placeholder: "e.g. ACME" },
            ...termsFields(),
          ]}
        />
      </Section>
    </>
  );
}
