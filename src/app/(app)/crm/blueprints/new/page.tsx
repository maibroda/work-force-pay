import { requirePage } from "@/lib/auth/session";
import { QUESTIONS } from "@/lib/entitlements/configure";
import { listLeadOptions } from "@/server/services/blueprints";
import { isSeller } from "@/server/services/price-book";
import { PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { saveBlueprintAction } from "@/app/actions/blueprints";

export default async function NewBlueprintPage() {
  const ctx = await requirePage("blueprint.manage");
  if (!(await isSeller(ctx))) return <PageHeader title="New blueprint" description="Blueprints and quotes are made in a payroll bureau's own organization, or by platform staff." />;
  const leads = await listLeadOptions(ctx);
  return (
    <>
      <PageHeader
        title="New blueprint"
        crumbs={[{ href: "/crm/blueprints", label: "Blueprints and quotes" }]}
        description="Answer about the prospect. The modules they need are worked out, the plan that fits best is proposed with the reason, and the quote is priced from the price book in force today. Nothing is sent."
      />
      <Section title="About the prospect">
        <SmartForm
          columns={2}
          submitLabel="Work out the blueprint and quote"
          action={saveBlueprintAction}
          fields={[
            { name: "prospectName", label: "Prospect", required: true },
            { name: "leadId", label: "Lead in your pipeline (optional)", type: "select", options: [{ value: "", label: "None" }, ...leads.map((l) => ({ value: l.id, label: `${l.number}: ${l.company}` }))] },
            { name: "employees", label: "How many employees will be on payroll?", type: "number", required: true, min: 1 },
            { name: "crmUsers", label: "How many sales users (only if they want the CRM)?", type: "number", min: 1 },
            ...QUESTIONS.map((q) => ({ name: `want_${q.key}`, label: q.ask, type: "checkbox" as const, span: 2 as const })),
          ]}
        />
      </Section>
    </>
  );
}
