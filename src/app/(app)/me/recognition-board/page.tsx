import { requirePage } from "@/lib/auth/session";
import { recognitionBoard } from "@/server/services/recognition";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";

export default async function RecognitionBoardPage() {
  const ctx = await requirePage();
  const rows = await recognitionBoard(ctx);
  return (
    <>
      <PageHeader title="Recognition board" description="Colleagues who have been recognised. Only awards the recipient agreed to share appear here." />
      {rows.length === 0 ? (
        <Section title="Nothing yet">
          <Empty>No one has been shown on the board yet.</Empty>
        </Section>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <Section key={r.id} title={r.employeeName} description={`${r.awardName} · ${fmtDate(r.awardedOn)}`}>
              <p className="whitespace-pre-line text-sm">{r.citation}</p>
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
