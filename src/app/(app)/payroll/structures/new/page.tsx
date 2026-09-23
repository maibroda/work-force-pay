import { requirePage } from "@/lib/auth/session";
import { PageHeader, Section } from "@/components/page";
import { StructureBuilder } from "@/components/structure-builder";
import { createStructureAction } from "@/app/actions/payroll";

export default async function NewStructurePage() {
  await requirePage("structure.manage");
  return (
    <>
      <PageHeader
        title="Create salary structure"
        crumbs={[{ href: "/payroll/structures", label: "Salary structures" }]}
        description="Start from the default template and adjust the percentages for a client-specific structure. Activation requires a 100% total unless the structure is marked PARTIAL."
      />
      <Section title="Structure">
        <StructureBuilder action={createStructureAction as never} submitLabel="Create structure" />
      </Section>
    </>
  );
}
