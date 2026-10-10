import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listTemplates } from "@/server/services/recurring-journals";
import { KIND_LABELS, type JournalKind } from "@/lib/journals";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/recurring";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { Empty, PageHeader, Section, Stat, StatGrid } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { runDueNowAction, setTemplateActiveAction } from "@/app/actions/recurring-journals";

export default async function RecurringJournalsPage() {
  const ctx = await requirePage("gl.view");
  const rows = await listTemplates(ctx);
  const manage = can(ctx.role, "journal.manage");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const due = rows.filter((r) => r.active && r.nextRunDate && r.nextRunDate <= today);
  const held = rows.filter((r) => r.lastRunNote);

  return (
    <>
      <PageHeader
        title="Recurring journals"
        description="A template for an entry that repeats (rent, insurance amortisation, a standing accrual). Each period it makes an ordinary journal draft; the draft is submitted, approved by someone other than whoever prepared it, and posted like any other. The template itself never touches the ledger, and nothing is ever posted automatically. The preparer of what it makes is whoever last changed the template."
        actions={
          manage ? (
            <Link href="/accounting/recurring-journals/new" className={buttonVariants({})}>
              New template
            </Link>
          ) : undefined
        }
      />
      <StatGrid cols={3}>
        <Stat label="Active templates" value={rows.filter((r) => r.active && r.nextRunDate).length} />
        <Stat label="Due to generate" value={due.length} tone={due.length ? "amber" : "green"} />
        <Stat label="Held as drafts" value={held.length} tone={held.length ? "amber" : "green"} />
      </StatGrid>
      {manage && (
        <div className="mb-4">
          <ActionButton action={runDueNowAction} confirm="Generate the journals that have come due? They are created as drafts (or submitted for approval, where a template says so); nothing is posted." variant="outline">
            Generate what is due
          </ActionButton>
        </div>
      )}
      <Section title={`${rows.length} template${rows.length === 1 ? "" : "s"}`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Template</TH>
              <TH>Kind</TH>
              <TH>Repeats</TH>
              <TH className="text-right">Amount</TH>
              <TH>Next journal</TH>
              <TH className="text-right">Made so far</TH>
              <TH>Status</TH>
              {manage && <TH />}
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="max-w-[20rem] whitespace-normal">
                  <Link className="text-primary underline" href={`/accounting/recurring-journals/${r.id}`}>
                    {r.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{r.description}</div>
                  {r.lastRunNote && <div className="mt-1 text-xs text-amber-800">{r.lastRunNote}</div>}
                </TD>
                <TD className="text-xs">{KIND_LABELS[r.kind as JournalKind]}</TD>
                <TD className="text-xs">
                  {FREQUENCY_LABELS[r.frequency as Frequency]}
                  {r.monthEnd ? ", month end" : ""}
                  {r.endDate && <div className="text-muted-foreground">until {fmtDate(r.endDate)}</div>}
                </TD>
                <TD className="text-right">{naira(r.amount)}</TD>
                <TD className="text-xs">{r.nextRunDate ? fmtDate(r.nextRunDate) : "—"}</TD>
                <TD className="text-right">{r._count.documents}</TD>
                <TD>
                  {!r.active ? <Badge tone="gray">Paused</Badge> : r.nextRunDate ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Finished</Badge>}
                  {r.autoSubmit && <div className="text-xs text-muted-foreground">submits for approval</div>}
                </TD>
                {manage && (
                  <TD className="whitespace-nowrap text-right">
                    {(r.active ? r.nextRunDate : true) && (
                      <ActionButton action={setTemplateActiveAction.bind(null, r.id, !r.active)} confirm={r.active ? "Pause this template? Nothing more is generated until it is resumed." : "Resume this template? Any dates missed while it was paused are generated on the next run, as drafts, under your name."} variant="outline">
                        {r.active ? "Pause" : "Resume"}
                      </ActionButton>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>No recurring journals yet.</Empty>}
      </Section>
    </>
  );
}
