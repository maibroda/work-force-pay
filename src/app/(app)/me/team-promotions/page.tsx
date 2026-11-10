import { requirePage } from "@/lib/auth/session";
import { listPromotions, listRoles } from "@/server/services/career";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { PromotionList } from "@/components/promotion-list";
import { SmartForm } from "@/components/smart-form";
import { proposePromotionAction } from "@/app/actions/career";

export default async function TeamPromotionsPage() {
  const ctx = await requirePage("career.propose");
  const [rows, roles] = await Promise.all([listPromotions(ctx), listRoles(ctx)]);
  return (
    <>
      <PageHeader
        title="My team's promotions"
        description="Propose that someone who reports to you moves to another role, with a few plain sentences about why. HR decides; a proposal changes nothing until it is approved and HR applies it. The employee is told only of an approved promotion. You can withdraw a proposal while it is undecided."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet, so you have no direct reports here — ask HR to link it.</p>
        </Section>
      ) : (
        <>
          <FormPanel title="Propose a promotion">
            <SmartForm
              columns={3}
              submitLabel="Send the proposal"
              action={proposePromotionAction}
              fields={[
                { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
                { name: "toCategoryId", label: "Moves to the role", type: "select", required: true, options: roles.map((r) => ({ value: r.id, label: r.name })) },
                { name: "intendedOn", label: "Intended from", type: "date", required: true },
                { name: "reason", label: "Why, in a few plain sentences", type: "textarea", required: true, span: 3 },
              ]}
            />
          </FormPanel>
          <Section title={`${rows.length} proposal${rows.length === 1 ? "" : "s"} you made`} flush>
            <PromotionList rows={rows as never} canDecide={false} canApply={false} userId={ctx.userId} />
          </Section>
        </>
      )}
    </>
  );
}
