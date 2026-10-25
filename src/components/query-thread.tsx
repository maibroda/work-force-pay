import { fmtDate } from "@/lib/dates";
import { QUERY_CATEGORY_LABELS, RESPONSE_TARGET_HOURS } from "@/server/services/client-queries";
import { ActionButton } from "@/components/action-button";
import { Section } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";

type Thread = {
  number: string;
  subject: string;
  category: string;
  status: string;
  raisedBy: string;
  createdAt: Date;
  responseHours: number | null;
  waitingHours: number | null;
  overdue: boolean;
  closedBy: string | null;
  closedAt: Date | null;
  messages: { id: string; side: string; authorName: string; body: string; createdAt: Date }[];
};

/** A query's messages, who sent each, and the reply box. The two sides share it; each passes its own reply and close actions. */
export function QueryThread({ q, reply, close, bureauSide }: { q: Thread; reply: (v: Record<string, unknown>) => Promise<{ ok: boolean; message?: string; error?: string }>; close: () => Promise<{ ok: boolean; message?: string; error?: string }>; bureauSide: boolean }) {
  const open = q.status !== "CLOSED";
  return (
    <>
      <Section
        title={`${q.number} — ${q.subject}`}
        description={`${QUERY_CATEGORY_LABELS[q.category as keyof typeof QUERY_CATEGORY_LABELS] ?? q.category} · raised by ${q.raisedBy} on ${fmtDate(q.createdAt)}`}
        actions={
          <span className="flex items-center gap-2">
            {q.status === "CLOSED" ? <Badge>Closed</Badge> : q.status === "ANSWERED" ? <Badge tone="blue">Answered</Badge> : <Badge tone={q.overdue ? "red" : "amber"}>{q.overdue ? "Open — waiting too long" : "Open"}</Badge>}
            {open && (
              <ActionButton action={close} confirm={bureauSide ? "Close this query?" : "Close this query? You can raise a new one any time."} variant="outline">
                Close
              </ActionButton>
            )}
          </span>
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">
          {q.responseHours !== null ? `First reply after ${q.responseHours} hour(s).` : q.waitingHours !== null ? `Waiting ${q.waitingHours} hour(s) for a first reply (target ${RESPONSE_TARGET_HOURS}).` : ""}
          {q.closedAt ? ` Closed by ${q.closedBy} on ${fmtDate(q.closedAt)}.` : ""}
        </p>
        <div className="space-y-3">
          {q.messages.map((m) => (
            <div key={m.id} className={`rounded border px-3 py-2 text-sm ${m.side === "BUREAU" ? "border-blue-200 bg-blue-50/60" : "bg-card"}`}>
              <p className="mb-1 text-xs text-muted-foreground">
                <b>{m.authorName}</b> · {m.side === "BUREAU" ? "bureau" : "client"} · {m.createdAt.toLocaleString("en-GB")}
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
