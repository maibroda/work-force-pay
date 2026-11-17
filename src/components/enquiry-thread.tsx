import { fmtDate } from "@/lib/dates";
import { ENQUIRY_CATEGORY_LABELS, type EnquiryCategory } from "@/lib/hr-enquiries";
import { ActionButton } from "@/components/action-button";
import { Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";

type Result = Promise<{ ok: boolean; message?: string; error?: string }>;
type Thread = {
  number: string;
  subject: string;
  category: EnquiryCategory;
  status: string;
  createdAt: Date;
  closedBy: string | null;
  closedAt: Date | null;
  overdue: boolean;
  dueDay: string;
  waitingDays: number | null;
  messages: { id: string; side: string; authorName: string; body: string; createdAt: Date }[];
};

/** An enquiry's messages, who sent each, and the reply box. The employee and HR share it; each passes its own reply and close actions. */
export function EnquiryThread({ q, reply, close, hrSide, canClose = true }: { q: Thread; reply: (v: Record<string, unknown>) => Result; close: () => Result; hrSide: boolean; canClose?: boolean }) {
  const open = q.status !== "CLOSED";
  return (
    <>
      <Section
        title={`${q.number} — ${q.subject}`}
        description={`${ENQUIRY_CATEGORY_LABELS[q.category]} · raised ${fmtDate(q.createdAt)}`}
        actions={
          <span className="flex items-center gap-2">
            {q.status === "CLOSED" ? <Badge>Closed</Badge> : q.status === "ANSWERED" ? <Badge tone="blue">Answered</Badge> : <Badge tone={q.overdue ? "red" : "amber"}>{q.overdue ? "Waiting for HR — past the target" : "Waiting for HR"}</Badge>}
            {open && canClose && (
              <ActionButton action={close} confirm={hrSide ? "Close this enquiry? It cannot be reopened; the employee can raise a new one." : "Close this enquiry? You can raise a new one any time."} variant="outline">
                Close
              </ActionButton>
            )}
          </span>
        }
      >
        {hrSide && q.waitingDays !== null && (
          <p className="mb-3 text-xs text-muted-foreground">
            Waiting {q.waitingDays} working day(s) for a first reply; due by {fmtDate(new Date(`${q.dueDay}T00:00:00Z`))}.
          </p>
        )}
        {q.closedAt && (
          <p className="mb-3 text-xs text-muted-foreground">
            Closed by {q.closedBy} on {fmtDate(q.closedAt)}.
          </p>
        )}
        <div className="space-y-3">
          {q.messages.map((m) => (
            <div key={m.id} className={`rounded border px-3 py-2 text-sm ${m.side === "HR" ? "border-blue-200 bg-blue-50/60" : "bg-card"}`}>
              <p className="mb-1 text-xs text-muted-foreground">
                <b>{m.authorName}</b> · {m.side === "HR" ? "HR" : "employee"} · {m.createdAt.toLocaleString("en-GB")}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
      </Section>
      {open && (
        <Section title="Reply">
          <SmartForm columns={1} submitLabel="Send" resetOnSuccess action={reply} fields={[{ name: "body", label: "Your message", type: "textarea", required: true }]} />
        </Section>
      )}
    </>
  );
}
