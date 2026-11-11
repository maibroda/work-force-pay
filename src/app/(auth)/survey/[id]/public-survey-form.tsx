"use client";
import { useState, useTransition } from "react";
import { SCALE_LABELS } from "@/lib/survey-scale";
import { submitPublicSurveyAction } from "./submit";

interface Q {
  id: string;
  kind: string;
  text: string;
}

/**
 * The survey for someone with an access code and no login. After one person finishes the page resets (so a shared device can be handed to the next person) and nothing
 * about the previous person stays on the screen.
 */
export function PublicSurveyForm({ surveyId, title, intro, questions }: { surveyId: string; title: string; intro: string | null; questions: Q[] }) {
  const [code, setCode] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setCode("");
    setValues({});
    setError(null);
    setDone(false);
  };

  if (done)
    return (
      <div>
        <h1 className="text-xl font-semibold">Thank you</h1>
        <p className="mt-2 text-sm text-slate-600">Your answers were sent. They are anonymous: nobody can tell which answers are yours, and your code cannot be used again.</p>
        <button type="button" onClick={reset} className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm text-white">
          Next person
        </button>
      </div>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const answers = questions.map((q) => (q.kind === "SCALE" ? { questionId: q.id, value: values[q.id] ? Number(values[q.id]) : undefined } : { questionId: q.id, comment: values[q.id] }));
          const r = await submitPublicSurveyAction(surveyId, code, answers);
          if (r.status === "ok") setDone(true);
          else if (r.status === "slow") setError("Too many tries from this connection. Wait a minute and try again.");
          else if (r.status === "bad") setError(r.message ?? "Check your answers and try again.");
          else setError("That code is not valid, or it has already been used. Check it and try again, or ask HR.");
        });
      }}
      className="space-y-4"
    >
      <h1 className="text-xl font-semibold">{title}</h1>
      {intro && <p className="text-sm text-slate-600">{intro}</p>}
      <p className="rounded bg-slate-100 p-3 text-xs text-slate-600">Your answers are anonymous. The code only proves you were invited and lets you answer once; it is separated from your answers the moment you send them.</p>
      <label className="block text-sm font-medium">
        Your access code
        <input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 w-full rounded border p-2 font-mono text-base uppercase" placeholder="e.g. 7K2M-9QDX-4HVB" autoComplete="off" autoCapitalize="characters" required />
      </label>
      {questions.map((q) => (
        <div key={q.id}>
          <label className="block text-sm font-medium" htmlFor={`q_${q.id}`}>
            {q.text}
            {q.kind === "COMMENT" ? " (optional)" : ""}
          </label>
          {q.kind === "SCALE" ? (
            <select id={`q_${q.id}`} value={values[q.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))} className="mt-1 w-full rounded border p-2 text-base">
              <option value="">— Choose —</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n}: {SCALE_LABELS[n]}
                </option>
              ))}
            </select>
          ) : (
            <textarea id={`q_${q.id}`} value={values[q.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))} className="mt-1 w-full rounded border p-2 text-base" rows={3} maxLength={500} />
          )}
        </div>
      ))}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded bg-slate-900 px-4 py-3 text-base text-white disabled:opacity-60">
        {pending ? "Sending…" : "Send my answers"}
      </button>
    </form>
  );
}
