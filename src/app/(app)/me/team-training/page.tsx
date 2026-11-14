import { requirePage } from "@/lib/auth/session";
import { effectivenessDueList, effectivenessEvidence, evaluationsDue, listRequests } from "@/server/services/training-evaluation";
import { EFFECTIVENESS_LABELS, EFFECTIVENESS_OUTCOMES } from "@/lib/training-evaluation";
import { fmtDate } from "@/lib/dates";
import { fullName } from "@/lib/utils";
import { Empty, FormPanel, PageHeader, Section } from "@/components/page";
import { RequestList } from "@/components/training-request-list";
import { SmartForm } from "@/components/smart-form";
import { evaluateEffectivenessAction, evaluateManagerAction, requestTrainingAction } from "@/app/actions/training-evaluation";

const RATINGS = [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n}${n === 5 ? " (fully applied)" : n === 1 ? " (not applied)" : ""}` }));

export default async function TeamTrainingPage() {
  const ctx = await requirePage("training.request");
  const [rows, due, effDue] = await Promise.all([listRequests(ctx), evaluationsDue(ctx), effectivenessDueList(ctx)]);
  // for each one asked, the skill assessments before and after the course, read-only (never a score)
  const evidence = new Map(await Promise.all(effDue.map(async (d) => [d.enrolmentId, await effectivenessEvidence(ctx, d.enrolmentId)] as const)));
  const level = (x: { level: number; on: string } | null) => (x ? `level ${x.level} on ${fmtDate(x.on)}` : "not assessed");
  return (
    <>
      <PageHeader
        title="My team's training"
        description="Ask for a course for someone who reports to you, with a few plain sentences about why. HR decides; accepting only adds it to HR's training needs list. Some time after a course, you are asked whether it was applied on the job: your answer is about the course, changes nothing about the person's pay or status, and the employee can read it."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet, so you have no direct reports here — ask HR to link it.</p>
        </Section>
      ) : (
        <>
          <Section title={`${due.length} evaluation${due.length === 1 ? "" : "s"} waiting for you`} description="Was the course applied on the job? 1 to 5, with an optional comment of up to 300 characters.">
            {due.length === 0 ? (
              <Empty>Nothing is waiting.</Empty>
            ) : (
              <div className="space-y-4">
                {due.map((d) => (
                  <div key={d.enrolmentId} className="rounded border p-3">
                    <p className="text-sm font-medium">
                      {fullName(d.employee)} ({d.employee.employeeNumber}): {d.programmeName}, attended {fmtDate(d.sessionDate)}
                    </p>
                    <div className="mt-2">
                      <SmartForm
                        columns={2}
                        submitLabel="Record my evaluation"
                        action={evaluateManagerAction.bind(null, d.enrolmentId)}
                        fields={[
                          { name: "rating", label: "Applied on the job?", type: "select", required: true, options: RATINGS },
                          { name: "comment", label: "A line about it (optional)" },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section
            title={`${effDue.length} effectiveness evaluation${effDue.length === 1 ? "" : "s"} waiting for you`}
            description="Some months after a course HR has chosen to follow up: did the person's performance on the work this training targets improve? &quot;Not yet visible&quot; is a fair answer if you have not had the chance to see. It is about the training, not a mark against the person: it changes no pay, skill, appraisal or promotion. The person can read your answer."
          >
            {effDue.length === 0 ? (
              <Empty>Nothing is waiting.</Empty>
            ) : (
              <div className="space-y-4">
                {effDue.map((d) => (
                  <div key={d.enrolmentId} className="rounded border p-3">
                    <p className="text-sm font-medium">
                      {fullName(d.employee)} ({d.employee.employeeNumber}): {d.programmeName}, attended {fmtDate(d.sessionDate)}
                    </p>
                    {evidence.get(d.enrolmentId)!.skills.length > 0 && (
                      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                        {evidence.get(d.enrolmentId)!.skills.map((s) => (
                          <li key={s.skillId}>
                            {s.skillName}: before the course {level(s.before)}; after {level(s.after)}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2">
                      <SmartForm
                        columns={2}
                        submitLabel="Record my evaluation"
                        action={evaluateEffectivenessAction.bind(null, d.enrolmentId)}
                        fields={[
                          { name: "outcome", label: "Did their performance on this work improve?", type: "select", required: true, options: EFFECTIVENESS_OUTCOMES.map((o) => ({ value: o, label: EFFECTIVENESS_LABELS[o] })) },
                          { name: "comment", label: "What you saw (optional, up to 300 characters)" },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <FormPanel title="Request a course">
            <SmartForm
              columns={3}
              submitLabel="Send the request"
              action={requestTrainingAction}
              fields={[
                { name: "employeeNumber", label: "Employee number", required: true, placeholder: "e.g. EMP-000012" },
                { name: "courseName", label: "Course", required: true, placeholder: "e.g. First aid" },
                { name: "reason", label: "Why, in a few plain sentences", type: "textarea", required: true, span: 3 },
              ]}
            />
          </FormPanel>
          <Section title={`${rows.length} request${rows.length === 1 ? "" : "s"} you made`} flush>
            <RequestList rows={rows as never} canDecide={false} userId={ctx.userId} />
          </Section>
        </>
      )}
    </>
  );
}
