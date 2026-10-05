import { requirePage } from "@/lib/auth/session";
import { listTemplates } from "@/server/services/letters";
import { LETTER_FIELDS, LETTER_LABELS, type LetterTypeKey } from "@/lib/letters";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { resetLetterTemplateAction, saveLetterTemplateAction } from "@/app/actions/letters";

export default async function LetterTemplatesPage() {
  const ctx = await requirePage("hr.configure");
  const templates = await listTemplates(ctx);
  return (
    <>
      <PageHeader
        title="Letter templates"
        description="The wording of each letter, in your own words. Use {{fields}} to merge in details — each kind of letter offers its own set (listed under it), and saving refuses any other. Letters already issued keep the wording they were issued with."
      />
      {templates.map((t) => (
        <Section
          key={t.id}
          title={LETTER_LABELS[t.type as LetterTypeKey]}
          description={
            <span>
              Fields: {LETTER_FIELDS[t.type as LetterTypeKey].map((f) => (
                <code key={f.key} title={f.label} className="mr-1.5 rounded bg-muted px-1 py-0.5 text-[11px]">{`{{${f.key}}}`}</code>
              ))}
            </span>
          }
          actions={
            <ActionButton action={resetLetterTemplateAction.bind(null, t.type)} confirm="Reset to the default wording?" variant="outline">
              Reset to default
            </ActionButton>
          }
        >
          <FormPanel title="Edit the wording">
            <SmartForm
              columns={2}
              submitLabel="Save wording"
              resetOnSuccess={false}
              action={saveLetterTemplateAction}
              fields={[
                { name: "type", label: "", type: "hidden", defaultValue: t.type },
                { name: "subject", label: "Subject", required: true, span: 2, defaultValue: t.subject },
                { name: "body", label: "Letter", type: "textarea", required: true, span: 2, defaultValue: t.body, help: "Leave a blank line between paragraphs." },
                { name: "signatoryName", label: "Signed by (name)", defaultValue: t.signatoryName, help: "Optional — leave a signature line only." },
                { name: "signatoryTitle", label: "Signatory's title", required: true, defaultValue: t.signatoryTitle },
              ]}
            />
          </FormPanel>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">{t.body}</pre>
        </Section>
      ))}
    </>
  );
}
