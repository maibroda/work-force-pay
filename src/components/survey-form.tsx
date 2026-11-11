import { SCALE_LABELS } from "@/lib/survey-scale";
import { SmartForm } from "@/components/smart-form";
import type { ActionResult } from "@/lib/action-result";

export interface SurveyQuestionView {
  id: string;
  kind: string;
  text: string;
}

/** The questions of one survey as a form: a statement is rated 1 to 5, a comment is optional free text. Used by the employee page. */
export function SurveyForm({ questions, action, submitLabel = "Send my answers" }: { questions: SurveyQuestionView[]; action: (v: Record<string, unknown>) => Promise<ActionResult>; submitLabel?: string }) {
  return (
    <SmartForm
      columns={1}
      submitLabel={submitLabel}
      action={action}
      fields={questions.map((q) =>
        q.kind === "SCALE"
          ? { name: `q_${q.id}`, label: q.text, type: "select" as const, options: [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n}: ${SCALE_LABELS[n]}` })) }
          : { name: `q_${q.id}`, label: `${q.text} (optional)`, type: "textarea" as const },
      )}
    />
  );
}
