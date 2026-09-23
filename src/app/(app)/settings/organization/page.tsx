import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { KV, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { updateOrganizationAction } from "@/app/actions/workforce";

export default async function OrganizationPage() {
  const ctx = await requirePage();
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  return (
    <>
      <PageHeader
        title="Organization"
        description="Every organization-owned record is scoped by organizationId; users only ever see their own organization's data (enforced server-side)."
      />
      <Section title="Details">
        <KV
          items={[
            ["Name", org.name],
            ["Code", org.code],
            ["Address", org.address],
            ["Phone", org.phone],
            ["Email", org.email],
          ]}
        />
      </Section>
      {can(ctx.role, "settings.manage") && (
        <Section title="Edit">
          <SmartForm
            resetOnSuccess={false}
            fields={[
              { name: "name", label: "Name", required: true, defaultValue: org.name },
              { name: "email", label: "Email", type: "email", defaultValue: org.email ?? undefined },
              { name: "phone", label: "Phone", defaultValue: org.phone ?? undefined },
              { name: "address", label: "Address", defaultValue: org.address ?? undefined },
            ]}
            action={updateOrganizationAction}
          />
        </Section>
      )}
    </>
  );
}
