import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listNotes } from "@/server/services/client-notes";
import { NOTE_REASON_LABELS, NOTE_STATUS_LABELS, NOTE_TYPE_LABELS, type NoteReason, type NoteStatus, type NoteType } from "@/lib/notes";
import { fmtDate } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import { Empty, FilterBar, FilterField, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { decideNoteAction } from "@/app/actions/client-notes";

const tone: Record<NoteStatus, "amber" | "green" | "red"> = { PENDING: "amber", APPROVED: "green", REJECTED: "red" };

export default async function NotesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("gl.view");
  const sp = await searchParams;
  const all = await listNotes(ctx);
  const rows = sp.status ? all.filter((n) => n.status === sp.status) : all;
  const approve = can(ctx.role, "note.approve");
  const pending = all.filter((n) => n.status === "PENDING");
  const signed = (n: (typeof all)[number]) => (n.type === "CREDIT" ? -1 : 1) * num(n.totalAmount);
  const approved = all.filter((n) => n.status === "APPROVED");
  return (
    <>
      <PageHeader
        title="Credit & debit notes"
        description="A credit note reduces what a client owes on an invoice (a billing error, a service credit, a discount); a debit note increases it (an under-billing, a price adjustment, a fee). Raise one from the invoice itself. Someone other than whoever raised it approves it, and approving it posts to the ledger and moves the invoice's balance; the invoice is never edited, and a decided note never changes. A mistaken credit note is put right with a debit note."
      />
      <StatGrid cols={3}>
        <Stat label="Waiting for approval" value={pending.length} tone={pending.length ? "amber" : "green"} />
        <Stat label="Approved" value={approved.length} />
        <Stat label="Net effect on receivables" value={naira(approved.reduce((s, n) => s + signed(n), 0))} />
      </StatGrid>
      <FilterBar>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {(Object.keys(NOTE_STATUS_LABELS) as NoteStatus[]).map((s) => (
              <option key={s} value={s}>
                {NOTE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </FilterField>
      </FilterBar>
      <Section title={`${rows.length} note${rows.length === 1 ? "" : "s"}`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Note</TH>
              <TH>Client</TH>
              <TH>Invoice</TH>
              <TH>Reason</TH>
              <TH>Date</TH>
              <TH className="text-right">Net</TH>
              <TH className="text-right">VAT</TH>
              <TH className="text-right">Total</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((n) => (
              <TR key={n.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/finance/notes/${n.id}`}>
                    {n.noteNumber}
                  </Link>
                  <div className="text-muted-foreground">{NOTE_TYPE_LABELS[n.type as NoteType]}</div>
                </TD>
                <TD>{n.client.name}</TD>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/finance/invoices/${n.invoice.id}`}>
                    {n.invoice.invoiceNumber}
                  </Link>
                </TD>
                <TD className="max-w-[18rem] whitespace-normal text-xs">
                  {NOTE_REASON_LABELS[n.reasonCode as NoteReason]}
                  <div className="text-muted-foreground">{n.reason}</div>
                </TD>
                <TD className="text-xs">{fmtDate(n.noteDate)}</TD>
                <TD className="text-right">{naira(num(n.netAmount))}</TD>
                <TD className="text-right">{num(n.vatAmount) ? naira(num(n.vatAmount)) : "—"}</TD>
                <TD className="text-right font-medium">{naira(num(n.totalAmount))}</TD>
                <TD>
                  <Badge tone={tone[n.status as NoteStatus]}>{NOTE_STATUS_LABELS[n.status as NoteStatus]}</Badge>
                  <div className="text-xs text-muted-foreground">{n.status === "PENDING" ? `Raised by ${n.requestedBy}` : n.decidedBy}</div>
                </TD>
                <TD className="space-x-1 whitespace-nowrap text-right">
                  {n.status === "PENDING" && approve && n.requestedByUserId !== ctx.userId && (
                    <>
                      <ActionButton action={decideNoteAction.bind(null, n.id, true)} confirm={`Approve ${n.noteNumber} for ${naira(num(n.totalAmount))}? It is posted to the ledger and the invoice's balance moves.`} variant="success">
                        Approve
                      </ActionButton>
                      <ActionButton action={decideNoteAction.bind(null, n.id, false)} reason reasonPlaceholder="Why it is being turned down" variant="outline">
                        Turn down
                      </ActionButton>
                    </>
                  )}
                  {n.status === "PENDING" && n.requestedByUserId === ctx.userId && <span className="text-xs text-muted-foreground">Waiting for someone else</span>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No notes{sp.status ? " with that status" : " yet"}. Raise one from an invoice.</Empty>}
      </Section>
    </>
  );
}
