import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { getLetter } from "@/server/services/letters";
import { LETTER_LABELS } from "@/lib/letters";
import { fmtDate } from "@/lib/dates";
import { PageHeader } from "@/components/page";
import { PrintButton } from "@/components/print-button";

export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("hr.view");
  const { id } = await params;
  const l = await getLetter(ctx, id);
  if (!l) notFound();
  // The merged text is plain text: render it as text, keeping the author's line breaks — never as HTML.
  const paragraphs = l.body.split(/\n{2,}/);
  return (
    <>
      <PageHeader
        title={`${l.referenceNumber} — ${LETTER_LABELS[l.type]}`}
        crumbs={[{ href: "/hr/letters", label: "Letters" }]}
        description={`For ${l.recipientName} · issued ${fmtDate(l.createdAt)} by ${l.generatedBy}`}
        actions={<PrintButton />}
      />
      <article className="mx-auto mb-10 max-w-3xl rounded-lg border bg-white p-10 text-[15px] leading-relaxed text-slate-900 shadow-sm print:border-0 print:shadow-none">
        <header className="mb-8 border-b pb-4">
          <p className="text-xl font-semibold tracking-tight">{l.organization.name}</p>
          {l.organization.address && <p className="text-sm text-slate-600">{l.organization.address}</p>}
        </header>
        <div className="mb-6 flex justify-between text-sm text-slate-600">
          <span>Ref: {l.referenceNumber}</span>
          <span>{fmtDate(l.createdAt)}</span>
        </div>
        <p className="mb-6 font-semibold">{l.subject}</p>
        <div className="space-y-4">
          {paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>
        <footer className="mt-14">
          <div className="mb-1 h-10 w-56 border-b border-slate-400" />
          {l.signatoryName && <p className="font-medium">{l.signatoryName}</p>}
          <p className="text-sm text-slate-600">{l.signatoryTitle}</p>
          <p className="text-sm text-slate-600">{l.organization.name}</p>
        </footer>
      </article>
    </>
  );
}
