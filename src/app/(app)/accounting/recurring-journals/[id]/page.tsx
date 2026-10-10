import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { dimensionOptions } from "@/server/services/dimensions";
import { postableAccountOptions } from "@/server/services/journals";
import { getTemplate } from "@/server/services/recurring-journals";
import { KIND_LABELS, STATUS_LABELS, type DocumentStatus, type JournalKind } from "@/lib/journals";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/recurring";
import { DIMENSIONS } from "@/lib/dimensions";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { KV, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { deleteTemplateAction, setTemplateActiveAction } from "@/app/actions/recurring-journals";
import { JournalEditor } from "../../manual-journals/journal-editor";

const tone: Record<DocumentStatus, "gray" | "amber" | "blue" | "green" | "red"> = { DRAFT: "gray", SUBMITTED: "amber", APPROVED: "blue", POSTED: "green", REJECTED: "red", CANCELLED: "gray" };
const isoDay = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");

export default async function RecurringJournalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("gl.view");
  const { id } = await params;
  const t = await getTemplate(ctx, id);
  if (!t) notFound();
  const manage = can(ctx.role, "journal.manage");
  const [accounts, dims] = await Promise.all([manage ? postableAccountOptions(ctx) : Promise.resolve([]), dimensionOptions(ctx)]);
  const nameFor = (column: string, value: string) => (dims[column as keyof typeof dims] ?? []).find((o) => o.value === value)?.label ?? value;
  const dimsOf = (l: (typeof t.lines)[number]) => Object.entries((l.dimensions ?? {}) as Record<string, string>).filter(([, v]) => v);
  const debit = t.lines.reduce((s, l) => s + Number(l.debit), 0);
  const credit = t.lines.reduce((s, l) => s + Number(l.credit), 0);

  return (
    <>
      <PageHeader
        title={t.name}
        crumbs={[{ href: "/accounting/recurring-journals", label: "Recurring journals" }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {!t.active ? <Badge tone="gray">Paused</Badge> : t.nextRunDate ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Finished</Badge>}
            {KIND_LABELS[t.kind as JournalKind]} · {FREQUENCY_LABELS[t.frequency as Frequency].toLowerCase()}
            {t.monthEnd ? " on the last day of the month" : ""} · next {t.nextRunDate ? fmtDate(t.nextRunDate) : "none"}
          </span>
        }
        actions={
          manage ? (
            <span className="flex flex-wrap gap-2">
              {(t.active ? t.nextRunDate : true) && (
                <ActionButton action={setTemplateActiveAction.bind(null, t.id, !t.active)} confirm={t.active ? "Pause this template?" : "Resume this template? Dates missed while it was paused are generated as drafts, under your name."} variant="outline">
                  {t.active ? "Pause" : "Resume"}
                </ActionButton>
              )}
              {t.documents.length === 0 && (
                <ActionButton action={deleteTemplateAction.bind(null, t.id)} confirm="Delete this template? It has not generated anything." variant="outline">
                  Delete
                </ActionButton>
              )}
            </span>
          ) : undefined
        }
      />

      {t.lastRunNote && <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Last run: {t.lastRunNote}</p>}
      <p className="mb-4 text-sm text-muted-foreground">
        Prepared by {t.updatedBy}, who last changed the template, so someone else has to approve what it makes. {t.autoSubmit ? "Each journal is submitted for approval as soon as it is made." : "Each journal is made as a draft for the preparer to check and submit."}
      </p>

      {manage ? (
        <Section title="Edit the template">
          <JournalEditor
            initial={{
              id: t.id,
              kind: t.kind as JournalKind,
              description: t.description,
              postingDate: isoDay(t.startDate),
              reverseOn: "",
              lines: t.lines.map((l) => ({ accountId: l.accountId, description: l.description, debit: Number(l.debit), credit: Number(l.credit), dimensions: (l.dimensions ?? {}) as Record<string, string> })),
            }}
            accounts={accounts}
            dimensionOptions={dims}
            template={{ name: t.name, frequency: t.frequency as Frequency, monthEnd: t.monthEnd, endDate: isoDay(t.endDate), reverseAfterDays: String(t.reverseAfterDays ?? 1), autoSubmit: t.autoSubmit, scheduleLocked: t.generatedCount > 0 }}
          />
        </Section>
      ) : (
        <>
          <Section title="Details">
            <KV
              cols={4}
              items={[
                ["First journal", fmtDate(t.startDate)],
                ["Ends", t.endDate ? fmtDate(t.endDate) : "never"],
                ["Description", t.description],
                ["Reverses after", t.kind === "ACCRUAL" && t.reverseAfterDays ? `${t.reverseAfterDays} day(s)` : "—"],
              ]}
            />
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
                {t.lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <span className="font-mono">{l.account.code}</span> {l.account.name}
                    </TD>
                    <TD className="text-xs">{l.description}</TD>
                    <TD className="max-w-[18rem] whitespace-normal text-xs text-muted-foreground">
                      {dimsOf(l).length ? dimsOf(l).map(([col, v]) => `${DIMENSIONS.find((dm) => dm.column === col)?.label ?? col}: ${nameFor(col, v)}`).join(" · ") : "—"}
                    </TD>
                    <TD className="text-right">{Number(l.debit) ? naira(l.debit) : ""}</TD>
                    <TD className="text-right">{Number(l.credit) ? naira(l.credit) : ""}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="px-4 py-2 text-right text-xs text-muted-foreground">
              Debits {naira(debit)} · Credits {naira(credit)}
            </p>
          </Section>
        </>
      )}

      <Section title={`Journals it has made (${t.documents.length})`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Journal</TH>
              <TH>Posting date</TH>
              <TH>Status</TH>
              <TH>Ledger entry</TH>
            </TR>
          </THead>
          <TBody>
            {t.documents.map((x) => (
              <TR key={x.id}>
                <TD className="font-mono text-xs">
                  <Link className="text-primary underline" href={`/accounting/manual-journals/${x.id}`}>
                    {x.documentNumber}
                  </Link>
                </TD>
                <TD className="text-xs">{fmtDate(x.postingDate)}</TD>
                <TD>
                  <Badge tone={tone[x.status as DocumentStatus]}>{STATUS_LABELS[x.status as DocumentStatus]}</Badge>
                </TD>
                <TD className="text-xs">
                  {x.journal ? (
                    <Link className="text-primary underline" href={`/accounting/journals/${x.journal.id}`}>
                      {x.journal.entryNumber}
                    </Link>
                  ) : (
                    "—"
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!t.documents.length && <p className="px-4 py-3 text-sm text-muted-foreground">Nothing generated yet.</p>}
      </Section>
    </>
  );
}
