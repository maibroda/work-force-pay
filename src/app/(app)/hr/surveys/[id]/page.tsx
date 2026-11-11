import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { canCtx } from "@/lib/hr-functions";
import { MIN_RESPONSES, SCALE_LABELS } from "@/lib/survey";
import { getSurvey, results } from "@/server/services/survey";
import { BusinessError } from "@/server/services/_base";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { OpenSurveyWithSheet, ReissueCode } from "@/components/survey-code-tools";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { addQuestionAction, closeSurveyAction, hideCommentAction, openSurveyAction, reissueCodeAction, removeQuestionAction, setFollowUpAction, startAssistedSessionAction } from "@/app/actions/survey";

type Summary = { shown: boolean; count: number | null; average: number | null; distribution: Record<string, number> | null };
const cell = (s: Summary | null | undefined) => (!s ? "—" : s.shown ? `${s.average} (${s.count} answers)` : "fewer than 5");

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("survey.manage");
  const { id } = await params;
  let s;
  try {
    s = await getSurvey(ctx, id);
  } catch (e) {
    if (e instanceof BusinessError) notFound();
    throw e;
  }
  const closed = s.state === "CLOSED";
  const r = closed ? await results(ctx, id) : null;
  const canAssist = canCtx(ctx, "survey.assist");
  return (
    <>
      <PageHeader title={s.title} description={`${s.intro ? s.intro + " " : ""}Opens ${fmtDate(s.opensOn)}, closes ${fmtDate(s.closesOn)}.`} />
      <Section title="Status" description="HR sees counts only: nobody can list who took part.">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={s.state === "OPEN" ? "green" : s.state === "CLOSED" ? "amber" : "gray"}>{s.state === "DRAFT" ? "Draft" : s.state === "SCHEDULED" ? "Opens later" : s.state === "OPEN" ? "Open" : "Closed"}</Badge>
          {s.state !== "DRAFT" && (
            <span>
              {s.participation.took} of {s.participation.invited} have taken part
            </span>
          )}
          {(s.state === "OPEN" || s.state === "SCHEDULED") && (
            <ActionButton action={closeSurveyAction.bind(null, s.id)} confirm="Close the survey now? Results are shown once it is closed, and it cannot be reopened." variant="outline">
              Close the survey
            </ActionButton>
          )}
        </div>
        {s.participation.byRole.shown.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">By role (shown only for groups of ten or more invited): {s.participation.byRole.shown.map((g) => `${g.label} ${g.took} of ${g.invited}`).join("; ")}.</p>
        )}
      </Section>

      <Section title={`Questions (${s.questions.length})`} description="A statement is rated from 1 (strongly disagree) to 5 (strongly agree); a comment is optional free text. At most 15 questions. They can be changed only while the survey is a draft.">
        {s.questions.length === 0 ? (
          <Empty>No question yet.</Empty>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {s.questions.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center gap-2">
                {q.text} <span className="text-xs text-muted-foreground">({q.kind === "SCALE" ? "rated 1 to 5" : "comment"})</span>
                {s.state === "DRAFT" && (
                  <ActionButton action={removeQuestionAction.bind(null, q.id)} confirm="Remove this question?" variant="outline">
                    Remove
                  </ActionButton>
                )}
              </li>
            ))}
          </ol>
        )}
        {s.state === "DRAFT" && (
          <div className="mt-3">
            <SmartForm
              columns={3}
              submitLabel="Add the question"
              action={addQuestionAction.bind(null, s.id)}
              fields={[
                { name: "kind", label: "Kind", type: "select", required: true, options: [{ value: "SCALE", label: "A statement rated 1 to 5" }, { value: "COMMENT", label: "An optional comment" }] },
                { name: "text", label: "The question or statement", required: true, span: 2 },
              ]}
            />
          </div>
        )}
      </Section>

      {s.state === "DRAFT" && (
        <Section title="Open the survey" description="Opening makes one access code for each invited employee. The sheet of codes is shown once, to print and hand out.">
          <OpenSurveyWithSheet open={openSurveyAction.bind(null, s.id)} />
        </Section>
      )}

      {s.state === "OPEN" && (
        <Section title="Employees without a login" description="They answer with their own access code: on their phone (open this survey's address, shown below, or scan a QR code of it), on a shared company device, or in an assisted session. An assisted session is run only by an authorised HR representative, never a supervisor: the employee types their own code and answers alone.">
          <p className="text-sm">
            Survey address: <b className="font-mono">/survey/{s.id}</b>
          </p>
          <div className="mt-3 space-y-3">
            <ReissueCode reissue={reissueCodeAction.bind(null, s.id)} />
            {canAssist && (
              <SmartForm
                columns={2}
                submitLabel="Start an assisted session"
                action={startAssistedSessionAction.bind(null, s.id)}
                fields={[{ name: "deviceLabel", label: "Which device? (for the record, e.g. Tablet, Ikeja gate)", required: true }]}
              />
            )}
          </div>
        </Section>
      )}

      {closed && r && (
        <>
          <Section title="Results" description={r.purged ? "The raw answers were deleted at the end of the retention period; these anonymised results are kept." : `Shown only from ${MIN_RESPONSES} answers. A role or department appears on its own only with at least ten invited and five answers; smaller groups are combined, and a second group is hidden when exactly one would be, so none can be worked out by subtraction.`}>
            <p className="mb-3 text-sm">
              {r.participation.took} of {r.participation.invited} took part. {r.responses === null ? `Fewer than ${MIN_RESPONSES} answers: nothing is shown.` : `${r.responses} submissions.`}
            </p>
            {r.questions.map((q) => (
              <div key={q.id} className="mb-4 rounded border p-3">
                <p className="text-sm font-medium">{q.text}</p>
                {q.kind === "SCALE" ? (
                  <>
                    <p className="mt-1 text-sm">Overall: {cell(q.summary as Summary | null)}</p>
                    {(q.summary as Summary | null)?.shown && (q.summary as Summary).distribution && (
                      <p className="text-xs text-muted-foreground">{Object.entries((q.summary as Summary).distribution!).map(([k, v]) => `${k} ${SCALE_LABELS[Number(k)]}: ${v}`).join(" · ")}</p>
                    )}
                    {q.byRole && (
                      <div className="mt-2 text-xs">
                        <b>By role:</b> {q.byRole.shown.map((g) => `${g.label} ${cell(g.summary as Summary)}`).join("; ") || "no role is shown on its own"}
                        {q.byRole.other && `; other roles combined: ${q.byRole.other.shown ? cell(q.byRole.other.summary as Summary) : "not shown"}`}
                      </div>
                    )}
                    {q.byDepartment && (
                      <div className="mt-1 text-xs">
                        <b>By department:</b> {q.byDepartment.shown.map((g) => `${g.label} ${cell(g.summary as Summary)}`).join("; ") || "no department is shown on its own"}
                        {q.byDepartment.other && `; other departments combined: ${q.byDepartment.other.shown ? cell(q.byDepartment.other.summary as Summary) : "not shown"}`}
                      </div>
                    )}
                  </>
                ) : q.comments === null ? (
                  <p className="mt-1 text-xs text-muted-foreground">{r.purged ? "Comments are not kept after the raw answers are deleted." : `Comments are shown from ${MIN_RESPONSES} answers.`}</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {q.comments.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-start gap-2">
                        <span className="max-w-xl whitespace-pre-line">{c.text}</span>
                        <ActionButton action={hideCommentAction.bind(null, c.id)} reason reasonPlaceholder="Why hide it? e.g. it names a person (required)" variant="outline">
                          Hide
                        </ActionButton>
                      </li>
                    ))}
                    {q.comments.length === 0 && <li className="text-xs text-muted-foreground">No comments.</li>}
                  </ul>
                )}
              </div>
            ))}
          </Section>
          <Section title="What we are doing about it" description="Every invited employee can read this on My surveys.">
            <SmartForm columns={1} submitLabel="Save" action={setFollowUpAction.bind(null, s.id)} resetOnSuccess={false} fields={[{ name: "followUp", label: "A short note", type: "textarea", required: true, defaultValue: s.followUp ?? "" }]} />
          </Section>
        </>
      )}
    </>
  );
}
