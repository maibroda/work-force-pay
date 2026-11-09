import { requirePage } from "@/lib/auth/session";
import { FEEDBACK_KINDS, FEEDBACK_KIND_LABELS } from "@/lib/feedback";
import { listFeedback } from "@/server/services/feedback";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { FeedbackList } from "@/components/feedback-list";
import { SmartForm } from "@/components/smart-form";
import { giveFeedbackAction } from "@/app/actions/feedback";

export default async function TeamFeedbackPage() {
  const ctx = await requirePage("feedback.give");
  const rows = await listFeedback(ctx, { scope: "team" });
  return (
    <>
      <PageHeader
        title="My team's feedback"
        description="Feedback about the people who report to you: Recognition (something done well) and Coaching (something to improve, and what would help). The employee reads everything you write and may reply once, so keep it factual and kind. You can only give feedback about your own direct reports; HR can correct a mistake."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet, so you have no direct reports here — ask HR to link it.</p>
        </Section>
      ) : (
        <>
          <FormPanel title="Give feedback">
            <SmartForm
              columns={3}
              submitLabel="Record feedback"
              action={giveFeedbackAction}
              fields={[
                { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
                { name: "kind", label: "Kind", type: "select", required: true, options: FEEDBACK_KINDS.map((k) => ({ value: k, label: FEEDBACK_KIND_LABELS[k] })) },
                { name: "relatesOn", label: "The day it is about (blank = today)", type: "date" },
                { name: "body", label: "The feedback, in a few plain sentences. The employee will read it.", type: "textarea", required: true, span: 3 },
              ]}
            />
          </FormPanel>
          <Section title={`${rows.length} entr${rows.length === 1 ? "y" : "ies"}`} flush>
            <FeedbackList rows={rows} canVoid={false} />
          </Section>
        </>
      )}
    </>
  );
}
