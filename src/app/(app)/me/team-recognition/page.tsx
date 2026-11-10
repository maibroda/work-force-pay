import { requirePage } from "@/lib/auth/session";
import { listAwardTypes, listAwards } from "@/server/services/recognition";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { AwardList } from "@/components/award-list";
import { SmartForm } from "@/components/smart-form";
import { nominateAction } from "@/app/actions/recognition";

export default async function TeamRecognitionPage() {
  const ctx = await requirePage("recognition.nominate");
  const [rows, types] = await Promise.all([listAwards(ctx), listAwardTypes(ctx)]);
  const active = types.filter((t) => t.active);
  return (
    <>
      <PageHeader
        title="My team's recognition"
        description="Nominate someone who reports to you for an award, with a few plain sentences about why. HR decides. The employee is told only if the award is approved. You can withdraw a nomination while it is undecided."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet, so you have no direct reports here — ask HR to link it.</p>
        </Section>
      ) : (
        <>
          <FormPanel title="Nominate someone">
            {active.length === 0 ? (
              <Empty>HR has not set up an award yet.</Empty>
            ) : (
              <SmartForm
                columns={3}
                submitLabel="Send the nomination"
                action={nominateAction}
                fields={[
                  { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
                  { name: "typeId", label: "Award", type: "select", required: true, options: active.map((t) => ({ value: t.id, label: t.name })) },
                  { name: "citation", label: "Why they deserve it, in a few plain sentences", type: "textarea", required: true, span: 3 },
                ]}
              />
            )}
          </FormPanel>
          <Section title={`${rows.length} nomination${rows.length === 1 ? "" : "s"} you made`} flush>
            <AwardList rows={rows} canDecide={false} userId={ctx.userId} />
          </Section>
        </>
      )}
    </>
  );
}
