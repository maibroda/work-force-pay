import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { dimensionOptions } from "@/server/services/dimensions";
import { getDocument, postableAccountOptions } from "@/server/services/journals";
import { canEditDocument, KIND_LABELS, STATUS_LABELS, type DocumentStatus, type JournalKind } from "@/lib/journals";
import { DIMENSIONS } from "@/lib/dimensions";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { approveDocumentAction, cancelDocumentAction, postDocumentAction, rejectDocumentAction, submitDocumentAction } from "@/app/actions/journals";
import { JournalEditor } from "../journal-editor";

const tone: Record<DocumentStatus, "gray" | "amber" | "blue" | "green" | "red"> = { DRAFT: "gray", SUBMITTED: "amber", APPROVED: "blue", POSTED: "green", REJECTED: "red", CANCELLED: "gray" };

export default async function JournalDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("gl.view");
  const { id } = await params;
  const doc = await getDocument(ctx, id);
  if (!doc) notFound();
  const status = doc.status as DocumentStatus;
  const manage = can(ctx.role, "journal.manage");
  const approve = can(ctx.role, "journal.approve");
  const editable = canEditDocument(status) && manage;
  const mine = doc.createdByUserId === ctx.userId || doc.submittedByUserId === ctx.userId;
  const debit = doc.lines.reduce((s, l) => s + Number(l.debit), 0);
  const credit = doc.lines.reduce((s, l) => s + Number(l.credit), 0);
  const dimsOf = (l: (typeof doc.lines)[number]) => Object.entries((l.dimensions ?? {}) as Record<string, string>).filter(([, v]) => v);

  const [accounts, dims] = await Promise.all([editable ? postableAccountOptions(ctx) : Promise.resolve([]), dimensionOptions(ctx)]); // dimension names are needed to read a posted journal too
  const nameFor = (column: string, value: string) => (dims[column as keyof typeof dims] ?? []).find((o) => o.value === value)?.label ?? value;

  return (
    <>
      <PageHeader
        title={`${doc.documentNumber} — ${doc.description}`}
        crumbs={[{ href: "/accounting/manual-journals", label: "Manual journals" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={tone[status]}>{STATUS_LABELS[status]}</Badge>
            {KIND_LABELS[doc.kind as JournalKind]} · posts {fmtDate(doc.postingDate)}
            {doc.reverseOn ? ` · reverses itself ${fmtDate(doc.reverseOn)}` : ""}
          </span>
        }
        actions={
          <span className="flex flex-wrap gap-2">
            {editable && (
              <ActionButton action={cancelDocumentAction.bind(null, doc.id)} reason reasonPlaceholder="Why it is being cancelled" variant="outline">
                Cancel journal
              </ActionButton>
            )}
            {manage && status === "DRAFT" && (
              <ActionButton action={submitDocumentAction.bind(null, doc.id)} confirm="Submit this journal for approval? Its lines can't be changed afterwards unless it is returned." variant="outline">
                Submit
              </ActionButton>
            )}
            {approve && status === "SUBMITTED" && !mine && (
              <ActionButton action={approveDocumentAction.bind(null, doc.id)} confirm="Approve this journal? It still has to be posted." variant="success">
                Approve
              </ActionButton>
            )}
            {approve && (status === "SUBMITTED" || status === "APPROVED") && (
              <ActionButton action={rejectDocumentAction.bind(null, doc.id)} reason reasonPlaceholder="What needs fixing" variant="outline">
                Return to preparer
              </ActionButton>
            )}
            {approve && status === "APPROVED" && (
              <ActionButton action={postDocumentAction.bind(null, doc.id)} confirm="Post this journal to the ledger? It can't be edited afterwards; only reversed." variant="success">
                Post
              </ActionButton>
            )}
          </span>
        }
      />

      {doc.recurringJournal && (
        <p className="mb-4 text-sm text-muted-foreground">
          Made by the recurring journal{" "}
          <Link className="text-primary underline" href={`/accounting/recurring-journals/${doc.recurringJournal.id}`}>
            {doc.recurringJournal.name}
          </Link>
          . The amounts can be checked and corrected here before it is submitted.
        </p>
      )}
      {status === "SUBMITTED" && mine && <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">You prepared or submitted this journal, so someone else has to approve it.</p>}

      {editable ? (
        <Section title="Edit the journal">
          <JournalEditor
            initial={{
              id: doc.id,
              kind: doc.kind as JournalKind,
              description: doc.description,
              postingDate: doc.postingDate.toISOString().slice(0, 10),
              reverseOn: doc.reverseOn ? doc.reverseOn.toISOString().slice(0, 10) : "",
              lines: doc.lines.map((l) => ({ accountId: l.accountId, description: l.description, debit: Number(l.debit), credit: Number(l.credit), dimensions: (l.dimensions ?? {}) as Record<string, string> })),
            }}
            accounts={accounts}
            dimensionOptions={dims}
            note={status === "REJECTED" ? doc.decisionNote : null}
          />
        </Section>
      ) : (
        <>
          <Section title="Details">
            <KV
              cols={4}
              items={[
                ["Prepared by", `${doc.createdBy} · ${fmtDate(doc.createdAt)}`],
                ["Submitted", doc.submittedBy ? `${doc.submittedBy} · ${fmtDate(doc.submittedAt)}` : "—"],
                ["Decision", doc.decidedBy ? `${doc.decidedBy} · ${fmtDate(doc.decidedAt)}` : "—"],
                ["Posted", doc.postedBy ? `${doc.postedBy} · ${fmtDate(doc.postedAt)}` : "—"],
                [
                  "Ledger entry",
                  doc.journal ? (
                    <Link key="j" className="text-primary underline" href={`/accounting/journals/${doc.journal.id}`}>
                      {doc.journal.entryNumber}
                    </Link>
                  ) : (
                    "not posted yet"
                  ),
                ],
                ["Reversed by", doc.journal?.reversedBy ? <Link key="r" className="text-primary underline" href={`/accounting/journals/${doc.journal.reversedBy.id}`}>{doc.journal.reversedBy.entryNumber}</Link> : "—"],
              ]}
            />
            {doc.decisionNote && <p className="mt-3 rounded-md bg-muted/50 p-2 text-sm">Note: {doc.decisionNote}</p>}
          </Section>
          <Section title="Lines" flush>
            <Table>
              <THead>
                <TR>
                  <TH>Account</TH>
                  <TH>Narration</TH>
                  <TH>Dimensions</TH>
                  <TH className="text-right">Debit</TH>
                  <TH className="text-right">Credit</TH>
                </TR>
              </THead>
              <TBody>
                {doc.lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <span className="font-mono">{l.account.code}</span> {l.account.name}
                    </TD>
                    <TD className="text-xs">{l.description}</TD>
                    <TD className="max-w-[18rem] whitespace-normal text-xs text-muted-foreground">
                      {dimsOf(l).length ? dimsOf(l).map(([col, v]) => `${DIMENSIONS.find((d) => d.column === col)?.label ?? col}: ${nameFor(col, v)}`).join(" · ") : "—"}
                    </TD>
                    <TD className="text-right">{Number(l.debit) ? naira(l.debit) : ""}</TD>
                    <TD className="text-right">{Number(l.credit) ? naira(l.credit) : ""}</TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR>
                  <TD colSpan={3}>Total</TD>
                  <TD className="text-right">{naira(debit)}</TD>
                  <TD className="text-right">{naira(credit)}</TD>
                </TR>
              </TFoot>
            </Table>
          </Section>
        </>
      )}
    </>
  );
}
