import type { Metadata } from "next";
import { publicSurvey } from "@/server/services/survey";
import { PublicSurveyForm } from "./public-survey-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Survey", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The address an employee reaches from a QR code or a shared device. No login: an access code is the only credential, and it only lets the person answer once. */
export default async function PublicSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await publicSurvey(id).catch(() => null);
  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-900 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 text-slate-900 shadow">
        {s ? (
          <PublicSurveyForm surveyId={s.id} title={s.title} intro={s.intro} questions={s.questions.map((q) => ({ id: q.id, kind: q.kind, text: q.text }))} />
        ) : (
          <>
            <h1 className="text-xl font-semibold">This survey is not open</h1>
            <p className="mt-2 text-sm text-slate-600">It may have closed, or the address may be wrong. Ask HR if you were expecting to answer a survey.</p>
          </>
        )}
      </div>
    </main>
  );
}
