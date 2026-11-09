import { requirePage } from "@/lib/auth/session";
import { FEEDBACK_KIND_LABELS } from "@/lib/feedback";
import { myFeedback } from "@/server/services/feedback";
import { fmtDate } from "@/lib/dates";
import { Empty, PageHeader, Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { replyToFeedbackAction } from "@/app/actions/feedback";

export default async function MyFeedbackPage() {
  const ctx = await requirePage();
  const rows = await myFeedback(ctx);
  return (
    <>
      <PageHeader
        title="My feedback"
        description="Everything your manager or HR has recorded about how you are doing: Recognition (something done well) and Coaching (something to improve, and what would help). Nothing is kept about you that you cannot see here. You can add one reply to each entry."
      />
      {!ctx.employeeId ? (
        <Section title="Not available">
          <p className="text-sm text-muted-foreground">Your login isn&apos;t linked to an employee record yet — ask HR to link it.</p>
        </Section>
      ) : rows.length === 0 ? (
        <Section title="Nothing yet">
          <Empty>No feedback has been recorded about you.</Empty>
        </Section>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Section
              key={r.id}
              title={fmtDate(r.relatesOn)}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.kind === "RECOGNITION" ? "green" : "amber"}>{FEEDBACK_KIND_LABELS[r.kind]}</Badge> from {r.authorName}
                </span>
              }
            >
              <p className="whitespace-pre-line text-sm">{r.body}</p>
              {r.reply ? (
                <p className="mt-2 rounded bg-muted/50 px-2 py-1 text-xs">
                  <b>Your reply:</b> {r.reply}
                </p>
              ) : (
                <div className="mt-3">
                  <SmartForm columns={1} submitLabel="Add my reply" action={replyToFeedbackAction.bind(null, r.id)} fields={[{ name: "reply", label: "Your reply (you can add one)", type: "textarea" }]} />
                </div>
              )}
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
