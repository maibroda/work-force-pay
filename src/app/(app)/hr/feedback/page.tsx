import { requirePage } from "@/lib/auth/session";
import { FEEDBACK_KINDS, FEEDBACK_KIND_LABELS, type FeedbackKind } from "@/lib/feedback";
import { listFeedback } from "@/server/services/feedback";
import { FilterBar, FilterField, FormPanel, PageHeader, Section } from "@/components/page";
import { FeedbackList } from "@/components/feedback-list";
import { SmartForm } from "@/components/smart-form";
import { Input, Select } from "@/components/ui/input";
import { giveFeedbackAction } from "@/app/actions/feedback";

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("feedback.manage");
  const sp = await searchParams;
  const kind = (FEEDBACK_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as FeedbackKind) : undefined;
  const rows = await listFeedback(ctx, { employeeNumber: sp.employee?.trim() || undefined, kind, from: sp.from || undefined, to: sp.to || undefined, includeVoided: sp.voided === "1" });
  return (
    <>
      <PageHeader
        title="Feedback"
        description="Short, dated notes about an employee: Recognition (something done well) and Coaching (something to improve, and what would help). The employee always sees what is recorded about them and may reply once. Nothing is edited: a mistake is voided with a reason and kept. Feedback changes no pay, status or discipline, and never changes an appraisal score; the reviewer sees it as evidence."
      />
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
      <FilterBar action="/hr/feedback">
        <FilterField label="Employee number">
          <Input name="employee" defaultValue={sp.employee ?? ""} placeholder="e.g. EMP-000012" />
        </FilterField>
        <FilterField label="Kind">
          <Select name="kind" defaultValue={kind ?? ""}>
            <option value="">All</option>
            {FEEDBACK_KINDS.map((k) => (
              <option key={k} value={k}>
                {FEEDBACK_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="From">
          <Input type="date" name="from" defaultValue={sp.from ?? ""} />
        </FilterField>
        <FilterField label="To">
          <Input type="date" name="to" defaultValue={sp.to ?? ""} />
        </FilterField>
        <FilterField label="Voided entries">
          <Select name="voided" defaultValue={sp.voided === "1" ? "1" : ""}>
            <option value="">Hide</option>
            <option value="1">Show</option>
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} entr${rows.length === 1 ? "y" : "ies"}`} flush>
        <FeedbackList rows={rows} canVoid />
      </Section>
    </>
  );
}
