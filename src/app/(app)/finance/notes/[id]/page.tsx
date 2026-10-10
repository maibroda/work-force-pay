import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getNote } from "@/server/services/client-notes";
import { NOTE_REASON_LABELS, NOTE_STATUS_LABELS, NOTE_TYPE_LABELS, type NoteReason, type NoteStatus, type NoteType } from "@/lib/notes";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { decideNoteAction, withdrawNoteAction } from "@/app/actions/client-notes";

const tone: Record<NoteStatus, "amber" | "green" | "red"> = { PENDING: "amber", APPROVED: "green", REJECTED: "red" };

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("gl.view");
  const { id } = await params;
  const n = await getNote(ctx, id);
  if (!n) notFound();
  const mine = n.requestedByUserId === ctx.userId;
  const approve = can(ctx.role, "note.approve");
  const status = n.status as NoteStatus;
  return (
    <>
      <PageHeader
        title={`${NOTE_TYPE_LABELS[n.type as NoteType]} ${n.noteNumber}`}
        crumbs={[{ href: "/finance/notes", label: "Credit & debit notes" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={tone[status]}>{NOTE_STATUS_LABELS[status]}</Badge>
            {n.client.name} · against{" "}
            <Link className="text-primary underline" href={`/finance/invoices/${n.invoice.id}`}>
              {n.invoice.invoiceNumber}
            </Link>
          </span>
        }
        actions={
          status === "PENDING" ? (
            <span className="flex flex-wrap gap-2">
              {approve && !mine && (
                <>
                  <ActionButton action={decideNoteAction.bind(null, n.id, true)} confirm={`Approve for ${naira(num(n.totalAmount))}? It is posted to the ledger and the invoice's balance moves.`} variant="success">
                    Approve
                  </ActionButton>
                  <ActionButton action={decideNoteAction.bind(null, n.id, false)} reason reasonPlaceholder="Why it is being turned down" variant="outline">
                    Turn down
                  </ActionButton>
                </>
              )}
              {mine && (
                <ActionButton action={withdrawNoteAction.bind(null, n.id)} reason reasonPlaceholder="Why it is being withdrawn" variant="outline">
                  Withdraw
                </ActionButton>
              )}
            </span>
          ) : undefined
        }
      />
      {status === "PENDING" && mine && <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">You raised this note, so someone else has to approve it.</p>}
      <Section title="The note">
        <KV
          cols={4}
          items={[
            ["Date", fmtDate(n.noteDate)],
            ["Reason", NOTE_REASON_LABELS[n.reasonCode as NoteReason]],
            ["Net", naira(num(n.netAmount))],
            ["VAT", num(n.vatAmount) ? naira(num(n.vatAmount)) : "—"],
            ["Total", naira(num(n.totalAmount))],
            ["Raised by", `${n.requestedBy} · ${fmtDate(n.createdAt)}`],
            ["Decision", n.decidedBy ? `${n.decidedBy} · ${fmtDate(n.decidedAt)}` : "—"],
            [
              "Ledger entry",
              n.journal ? (
                <Link key="j" className="text-primary underline" href={`/accounting/journals/${n.journal.id}`}>
                  {n.journal.entryNumber}
                </Link>
              ) : (
                "not posted"
              ),
            ],
          ]}
        />
        <p className="mt-3 rounded-md bg-muted/50 p-2 text-sm">{n.reason}</p>
        {n.decisionNote && <p className="mt-2 text-sm text-muted-foreground">Decision note: {n.decisionNote}</p>}
      </Section>
    </>
  );
}
