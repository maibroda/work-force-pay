import { requirePage } from "@/lib/auth/session";
import { myRecognition } from "@/server/services/recognition";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { announceAgreementAction } from "@/app/actions/recognition";

export default async function MyRecognitionPage() {
  const ctx = await requirePage();
  const rows = await myRecognition(ctx);
  return (
    <>
      <PageHeader
        title="My recognition"
        description="Awards you have received. Some awards may be shown on the company recognition board, but only if you agree: you decide, and you can change your mind at any time."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : rows.length === 0 ? (
        <Section title="Nothing yet">
          <Empty>No award has been recorded for you yet.</Empty>
        </Section>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Section key={r.id} title={r.awardName} description={fmtDate(r.awardedOn)}>
              <p className="whitespace-pre-line text-sm">{r.citation}</p>
              {r.mayAnnounce && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {r.announceAgreed ? <Badge tone="green">Shown on the recognition board</Badge> : <Badge tone="gray">Not shown on the board</Badge>}
                  {r.announceAgreed ? (
                    <ActionButton action={announceAgreementAction.bind(null, r.id, false)} variant="outline">
                      Stop showing it
                    </ActionButton>
                  ) : (
                    <ActionButton action={announceAgreementAction.bind(null, r.id, true)} variant="outline">
                      I agree to it being shown
                    </ActionButton>
                  )}
                </div>
              )}
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
