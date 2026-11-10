import { requirePage } from "@/lib/auth/session";
import { mySurveys, surveyFormFor } from "@/server/services/survey";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { SurveyForm } from "@/components/survey-form";
import { submitMySurveyAction } from "@/app/actions/survey";

export default async function MySurveysPage() {
  const ctx = await requirePage();
  const mine = await mySurveys(ctx);
  const forms = await Promise.all(mine.open.map((s) => surveyFormFor(ctx, s.id)));
  return (
    <>
      <PageHeader
        title="My surveys"
        description="Surveys you are invited to answer. Your answers are anonymous: they carry no name and no time, the company cannot see who took part, and nothing is shown unless at least five people answered. Answering is your choice and changes nothing about you."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : (
        <>
          {forms.length === 0 ? (
            <Section title="Nothing to answer">
              <Empty>No survey is open for you. If you were given an access code on a sheet, you can use it on the survey address you were given.</Empty>
            </Section>
          ) : (
            forms.map((f, i) => (
              <Section key={f.id} title={f.title} description={`${f.intro ? f.intro + " " : ""}Open until ${fmtDate(mine.open[i].closesOn)}.`}>
                <SurveyForm questions={f.questions} action={submitMySurveyAction.bind(null, f.id)} />
              </Section>
            ))
          )}
          {mine.closed.length > 0 && (
            <Section title="What we are doing about it" description="From surveys that have closed.">
              <ul className="space-y-3 text-sm">
                {mine.closed.map((c) => (
                  <li key={c.id}>
                    <b>{c.title}</b>
                    <p className="whitespace-pre-line">{c.followUp}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </>
  );
}
